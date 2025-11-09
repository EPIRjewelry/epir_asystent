/**
 * worker/src/config/bindings.ts
 * 
 * Centralized environment bindings configuration.
 * Type-safe access to Cloudflare Worker environment variables and bindings.
 * 
 * PURPOSE:
 * - Single source of truth for env variable names
 * - Type safety for env access
 * - Easier testing (mock this file instead of env everywhere)
 * - Documentation of required vs optional bindings
 * 
 * USAGE:
 * ```typescript
 * import { getEnvBinding, REQUIRED_SECRETS } from './config/bindings';
 * 
 * const apiKey = getEnvBinding(env, 'GROQ_API_KEY'); // throws if missing
 * const shopDomain = env.SHOP_DOMAIN || 'fallback.myshopify.com';
 * ```
 * 
 * @see workers/worker/wrangler.toml - Binding definitions
 */

// Cloudflare Workers types
type AIBinding = any; // @cloudflare/workers-types/experimental
type VectorizeIndex = any; // @cloudflare/workers-types/experimental

/**
 * Complete Cloudflare Worker environment interface
 * 
 * Includes all bindings used by EPIR Assistant:
 * - Durable Objects (SessionDO, RateLimiterDO, TokenVaultDO)
 * - D1 Database
 * - Vectorize Index
 * - KV Namespace
 * - Service Bindings (AI Worker, RAG Worker)
 * - AI Binding (Cloudflare AI)
 * - Secrets (Groq API Key, Shopify tokens)
 * - Vars (Shop domain, allowed origins)
 */
export interface Env {
  // ========================================
  // DURABLE OBJECTS
  // ========================================
  
  /**
   * Session Durable Object
   * Stores conversation history, cart_id, customer metadata
   */
  SESSION_DO: DurableObjectNamespace;

  /**
   * Rate Limiter Durable Object
   * Prevents abuse (max 20 requests/minute per IP)
   */
  RATE_LIMITER_DO: DurableObjectNamespace;

  /**
   * Token Vault Durable Object
   * Creates anonymous customer tokens for Storefront API
   */
  TOKEN_VAULT_DO: DurableObjectNamespace;

  // ========================================
  // DATABASES & STORAGE
  // ========================================

  /**
   * D1 Database
   * Stores cache, analytics, session metadata
   */
  DB: D1Database;

  /**
   * Vectorize Index
   * FAQ embeddings for semantic search (RAG)
   */
  VECTOR_INDEX?: VectorizeIndex;

  /**
   * KV Namespace (legacy sessions)
   * Used for backward compatibility
   */
  SESSIONS_KV?: KVNamespace;

  // ========================================
  // SERVICE BINDINGS
  // ========================================

  /**
   * AI Worker Service Binding
   * Reusable Groq API client (streaming + non-streaming)
   * 
   * Endpoints:
   * - POST /stream - SSE text deltas
   * - POST /harmony - SSE HarmonyEvent objects
   * - POST /complete - JSON response
   * - GET /health - Health check
   */
  AI_WORKER?: Fetcher;

  /**
   * RAG Worker Service Binding
   * Reusable RAG orchestrator (MCP + Vectorize + formatting)
   * 
   * Endpoints:
   * - POST /search/products - Product catalog search
   * - POST /search/policies - FAQ/policies search
   * - POST /context/build - Full RAG context building
   * - GET /health - Health check
   */
  RAG_WORKER?: Fetcher;

  // ========================================
  // CLOUDFLARE AI
  // ========================================

  /**
   * Cloudflare AI Binding
   * Used for embeddings (@cf/baai/bge-large-en-v1.5)
   */
  AI?: AIBinding;

  // ========================================
  // SECRETS (wrangler secret put)
  // ========================================

  /**
   * Groq API Key (REQUIRED)
   * Get from: https://console.groq.com/keys
   * Set with: wrangler secret put GROQ_API_KEY
   */
  GROQ_API_KEY: string;

  /**
   * Shopify Storefront Access Token
   * Used for MCP and Storefront GraphQL API
   * Set with: wrangler secret put SHOPIFY_STOREFRONT_TOKEN
   */
  SHOPIFY_STOREFRONT_TOKEN?: string;

  /**
   * Shopify Admin Access Token
   * Used for Admin GraphQL API (fallback when MCP unavailable)
   * Set with: wrangler secret put SHOPIFY_ADMIN_TOKEN
   */
  SHOPIFY_ADMIN_TOKEN?: string;

  // ========================================
  // VARS (wrangler.toml)
  // ========================================

  /**
   * Shop Domain (e.g., 'epir-art-silver-jewellery.myshopify.com')
   * IMMUTABLE: Do not change without authorization
   * Set in: wrangler.toml [vars]
   */
  SHOP_DOMAIN?: string;

