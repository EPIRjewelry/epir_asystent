/**
 * GraphQL utilities for Shopify API integration
 * Handles Storefront and Admin API calls with retry logic and rate limiting
 */

const SHOPIFY_API_VERSION = '2024-10';
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 100;
const INITIAL_RETRY_DELAY_MS = 1000;

interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: string[];
  extensions?: Record<string, unknown>;
}

interface GraphQLResponse<T = any> {
  data?: T;
  errors?: GraphQLError[];
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute GraphQL query with retry logic and rate limiting
 * @param url - Full GraphQL endpoint URL
 * @param headers - Request headers (must include auth token)
 * @param query - GraphQL query string
 * @param variables - Optional GraphQL variables
 * @param retries - Max retry attempts
 * @returns Parsed GraphQL data
 */
export async function executeGraphQL<T>(
  url: string,
  headers: Record<string, string>,
  query: string,
  variables?: Record<string, unknown>,
  retries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Rate limiting: wait before each request (except first)
      if (attempt > 0) {
        const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[GraphQL] Retry ${attempt}/${retries - 1} after ${retryDelay}ms...`);
        await sleep(retryDelay);
      } else {
        await sleep(RATE_LIMIT_DELAY_MS);
      }

      const body = variables ? { query, variables } : { query };
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      });

      // Handle HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        
        // Retry on rate limit (429) or server errors (5xx)
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`HTTP ${response.status}: ${errorText}`);
          console.warn(`[GraphQL] Retryable error (attempt ${attempt + 1}/${retries}): ${lastError.message}`);
          continue;
        }
        
        // Don't retry on auth errors (401, 403)
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Authentication error (${response.status}): ${errorText}. Check your API token.`);
        }
        
        throw new Error(`GraphQL HTTP error (${response.status}): ${errorText}`);
      }

      // Parse GraphQL response
      const result = await response.json() as GraphQLResponse<T>;

      // Check for GraphQL errors
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map(err => {
          const location = err.locations ? ` at line ${err.locations[0].line}:${err.locations[0].column}` : '';
          const path = err.path ? ` (path: ${err.path.join('.')})` : '';
          return `${err.message}${location}${path}`;
        }).join('; ');
        
        throw new Error(`GraphQL errors: ${errorMessages}`);
      }

      if (!result.data) {
        throw new Error('GraphQL response missing data field');
      }

      return result.data;
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on GraphQL errors or auth errors
      if (error instanceof Error && (
        error.message.includes('GraphQL errors') ||
        error.message.includes('Authentication error')
      )) {
        throw error;
      }
      
      // Continue to retry on network/timeout errors
      if (attempt === retries - 1) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('GraphQL request failed after retries');
}

/**
 * Call Shopify Storefront API
 * @param shopDomain - Shop domain (e.g., example.myshopify.com)
 * @param storefrontToken - Storefront access token
 * @param query - GraphQL query
 * @param variables - Optional variables
 * @returns GraphQL data
 */
export async function callStorefrontAPI<T>(
  shopDomain: string,
  storefrontToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const url = `https://${shopDomain}/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = {
    'X-Shopify-Storefront-Access-Token': storefrontToken,
  };
  
  return executeGraphQL<T>(url, headers, query, variables);
}

/**
 * Call Shopify Admin API
 * @param shopDomain - Shop domain (e.g., example.myshopify.com)
 * @param adminToken - Admin API access token
 * @param query - GraphQL query
 * @param variables - Optional variables
 * @returns GraphQL data
 */
export async function callAdminAPI<T>(
  shopDomain: string,
  adminToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = {
    'X-Shopify-Access-Token': adminToken,
  };
  
  return executeGraphQL<T>(url, headers, query, variables);
}

/**
 * Fetch product metafields using Admin API
 * @param shopDomain - Shop domain
 * @param adminToken - Admin API token
 * @param productId - Product GID
 * @param namespace - Metafield namespace (optional)
 * @returns Product with metafields
 */
export async function fetchProductMetafields(
  shopDomain: string,
  adminToken: string,
  productId: string,
  namespace?: string
): Promise<any> {
  const metafieldsFilter = namespace 
    ? `metafields(namespace: "${namespace}", first: 20)` 
    : `metafields(first: 20)`;
    
  const query = `
    query GetProductMetafields($id: ID!) {
      product(id: $id) {
        id
        title
        ${metafieldsFilter} {
          edges {
            node {
              namespace
              key
              value
              type
            }
          }
        }
      }
    }
  `;

  return callAdminAPI<any>(shopDomain, adminToken, query, { id: productId });
}

/**
 * Fetch fresh product data with metafields for RAG context
 * @param shopDomain - Shop domain
 * @param adminToken - Admin API token (optional)
 * @param storefrontToken - Storefront token (fallback)
 * @param searchQuery - Product search query
 * @returns Array of products
 */
export async function fetchProductsForRAG(
  shopDomain: string,
  adminToken: string | undefined,
  storefrontToken: string | undefined,
  searchQuery: string
): Promise<any[]> {
  // Try Admin API first for richer data
  if (adminToken) {
    try {
      const query = `
        query SearchProducts($query: String!) {
          products(first: 5, query: $query) {
            edges {
              node {
                id
                title
                description
                vendor
                productType
                tags
                metafields(first: 10) {
                  edges {
                    node {
                      namespace
                      key
                      value
                    }
                  }
                }
                variants(first: 3) {
                  edges {
                    node {
                      id
                      title
                      price
                    }
                  }
                }
              }
            }
          }
        }
      `;
      
      const data = await callAdminAPI<any>(shopDomain, adminToken, query, { query: searchQuery });
      return data.products?.edges?.map((e: any) => e.node) || [];
    } catch (error) {
      console.warn('[GraphQL] Admin API failed, falling back to Storefront:', error);
    }
  }

  // Fallback to Storefront API
  if (storefrontToken) {
    const query = `
      query SearchProducts($query: String!) {
        products(first: 5, query: $query) {
          edges {
            node {
              id
              title
              description
              vendor
              productType
              tags
              variants(first: 3) {
                edges {
                  node {
                    id
                    title
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    const data = await callStorefrontAPI<any>(shopDomain, storefrontToken, query, { query: searchQuery });
    return data.products?.edges?.map((e: any) => e.node) || [];
  }

  return [];
}
