/**
 * worker/src/hmac.ts
 *
 * HMAC-SHA256 helpers for Cloudflare Workers.
 * - computeHmac: Compute HMAC-SHA256 signature (hex-encoded)
 * - verifyHmac: Verify HMAC-SHA256 signature with constant-time comparison
 *
 * Security best practices:
 * - Uses crypto.subtle for cryptographic operations
 * - Constant-time comparison to prevent timing attacks
 * - Supports both string and Uint8Array inputs
 */

/**
 * Compute HMAC-SHA256 signature for a message.
 * Returns hex-encoded signature string.
 *
 * @param secret - Secret key (string)
 * @param message - Message to sign (string or Uint8Array)
 * @returns Promise<string> - Hex-encoded HMAC signature
 *
 * @example
 * const sig = await computeHmac('my-secret', 'hello world');
 * console.log(sig); // "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e"
 */
export async function computeHmac(
  secret: string,
  message: Uint8Array | string
): Promise<string> {
  if (!secret || secret.length === 0) {
    throw new Error('Secret key cannot be empty');
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = typeof message === 'string' ? encoder.encode(message) : message;

  // Import secret key for HMAC
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign message
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData.buffer as ArrayBuffer);

  // Convert to hex string
  const signatureArray = new Uint8Array(signature);
  const hexSignature = Array.from(signatureArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return hexSignature;
}

/**
 * Verify HMAC-SHA256 signature with constant-time comparison.
 * Supports hex-encoded signatures.
 *
 * @param headerSig - Signature from header/query (hex string)
 * @param secret - Secret key (string)
 * @param message - Original message (string or Uint8Array)
 * @returns Promise<boolean> - True if signature is valid
 *
 * @example
 * const isValid = await verifyHmac('a591a6d...', 'my-secret', 'hello world');
 * console.log(isValid); // true or false
 */
export async function verifyHmac(
  headerSig: string,
  secret: string,
  message: Uint8Array | string
): Promise<boolean> {
  if (!headerSig || headerSig.length === 0) {
    return false;
  }

  if (!secret || secret.length === 0) {
    return false;
  }

  try {
    // Compute expected signature
    const expectedSig = await computeHmac(secret, message);

    // Constant-time comparison
    return constantTimeCompare(headerSig, expectedSig);
  } catch (error) {
    console.error('HMAC verification error:', error);
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares two strings byte-by-byte, always checking all bytes.
 *
 * @param a - First string
 * @param b - Second string
 * @returns boolean - True if strings are equal
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    // XOR characters - 0 if equal, non-zero if different
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}

/**
 * Parse signature from various formats (hex, base64).
 * Returns normalized hex string.
 *
 * @param signature - Signature string (hex or base64)
 * @returns string - Normalized hex string
 */
export function parseSignature(signature: string): string {
  // Check if hex (only 0-9a-fA-F)
  const isHex = /^[0-9a-fA-F]+$/.test(signature);
  
  if (isHex) {
    // Must be even length
    if (signature.length % 2 !== 0) {
      throw new Error('Invalid signature format: hex must have even length');
    }
    return signature.toLowerCase();
  }

  // Try base64 decode
  try {
    const binary = atob(signature);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    // Convert to hex
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    throw new Error('Invalid signature format: must be hex or base64');
  }
}

/**
 * Canonicalize query parameters for HMAC signing.
 * Sorts keys alphabetically, formats as key=value, concatenates without separators.
 *
 * @param params - URLSearchParams object
 * @param excludeKeys - Keys to exclude (e.g., ['signature', 'hmac'])
 * @returns string - Canonicalized query string
 *
 * @example
 * const params = new URLSearchParams('foo=bar&shop=test.myshopify.com&timestamp=123');
 * const canonical = canonicalizeParams(params, ['signature']);
 * // "foo=barshop=test.myshopify.comtimestamp=123"
 */
export function canonicalizeParams(
  params: URLSearchParams,
  excludeKeys: string[] = ['signature', 'hmac']
): string {
  const entries = [...params.entries()]
    .filter(([key]) => !excludeKeys.includes(key))
    .sort((a, b) => a[0].localeCompare(b[0]));

  return entries.map(([key, value]) => `${key}=${value}`).join('');
}

/**
 * Verify timestamp is within acceptable range (e.g., 5 minutes).
 * Prevents replay attacks.
 *
 * @param timestamp - Unix timestamp (seconds)
 * @param maxAgeSeconds - Maximum age in seconds (default: 300 = 5 minutes)
 * @returns boolean - True if timestamp is valid
 *
 * @example
 * const isValid = verifyTimestamp(Math.floor(Date.now() / 1000), 300);
 * console.log(isValid); // true
 */
export function verifyTimestamp(
  timestamp: number,
  maxAgeSeconds: number = 300
): boolean {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - timestamp);

  return age <= maxAgeSeconds;
}
