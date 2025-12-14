/**
 * workers/worker/src/handlers/mcp_fetcher.ts
 * 
 * MCP Fetcher - JSON-RPC client for Shopify MCP endpoint
 * 
 * Purpose:
 * - Execute JSON-RPC calls to Shopify MCP endpoint (https://{shop}.myshopify.com/api/mcp)
 * - Normalize responses to standard passage format
 * - Handle errors and provide fallback mechanisms
 * - Support various MCP methods (search_dev_docs, search_products, etc.)
 * 
 * Usage:
 * ```typescript
 * import { fetchMCP } from './handlers/mcp_fetcher';
 * 
 * const passages = await fetchMCP(
 *   'epir-art-silver-jewellery.myshopify.com',
 *   'What is the return policy?',
 *   { topK: 5, adminToken: env.SHOPIFY_ADMIN_TOKEN }
 * );
 * 
 * console.log(passages); // [{ text: '...', score: 0.95, source: '...' }, ...]
 * ```
 */

/**
 * Passage structure returned by fetchMCP
 */
export interface MCPPassage {
  /** Passage text content */
  text: string;
  
  /** Relevance score (0-1) */
  score: number;
  
  /** Source identifier (e.g., 'FAQ: Return Policy', 'Product: Ring #12345') */
  source: string;
}

/**
 * JSON-RPC request structure
 */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
  id: string | number;
}

/**
 * JSON-RPC response structure
 */
interface JSONRPCResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number;
}

/**
 * Options for MCP fetcher
 */
export interface MCPFetcherOptions {
  /** Shopify Admin API token (for authenticated requests) */
  adminToken?: string;
  
  /** Number of top results to return (default: 5) */
  topK?: number;
  
  /** MCP endpoint path (default: '/api/mcp') */
  endpointPath?: string;
  
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
  
  /** MCP method to call (default: 'search_dev_docs') */
  method?: string;
}

/**
 * Fetch passages from Shopify MCP endpoint
 * 
 * Executes a JSON-RPC call to the Shopify MCP endpoint and normalizes
 * the response to a standard passage format.
 * 
 * @param shopDomain - Shopify shop domain (e.g., 'my-shop.myshopify.com')
 * @param query - Search query text
 * @param opts - Optional configuration
 * @returns Promise<MCPPassage[]> - Array of passages
 * 
 * @throws Error if MCP request fails or returns error
 * 
 * @example
 * const passages = await fetchMCP(
 *   'epir-art-silver-jewellery.myshopify.com',
 *   'sterling silver rings',
 *   { topK: 3, method: 'search_products' }
 * );
 */
