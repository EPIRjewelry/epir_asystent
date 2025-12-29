/**
 * Shopify MCP Client - wywołuje oficjalny endpoint MCP Shopify
 * https://{shop_domain}/api/mcp
 * 
 * Używa Storefront API (publiczne, nie wymaga Admin Token)
 * Wymaga tylko SHOPIFY_STOREFRONT_TOKEN jako secret
 */

import { type McpRequest, type McpResponse } from './utils/jsonrpc';

export interface Env {
  SHOP_DOMAIN?: string;
}

const MCP_TIMEOUT_MS = 5000;

const CATALOG_FALLBACK = {
  products: [],
  system_note: 'Sklep jest chwilowo niedostępny (Connection Timeout). Poinformuj klienta o problemie technicznym.'
};

function safeArgsSummary(args: any) {
  if (!args || typeof args !== 'object') return {};
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') summary[key] = `[len:${value.length}]`;
    else if (Array.isArray(value)) summary[key] = `array(len=${value.length})`;
    else if (value && typeof value === 'object') summary[key] = 'object';
    else summary[key] = value;
  }
  return summary;
}

function normalizeSearchArgs(raw: any) {
  const args = { ...raw };
  args.first = typeof args.first === 'number' ? args.first : 5;
  args.context = typeof args.context === 'string' && args.context.trim().length > 0 ? args.context : 'biżuteria';
  return args;
}

/**
 * Wywołuje narzędzie MCP Shopify (search_shop_catalog, get_shop_policies, etc.)
 * @param toolName Nazwa narzędzia (np. "search_shop_catalog")
 * @param args Argumenty narzędzia
 * @param env Env z SHOP_DOMAIN i SHOPIFY_STOREFRONT_TOKEN
 * @returns Wynik MCP (result.content[0].text lub error)
 */
export async function callShopifyMcpTool(
  toolName: string,
  args: Record<string, any>,
  env: Env
): Promise<any> {
  const shopDomain = env.SHOP_DOMAIN || process.env.SHOP_DOMAIN;
  if (!shopDomain) {
    throw new Error('SHOP_DOMAIN not configured in wrangler.toml [vars]');
  }

  const normalizedArgs = toolName === 'search_shop_catalog' ? normalizeSearchArgs(args) : args ?? {};
  const mcpEndpoint = `https://${String(shopDomain).replace(/\/$/, '')}/api/mcp`;

  const request: McpRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: normalizedArgs
    },
    id: Date.now()
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);

  try {
    const response = await fetch(mcpEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    console.log('[Shopify MCP] call', { tool: toolName, status: response.status, args: safeArgsSummary(normalizedArgs) });

    if (!response.ok) {
      if (toolName === 'search_shop_catalog' && response.status === 522) {
        return CATALOG_FALLBACK;
      }
      const text = await response.text().catch(() => '<no body>');
      throw new Error(`Shopify MCP HTTP ${response.status}: ${text}`);
    }

    const mcpResponse: McpResponse | null = await response.json().catch(() => null);
    if (!mcpResponse) {
      throw new Error('Shopify MCP returned invalid JSON');
    }
    if (mcpResponse.error) {
      throw new Error(`Shopify MCP error ${mcpResponse.error.code}: ${mcpResponse.error.message}`);
    }
    return (mcpResponse as any).result ?? mcpResponse;
  } catch (err: any) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    const isNetworkError = err instanceof TypeError;
    if (toolName === 'search_shop_catalog' && (isAbortError || isNetworkError)) {
      return CATALOG_FALLBACK;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Wyszukuje produkty w katalogu Shopify przez MCP endpoint
 */
export async function searchShopCatalogMcp(
  query: string,
  env: Env,
  context?: string
): Promise<string> {
  return callShopifyMcpTool('search_shop_catalog', { query, context }, env);
}

/**
 * Pobiera polityki sklepu przez MCP endpoint
 */
export async function getShopPoliciesMcp(
  policyTypes: string[],
  env: Env
): Promise<string> {
  return callShopifyMcpTool('get_shop_policies', { policy_types: policyTypes }, env);
}

/**
 * Aktualizuje koszyk - dodaje, usuwa lub zmienia ilość produktów
 * @param env Env z SHOP_DOMAIN i SHOPIFY_STOREFRONT_TOKEN
 * @param cartId ID istniejącego koszyka (null dla nowego koszyka)
 * @param lines Tablica linii koszyka z merchandiseId i quantity
 * @returns Zaktualizowany koszyk jako JSON string
 */
export async function updateCart(
  env: Env,
  cartId: string | null,
  lines: Array<{ merchandiseId: string; quantity: number }>
): Promise<string> {
  const result = await callShopifyMcpTool('update_cart', { cart_id: cartId, lines }, env);
  return JSON.stringify(result ?? {});
}

/**
 * Pobiera aktualny koszyk
 * @param env Env z SHOP_DOMAIN i SHOPIFY_STOREFRONT_TOKEN
 * @param cartId ID koszyka do pobrania
 * @returns Koszyk jako JSON string z produktami i cenami
 */
export async function getCart(
  env: Env,
  cartId: string
): Promise<string> {
  const result = await callShopifyMcpTool('get_cart', { cart_id: cartId }, env);
  return JSON.stringify(result ?? {});
}

/**
 * Pobiera status konkretnego zamówienia
 * @param env Env z SHOP_DOMAIN i SHOPIFY_STOREFRONT_TOKEN
 * @param orderId ID zamówienia
 * @returns Status zamówienia jako JSON string
 */
export async function getOrderStatus(
  env: Env,
  orderId: string
): Promise<string> {
  const result = await callShopifyMcpTool('get_order_status', { order_id: orderId }, env);
  return JSON.stringify(result ?? {});
}

/**
 * Pobiera status ostatniego zamówienia klienta
 * @param env Env z SHOP_DOMAIN i SHOPIFY_STOREFRONT_TOKEN
 * @returns Ostatnie zamówienie jako JSON string
 */
export async function getMostRecentOrderStatus(
  env: Env
): Promise<string> {
  const result = await callShopifyMcpTool('get_most_recent_order_status', {}, env);
  return JSON.stringify(result ?? {});
}

/**
 * Fetch basic customer details from Admin API (firstName, lastName, email)
 */
export async function getCustomerById(env: Env, customerId: string): Promise<{ firstName?: string; lastName?: string; email?: string } | null> {
  try {
    const shopDomain = env.SHOP_DOMAIN || process.env.SHOP_DOMAIN;
    if (!shopDomain) throw new Error('SHOP_DOMAIN not configured');
    const adminToken = env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!adminToken) throw new Error('SHOPIFY_ADMIN_TOKEN not configured');

    const query = `query customer($id: ID!) { customer(id: $id) { firstName lastName email } }`;
    const endpoint = `https://${shopDomain}/admin/api/2024-07/graphql.json`;
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken }, body: JSON.stringify({ query, variables: { id: customerId } }) });
    if (!response.ok) return null;
    const json: any = await response.json().catch(() => null);
    const customer = json?.data?.customer;
    if (!customer) return null;
    return { firstName: customer.firstName, lastName: customer.lastName, email: customer.email };
  } catch (e) {
    console.warn('getCustomerById error:', e);
    return null;
  }
}
