/**
 * RAG Worker - Domain: Orchestrator
 * 
 * Decision logic for RAG data retrieval.
 * Determines WHEN to use MCP vs Vectorize based on intent and availability.
 * 
 * PRIORITY (per architectural guidelines):
 * 1. MCP (Shopify Storefront MCP) - ALWAYS primary source
 * 2. Vectorize (FAQ embeddings) - fallback when MCP unavailable
 * 3. Cache (D1) - performance optimization layer
 * 
 * @see workers/worker/src/rag.ts - searchProductsAndCartWithMCP
 * @see Model Agentowy i Ekosystem Shopify.txt - Section 4.1 (MCP as Anti-Hallucination)
 */

import {
  searchProducts,
  getCart,
  getMostRecentOrder,
  searchPoliciesFaq,
} from '../services/shopify-mcp';
import { searchFaqVectorize, VectorizeIndex, AIBinding } from '../services/vectorize';
import { RagSearchResult, RagResultItem } from './formatter';

/**
 * User intent types
 */
export type UserIntent = 'search' | 'cart' | 'order' | 'faq' | null;

/**
 * RAG orchestration options
 */
export interface RagOptions {
  query: string;
  intent?: UserIntent;
  cartId?: string | null;
  vectorIndex?: VectorizeIndex;
  aiBinding?: AIBinding;
  topK?: number;
}

/**
 * Detect user intent from query
 * 
 * @param query - User query
 * @returns Detected intent
 */
export function detectIntent(query: string): UserIntent {
  const msg = query.toLowerCase();

  const cartKeywords = [
    'koszyk', 'dodaj do koszyka', 'w koszyku', 'zawartość koszyka',
    'co mam w koszyku', 'usuń z koszyka', 'aktualizuj koszyk', 'pokaż koszyk',
    'cart', 'add to cart', 'show cart', 'my cart', 'what is in my cart', 'update cart'
  ];

  const orderKeywords = [
    'zamówienie', 'mojego zamówienia', 'status zamówienia', 'moje zamówienie',
    'śledzenie', 'śledzenie przesyłki', 'gdzie jest', 'kiedy dotrze', 'ostatnie zamówienie',
    'order status', 'order', 'track my order', 'recent order', 'where is my package'
  ];

  const faqKeywords = [
    'polityka', 'zwrot', 'wysyłka', 'dostawa', 'reklamacja', 'gwarancja',
    'policy', 'return', 'shipping', 'delivery', 'complaint', 'warranty', 'faq'
  ];

  if (cartKeywords.some(keyword => msg.includes(keyword))) {
    return 'cart';
  }
  if (orderKeywords.some(keyword => msg.includes(keyword))) {
    return 'order';
  }
  if (faqKeywords.some(keyword => msg.includes(keyword))) {
    return 'faq';
  }

  // Default: product search
  return 'search';
}

/**
 * Orchestrate RAG data retrieval
 * 
 * Main orchestration function that decides which data sources to use
 * based on intent and availability.
 * 
 * @param options - RAG orchestration options
 * @returns Formatted context string for AI consumption
 * 
 * @example
 * ```typescript
 * const context = await orchestrateRag({
 *   query: 'Jakie masz pierścionki?',
 *   intent: 'search',
 *   vectorIndex: env.VECTOR_INDEX,
 *   aiBinding: env.AI,
 * });
 * ```
 */
