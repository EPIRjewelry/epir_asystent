// MCP Server (JSON-RPC 2.0) dla narzędzi Shopify w trybie single-store.
// Architektura: Wszystkie narzędzia delegują do oficjalnego endpoint MCP sklepu:
//   https://{shop_domain}/api/mcp
// Bez fallbacków na Storefront/Admin API – tzn. bez zależności od tokenów Storefront.
// 
// Strategia błędów (Plan B):
// - Timeout/522/503/AbortError dla search_shop_catalog → fallback: puste produkty + system_note
// - Timeout/AbortError dla innych narzędzi → błąd JSON-RPC (nie fallback)
// - Dzięki temu AI dostaje "sklep niedostępny" zamiast crashu z 401.
//
// Sekrety (SHOPIFY_APP_SECRET) pochodzą TYLKO z Cloudflare Secrets.
// ŻADNYCH sekretów w wrangler.toml [vars] ani w kodzie.
// Endpointy:
// - POST /mcp/tools/call (dev/test bez HMAC)
// - POST /apps/assistant/mcp (App Proxy + HMAC)

import { verifyAppProxyHmac } from './auth';
import { checkRateLimit } from './rate-limiter';
import { 
  type JsonRpcRequest, 
  type JsonRpcResponse,
  createJsonRpcSuccess,
  createJsonRpcError 
} from './utils/jsonrpc';
import type { Env } from './index';
import { normalizeCartId, isValidCartGid } from './utils/cart';
import { withRetry } from './utils/retry';

type JsonRpcId = string | number | null;

function json(headers: HeadersInit = {}) {
  return { 'Content-Type': 'application/json', ...headers };
}

function rpcResult(id: JsonRpcId, result: any): Response {
  const body = createJsonRpcSuccess(id ?? 0, result);
  return new Response(JSON.stringify(body), { status: 200, headers: json() });
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: any): Response {
  const body = createJsonRpcError(id ?? 0, code, message, data);
  return new Response(JSON.stringify(body), { status: 200, headers: json() });
}

const MCP_TIMEOUT_MS = 5000;

const CATALOG_FALLBACK = {
  products: [],
  system_note: 'Sklep jest chwilowo niedostępny (Connection Timeout). Poinformuj klienta o problemie technicznym.'
};

function verifyInternalKey(env: Env, request: Request): { ok: boolean; message?: string } {
  const expected = env.EPIR_INTERNAL_KEY || (process.env as any)?.EPIR_INTERNAL_KEY;
  if (!expected) return { ok: true }; // brak klucza -> nie wymuszamy
  const provided = request.headers.get('X-EPIR-Internal-Key');
  if (provided && provided === expected) return { ok: true };
  return { ok: false, message: 'Unauthorized: Missing or invalid X-EPIR-Internal-Key' };
}

function safeArgsSummary(args: any) {
  if (!args || typeof args !== 'object') return {};
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      summary[key] = `[len:${value.length}]`;
    } else if (Array.isArray(value)) {
      summary[key] = `array(len=${value.length})`;
    } else if (value && typeof value === 'object') {
      summary[key] = 'object';
    } else {
      summary[key] = value;
    }
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
 * Normalize cart-related arguments before calling MCP
 * Fixes cart_id format issues (spaces, missing key, invalid GID)
 */
function normalizeCartArgs(raw: any, sessionCartKey?: string): any {
  const args = { ...raw };
  
  // Remove cart_id if it's null (Shopify MCP doesn't accept null, only undefined or valid string)
  if (args.cart_id === null) {
    delete args.cart_id;
    console.log('[normalizeCartArgs] Removed null cart_id (will create new cart)');
    return args;
  }
  
  // Normalize cart_id if present
  if (args.cart_id) {
    const normalized = normalizeCartId(args.cart_id, sessionCartKey);
    
    if (!normalized) {
      console.warn('[normalizeCartArgs] Invalid cart_id, keeping original:', args.cart_id);
      return args;
    }
    
    args.cart_id = normalized;
    console.log('[normalizeCartArgs] Normalized cart_id:', { original: raw.cart_id, normalized });
  }
  
  return args;
}

