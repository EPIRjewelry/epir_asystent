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
import { isString, isRecord } from '../utils/json';
import { callMcpWithRetry, extractMcpTextContent } from '../utils/mcp-client';

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
  return callMcpWithRetry(CANONICAL_MCP_URL, toolName, args, MCP_RETRY_CONFIG);
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

  return extractMcpTextContent(result);
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
