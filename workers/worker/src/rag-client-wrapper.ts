/**
 * worker/src/rag-client-wrapper.ts
 * 
 * Hybrid wrapper for RAG functionality:
 * - Uses RAG_WORKER Service Binding (primary)
 * - Falls back to local rag.ts (for backward compatibility)
 * 
 * PURPOSE:
 * - Gradual migration from monolithic rag.ts to microservice RAG Worker
 * - Zero-downtime deployment (works with or without RAG_WORKER binding)
 * - Identical API to rag.ts (drop-in replacement)
 * 
 * MIGRATION PATH:
 * 1. Deploy RAG Worker separately → wrangler deploy in workers/rag-worker
 * 2. Update main worker wrangler.toml with RAG_WORKER binding (DONE)
 * 3. Replace all rag.ts imports with rag-client-wrapper.ts
 * 4. Test thoroughly (fallback should work seamlessly)
 * 5. After 100% migration, remove local rag.ts
 * 
 * @see workers/rag-worker/src/index.ts - RAG Worker implementation
 * @see workers/worker/src/rag.ts - Original implementation (fallback)
 */

import * as LocalRAG from './rag';

/**
 * Environment with optional RAG_WORKER binding
 */
interface Env {
  RAG_WORKER?: Fetcher;
  VECTOR_INDEX?: VectorizeIndex;
  AI?: any; // Cloudflare AI binding
  DB?: D1Database;
  SHOP_DOMAIN?: string;
  SHOPIFY_STOREFRONT_TOKEN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
}

/**
 * Re-export types from rag.ts for backward compatibility
 */
export type { RagResultItem, RagSearchResult } from './rag';

// VectorizeIndex type alias (use 'any' to match rag.ts signature)
export type VectorizeIndex = any;

/**
 * Check if RAG_WORKER Service Binding is available
 * 
 * @param env - Cloudflare Worker environment
 * @returns true if RAG_WORKER exists and is healthy
 */
async function isRAGWorkerAvailable(env: Env): Promise<boolean> {
  if (!env.RAG_WORKER) {
    return false;
  }

  try {
    // Quick health check (max 1 second timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);

    const response = await env.RAG_WORKER.fetch('https://rag-worker/health', {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return response.ok;
  } catch (error) {
    console.warn('[RAG Wrapper] RAG_WORKER health check failed, using fallback:', error);
    return false;
  }
}

/**
 * Search product catalog via MCP
 * 
 * Uses RAG_WORKER if available, otherwise falls back to local rag.ts
 * 
 * @param query - Search query
 * @param shopDomain - Shop domain or env object (for test shim compatibility)
 * @param context - Optional context
 * @returns Formatted product context or result object
 */
export async function searchProductCatalogWithMCP(
  query: string,
  shopDomain: any,
  context?: string
): Promise<any> {
  // Check if shopDomain is actually an Env object (with RAG_WORKER binding)
  const env = (shopDomain && typeof shopDomain === 'object' && 'RAG_WORKER' in shopDomain) 
    ? shopDomain as Env 
    : undefined;

  // Try RAG_WORKER first
  if (env && await isRAGWorkerAvailable(env)) {
    try {
      console.log('[RAG Wrapper] Using RAG_WORKER for product search');

      const response = await env.RAG_WORKER!.fetch('https://rag-worker/search/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          productType: 'biżuteria',
        }),
      });

      if (!response.ok) {
        throw new Error(`RAG_WORKER returned ${response.status}`);
      }

      const data = await response.json() as { context: string };
      return data.context || false;
    } catch (error) {
      console.warn('[RAG Wrapper] RAG_WORKER product search failed, using fallback:', error);
      // Fall through to local RAG
    }
  }

  // Fallback: Local rag.ts
  console.log('[RAG Wrapper] Using local rag.ts for product search');
  return LocalRAG.searchProductCatalogWithMCP(query, shopDomain, context);
}

/**
 * Search shop policies and FAQs via MCP
 * 
 * Uses RAG_WORKER if available, otherwise falls back to local rag.ts
 * 
 * @param query - Search query
 * @param shopDomain - Shop domain
 * @param vectorIndex - Vectorize index (fallback)
 * @param aiBinding - Cloudflare AI binding (fallback)
 * @param topK - Number of results
 * @returns RagSearchResult object
 */
