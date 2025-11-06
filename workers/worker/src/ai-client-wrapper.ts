/**
 * worker/src/ai-client-wrapper.ts
 * 
 * Hybrid wrapper for AI functionality:
 * - Uses AI_WORKER Service Binding (primary)
 * - Falls back to local ai-client.ts (for backward compatibility)
 * 
 * PURPOSE:
 * - Gradual migration from monolithic ai-client.ts to microservice AI Worker
 * - Zero-downtime deployment (works with or without AI_WORKER binding)
 * - Identical API to ai-client.ts (drop-in replacement)
 * 
 * MIGRATION PATH:
 * 1. Deploy AI Worker separately → wrangler deploy in workers/ai-worker
 * 2. Update main worker wrangler.toml with AI_WORKER binding
 * 3. Replace all ai-client.ts imports with ai-client-wrapper.ts
 * 4. Test thoroughly (fallback should work seamlessly)
 * 5. After 100% migration, remove local ai-client.ts
 * 
 * @see workers/ai-worker/src/index.ts - AI Worker implementation
 * @see workers/worker/src/ai-client.ts - Original implementation (fallback)
 */

import { GroqMessage, HarmonyEvent } from './ai-client';
import * as LocalAIClient from './ai-client';

/**
 * Environment with optional AI_WORKER binding
 */
interface Env {
  GROQ_API_KEY: string;
  AI_WORKER?: Fetcher;
  GROQ_PRICE_INPUT_PER_M?: number;
  GROQ_PRICE_OUTPUT_PER_M?: number;
}

/**
 * Check if AI_WORKER Service Binding is available
 * 
 * @param env - Cloudflare Worker environment
 * @returns true if AI_WORKER exists and is healthy
 */
async function isAIWorkerAvailable(env: Env): Promise<boolean> {
  if (!env.AI_WORKER) {
    return false;
  }

  try {
    // Quick health check (max 1 second timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);

    const response = await env.AI_WORKER.fetch('https://ai-worker/health', {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return response.ok;
  } catch (error) {
    console.warn('[AI Wrapper] AI_WORKER health check failed, using fallback:', error);
    return false;
  }
}

/**
 * Stream text deltas from Groq API
 * 
 * Uses AI_WORKER if available, otherwise falls back to local ai-client.ts
 * 
 * @param messages - Chat messages
 * @param env - Environment
 * @returns ReadableStream<string> - Text deltas
 */
export async function streamGroqResponse(
  messages: GroqMessage[],
  env: Env
): Promise<ReadableStream<string>> {
  // Try AI_WORKER first
  if (await isAIWorkerAvailable(env)) {
    try {
      console.log('[AI Wrapper] Using AI_WORKER for streaming');

      const response = await env.AI_WORKER!.fetch('https://ai-worker/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        throw new Error(`AI_WORKER returned ${response.status}`);
      }

      if (!response.body) {
        throw new Error('AI_WORKER returned empty body');
      }

      return response.body.pipeThrough(new TextDecoderStream()) as ReadableStream<string>;
    } catch (error) {
      console.warn('[AI Wrapper] AI_WORKER streaming failed, using fallback:', error);
      // Fall through to local client
    }
  }

  // Fallback: Local ai-client.ts
  console.log('[AI Wrapper] Using local ai-client.ts for streaming');
  return LocalAIClient.streamGroqResponse(messages, env);
}

/**
 * Stream Harmony events from Groq API
 * 
 * Uses AI_WORKER if available, otherwise falls back to local ai-client.ts
 * 
 * @param messages - Chat messages
 * @param env - Environment
 * @returns ReadableStream<HarmonyEvent> - Parsed Harmony events
 */
export async function streamGroqHarmonyEvents(
  messages: GroqMessage[],
  env: Env
): Promise<ReadableStream<HarmonyEvent>> {
  // Try AI_WORKER first
  if (await isAIWorkerAvailable(env)) {
    try {
      console.log('[AI Wrapper] Using AI_WORKER for Harmony streaming');

      const response = await env.AI_WORKER!.fetch('https://ai-worker/harmony', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        throw new Error(`AI_WORKER returned ${response.status}`);
      }

      if (!response.body) {
        throw new Error('AI_WORKER returned empty body');
      }

      // Parse SSE stream into HarmonyEvent objects
      return response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(
          new TransformStream<string, HarmonyEvent>({
            start() {},
            transform(chunk, controller) {
              // Parse Server-Sent Events format
              const lines = chunk.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6).trim();
                  if (data && data !== '[DONE]') {
                    try {
                      const event = JSON.parse(data) as HarmonyEvent;
                      controller.enqueue(event);
                    } catch (err) {
                      console.error('[AI Wrapper] Failed to parse HarmonyEvent:', err);
                    }
                  }
                }
              }
            },
          })
        );
    } catch (error) {
      console.warn('[AI Wrapper] AI_WORKER Harmony streaming failed, using fallback:', error);
      // Fall through to local client
    }
  }

  // Fallback: Local ai-client.ts
  console.log('[AI Wrapper] Using local ai-client.ts for Harmony streaming');
  return LocalAIClient.streamGroqHarmonyEvents(messages, env);
}

/**
 * Get complete response from Groq API (non-streaming)
 * 
 * Uses AI_WORKER if available, otherwise falls back to local ai-client.ts
 * 
 * @param messages - Chat messages
 * @param env - Environment
 * @returns Complete response text
 */
export async function getGroqResponse(
  messages: GroqMessage[],
  env: Env
): Promise<string> {
  // Try AI_WORKER first
  if (await isAIWorkerAvailable(env)) {
    try {
      console.log('[AI Wrapper] Using AI_WORKER for complete response');

      const response = await env.AI_WORKER!.fetch('https://ai-worker/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        throw new Error(`AI_WORKER returned ${response.status}`);
      }

      const data = await response.json() as { text: string };
      return data.text;
    } catch (error) {
      console.warn('[AI Wrapper] AI_WORKER complete failed, using fallback:', error);
      // Fall through to local client
    }
  }

  // Fallback: Local ai-client.ts
  console.log('[AI Wrapper] Using local ai-client.ts for complete response');
  return LocalAIClient.getGroqResponse(messages, env);
}

/**
 * Re-export types for convenience
 */
export { GroqMessage, HarmonyEvent } from './ai-client';
export { GROQ_MODEL_ID, MODEL_PARAMS } from './config/model-params';
