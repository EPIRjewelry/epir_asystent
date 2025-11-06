// MCP Server (JSON-RPC 2.0) dla narzędzi Shopify w trybie single-store.
// Sekrety (SHOPIFY_APP_SECRET, SHOPIFY_ADMIN_TOKEN) pochodzą TYLKO z Cloudflare Secrets.
// ŻADNYCH sekretów w wrangler.toml [vars] ani w kodzie.
// Endpointy:
// - POST /mcp/tools/call (dev/test bez HMAC)
// - POST /apps/assistant/mcp (App Proxy + HMAC)
// Narzędzia: get_product, search_shop_catalog (Shopify Admin GraphQL 2024-07)

import { verifyAppProxyHmac } from './auth';
import { searchProductCatalog, getShopPolicies } from './mcp';
import {
  updateCart,
  getCart,
  getOrderStatus,
  getMostRecentOrderStatus
} from './shopify-mcp-client';
import type { Env } from './index';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id?: JsonRpcId;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  result: any;
  id: JsonRpcId;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  error: { code: number; message: string; data?: any };
  id: JsonRpcId;
}

function json(headers: HeadersInit = {}) {
  return { 'Content-Type': 'application/json', ...headers };
}

function rpcResult(id: JsonRpcId, result: any): Response {
  const body: JsonRpcSuccess = { jsonrpc: '2.0', result, id: id ?? null };
  return new Response(JSON.stringify(body), { status: 200, headers: json() });
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: any): Response {
  const body: JsonRpcError = { jsonrpc: '2.0', error: { code, message, data }, id: id ?? null };
  return new Response(JSON.stringify(body), { status: 200, headers: json() });
}

async function adminGraphql<T = any>(env: Env, query: string, variables?: Record<string, any>): Promise<T> {
  if (!env.SHOP_DOMAIN) throw new Error('Brak SHOP_DOMAIN (ustaw w wrangler.toml [vars])');
  if (!env.SHOPIFY_ADMIN_TOKEN) throw new Error('Brak SHOPIFY_ADMIN_TOKEN (ustaw przez wrangler secret put)');

  const endpoint = `https://${env.SHOP_DOMAIN}/admin/api/2024-07/graphql.json`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '<no body>');
    throw new Error(`Shopify GraphQL ${res.status}: ${txt}`);
  }

  const data = await res.json().catch(() => ({})) as any;
  if (data?.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  return data.data as T;
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

  try {
    const { name, arguments: mcpArgs } = rpc.params as any;

    // Prefer routing tool execution to the shop's MCP endpoint if available
    const shopDomain = env?.SHOP_DOMAIN || process.env.SHOP_DOMAIN;
    if (shopDomain) {
      try {
        const shopUrl = `https://${String(shopDomain).replace(/\/$/, '')}/api/mcp`;
        const res = await fetch(shopUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rpc)
        });
        if (res.ok) {
          const j = await res.json().catch(() => null) as any;
          if (j && !j.error) {
            // Normalize to direct-call shape
            return { result: j.result };
          }
        }
        // fallback to local execution if remote fails
      } catch (err) {
        console.warn('callMcpToolDirect: shop MCP proxy failed, falling back to local execution:', err);
      }
    }
    
    switch (name) {
      case 'search_shop_catalog': {
        if (!mcpArgs.query) {
          return { error: { code: -32602, message: 'Invalid params: "query" required for search_shop_catalog' }};
        }
        const result = await searchProductCatalog({ query: mcpArgs.query, first: mcpArgs.first || 5 }, env);
        return { result };
      }
      case 'search_shop_policies_and_faqs': {
        if (!mcpArgs.query) {
          return { error: { code: -32602, message: 'Invalid params: "query" required for search_shop_policies_and_faqs' }};
        }
        const result = await getShopPolicies({ policy_types: ['termsOfService', 'shippingPolicy', 'refundPolicy', 'privacyPolicy', 'subscriptionPolicy'] }, env);
        return { result };
      }
      case 'update_cart': {
        if (!mcpArgs.lines || !Array.isArray(mcpArgs.lines)) {
          return { error: { code: -32602, message: 'Invalid params: "lines" array required for update_cart' }};
        }
        for (const line of mcpArgs.lines) {
          if (!line.merchandiseId || typeof line.quantity !== 'number') {
            return { error: { code: -32602, message: 'Invalid params: each line must have "merchandiseId" and "quantity"' }};
          }
        }
        const result = await updateCart(env, mcpArgs.cart_id || null, mcpArgs.lines);
        return { result: { content: [{ type: 'text', text: result }] }};
      }
      case 'get_cart': {
        if (!mcpArgs.cart_id) {
          return { error: { code: -32602, message: 'Invalid params: "cart_id" required for get_cart' }};
        }
        const result = await getCart(env, mcpArgs.cart_id);
        return { result: { content: [{ type: 'text', text: result }] }};
      }
      case 'get_order_status': {
        if (!mcpArgs.order_id) {
          return { error: { code: -32602, message: 'Invalid params: "order_id" required for get_order_status' }};
        }
        const result = await getOrderStatus(env, mcpArgs.order_id);
        return { result: { content: [{ type: 'text', text: result }] }};
      }
      case 'get_most_recent_order_status': {
        const result = await getMostRecentOrderStatus(env);
        return { result: { content: [{ type: 'text', text: result }] }};
      }
      case 'test_tool': {
        // Mock test tool for unit tests
        return { result: { success: true }};
      }
      default:
        return { error: { code: -32601, message: `Unknown tool: ${name}` }};
    }
  } catch (err: any) {
    console.error('MCP direct tool error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return { error: { code: -32000, message: 'Tool execution failed', details: { message }}};
  }
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
  }

  return handleToolsCall(env, request);
}