export async function fetchMCP(
  shopDomain: string,
  query: string,
  opts?: MCPFetcherOptions
): Promise<MCPPassage[]> {
  // Validate inputs
  if (!shopDomain || shopDomain.trim().length === 0) {
    throw new Error('fetchMCP: shopDomain is required');
  }
  
  if (!query || query.trim().length === 0) {
    throw new Error('fetchMCP: query is required');
  }
  
  // Parse options
  const {
    adminToken,
    topK = 5,
    endpointPath = '/api/mcp',
    timeout = 10000,
    method = 'search_dev_docs'
  } = opts || {};
  
  // Construct MCP endpoint URL
  const mcpUrl = `https://${shopDomain}${endpointPath}`;
  
  // Build JSON-RPC request
  const rpcRequest: JSONRPCRequest = {
    jsonrpc: '2.0',
    method,
    params: {
      q: query,
      top_k: topK
    },
    id: `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  };
  
  try {
    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'EPIR-Assistant/1.0'
      },
      body: JSON.stringify(rpcRequest),
      signal: AbortSignal.timeout(timeout)
    };
    
    // Add authentication if token provided
    if (adminToken) {
      fetchOptions.headers = {
        ...fetchOptions.headers,
        'X-Shopify-Access-Token': adminToken
      };
    }
    
    // Execute request
    const response = await fetch(mcpUrl, fetchOptions);
    
    // Check HTTP status
    if (!response.ok) {
      throw new Error(
        `MCP request failed: HTTP ${response.status} ${response.statusText}`
      );
    }
    
    // Parse JSON-RPC response
    const rpcResponse: JSONRPCResponse = await response.json();
    
    // Check for JSON-RPC error
    if (rpcResponse.error) {
      throw new Error(
        `MCP JSON-RPC error: ${rpcResponse.error.message} (code: ${rpcResponse.error.code})`
      );
    }
    
    // Normalize result to passages
    const passages = normalizeResultToPassages(rpcResponse.result, method);
    
    return passages;
    
  } catch (error) {
    // Handle timeout
    if (error instanceof Error && error.name === 'TimeoutError') {
      console.error('fetchMCP: Request timeout', { shopDomain, query, method });
      throw new Error('MCP request timeout. Please try again.');
    }
    
    // Handle network errors
    if (error instanceof TypeError) {
      console.error('fetchMCP: Network error', { shopDomain, query, error });
      throw new Error('MCP network error. Please check connectivity.');
    }
    
    // Re-throw other errors
    console.error('fetchMCP: Error', { shopDomain, query, method, error });
    throw error;
  }
}

/**
 * Normalize MCP result to standard passage format
 * 
 * Different MCP methods return different result structures.
 * This function normalizes them to a consistent MCPPassage[] format.
 * 
 * @param result - Raw JSON-RPC result
 * @param method - MCP method name
 * @returns MCPPassage[] - Normalized passages
 */
function normalizeResultToPassages(result: any, method: string): MCPPassage[] {
  if (!result) {
    return [];
  }
  
  try {
    // Handle search_dev_docs format
    if (method === 'search_dev_docs') {
      if (Array.isArray(result.passages)) {
        return result.passages.map((p: any, idx: number) => ({
          text: String(p.text || p.content || ''),
          score: typeof p.score === 'number' ? p.score : 1.0 - (idx * 0.1),
          source: String(p.source || p.title || `Document ${idx + 1}`)
        }));
      }
      
      if (Array.isArray(result)) {
        return result.map((p: any, idx: number) => ({
          text: String(p.text || p.content || p),
          score: typeof p.score === 'number' ? p.score : 1.0 - (idx * 0.1),
          source: String(p.source || `Result ${idx + 1}`)
        }));
      }
    }
    
    // Handle search_products format
    if (method === 'search_products') {
      if (Array.isArray(result.products)) {
        return result.products.map((p: any, idx: number) => ({
          text: formatProductAsText(p),
          score: typeof p.relevance === 'number' ? p.relevance : 1.0 - (idx * 0.1),
          source: `Product: ${p.title || p.name || p.id || idx + 1}`
        }));
      }
    }
    
    // Generic array handling
    if (Array.isArray(result)) {
      return result.map((item: any, idx: number) => ({
        text: String(item.text || item.content || item.description || JSON.stringify(item)),
        score: typeof item.score === 'number' ? item.score : 1.0 - (idx * 0.1),
        source: String(item.source || item.title || `Item ${idx + 1}`)
      }));
    }
    
    // Single result object
    if (typeof result === 'object') {
      return [{
        text: String(result.text || result.content || result.description || JSON.stringify(result)),
        score: typeof result.score === 'number' ? result.score : 1.0,
        source: String(result.source || result.title || 'Result')
      }];
    }
    
    // Fallback: empty array
    console.warn('normalizeResultToPassages: Unexpected result format', { method, result });
    return [];
    
  } catch (error) {
    console.error('normalizeResultToPassages: Error', { method, error });
    return [];
  }
}

/**
 * Format product object as readable text
 */
function formatProductAsText(product: any): string {
  const parts: string[] = [];
  
  if (product.title) parts.push(`Title: ${product.title}`);
  if (product.description) parts.push(`Description: ${product.description}`);
  if (product.price) parts.push(`Price: ${product.price}`);
  if (product.variants && Array.isArray(product.variants)) {
    parts.push(`Variants: ${product.variants.length}`);
  }
  if (product.tags && Array.isArray(product.tags)) {
    parts.push(`Tags: ${product.tags.join(', ')}`);
  }
  
  return parts.join(' | ');
}

/**
 * Build RAG context summary from passages
 * 
 * Creates a formatted summary of top passages for inclusion in prompt.
 * 
 * @param passages - Array of passages
 * @param maxPassages - Maximum number of passages to include (default: 5)
 * @returns Formatted context string
 * 
 * @example
 * const summary = buildRagContextSummary(passages, 3);
 * // Returns:
 * // "Top 3 relevant passages:
 * //  1. [Score: 0.95, Source: FAQ] Return policy text...
 * //  2. [Score: 0.87, Source: Product] Product description...
 * //  3. [Score: 0.82, Source: Policy] Shipping info..."
 */
export function buildRagContextSummary(
  passages: MCPPassage[],
  maxPassages: number = 5
): string {
  if (!passages || passages.length === 0) {
    return 'No relevant information found.';
  }
  
  const topPassages = passages.slice(0, maxPassages);
  const lines = [`Top ${topPassages.length} relevant passages:\n`];
  
  topPassages.forEach((p, idx) => {
    const scoreStr = p.score.toFixed(2);
    const preview = p.text.slice(0, 200) + (p.text.length > 200 ? '...' : '');
    lines.push(`${idx + 1}. [Score: ${scoreStr}, Source: ${p.source}] ${preview}`);
  });
  
  return lines.join('\n');
}