  /**
   * Allowed CORS origin
   * Set in: wrangler.toml [vars]
   */
  ALLOWED_ORIGIN?: string;

  /**
   * Worker origin (for internal MCP calls)
   * Set in: wrangler.toml [vars]
   */
  WORKER_ORIGIN?: string;

  /**
   * Development bypass flag
   * Set to '1' to skip HMAC validation in dev
   * Set in: wrangler.toml [vars] or .dev.vars
   */
  DEV_BYPASS?: string;

  // ========================================
  // PRICING (optional)
  // ========================================

  /**
   * Groq input price per million tokens (USD)
   * Example: 0.20
   */
  GROQ_PRICE_INPUT_PER_M?: number;

  /**
   * Groq output price per million tokens (USD)
   * Example: 0.30
   */
  GROQ_PRICE_OUTPUT_PER_M?: number;
}

/**
 * Required secrets (MUST be set via `wrangler secret put`)
 */
export const REQUIRED_SECRETS = [
  'GROQ_API_KEY',
] as const;

/**
 * Optional secrets (fallback behavior if missing)
 */
export const OPTIONAL_SECRETS = [
  'SHOPIFY_STOREFRONT_TOKEN',
  'SHOPIFY_ADMIN_TOKEN',
] as const;

/**
 * Required vars (MUST be set in wrangler.toml [vars])
 */
export const REQUIRED_VARS = [
  'SHOP_DOMAIN',
  'ALLOWED_ORIGIN',
] as const;

/**
 * Optional vars
 */
export const OPTIONAL_VARS = [
  'WORKER_ORIGIN',
  'DEV_BYPASS',
] as const;

/**
 * Get required env binding (throws if missing)
 * 
 * @param env - Cloudflare Worker environment
 * @param key - Binding key name
 * @returns Binding value
 * @throws Error if binding is missing
 * 
 * @example
 * ```typescript
 * const apiKey = getEnvBinding(env, 'GROQ_API_KEY');
 * ```
 */
export function getEnvBinding<K extends keyof Env>(
  env: Env,
  key: K
): NonNullable<Env[K]> {
  const value = env[key];
  
  if (value === undefined || value === null) {
    throw new Error(`Missing required environment binding: ${String(key)}`);
  }
  
  return value as NonNullable<Env[K]>;
}

/**
 * Get optional env binding with fallback
 * 
 * @param env - Cloudflare Worker environment
 * @param key - Binding key name
 * @param fallback - Fallback value if missing
 * @returns Binding value or fallback
 * 
 * @example
 * ```typescript
 * const shopDomain = getEnvBindingOrDefault(
 *   env,
 *   'SHOP_DOMAIN',
 *   'epir-art-silver-jewellery.myshopify.com'
 * );
 * ```
 */
export function getEnvBindingOrDefault<K extends keyof Env, T>(
  env: Env,
  key: K,
  fallback: T
): NonNullable<Env[K]> | T {
  const value = env[key];
  
  return (value !== undefined && value !== null) 
    ? (value as NonNullable<Env[K]>) 
    : fallback;
}

/**
 * Validate all required bindings are present
 * 
 * @param env - Cloudflare Worker environment
 * @throws Error if any required binding is missing
 * 
 * @example
 * ```typescript
 * export default {
 *   async fetch(request: Request, env: Env, ctx: ExecutionContext) {
 *     validateRequiredBindings(env);
 *     // ... rest of handler
 *   }
 * }
 * ```
 */
export function validateRequiredBindings(env: Env): void {
  const missing: string[] = [];

  // Check required secrets
  for (const secret of REQUIRED_SECRETS) {
    if (!env[secret]) {
      missing.push(secret);
    }
  }

  // Check required vars
  for (const varName of REQUIRED_VARS) {
    if (!env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment bindings: ${missing.join(', ')}\n\n` +
      `Set secrets with: wrangler secret put <SECRET_NAME>\n` +
      `Set vars in: wrangler.toml [vars]`
    );
  }
}

/**
 * Get canonical MCP URL (immutable)
 * 
 * @param env - Cloudflare Worker environment
 * @returns Canonical MCP URL
 * 
 * @example
 * ```typescript
 * const mcpUrl = getCanonicalMcpUrl(env);
 * // => 'https://epir-art-silver-jewellery.myshopify.com/api/mcp'
 * ```
 */
export function getCanonicalMcpUrl(env: Env): string {
  const shopDomain = env.SHOP_DOMAIN || 'epir-art-silver-jewellery.myshopify.com';
  return `https://${shopDomain}/api/mcp`;
}
