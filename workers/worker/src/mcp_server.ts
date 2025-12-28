// MCP Server (JSON-RPC 2.0) dla narzędzi Shopify w trybie single-store.
// Sekrety (SHOPIFY_APP_SECRET, SHOPIFY_ADMIN_TOKEN) pochodzą TYLKO z Cloudflare Secrets.
// ŻADNYCH sekretów w wrangler.toml [vars] ani w kodzie.
// Endpointy:
// - POST /mcp/tools/call (dev/test bez HMAC)
// - POST /apps/assistant/mcp (App Proxy + HMAC)
// Narzędzia: get_product, search_shop_catalog (Shopify Admin GraphQL 2024-07)

import { verifyAppProxyHmac } from './auth';
import { checkRateLimit } from './rate-limiter';
import { searchProductCatalog, getShopPolicies } from './mcp';
import {
  updateCart,
  getCart,
  getOrderStatus,
  getMostRecentOrderStatus
} from './shopify-mcp-client';
import { adminGraphql } from './utils/shopify-graphql';
import { 
  type JsonRpcRequest, 
  type JsonRpcResponse,
  createJsonRpcSuccess,
  createJsonRpcError 
} from './utils/jsonrpc';
import type { Env } from './index';

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

async function toolGetProduct(env: Env, args: any) {
  const id = String(args?.id || '').trim();
  if (!id) throw new Error('get_product: Missing "id"');
  const data = await adminGraphql<{ product: any }>(
    env,
    `query Product($id: ID!) {
      product(id: $id) {
        id title handle descriptionHtml onlineStoreUrl vendor tags
        variants(first: 10) { edges { node { id title price } } }
        featuredImage { url altText }
      }
    }`,
    { id }
  );
  return data.product;
}