export async function searchShopPoliciesAndFaqsWithMCP(
  query: string,
  shopDomain: string | undefined,
  vectorIndex?: VectorizeIndex,
  aiBinding?: any,
  topK: number = 3
): Promise<LocalRAG.RagSearchResult> {
  // Check if shopDomain is actually an Env object (with RAG_WORKER binding)
  let env: Env | undefined = undefined;
  if (shopDomain && typeof shopDomain === 'object' && shopDomain !== null) {
    if ('RAG_WORKER' in (shopDomain as object)) {
      env = shopDomain as any as Env;
    }
  }

  // Try RAG_WORKER first
  if (env && await isRAGWorkerAvailable(env)) {
    try {
      console.log('[RAG Wrapper] Using RAG_WORKER for FAQ search');

      const response = await env.RAG_WORKER!.fetch('https://rag-worker/search/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK }),
      });

      if (!response.ok) {
        throw new Error(`RAG_WORKER returned ${response.status}`);
      }

      const data = await response.json() as { context: string };
      
      // Convert to RagSearchResult format
      return {
        query,
        results: data.context ? [{
          id: 'mcp_faq',
          text: data.context,
          snippet: data.context.slice(0, 500),
          source: 'mcp' as const,
        }] : [],
      };
    } catch (error) {
      console.warn('[RAG Wrapper] RAG_WORKER FAQ search failed, using fallback:', error);
      // Fall through to local RAG
    }
  }

  // Fallback: Local rag.ts
  console.log('[RAG Wrapper] Using local rag.ts for FAQ search');
  return LocalRAG.searchShopPoliciesAndFaqsWithMCP(query, shopDomain, vectorIndex, aiBinding, topK);
}

/**
 * Search shop policies and FAQs (legacy Vectorize-only version)
 * 
 * @deprecated Use searchShopPoliciesAndFaqsWithMCP instead
 * 
 * @param query - Search query
 * @param vectorIndex - Vectorize index
 * @param aiBinding - Cloudflare AI binding
 * @param topK - Number of results
 * @returns RagSearchResult object
 */
export async function searchShopPoliciesAndFaqs(
  query: string,
  vectorIndex?: VectorizeIndex,
  aiBinding?: any,
  topK: number = 3
): Promise<LocalRAG.RagSearchResult> {
  console.log('[RAG Wrapper] Using local rag.ts for legacy FAQ search (Vectorize-only)');
  const result = await LocalRAG.searchShopPoliciesAndFaqs(query, vectorIndex, aiBinding, topK);
  
  // If result is already RagSearchResult, return it
  if (result && typeof result === 'object' && 'results' in result) {
    return result as LocalRAG.RagSearchResult;
  }
  
  // Otherwise, wrap in RagSearchResult format
  return {
    query,
    results: result ? [{
      id: 'legacy_faq',
      text: typeof result === 'string' ? result : JSON.stringify(result),
      snippet: '',
      source: 'vectorize' as const,
    }] : [],
  };
}

/**
 * Format RAG context for AI prompt
 * 
 * This is a pure formatter function - no need to call RAG_WORKER
 * Always use local implementation for performance
 * 
 * @param ragContext - RAG search results (RagSearchResult object)
 * @returns Formatted context string
 */
export function formatRagContextForPrompt(
  ragContext: LocalRAG.RagSearchResult
): string {
  return LocalRAG.formatRagContextForPrompt(ragContext);
}

/**
 * Build full RAG context via RAG_WORKER
 * 
 * This is the RECOMMENDED function for new code.
 * Uses RAG_WORKER's /context/build endpoint which handles:
 * - Intent detection (search, cart, order, faq)
 * - MCP primary source with Vectorize fallback
 * - Formatted output ready for AI consumption
 * 
 * @param query - User query
 * @param cartId - Optional cart ID
 * @param env - Environment (must have RAG_WORKER binding)
 * @returns Formatted context string
 */
export async function buildRagContext(
  query: string,
  cartId: string | null | undefined,
  env: Env
): Promise<string> {
  // Try RAG_WORKER first
  if (await isRAGWorkerAvailable(env)) {
    try {
      console.log('[RAG Wrapper] Using RAG_WORKER for full context build');

      const response = await env.RAG_WORKER!.fetch('https://rag-worker/context/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          cartId: cartId || undefined,
          topK: 3,
        }),
      });

      if (!response.ok) {
        throw new Error(`RAG_WORKER returned ${response.status}`);
      }

      const data = await response.json() as { context: string };
      return data.context || '';
    } catch (error) {
      console.warn('[RAG Wrapper] RAG_WORKER context build failed, using fallback:', error);
      // Fall through to local RAG
    }
  }

  // Fallback: Use local searchProductCatalogWithMCP
  console.log('[RAG Wrapper] Using local rag.ts for context build');
  const productContext = await LocalRAG.searchProductCatalogWithMCP(query, env.SHOP_DOMAIN || 'epir-art-silver-jewellery.myshopify.com');
  
  // searchProductCatalogWithMCP returns string or object, need to wrap in RagSearchResult
  if (typeof productContext === 'string') {
    return productContext;
  } else if (productContext && typeof productContext === 'object' && 'result' in productContext) {
    return String(productContext.result || '');
  }
  
  return '';
}
