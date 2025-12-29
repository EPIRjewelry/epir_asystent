import type { Env } from './index';
import { callShopifyMcpTool } from './shopify-mcp-client';

// --- Typy dla parametrów i wyników narzędzi ---

interface SearchProductParams {
  query: string;
  first?: number;
  context?: string;
}

interface PolicyParams {
  policy_types: ('termsOfService' | 'shippingPolicy' | 'refundPolicy' | 'privacyPolicy' | 'subscriptionPolicy')[];
}

interface ProductResult {
  id: string;
  title: string;
  description?: string;
  price?: string;
  currency?: string;
  url?: string;
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
/**
 * Narzędzie MCP: Wyszukuje produkty w katalogu Shopify przez oficjalny endpoint MCP sklepu.
 * @param params Parametry wyszukiwania, głównie `query`.
 * @param env Zmienne środowiskowe.
 * @returns Structured JSON z wynikami.
 */
  if (result && typeof result === 'object' && 'products' in (result as any)) {
    return result as any;
  }
  return { products: [] };
}

/**
 * Narz─Ödzie MCP: Pobiera polityki sklepu (regulamin, wysy┼éka itp.) za pomoc─ů Admin API.
 * @param params Parametry okre┼Ťlaj─ůce, kt├│re polityki pobra─ç.
 * @param env Zmienne ┼Ťrodowiskowe.
 * @returns Structured JSON z tre┼Ťci─ů polityk.
 */
export async function getShopPolicies(params: PolicyParams, env: Env): Promise<{ policies: PolicyResult[] }> {
  try {
    const result = await callShopifyMcpTool('get_shop_policies', { policy_types: params.policy_types }, env as any);
    if (result && typeof result === 'object' && 'policies' in (result as any)) {
      return result as any;
    }
  } catch (e) {
    console.warn('getShopPolicies via MCP failed:', e);
  }
  return { policies: [] };
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

