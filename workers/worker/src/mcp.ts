import type { Env } from './index';

// --- Typy dla parametr├│w i wynik├│w narz─Ödzi ---

interface SearchProductParams {
  query: string;
  first?: number;
}

interface PolicyParams {
  policy_types: ('termsOfService' | 'shippingPolicy' | 'refundPolicy' | 'privacyPolicy' | 'subscriptionPolicy')[];
}

interface ProductResult {
  id: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  url: string;
}

interface PolicyResult {
  type: string;
  body: string;
}

// --- Implementacje narzędzi (Tools) ---

/**
 * Narz─Ödzie MCP: Wyszukuje produkty w katalogu Shopify za pomoc─ů Storefront API.
 * @param params Parametry wyszukiwania, głównie `query`.
 * @param env Zmienne srodowiskowe.
 * @returns Structured JSON z wynikami.
 */
export async function searchProductCatalog(params: SearchProductParams, env: Env): Promise<{ products: ProductResult[] }> {
  const { query, first = 5 } = params;
  const shopDomain = env.SHOP_DOMAIN || process.env.SHOP_DOMAIN || 'test-shop.myshopify.com';
  const storefrontToken = env.SHOPIFY_STOREFRONT_TOKEN || process.env.SHOPIFY_STOREFRONT_TOKEN || 'mock-token';
  const storefrontUrl = `https://${shopDomain}/api/2025-10/graphql.json`;
  
  console.log('[searchProductCatalog] Shop:', shopDomain);
  console.log('[searchProductCatalog] Token exists:', !!storefrontToken);
  console.log('[searchProductCatalog] Token prefix:', storefrontToken?.substring(0, 10));

  const graphqlQuery = {
    query: `
      query searchProducts($query: String!, $first: Int!) {
        products(query: $query, first: $first) {
          edges {
            node {
              id
              title
              descriptionHtml
              onlineStoreUrl
              priceRange {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `,
    variables: { query, first },
  };

  const response = await fetch(storefrontUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': storefrontToken,
    },
    body: JSON.stringify(graphqlQuery),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Shopify Storefront API error:', errorText);
    throw new Error(`Shopify Storefront API error: ${response.status}`);
  }

  const json: any = await response.json();
  const products = json.data?.products?.edges;

  if (!products || products.length === 0) {
    return { products: [] };
  }

  return {
    products: products.map((edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      description: edge.node.descriptionHtml.replace(/<[^>]*>/g, '').substring(0, 200),
      price: edge.node.priceRange.minVariantPrice.amount,
      currency: edge.node.priceRange.minVariantPrice.currencyCode,
      url: edge.node.onlineStoreUrl
    }))
  };
}

/**
 * Narz─Ödzie MCP: Pobiera polityki sklepu (regulamin, wysy┼éka itp.) za pomoc─ů Admin API.
 * @param params Parametry okre┼Ťlaj─ůce, kt├│re polityki pobra─ç.
 * @param env Zmienne ┼Ťrodowiskowe.
 * @returns Structured JSON z tre┼Ťci─ů polityk.
 */
export async function getShopPolicies(params: PolicyParams, env: Env): Promise<{ policies: PolicyResult[] }> {
  const shopDomain = env.SHOP_DOMAIN || process.env.SHOP_DOMAIN || 'test-shop.myshopify.com';
  const adminToken = env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || 'mock-token';
  const adminUrl = `https://${shopDomain}/admin/api/2025-10/graphql.json`;
  const policyFields = params.policy_types.join('\n');

  const graphqlQuery = {
    query: `
      query getShopPolicies {
        shop {
          ${policyFields} {
            body
          }
        }
      }
    `,
  };

  const response = await fetch(adminUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': adminToken,
    },
    body: JSON.stringify(graphqlQuery),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Shopify Admin API error:', errorText);
    throw new Error(`Shopify Admin API error: ${response.status}`);
  }

  const json: any = await response.json();
  const policies = json.data?.shop;

  if (!policies) {
    return { policies: [] };
  }

  return {
    policies: Object.entries(policies).map(([key, value]: [string, any]) => ({
      type: key,
      body: value.body
    }))
  };
}

/**
 * Funkcja pomocnicza do sprawdzania, czy zapytanie użytkownika dotyczy produktu.
 * @param message Wiadomość od użytkownika.
 * @returns True, jeśli wiadomość prawdopodobnie dotyczy produktu.
 */
export function isProductQuery(message: string): boolean {
  const keywords = ['produkt', 'pierścionek', 'pierścionk', 'pierscione', 'naszyjnik', 'bransoletka', 'bransolet', 'kolczyk', 'kolczyki', 'cena', 'dostepn', 'kupi', 'znalezc', 'fair trade', 'diament', 'zlot', 'złot'];
  const lowerCaseMessage = message.toLowerCase();
  return keywords.some(keyword => lowerCaseMessage.includes(keyword));
}

/**
 * Funkcja pomocnicza do sprawdzania, czy zapytanie użytkownika dotyczy koszyka.
 * @param message Wiadomość od użytkownika.
 * @returns True, jeśli wiadomość dotyczy koszyka zakupów.
 */
export function isCartQuery(message: string): boolean {
  const keywords = ['koszyk', 'dodaj', 'usuń', 'usun', 'zamówi', 'zamowi', 'kupi', 'kupuj', 'kupuję', 'checkout', 'cart'];
  const lowerCaseMessage = message.toLowerCase();
  return keywords.some(keyword => lowerCaseMessage.includes(keyword));
}

// --- MCP wrapper functions using direct calls ---

/**
 * Search product catalog via MCP
 */
export async function mcpCatalogSearch(
  shopDomain: string,
  query: string,
  env: Env,
  context: string = 'biżuteria'
): Promise<Array<{name: string; price: string; url: string; image: string; id: string}> | null> {
  try {
    // Direct call to searchProductCatalog instead of HTTP fetch
    const result = await searchProductCatalog({ query, first: 5 }, env);
    
    if (!result || !result.products || result.products.length === 0) {
      return null;
    }

    // Normalize product format to match expected interface
    return result.products.map((p: ProductResult) => ({
      name: p.title || '',
      price: p.price || '',
      url: p.url || '',
      image: '', // ProductResult doesn't have image field currently
      id: p.id || ''
    }));
  } catch (error) {
    console.error('mcpCatalogSearch error:', error);
    return null;
  }
}

// Added validation for model responses
function validateModelResponse(response: any): boolean {
  if (!response || typeof response !== 'object') {
    logError('Invalid model response format', response);
    return false;
  }
  if (!response.reply || typeof response.reply !== 'string') {
    logError('Model response missing required fields', response);
    return false;
  }
  return true;
}

// Defined missing variable and fixed return statement
const modelResponse = { reply: 'Mock reply' }; // Mock response for testing

function logError(message: string, data?: any) {
  console.error(`[ERROR] ${message}`, data || '');
}

// Wrapped return statement in a function
function handleError() {
  return 'An error occurred while processing your request. Please try again.';
}

// Example usage
const isValid = validateModelResponse(modelResponse);
if (!isValid) {
  handleError();
}

