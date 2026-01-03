/**
 * workers/worker/src/utils/cart.ts
 * 
 * Utilities for cart_id normalization and validation
 * Fixes issues with cart_id format across MCP tools (get_cart, update_cart)
 */

/**
 * Normalize cart_id to ensure consistent format
 * 
 * Accepts:
 * - Full GID with key: 'gid://shopify/Cart/<id>?key=...'
 * - GID without key: 'gid://shopify/Cart/<id>'
 * - Just key: 'hWN78...' or 'key=...'
 * 
 * Returns normalized format that Shopify API accepts
 * 
 * @param raw - Raw cart_id from session or user input
 * @param sessionKey - Optional key from session to append if missing
 * @returns Normalized cart_id or null if invalid
 */
export function normalizeCartId(raw: string | null | undefined, sessionKey?: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  
  // Remove all whitespace
  raw = raw.trim().replace(/\s+/g, '');
  
  if (!raw) return null;
  
  // Extract key if present
  const keyMatch = raw.match(/[?&]key=([A-Za-z0-9\-_]+)/);
  const extractedKey = keyMatch ? keyMatch[1] : null;
  
  // Check if it's a full GID
  const gidMatch = raw.match(/^gid:\/\/shopify\/Cart\/([A-Za-z0-9\-_]+)/);
  
  if (gidMatch) {
    const cartId = gidMatch[1];
    const key = extractedKey || sessionKey;
    
    // Return full GID with key if available
    if (key) {
      return `gid://shopify/Cart/${cartId}?key=${key}`;
    }
    
    // Return GID without key (may fail in some API calls)
    return `gid://shopify/Cart/${cartId}`;
  }
  
  // If it's just a key parameter (e.g., "key=abc123" or "abc123")
  const justKeyMatch = raw.match(/^(?:key=)?([A-Za-z0-9\-_]+)$/);
  if (justKeyMatch) {
    const key = justKeyMatch[1];
    // We need a cart ID to construct full GID, so just return the key parameter
    return `?key=${key}`;
  }
  
  // Invalid format
  console.warn('[normalizeCartId] Invalid cart_id format:', raw);
  return null;
}

/**
 * Validate if cart_id is in expected Shopify GID format
 * 
 * @param cartId - Cart ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidCartGid(cartId: string | null | undefined): boolean {
  if (!cartId || typeof cartId !== 'string') return false;
  
  // Must be GID format: gid://shopify/Cart/<id> (with optional ?key=...)
  const gidPattern = /^gid:\/\/shopify\/Cart\/[A-Za-z0-9\-_]+(\?key=[A-Za-z0-9\-_]+)?$/;
  return gidPattern.test(cartId);
}

/**
 * Extract cart ID and key from full GID
 * 
 * @param cartId - Full cart GID
 * @returns Object with id and key, or null if invalid
 */
export function parseCartGid(cartId: string): { id: string; key: string | null } | null {
  if (!cartId) return null;
  
  const match = cartId.match(/^gid:\/\/shopify\/Cart\/([A-Za-z0-9\-_]+)(\?key=([A-Za-z0-9\-_]+))?$/);
  
  if (!match) return null;
  
  return {
    id: match[1],
    key: match[3] || null
  };
}

/**
 * Build cart URL for checkout
 * 
 * @param shopDomain - Shopify shop domain
 * @param cartId - Cart GID with key
 * @returns Full checkout URL or null if invalid
 */
export function buildCartUrl(shopDomain: string, cartId: string): string | null {
  const parsed = parseCartGid(cartId);
  
  if (!parsed || !parsed.key) {
    console.warn('[buildCartUrl] Cannot build URL without cart key');
    return null;
  }
  
  return `https://${shopDomain}/cart/c/${parsed.id}?key=${parsed.key}`;
}
