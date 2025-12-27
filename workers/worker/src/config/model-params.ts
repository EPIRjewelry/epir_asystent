/**
 * worker/src/config/model-params.ts
 *
 * Centralna konfiguracja parametrów modelu AI.
 * Ekstrahowane z ai-client.ts dla łatwego zarządzania i A/B testingu.
 *
 * Model: llama-3.3-70b-versatile (Groq)
 * - 70B parameters, długo kontekstu ~128k
 * - Natywne tool_calls (OpenAI-compatible)
 * - Optymalizowany pod niskie opóźnienia na infrastrukturze Groq
 */

/**
 * Model ID używany w całym workerze.
 */
export const GROQ_MODEL_ID = 'llama-3.3-70b-versatile' as const;

// Compile-time verification that GROQ_MODEL_ID is not accidentally changed
const _MODEL_VERIFICATION: 'llama-3.3-70b-versatile' = GROQ_MODEL_ID;

/**
 * Model parameters for chat completions
 * 
 * These values are optimized for luxury jewelry e-commerce assistant:
 * - temperature: Controls randomness (0.5 = balanced creativity/consistency)
 * - max_tokens: Maximum response length (3000 = ~2000 words)
 * - top_p: Nucleus sampling threshold (0.9 = high quality, diverse responses)
 * 
 * For A/B testing: Create new config file (model-params-v2.ts) instead of modifying this
 */
export const MODEL_PARAMS = {
  /**
   * Temperature: Controls randomness in responses
   * - 0.0 = deterministic (same input → same output)
   * - 1.0 = maximum creativity
   * - 0.5 = balanced (RECOMMENDED for luxury assistant)
   * 
   * @default 0.5
   */
  temperature: 0.5,

  /**
   * Max tokens: Maximum response length
   * - 1 token ≈ 0.75 words (English)
   * - 1 token ≈ 0.5 words (Polish, due to diacritics)
   * - 3000 tokens ≈ 1500-2000 words in Polish
   * 
   * @default 3000
   */
  max_tokens: 3000,

  /**
   * Top-p (nucleus sampling): Probability threshold for token selection
   * - 1.0 = consider all tokens
   * - 0.9 = consider top 90% probability mass (RECOMMENDED)
   * - 0.5 = very focused, less diverse
   * 
   * @default 0.9
   */
  top_p: 0.9,

  /**
   * Stream options: Include usage statistics in streaming response
   * Required for cost tracking and monitoring.
   * 
   * @default { include_usage: true }
   */
  stream_options: {
    include_usage: true,
  },
} as const;

/**
 * Groq API endpoint (DO NOT CHANGE)
 */
export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions' as const;

/**
 * Type-safe export of model parameters
 * Use this in ai-client.ts to ensure consistency
 */
export type ModelParams = typeof MODEL_PARAMS;
