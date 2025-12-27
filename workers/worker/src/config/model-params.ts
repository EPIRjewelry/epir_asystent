/**
 * worker/src/config/model-params.ts
 * 
 * Centralna konfiguracja parametrów modelu AI.
 * Ekstrahowane z ai-client.ts dla łatwego zarządzania i A/B testingu.
 * 
 * ⚠️ CRITICAL: GROQ_MODEL_ID is HARDCODED and IMMUTABLE
 * 
 * Model: llama-3.3-70b-versatile
 * - Llama 3.3 70B architecture
 * - Native OpenAI Function Calling support
 * - 128k context window
 * - Optimized for luxury e-commerce (jewelry) assistant
 * 
 * DO NOT change GROQ_MODEL_ID without:
 * 1. Owner approval
 * 2. Testing prompt compatibility
 * 3. Verifying Harmony protocol support
 * 4. Updating documentation (README.md, copilot-instructions.md)
 * 
 * @see README.md - Canonical settings section
 * @see .github/copilot-instructions.md - Architecture overview
 */

/**
 * ⚠️ Model ID Configuration
 * 
 * This model is specifically chosen for:
 * - Llama 3.3 70B architecture
 * - Native OpenAI Function Calling support
 * - Chain-of-Thought reasoning capabilities
 * - Optimized cost/performance ratio via Groq's LPU infrastructure
 * 
 * System prompts and tool definitions are designed for OpenAI-compatible function calling.
 * 
 * @constant
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
