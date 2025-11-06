/**
 * RAG Worker - Service: Shopify MCP Client
 * 
 * Handles all communication with Shopify Merchant Component Platform (MCP).
 * Uses JSON-RPC 2.0 protocol as per MCP specification.
 * 
 * NO API KEY REQUIRED - MCP is a public endpoint for the shop.
 * 
 * @see Harmony Chat_ Shopify, MCP, API, UX.txt - Section III
 * @see workers/worker/src/rag.ts - callMcpTool function
 */

import { CANONICAL_MCP_URL, MCP_RETRY_CONFIG, MCP_TOOLS } from '../config/sources';

/**
 * MCP JSON-RPC 2.0 Request
 */
interface McpRequest {
  jsonrpc: '2.0';
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, any>;
  };
  id: number;
}

/**
 * MCP JSON-RPC 2.0 Response
 */
interface McpResponse {
  jsonrpc?: '2.0';
  id?: number;
  result?: {
    content?: Array<{
      type: string;
      text?: string;
      title?: string;
      [key: string]: any;
    }>;
  };
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Type guard for string
 */
function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/**
 * Type guard for record
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Safe JSON parse with double-encoding support
 * (MCP sometimes returns double-encoded JSON strings)
 */
function safeJsonParse<T = unknown>(input: unknown): T | unknown {
  if (!isString(input)) return input;
  const s = input.trim();
  if (!s) return input;
  
  try {
    const parsed = JSON.parse(s);
    // Check for double-encoding
    if (isString(parsed)) {
      const inner = parsed.trim();
      if (
        (inner.startsWith('{') && inner.endsWith('}')) ||
        (inner.startsWith('[') && inner.endsWith(']'))
      ) {
        try {
          return JSON.parse(inner);
        } catch {
          return parsed;
        }
      }
    }
    return parsed;
  } catch {
    return input;
  }
}

/**
 * Call Shopify MCP tool with retry logic
 * 
 * @param toolName - Name of MCP tool (use MCP_TOOLS constants)
 * @param args - Tool arguments
 * @returns Parsed result or null on error
 * 
 * @example
 * ```typescript
 * const products = await callShopifyMcp(MCP_TOOLS.SEARCH_CATALOG, {
 *   query: 'pierścionki',
 *   context: 'biżuteria'
 * });
 * ```
 */
export async function callShopifyMcp(
  toolName: string,
  args: Record<string, any>
): Promise<any> {
  const payload: McpRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
    id: Date.now(),
  };

  console.log(`[MCP] 📤 Calling tool: ${toolName}`, args);

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt < MCP_RETRY_CONFIG.MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(CANONICAL_MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Handle rate limiting (429)
      if (res.status === 429) {
        const backoff = Math.min(
          MCP_RETRY_CONFIG.INITIAL_BACKOFF_MS * (2 ** attempt),
          MCP_RETRY_CONFIG.MAX_BACKOFF_MS
        );
        console.warn(`[MCP] ⚠️ Rate limited (429), retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      // Handle other HTTP errors
      if (!res.ok) {
        const errorText = await res.text().catch(() => '<no body>');
        console.error(`[MCP] ❌ HTTP ${res.status}:`, errorText);
        
        if (attempt < MCP_RETRY_CONFIG.MAX_ATTEMPTS - 1) {
          const backoff = MCP_RETRY_CONFIG.INITIAL_BACKOFF_MS * (2 ** attempt);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        
        return null;
      }

      // Parse response
      let response: unknown = await res.json().catch(() => null);
      
      // Handle double-encoded JSON
      if (isString(response)) {
        response = safeJsonParse(response);
      }

      if (!isRecord(response)) {
        console.error('[MCP] ❌ Invalid response format');
        return null;
      }

      const mcpResponse = response as McpResponse;

      // Check for JSON-RPC error
      if (mcpResponse.error) {
        console.error('[MCP] ❌ RPC Error:', mcpResponse.error);
        return null;
      }

      // Extract result
      const result = mcpResponse.result;
      if (!result) {
        console.warn('[MCP] ⚠️ Empty result');
        return null;
      }

      console.log(`[MCP] ✅ Tool ${toolName} succeeded`);
      
      // Handle double-encoded result
      if (isString(result)) {
        return safeJsonParse(result);
      }

      return result;

    } catch (err) {
      console.error(`[MCP] ❌ Attempt ${attempt + 1} failed:`, err);
      
      if (attempt < MCP_RETRY_CONFIG.MAX_ATTEMPTS - 1) {
        const backoff = MCP_RETRY_CONFIG.INITIAL_BACKOFF_MS * (2 ** attempt);
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        return null;
      }
    }
  }

  return null;
}

/**
 * Search product catalog via MCP
 */
export async function searchProducts(
  query: string,
  context: string = 'biżuteria'
): Promise<string> {
  const result = await callShopifyMcp(MCP_TOOLS.SEARCH_CATALOG, {
    query,
    context,
  });

  if (!result) return '';

  // Extract text from MCP content array
  if (isRecord(result) && Array.isArray(result.content)) {
    const textContent = result.content
      .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n');
    
    return textContent || '';
  }

  // Fallback: stringify result
  return typeof result === 'string' ? result : JSON.stringify(result);
}

/**
 * Get cart via MCP
 */
export async function getCart(cartId: string): Promise<any> {
  return callShopifyMcp(MCP_TOOLS.GET_CART, { cart_id: cartId });
}

/**
 * Update cart via MCP
 */
export async function updateCart(cartId: string, items: any[]): Promise<any> {
  return callShopifyMcp(MCP_TOOLS.UPDATE_CART, { cart_id: cartId, items });
}

/**
 * Get most recent order status via MCP
 */
export async function getMostRecentOrder(): Promise<any> {
  return callShopifyMcp(MCP_TOOLS.GET_RECENT_ORDER, {});
}

/**
 * Search policies and FAQs via MCP
 */
export async function searchPoliciesFaq(query: string): Promise<any> {
  return callShopifyMcp(MCP_TOOLS.SEARCH_POLICIES_FAQ, { query });
}
