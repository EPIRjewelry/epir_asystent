/**
 * RAG Worker - Main Entry Point
 * 
 * Reusable RAG orchestration worker exposing REST API for:
 * - Product search (MCP primary source)
 * - Policy/FAQ search (MCP + Vectorize fallback)
 * - Full context building (all sources)
 * 
 * DESIGN PRINCIPLES:
 * - MCP ALWAYS primary source (anti-hallucination strategy)
 * - Vectorize as fallback when MCP unavailable
 * - Clean REST API for Service Binding integration
 * - No hardcoded secrets (env.SHOP_DOMAIN from wrangler.toml vars)
 * 
 * ENDPOINTS:
 * - POST /search/products - Product catalog search via MCP
 * - POST /search/policies - FAQ/policies search (MCP + Vectorize)
 * - POST /context/build - Full RAG context for AI consumption
 * - GET /health - Health check
 * 
 * @see workers/worker/src/rag.ts - Original implementation
 * @see Model Agentowy i Ekosystem Shopify.txt - MCP specifications
 */

import {
  orchestrateRag,
  buildRagContext,
  detectIntent,
  UserIntent,
} from './domain/orchestrator';
import {
  formatRagContextForPrompt,
  formatRagForPrompt,
  hasHighConfidenceResults,
} from './domain/formatter';
import { VectorizeIndex, AIBinding } from './services/vectorize';

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  /**
   * Vectorize index for FAQ embeddings
   */
  VECTOR_INDEX?: VectorizeIndex;

  /**
   * Cloudflare AI binding for embeddings
   */
  AI?: AIBinding;

  /**
   * D1 database for caching
   */
  DB?: D1Database;

  /**
   * Shop domain (from wrangler.toml vars)
   */
  SHOP_DOMAIN?: string;

  /**
   * Canonical MCP URL (from wrangler.toml vars)
   */
  CANONICAL_MCP_URL?: string;
}

/**
 * Request body for /search/products
 */
interface ProductSearchRequest {
  query: string;
  productType?: string;
}

/**
 * Request body for /search/policies
 */
interface PolicySearchRequest {
  query: string;
  topK?: number;
}

/**
 * Request body for /context/build
 */
interface ContextBuildRequest {
  query: string;
  intent?: UserIntent;
  cartId?: string | null;
  topK?: number;
}

/**
 * Main Worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // ========================================
      // GET /health - Health check
      // ========================================
      if (url.pathname === '/health' && request.method === 'GET') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'epir-rag-worker',
            timestamp: new Date().toISOString(),
            bindings: {
              vectorIndex: !!env.VECTOR_INDEX,
              ai: !!env.AI,
              db: !!env.DB,
              shopDomain: env.SHOP_DOMAIN || 'not_set',
              mcpUrl: env.CANONICAL_MCP_URL || 'not_set',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      // ========================================
      // POST /search/products - Product search
      // ========================================
      if (url.pathname === '/search/products' && request.method === 'POST') {
        const body = (await request.json()) as ProductSearchRequest;
        const { query, productType = 'biżuteria' } = body;

        if (!query) {
          return new Response(
            JSON.stringify({ error: 'Missing required field: query' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        // Use orchestrator with 'search' intent
        const contextText = await orchestrateRag({
          query,
          intent: 'search',
        });

        return new Response(
          JSON.stringify({ query, context: contextText }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // ========================================
      // POST /search/policies - FAQ/policies search
      // ========================================
      if (url.pathname === '/search/policies' && request.method === 'POST') {
        const body = (await request.json()) as PolicySearchRequest;
        const { query, topK = 3 } = body;

        if (!query) {
          return new Response(
            JSON.stringify({ error: 'Missing required field: query' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        // Use orchestrator with 'faq' intent
        const contextText = await orchestrateRag({
          query,
          intent: 'faq',
          vectorIndex: env.VECTOR_INDEX,
          aiBinding: env.AI,
          topK,
        });

        return new Response(
          JSON.stringify({ query, context: contextText }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // ========================================
      // POST /context/build - Full RAG context
      // ========================================
      if (url.pathname === '/context/build' && request.method === 'POST') {
        const body = (await request.json()) as ContextBuildRequest;
        const { query, intent, cartId, topK = 3 } = body;

        if (!query) {
          return new Response(
            JSON.stringify({ error: 'Missing required field: query' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        // Auto-detect intent if not provided
        const finalIntent = intent || detectIntent(query);

        // Use orchestrator with detected/provided intent
        const contextText = await orchestrateRag({
          query,
          intent: finalIntent,
          cartId,
          vectorIndex: env.VECTOR_INDEX,
          aiBinding: env.AI,
          topK,
        });

        // Alternative: Use buildRagContext for structured result
        // const ragResult = await buildRagContext({
        //   query,
        //   intent: finalIntent,
        //   vectorIndex: env.VECTOR_INDEX,
        //   aiBinding: env.AI,
        //   topK,
        // });
        // const contextText = formatRagForPrompt(ragResult);

        return new Response(
          JSON.stringify({
            query,
            intent: finalIntent,
            context: contextText,
            hasHighConfidence: true, // Could use hasHighConfidenceResults() for structured results
          }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // ========================================
      // 404 Not Found
      // ========================================
      return new Response(
        JSON.stringify({
          error: 'Not Found',
          availableEndpoints: [
            'GET /health',
            'POST /search/products',
            'POST /search/policies',
            'POST /context/build',
          ],
        }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );

    } catch (error: any) {
      console.error('[RAG_WORKER] ❌ Unhandled error:', error);

      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error?.message || 'Unknown error',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  },
};