export async function orchestrateRag(options: RagOptions): Promise<string> {
  const { query, intent, cartId, vectorIndex, aiBinding, topK = 3 } = options;

  let output = '';

  try {
    // CART INTENT: Get cart data via MCP
    if (intent === 'cart' && cartId) {
      console.log('[Orchestrator] 🛒 Cart intent detected');
      
      const cartRaw = await getCart(cartId);
      
      if (cartRaw && cartRaw.content) {
        const cartText = cartRaw.content
          .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n');
        
        if (cartText) {
          output += `\n[KOSZYK (MCP)]\n${cartText}\n`;
        }
      }
    }

    // ORDER INTENT: Get order status via MCP
    if (intent === 'order') {
      console.log('[Orchestrator] 📦 Order intent detected');
      
      const orderRaw = await getMostRecentOrder();
      
      if (orderRaw && orderRaw.content) {
        const orderText = orderRaw.content
          .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n');
        
        if (orderText) {
          output += `\n[OSTATNIE ZAMÓWIENIE (MCP)]\n${orderText}\n`;
        }
      }
    }

    // FAQ INTENT: Try MCP first, fallback to Vectorize
    if (intent === 'faq') {
      console.log('[Orchestrator] ❓ FAQ intent detected');
      
      // Try MCP first (PRIMARY source)
      const mcpFaq = await searchPoliciesFaq(query);
      
      if (mcpFaq && mcpFaq.content && mcpFaq.content.length > 0) {
        const faqText = mcpFaq.content
          .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n');
        
        if (faqText) {
          output += `\n[FAQ/POLITYKI (MCP)]\n${faqText}\n`;
        }
      } else if (vectorIndex && aiBinding) {
        // Fallback: Vectorize semantic search
        console.log('[Orchestrator] 🔄 MCP FAQ unavailable, using Vectorize fallback');
        
        const vectorResults = await searchFaqVectorize(query, vectorIndex, aiBinding, topK);
        
        if (vectorResults.length > 0) {
          output += `\n[FAQ/POLITYKI (Vectorize)]\n`;
          vectorResults.forEach((r, idx) => {
            output += `${idx + 1}. ${r.title || r.id}: ${r.snippet}\n`;
          });
        }
      }
    }

    // SEARCH INTENT (default): Product search via MCP
    if (intent === 'search' || !intent) {
      console.log('[Orchestrator] 🔍 Product search intent');
      
      const productContext = await searchProducts(query, 'biżuteria');
      
      if (productContext) {
        output += `\n${productContext}\n`;
      }
    }

    // Always return a string, never false/undefined
    return output.trim();

  } catch (error) {
    console.error('[Orchestrator] ❌ Error:', error);
    return '';
  }
}

/**
 * Build full RAG context with structured results
 * 
 * Alternative to orchestrateRag that returns structured RagSearchResult
 * instead of plain string. Useful for fine-grained control.
 * 
 * @param options - RAG orchestration options
 * @returns Structured RAG search result
 */
export async function buildRagContext(options: RagOptions): Promise<RagSearchResult> {
  const { query, intent, vectorIndex, aiBinding, topK = 3 } = options;

  const results: RagResultItem[] = [];

  try {
    // FAQ search: MCP primary, Vectorize fallback
    if (intent === 'faq') {
      const mcpFaq = await searchPoliciesFaq(query);
      
      if (mcpFaq && mcpFaq.content && mcpFaq.content.length > 0) {
        mcpFaq.content
          .filter((c: any) => c.type === 'text')
          .forEach((c: any, idx: number) => {
            results.push({
              id: `faq_mcp_${idx + 1}`,
              title: c.title || undefined,
              text: c.text || '',
              snippet: (c.text || '').slice(0, 500),
              source: 'mcp',
              metadata: c,
            });
          });
      } else if (vectorIndex && aiBinding) {
        const vectorResults = await searchFaqVectorize(query, vectorIndex, aiBinding, topK);
        results.push(...vectorResults);
      }
    }

    // Product search via MCP
    if (intent === 'search' || !intent) {
      const productText = await searchProducts(query, 'biżuteria');
      
      if (productText) {
        results.push({
          id: 'products_mcp',
          text: productText,
          snippet: productText.slice(0, 500),
          source: 'mcp',
        });
      }
    }

    return { query, results };

  } catch (error) {
    console.error('[Orchestrator] ❌ buildRagContext error:', error);
    return { query, results: [] };
  }
}