async function callShopMcp(env: Env, toolName: string, rawArgs: any): Promise<{ result?: any; error?: any }> {
  const shopDomain = env?.SHOP_DOMAIN || process.env.SHOP_DOMAIN;
  if (!shopDomain) {
    return { error: { code: -32602, message: 'SHOP_DOMAIN not configured' } };
  }

  // Normalize arguments based on tool type
  let args: any;
  if (toolName === 'search_shop_catalog') {
    args = normalizeSearchArgs(rawArgs);
  } else if (toolName === 'get_cart' || toolName === 'update_cart') {
    args = normalizeCartArgs(rawArgs ?? {});
    
    // Validate cart_id for cart operations
    if (args.cart_id && !isValidCartGid(args.cart_id) && !args.cart_id.startsWith('?key=')) {
      console.warn(`[callShopMcp] Invalid cart_id format for ${toolName}:`, args.cart_id);
      return { 
        error: { 
          code: -32602, 
          message: 'Invalid cart_id format. Expected a Shopify Cart GID (e.g., \'gid://shopify/Cart/<id>?key=...\')' 
        } 
      };
    }
  } else {
    args = rawArgs ?? {};
  }

  const rpc: JsonRpcRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: toolName, arguments: args },
    id: Date.now()
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  const endpoint = `https://${String(shopDomain).replace(/\/$/, '')}/api/mcp`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpc),
      signal: controller.signal
    });

    console.log('[mcp] call', { tool: toolName, status: res.status, args: safeArgsSummary(args), timestamp: new Date().toISOString() });

    if (!res.ok) {
      // Plan B: Safe fallback for search_shop_catalog on network/service errors
      if (toolName === 'search_shop_catalog' && (res.status === 522 || res.status === 503 || res.status >= 500)) {
        console.warn(`[mcp] Shop MCP ${res.status} for ${toolName}, returning safe fallback`);
        return { result: CATALOG_FALLBACK };
      }
      const body = await res.text().catch(() => '');
      return { error: { code: res.status, message: `Shop MCP HTTP ${res.status}`, details: body.slice(0, 500) } };
    }

    const json = (await res.json().catch(() => null)) as JsonRpcResponse | null;
    if (!json) {
      if (toolName === 'search_shop_catalog') {
        console.warn('[mcp] Invalid JSON from shop MCP for search_shop_catalog, returning safe fallback');
        return { result: CATALOG_FALLBACK };
      }
      return { error: { code: -32700, message: 'Invalid JSON response from shop MCP' } };
    }
    if ((json as any).error) {
      return { error: (json as any).error };
    }
    return { result: (json as any).result ?? json };
  } catch (err: any) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    const isNetworkError = err instanceof TypeError;
    const errMsg = err?.message || String(err);
    
    // Plan B: Safe fallback for search_shop_catalog on timeout/network errors
    if (toolName === 'search_shop_catalog' && (isAbortError || isNetworkError)) {
      console.warn(`[mcp] Timeout/Network error for ${toolName}, returning safe fallback`, { error: errMsg });
      return { result: CATALOG_FALLBACK };
    }
    
    console.error('[mcp] Shop MCP call failed', { tool: toolName, error: errMsg });
    return { error: { code: -32000, message: 'Shop MCP call failed', details: errMsg } };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function handleToolsCall(env: any, request: Request): Promise<Response> {
  let rpc: JsonRpcRequest | null = null;
  try {
    rpc = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return rpcError(rpc?.id ?? null, -32600, 'Invalid Request');
  }

  if (rpc.method === 'tools/list') {
    const tools = [
      {
        name: 'search_shop_catalog',
        description: 'Search Shopify product catalog using natural language or keywords',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (keywords, product name, category)' },
            context: { type: 'string', description: 'Additional context to help tailor results' }
          },
          required: ['query', 'context']
        }
      },
      {
        name: 'search_shop_policies_and_faqs',
        description: 'Answer questions about policies, shipping, returns, FAQs',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The question about policies or FAQs' },
            context: { type: 'string', description: 'Additional context (optional)' }
          },
          required: ['query']
        }
      },
      {
        name: 'get_cart',
        description: 'Retrieve current shopping cart contents',
        inputSchema: {
          type: 'object',
          properties: {
            cart_id: { type: 'string', description: 'Cart ID to retrieve' }
          },
          required: ['cart_id']
        }
      },
      {
        name: 'update_cart',
        description: 'Add, remove, or update items in the shopping cart',
        inputSchema: {
          type: 'object',
          properties: {
            cart_id: { type: ['string', 'null'], description: 'Cart ID (null for new cart)' },
            lines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  line_item_id: { type: 'string', description: 'Existing cart line ID' },
                  merchandise_id: { type: 'string', description: 'Product variant ID' },
                  quantity: { type: 'number', description: 'Quantity to set' }
                },
                required: ['quantity']
              }
            }
          },
          required: ['lines']
        }
      }
    ];
    return rpcResult(rpc.id ?? null, { tools });
  }

  if (rpc.method !== 'tools/call') {
    return rpcError(rpc.id ?? null, -32601, `Method not found: ${rpc.method}`);
  }

  const name = rpc.params?.name as string | undefined;
  const args = rpc.params?.arguments ?? {};
  if (!name) {
    return rpcError(rpc.id ?? null, -32602, 'Invalid params: "name" required');
  }

  if (name === 'search_shop_catalog' && !args.query) {
    return rpcError(rpc.id ?? null, -32602, 'Invalid params: "query" required for search_shop_catalog');
  }

  const { result, error } = await callShopMcp(env, name, args);

  if (error) {
    return rpcError(rpc.id ?? null, error.code ?? -32000, error.message ?? 'Tool execution failed', error.details ? { details: error.details } : undefined);
  }

  return rpcResult(rpc.id ?? null, result ?? {});
}

