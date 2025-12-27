/// <reference types="@cloudflare/workers-types" />

/**
 * AI Worker - Reusable AI service for EPIR ecosystem
 * 
 * This worker is designed to be called via Service Binding from other workers.
 * It encapsulates all Groq API communication logic.
 * 
 * Architecture:
 * - Main Worker (epir-art-jewellery-worker) → Service Binding → AI Worker (this)
 * - AI Worker handles: streaming, non-streaming, Harmony events, cost logging
 * 
 * Endpoints:
 * - POST /stream - Returns SSE stream of text deltas
 * - POST /function-calling - Returns SSE stream of OpenAIEvent objects
 * - POST /complete - Returns JSON with full response
 * 
 * @see Service Binding docs: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
 */

export type GroqMessage = { 
  role: 'system' | 'user' | 'assistant' | 'tool'; 
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

// OpenAI Function Calling support — parsed event types
export type OpenAIEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string; index: number }
  | { type: 'tool_call_chunk'; id?: string; name?: string; arguments?: string; index: number }
  | { type: 'usage'; prompt_tokens: number; completion_tokens: number };

interface Env {
  GROQ_API_KEY: string;
  GROQ_PRICE_INPUT_PER_M?: number;
  GROQ_PRICE_OUTPUT_PER_M?: number;
}

interface GroqPayload {
  model: string;
  messages: GroqMessage[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream_options?: { include_usage?: boolean };
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * ⚠️ CRITICAL: Model ID is HARDCODED and MUST NOT be changed without authorization.
 * 
 * This model (llama-3.3-70b-versatile) is specifically chosen and configured for:
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
 * Parse SSE "data:" lines and emit OpenAI Function Calling events.
 */
function createOpenAIFunctionCallingTransform(): TransformStream<string, OpenAIEvent> {
  let buffer = '';
  const toolCallsByIndex = new Map<number, { id?: string; name?: string; arguments: string }>();

  return new TransformStream<string, OpenAIEvent>({
    start() {
      buffer = '';
      toolCallsByIndex.clear();
    },
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line === 'data: [DONE]' || line === '[DONE]') continue;
        
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
        let parsed: any = null;
        try {
          parsed = JSON.parse(payload);
        } catch (_e) {
          continue;
        }

        const choice = parsed?.choices?.[0];
        const delta = choice?.delta;
        const message = choice?.message;
        const usage = parsed?.usage;

        if (usage && typeof usage === 'object') {
          const p = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
          const c = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
          controller.enqueue({ type: 'usage', prompt_tokens: p, completion_tokens: c });
        }

        if (message?.content && typeof message.content === 'string') {
          controller.enqueue({ type: 'text', delta: message.content });
        }

        if (delta?.content && typeof delta.content === 'string') {
          controller.enqueue({ type: 'text', delta: delta.content });
        }

        if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index ?? 0;
            
            let accumulated = toolCallsByIndex.get(index);
            if (!accumulated) {
              accumulated = { arguments: '' };
              toolCallsByIndex.set(index, accumulated);
            }

            if (toolCallDelta.id) {
              accumulated.id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
              accumulated.name = toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              accumulated.arguments += toolCallDelta.function.arguments;
            }

            controller.enqueue({
              type: 'tool_call_chunk',
              id: toolCallDelta.id,
              name: toolCallDelta.function?.name,
              arguments: toolCallDelta.function?.arguments,
              index
            });
          }
        }

        if (message?.tool_calls && Array.isArray(message.tool_calls)) {
          for (let i = 0; i < message.tool_calls.length; i++) {
            const toolCall = message.tool_calls[i];
            controller.enqueue({
              type: 'tool_call',
              id: toolCall.id,
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
              index: i
            });
          }
        }
      }
    },
    flush(controller) {
      for (const [index, toolCall] of toolCallsByIndex.entries()) {
        if (toolCall.id && toolCall.name && toolCall.arguments) {
          controller.enqueue({
            type: 'tool_call',
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
            index
          });
        }
      }
    }
  });
}

/**
 * Main Worker fetch handler - routes requests to appropriate endpoints
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', model: GROQ_MODEL_ID }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // All AI endpoints require POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Parse request body
    let body: { messages: GroqMessage[]; temperature?: number; max_tokens?: number; top_p?: number };
    try {
      body = await request.json();
    } catch (e) {
      return new Response('Invalid JSON body', { status: 400 });
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      return new Response('Missing or invalid "messages" array', { status: 400 });
    }

    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) {
      return new Response('Missing GROQ_API_KEY secret', { status: 500 });
    }

    // Route to appropriate handler
    switch (url.pathname) {
      case '/stream':
        return handleStream(body, env, apiKey);
      case '/function-calling':
        return handleFunctionCalling(body, env, apiKey);
      case '/harmony': // Backward compatibility alias
        return handleFunctionCalling(body, env, apiKey);
      case '/complete':
        return handleComplete(body, env, apiKey);
      default:
        return new Response('Not found', { status: 404 });
    }
  },
};

/**
 * POST /stream - Returns SSE stream of text deltas
 */
