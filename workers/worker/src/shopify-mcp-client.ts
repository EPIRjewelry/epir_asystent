/**
 * Shopify MCP Client - wywołuje oficjalny endpoint MCP Shopify
 * https://{shop_domain}/api/mcp
 * 
 * Używa Storefront API (publiczne, nie wymaga Admin Token)
 * Wymaga tylko SHOPIFY_STOREFRONT_TOKEN jako secret
 */

export interface Env {
  SHOP_DOMAIN?: string;
  SHOPIFY_STOREFRONT_TOKEN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
}

interface McpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

interface McpResponse {
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
 * Wykonuje zapytanie GraphQL do Shopify Admin API (fallback gdy MCP nie działa)
 * @param env Env z SHOP_DOMAIN i SHOPIFY_ADMIN_TOKEN
 * @param query Zapytanie GraphQL
 * @param variables Zmienne dla zapytania
 * @returns Obiekt data z odpowiedzi GraphQL
 */
async function adminGraphql<T = any>(
  env: Env,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const shopDomain = env.SHOP_DOMAIN || process.env.SHOP_DOMAIN;
  const adminToken = env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
  
  if (!shopDomain) {
    throw new Error('SHOP_DOMAIN not configured in wrangler.toml [vars]');
  }
  if (!adminToken) {
    throw new Error('SHOPIFY_ADMIN_TOKEN not set (use: wrangler secret put SHOPIFY_ADMIN_TOKEN)');
  }

  const endpoint = `https://${shopDomain}/admin/api/2024-07/graphql.json`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': adminToken
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '<no body>');
    throw new Error(`Shopify GraphQL ${response.status}: ${text}`);
  }

  const data = (await response.json().catch(() => ({}))) as any;
  if (data?.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data as T;
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
): Promise<string> {
  const shopDomain = env.SHOP_DOMAIN || process.env.SHOP_DOMAIN;
  
  if (!shopDomain) {
    throw new Error('SHOP_DOMAIN not configured in wrangler.toml [vars]');
  }

  const mcpEndpoint = `https://${shopDomain}/api/mcp`;
  
  const request: McpRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args
    },
    id: Date.now()
  };

  console.log(`[Shopify MCP] Calling ${toolName} at ${mcpEndpoint}`, args);

  const response = await fetch(mcpEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
      // NO TOKEN REQUIRED for Storefront MCP!
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '<no body>');
    throw new Error(`Shopify MCP HTTP ${response.status}: ${text}`);
  }

  const mcpResponse: McpResponse = await response.json();

  if (mcpResponse.error) {
    throw new Error(
      `Shopify MCP error ${mcpResponse.error.code}: ${mcpResponse.error.message}`
    );
  }

  // Standardowy format wyniku MCP
  if (mcpResponse.result?.content && Array.isArray(mcpResponse.result.content)) {
    const textContent = mcpResponse.result.content.find((c: any) => c.type === 'text');
    if (textContent?.text) {
      return String(textContent.text);
    }
  }

  // Fallback: zwróć raw result jako JSON string
  return JSON.stringify(mcpResponse.result || {});
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
  try {
    // Próba przez MCP
    return await callShopifyMcpTool('update_cart', { cart_id: cartId, lines }, env);
  } catch (mcpError) {
    console.warn('[MCP Fallback] update_cart failed, trying GraphQL Admin API', mcpError);
    
    // Fallback: GraphQL Storefront API (cartCreate lub cartLinesUpdate)
    if (!cartId) {
      // Tworzenie nowego koszyka
      const mutation = `
        mutation cartCreate($input: CartInput!) {
          cartCreate(input: $input) {
            cart {
              id
              lines(first: 10) {
                edges {
                  node {
                    id
                    quantity
                    merchandise { ... on ProductVariant { id title price { amount } } }
                  }
                }
              }
              cost { totalAmount { amount currencyCode } }
            }
            userErrors { field message }
          }
        }
      `;
      const data = await adminGraphql<{ cartCreate: any }>(env, mutation, {
        input: { lines: lines.map(l => ({ merchandiseId: l.merchandiseId, quantity: l.quantity })) }
      });
      
      if (data.cartCreate.userErrors?.length) {
        throw new Error(`Cart create errors: ${JSON.stringify(data.cartCreate.userErrors)}`);
      }
      
      return JSON.stringify(data.cartCreate.cart);
    } else {
      // Aktualizacja istniejącego koszyka
      const mutation = `
        mutation cartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
          cartLinesUpdate(cartId: $cartId, lines: $lines) {
            cart {
              id
              lines(first: 10) {
                edges {
                  node {
                    id
                    quantity
                    merchandise { ... on ProductVariant { id title price { amount } } }
                  }
                }
              }
              cost { totalAmount { amount currencyCode } }
            }
            userErrors { field message }
          }
        }
      `;
      const data = await adminGraphql<{ cartLinesUpdate: any }>(env, mutation, {
        cartId,
        lines: lines.map(l => ({ id: l.merchandiseId, quantity: l.quantity }))
      });
      
      if (data.cartLinesUpdate.userErrors?.length) {
        throw new Error(`Cart update errors: ${JSON.stringify(data.cartLinesUpdate.userErrors)}`);
      }
      
      return JSON.stringify(data.cartLinesUpdate.cart);
    }
  }
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
  try {
    // Próba przez MCP
    return await callShopifyMcpTool('get_cart', { cart_id: cartId }, env);
  } catch (mcpError) {
    console.warn('[MCP Fallback] get_cart failed, trying GraphQL Admin API', mcpError);
    
    // Fallback: GraphQL Storefront API cart query
    const query = `
      query cart($id: ID!) {
        cart(id: $id) {
          id
          lines(first: 50) {
            edges {
              node {
                id
                quantity
                merchandise {
                  ... on ProductVariant {
                    id
                    title
                    price { amount currencyCode }
                    product { title handle }
                  }
                }
              }
            }
          }
          cost {
            totalAmount { amount currencyCode }
            subtotalAmount { amount currencyCode }
            totalTaxAmount { amount currencyCode }
          }
          checkoutUrl
        }
      }
    `;
    
    const data = await adminGraphql<{ cart: any }>(env, query, { id: cartId });
    
    if (!data.cart) {
      throw new Error(`Cart not found: ${cartId}`);
    }
    
    return JSON.stringify(data.cart);
  }
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
  try {
    // Próba przez MCP
    return await callShopifyMcpTool('get_order_status', { order_id: orderId }, env);
  } catch (mcpError) {
    console.warn('[MCP Fallback] get_order_status failed, trying GraphQL Admin API', mcpError);
    
    // Fallback: GraphQL Admin API order query
    const query = `
      query order($id: ID!) {
        order(id: $id) {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 10) {
            edges {
              node {
                id
                title
                quantity
                variant { id title }
              }
            }
          }
          shippingAddress {
            address1
            city
            country
            zip
          }
        }
      }
    `;
    
    const data = await adminGraphql<{ order: any }>(env, query, { id: orderId });
    
    if (!data.order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    return JSON.stringify(data.order);
  }
}

/**
 * Pobiera status ostatniego zamówienia klienta
 * @param env Env z SHOP_DOMAIN i SHOPIFY_STOREFRONT_TOKEN
 * @returns Ostatnie zamówienie jako JSON string
 */
export async function getMostRecentOrderStatus(
  env: Env
): Promise<string> {
  try {
    // Próba przez MCP
    return await callShopifyMcpTool('get_most_recent_order_status', {}, env);
  } catch (mcpError) {
    console.warn('[MCP Fallback] get_most_recent_order_status failed, trying GraphQL Admin API', mcpError);
    
    // Fallback: GraphQL Admin API orders query (most recent)
    const query = `
      query orders {
        orders(first: 1, reverse: true, sortKey: CREATED_AT) {
          edges {
            node {
              id
              name
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet { shopMoney { amount currencyCode } }
              lineItems(first: 10) {
                edges {
                  node {
                    id
                    title
                    quantity
                    variant { id title }
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    const data = await adminGraphql<{ orders: { edges: Array<{ node: any }> } }>(env, query);
    
    if (!data.orders?.edges?.length) {
      throw new Error('No orders found');
    }
    
    return JSON.stringify(data.orders.edges[0].node);
  }
}
