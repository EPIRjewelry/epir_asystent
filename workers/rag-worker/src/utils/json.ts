/**
 * Shared JSON utilities for parsing and type guards
 * Extracted from duplicated code across the codebase
 */

/**
 * Type guard for string
 */
export function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/**
 * Type guard for record (plain object)
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Safe JSON parse with double-encoding support
 * (MCP sometimes returns double-encoded JSON strings)
 * 
 * @param input - Value to parse (handles strings, already-parsed objects, etc.)
 * @returns Parsed value or original input if parsing fails
 */
export function safeJsonParse<T = unknown>(input: unknown): T | unknown {
  if (!isString(input)) return input;
  const s = input.trim();
  if (!s) return input;
  
  try {
    const parsed = JSON.parse(s);
    // Check for double-encoding
    if (isString(parsed)) {
      const inner = parsed.trim();
      if (
        (inner.startsWith('{') && inner.endsWith('}')) ||
        (inner.startsWith('[') && inner.endsWith(']'))
      ) {
        try {
          return JSON.parse(inner);
        } catch {
          return parsed;
        }
      }
    }
    return parsed;
  } catch {
    return input;
  }
}

/**
 * Extract a string field from a record using multiple possible key names
 * 
 * @param obj - Object to search
 * @param keys - Possible key names to try
 * @returns First non-empty string value found, or undefined
 */
export function asStringField(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const val = obj[k];
    if (isString(val) && val.trim().length > 0) return val.trim();
  }
  return undefined;
}