async function handleStream(
  body: { messages: GroqMessage[]; temperature?: number; max_tokens?: number; top_p?: number },
  env: Env,
  apiKey: string
): Promise<Response> {
  const payload: GroqPayload = {
    model: GROQ_MODEL_ID,
    messages: body.messages,
    stream: true,
    temperature: body.temperature ?? 0.5,
    max_tokens: body.max_tokens ?? 3000,
    top_p: body.top_p ?? 0.9,
    stream_options: { include_usage: true },
  };

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const errorBody = await res.text().catch(() => '<no body>');
    return new Response(`Groq API error: ${errorBody}`, { status: res.status });
  }

  let buffer = '';
  let usagePrompt = 0;
  let usageCompletion = 0;
  let sawUsage = false;

  const textStream = res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        start() {
          buffer = '';
        },
        transform(chunk, controller) {
          buffer += chunk;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') continue;
            
            const prefix = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
            try {
              const parsed = JSON.parse(prefix);
              const content = parsed?.choices?.[0]?.delta?.content;
              const messageContent = parsed?.choices?.[0]?.message?.content;
              const usage = parsed?.usage;
              
              if (typeof content === 'string' && content) {
                controller.enqueue(content);
              } else if (typeof messageContent === 'string' && messageContent) {
                controller.enqueue(messageContent);
              } else if (usage && typeof usage === 'object') {
                const p = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
                const c = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
                if (!Number.isNaN(p)) usagePrompt = p;
                if (!Number.isNaN(c)) usageCompletion = c;
                sawUsage = true;
              }
            } catch (e) {
              // Ignore non-parseable chunks
            }
          }
        },
        flush(controller) {
          if (buffer.trim() && buffer.trim() !== 'data: [DONE]' && buffer.trim() !== '[DONE]') {
            const trimmed = buffer.trim();
            const prefix = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
            try {
              const parsed = JSON.parse(prefix);
              const content = parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content;
              if (typeof content === 'string' && content) {
                controller.enqueue(content);
              }
            } catch (e) {
              // Ignore errors on final flush
            }
          }
          if (sawUsage) {
            try {
              const inM = env.GROQ_PRICE_INPUT_PER_M;
              const outM = env.GROQ_PRICE_OUTPUT_PER_M;
              if (typeof inM === 'number' && typeof outM === 'number') {
                const costIn = (usagePrompt / 1_000_000) * inM;
                const costOut = (usageCompletion / 1_000_000) * outM;
                const total = costIn + costOut;
                console.log(`[AI-Worker][stream] usage: prompt=${usagePrompt}, completion=${usageCompletion}, cost≈$${total.toFixed(6)}`);
              } else {
                console.log(`[AI-Worker][stream] usage: prompt=${usagePrompt}, completion=${usageCompletion}`);
              }
            } catch {}
          }
        }
      })
    )
    .pipeThrough(new TextEncoderStream());  // Convert string → Uint8Array for Response

  return new Response(textStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * POST /function-calling - Returns SSE stream of OpenAIEvent objects (JSON lines)
 */
async function handleFunctionCalling(
  body: { messages: GroqMessage[]; temperature?: number; max_tokens?: number; top_p?: number },
  env: Env,
  apiKey: string
): Promise<Response> {
  const payload: GroqPayload = {
    model: GROQ_MODEL_ID,
    messages: body.messages,
    stream: true,
    temperature: body.temperature ?? 0.5,
    max_tokens: body.max_tokens ?? 3000,
    top_p: body.top_p ?? 0.9,
    stream_options: { include_usage: true },
  };

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const errorBody = await res.text().catch(() => '<no body>');
    return new Response(`Groq API error: ${errorBody}`, { status: res.status });
  }

  const functionCallingStream = res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(createOpenAIFunctionCallingTransform())
    .pipeThrough(new TransformStream<OpenAIEvent, string>({
      transform(event, controller) {
        controller.enqueue(JSON.stringify(event) + '\n');
      }
    }))
    .pipeThrough(new TextEncoderStream());  // Convert string → Uint8Array for Response

  return new Response(functionCallingStream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * POST /complete - Returns full JSON response (non-streaming)
 */
async function handleComplete(
  body: { messages: GroqMessage[]; temperature?: number; max_tokens?: number; top_p?: number },
  env: Env,
  apiKey: string
): Promise<Response> {
  const payload: GroqPayload = {
    model: GROQ_MODEL_ID,
    messages: body.messages,
    stream: false,
    temperature: body.temperature ?? 0.5,
    max_tokens: body.max_tokens ?? 3000,
    top_p: body.top_p ?? 0.9,
  };

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '<no body>');
    return new Response(`Groq API error: ${errorBody}`, { status: res.status });
  }

  const json: any = await res.json().catch(() => null);
  const content = json?.choices?.[0]?.message?.content;

  // Log usage + cost
  try {
    const usage = json?.usage || {};
    const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
    if (prompt || completion) {
      const inM = env.GROQ_PRICE_INPUT_PER_M;
      const outM = env.GROQ_PRICE_OUTPUT_PER_M;
      if (typeof inM === 'number' && typeof outM === 'number') {
        const costIn = (prompt / 1_000_000) * inM;
        const costOut = (completion / 1_000_000) * outM;
        const total = costIn + costOut;
        console.log(`[AI-Worker][complete] usage: prompt=${prompt}, completion=${completion}, cost≈$${total.toFixed(6)}`);
      } else {
        console.log(`[AI-Worker][complete] usage: prompt=${prompt}, completion=${completion}`);
      }
    }
  } catch {}

  if (!content) {
    return new Response('Groq API returned empty response', { status: 500 });
  }

  return new Response(JSON.stringify({ content }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
