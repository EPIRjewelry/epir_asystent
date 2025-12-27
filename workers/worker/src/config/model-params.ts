/**
 * worker/src/config/model-params.ts
 * Centralna konfiguracja parametrów modelu AI.
 * Docelowy model: Groq Llama 3.3 70B (OpenAI-compatible, native tool_calls).
 */

export const GROQ_MODEL_ID = 'llama-3.3-70b-versatile' as const;

// Compile-time verification
const _MODEL_VERIFICATION: 'llama-3.3-70b-versatile' = GROQ_MODEL_ID;

export const MODEL_PARAMS = {
  temperature: 0.5,
  max_tokens: 3000,
  top_p: 0.9,
  stream_options: {
    include_usage: true,
  },
} as const;

export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions' as const;
export type ModelParams = typeof MODEL_PARAMS;