/**
 * Direct MCP tool call without HTTP - for internal calls
 */
export async function callMcpToolDirect(env: any, toolName: string, args: any): Promise<any> {
  const { result, error } = await callShopMcp(env, toolName, args);
  if (error) return { error };
  return { result };
}

export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isAppProxy = url.pathname === '/apps/assistant/mcp';
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: json() });
  }

  // Internal key check (dla wywołań z Hydrogen/SSR, nie dotyczy App Proxy)
  if (!isAppProxy) {
    const internalCheck = verifyInternalKey(env, request);
    if (!internalCheck.ok) {
      return new Response(internalCheck.message ?? 'Unauthorized', { status: 401, headers: json() });
    }
  }

  if (isAppProxy) {
    if (!env.SHOPIFY_APP_SECRET) {
      return new Response('Server misconfigured', { status: 500, headers: json() });
    }
    const valid = await verifyAppProxyHmac(request, env.SHOPIFY_APP_SECRET);
    if (!valid) return new Response('Invalid signature', { status: 401, headers: json() });

    // Rate limit per shop for App Proxy MCP calls. Protect backend from abusive loops.
    try {
      const shop = env.SHOP_DOMAIN || process.env.SHOP_DOMAIN || 'global';
      const rl = await checkRateLimit(shop, env as any, 1);
      if (!rl || !rl.allowed) {
        const retryAfter = rl?.retryAfterMs ? String(rl.retryAfterMs) : undefined;
        const headers = { ...json(), ...(retryAfter ? { 'Retry-After': retryAfter } : {}) };
        return new Response('Rate limit exceeded', { status: 429, headers });
      }
    } catch (e) {
      console.warn('[mcp_server] Rate limit check failed, continuing:', e);
      // If rate limit service throws, proceed (fail-open) but log false positives
    }
  }

  return handleToolsCall(env, request);
}