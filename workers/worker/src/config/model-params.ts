/**
 * worker/src/config/model-params.ts
 *
 * Centralna konfiguracja parametrów modelu AI.
 * Ekstrahowane z ai-client.ts dla łatwego zarządzania i A/B testingu.
 *
 * Model: llama-3.3-70b-versatile (Groq)
 * - Dense transformer (bez Harmony/MoE tokenów)
 * - Natywne tool_calls, brak <|call|>/<|end|>
 * - Bardzo dobra jakość dla e-commerce / asystentów
 */

/**
 * Model ID
 */
export const GROQ_MODEL_ID = 'llama-3.3-70b-versatile' as const;

// Compile-time verification that GROQ_MODEL_ID is not accidentally changed
const _MODEL_VERIFICATION: 'llama-3.3-70b-versatile' = GROQ_MODEL_ID;

/**
 * Model parameters for chat completions
 */
export const MODEL_PARAMS = {
  temperature: 0.5,
  max_tokens: 3000,
  top_p: 0.9,
  stream_options: {
    include_usage: true,
  },
} as const;

/**
 * Groq API endpoint (OpenAI-compatible)
 */
export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions' as const;

/**
 * Type-safe export of model parameters
 */
export type ModelParams = typeof MODEL_PARAMS;