async function toolSearchProducts(env: Env, args: any) {
  const query = String(args?.query || '').trim();
  if (!query) throw new Error('search_shop_catalog: Missing "query"');
  const data = await adminGraphql<{ products: { edges: { node: any }[] } }>(
    env,
    `query Search($query: String!) {
      products(first: 10, query: $query) {
        edges { node { id title handle vendor onlineStoreUrl featuredImage { url altText } } }
      }
    }`,
    { query }
  );
  return data.products?.edges?.map(e => e.node) ?? [];
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
        description: 'Search Shopify product catalog',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, first: { type: 'number', default: 5 } } }
      },
      {
        name: 'search_shop_policies_and_faqs',
        description: 'Search shop policies and FAQs',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, context: { type: 'string' } } }
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
                  merchandiseId: { type: 'string', description: 'Product variant ID' },
                  quantity: { type: 'number', description: 'Quantity to add/update' }
                },
                required: ['merchandiseId', 'quantity']
              }
            }
          },
          required: ['lines']
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
        name: 'get_order_status',
        description: 'Get status and details of a specific order',
        inputSchema: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: 'Order ID to check' }
          },
          required: ['order_id']
        }
      },
      {
        name: 'get_most_recent_order_status',
        description: 'Get status of the most recent order',
        inputSchema: { type: 'object', properties: {} }
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

  try {
    switch (name) {
      case 'search_shop_catalog': {
        if (!args.query) {
          return rpcError(rpc.id ?? null, -32602, 'Invalid params: "query" required for search_shop_catalog');
        }
        const result = await searchProductCatalog({ query: args.query, first: args.first || 5 }, env);
        return rpcResult(rpc.id ?? null, result);
      }
      case 'search_shop_policies_and_faqs': {
        if (!args.query) {
          return rpcError(rpc.id ?? null, -32602, 'Invalid params: "query" required for search_shop_policies_and_faqs');
        }
        const result = await getShopPolicies({ policy_types: ['termsOfService', 'shippingPolicy', 'refundPolicy', 'privacyPolicy', 'subscriptionPolicy'] }, env);
        return rpcResult(rpc.id ?? null, result);
      }
      case 'update_cart': {
        // Walidacja params
        if (!args.lines || !Array.isArray(args.lines)) {
          return rpcError(rpc.id ?? null, -32602, 'Invalid params: "lines" array required for update_cart');
        }
        // Sprawdź, czy każda linia ma wymagane pola
        for (const line of args.lines) {
          if (!line.merchandiseId || typeof line.quantity !== 'number') {
            return rpcError(rpc.id ?? null, -32602, 'Invalid params: each line must have "merchandiseId" and "quantity"');
          }
        }
        const result = await updateCart(env, args.cart_id || null, args.lines);
        return rpcResult(rpc.id ?? null, { content: [{ type: 'text', text: result }] });
      }
      case 'get_cart': {
        if (!args.cart_id) {
          return rpcError(rpc.id ?? null, -32602, 'Invalid params: "cart_id" required for get_cart');
        }
        const result = await getCart(env, args.cart_id);
        return rpcResult(rpc.id ?? null, { content: [{ type: 'text', text: result }] });
      }
      case 'get_order_status': {
        if (!args.order_id) {
          return rpcError(rpc.id ?? null, -32602, 'Invalid params: "order_id" required for get_order_status');
        }
        const result = await getOrderStatus(env, args.order_id);
        return rpcResult(rpc.id ?? null, { content: [{ type: 'text', text: result }] });
      }
      case 'get_most_recent_order_status': {
        const result = await getMostRecentOrderStatus(env);
        return rpcResult(rpc.id ?? null, { content: [{ type: 'text', text: result }] });
      }
      default:
        return rpcError(rpc.id ?? null, -32601, `Unknown tool: ${name}`);
    }
  } catch (err: any) {
    console.error('MCP tool error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return rpcError(rpc.id ?? null, -32000, 'Tool execution failed', { message });
  }
}

/**
 * Direct MCP tool call without HTTP - for internal calls
 */
export async function callMcpToolDirect(env: any, toolName: string, args: any): Promise<any> {
  const rpc: JsonRpcRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: toolName, arguments: args },
    id: Date.now()
  };

  const shopDomain = env?.SHOP_DOMAIN || process.env.SHOP_DOMAIN;
  const workerOrigin = env?.WORKER_ORIGIN;
  const originHeader = env?.ALLOWED_ORIGIN || workerOrigin || 'https://asystent.epirbizuteria.pl';
  const isSearchCatalogTool = toolName === 'search_shop_catalog';
  const catalogFallbackResult = {
    products: [],
    system_note: 'Sklep jest chwilowo niedostępny (Connection Timeout). Poinformuj klienta o problemie technicznym.'
  };

  let lastError: Error | null = null;

  // Ensure shop MCP is always prioritized
  if (shopDomain) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const shopUrl = `https://${String(shopDomain).replace(/\/$/, '')}/api/mcp`;
      console.log(`Attempting shop MCP connection for tool: ${toolName}`, {
        shopUrl,
        arguments: args,
        timestamp: new Date().toISOString(),
      });
      const res = await fetch(shopUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: originHeader },
        body: JSON.stringify(rpc),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (isSearchCatalogTool && res.status === 522) {
          console.warn('Shop MCP returned 522 for search_shop_catalog; returning fallback response', {
            toolName,
            status: res.status,
            statusText: res.statusText,
            body: body.slice(0, 500),
          });
          return { result: catalogFallbackResult };
        }
        console.warn('Shop MCP returned non-OK response', {
          toolName,
          status: res.status,
          statusText: res.statusText,
          body: body.slice(0, 1000),
        });
        lastError = new Error(`Shop MCP ${res.status} ${res.statusText}: ${body}`);
      } else {
        const j = await res.json().catch(() => null) as any;
        if (j && !j.error) {
          console.log(`Shop MCP success for tool: ${toolName}`, {
            result: j.result,
            timestamp: new Date().toISOString(),
          });
          return { result: j.result };
        }
        lastError = new Error('Shop MCP returned invalid JSON payload');
      }
    } catch (err) {
      const isAbortError = err instanceof Error && err.name === 'AbortError';
      const isNetworkError = err instanceof TypeError;
      if (isSearchCatalogTool && (isAbortError || isNetworkError)) {
        console.warn('Shop MCP fetch aborted or network error for search_shop_catalog; returning fallback response', {
          toolName,
          error: err,
          timestamp: new Date().toISOString(),
        });
        return { result: catalogFallbackResult };
      }
      console.warn(`Shop MCP failed for tool: ${toolName}, falling back`, {
        error: err,
        timestamp: new Date().toISOString(),
      });
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    finally {
      clearTimeout(timeoutId);
    }
  }

  // Try internal worker MCP as a fallback
  if (workerOrigin) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const workerUrl = `${String(workerOrigin).replace(/\/$/, '')}/mcp/tools/call`;
      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: originHeader },
        body: JSON.stringify(rpc),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (isSearchCatalogTool && res.status === 522) {
          console.warn('Worker MCP returned 522 for search_shop_catalog; returning fallback response', {
            toolName,
            status: res.status,
            statusText: res.statusText,
            body: body.slice(0, 500),
          });
          return { result: catalogFallbackResult };
        }
        console.warn('Worker MCP returned non-OK response', {
          toolName,
          status: res.status,
          statusText: res.statusText,
          body: body.slice(0, 1000),
        });
        lastError = new Error(`Worker MCP ${res.status} ${res.statusText}: ${body}`);
        throw lastError;
      }
      const j = await res.json().catch(() => null) as any;
      if (j && !j.error) {
        return { result: j.result };
      }
    } catch (err) {
      const isAbortError = err instanceof Error && err.name === 'AbortError';
      const isNetworkError = err instanceof TypeError;
      if (isSearchCatalogTool && (isAbortError || isNetworkError)) {
        console.warn('Worker MCP fetch aborted or network error for search_shop_catalog; returning fallback response', {
          toolName,
          error: err,
          timestamp: new Date().toISOString(),
        });
        return { result: catalogFallbackResult };
      }
      console.warn('callMcpToolDirect: worker MCP proxy failed:', err);
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    finally {
      clearTimeout(timeoutId);
    }
  }

  // If both endpoints fail, throw a clear error
  console.error('callMcpToolDirect: All MCP endpoints failed', {
    toolName,
    arguments: args,
    lastError,
    timestamp: new Date().toISOString(),
  });
  throw new Error('Tool execution failed');
}

export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isAppProxy = url.pathname === '/apps/assistant/mcp';
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: json() });
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