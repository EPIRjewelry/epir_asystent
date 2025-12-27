/**
 * worker/src/ai-client.ts
 * Ujednolicony klient do komunikacji z API Groq.
 * Obsługa natywnych tool_calls (OpenAI-compatible) – brak Harmony tagów.
 */

import { GROQ_MODEL_ID, MODEL_PARAMS, GROQ_API_URL } from './config/model-params';

export type GroqMessage = { 
  role: 'system' | 'user' | 'assistant' | 'tool'; 
  content: string;
  tool_call_id?: string;  // Opcjonalne dla wiadomości 'tool'
  name?: string;           // Opcjonalne dla wiadomości 'tool'
};

// Streaming event types (tekst i tool_calls)
export type HarmonyEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; arguments: any }
  | { type: 'tool_return'; result: any }
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

export async function streamGroqResponse(
  messages: GroqMessage[],
  env: Env
): Promise<ReadableStream<string>> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Missing GROQ_API_KEY secret');

  const payload: GroqPayload = {
    model: GROQ_MODEL_ID,
    messages,
    stream: true,
    temperature: MODEL_PARAMS.temperature,
    max_tokens: MODEL_PARAMS.max_tokens,
    top_p: MODEL_PARAMS.top_p,
    stream_options: MODEL_PARAMS.stream_options,
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
    throw new Error(`Groq API error (${res.status}): ${errorBody}`);
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
              }
              if (usage && typeof usage === 'object') {
                const p = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
                const c = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
                if (!Number.isNaN(p)) usagePrompt = p;
                if (!Number.isNaN(c)) usageCompletion = c;
                sawUsage = true;
              }
            } catch (e) {
              // ignore
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
            } catch (e) {}
          }
          if (sawUsage) {
            try {
              const inM = env.GROQ_PRICE_INPUT_PER_M;
              const outM = env.GROQ_PRICE_OUTPUT_PER_M;
              if (typeof inM === 'number' && typeof outM === 'number') {
                const costIn = (usagePrompt / 1_000_000) * inM;
                const costOut = (usageCompletion / 1_000_000) * outM;
                const total = costIn + costOut;
                console.log(`[Groq][stream] usage: prompt=${usagePrompt}, completion=${usageCompletion}, cost≈$${total.toFixed(6)} (in=$${costIn.toFixed(6)}, out=$${costOut.toFixed(6)})`);
              } else {
                console.log(`[Groq][stream] usage: prompt=${usagePrompt}, completion=${usageCompletion}`);
              }
            } catch {}
          }
        }
      })
    );

  return textStream;
}

/**
 * Transform stream dla natywnych tool_calls (OpenAI-compatible) → HarmonyEvent
 */
function createHarmonyTransform(): TransformStream<string, HarmonyEvent> {
  let buffer = '';

  return new TransformStream<string, HarmonyEvent>({
    start() {
      buffer = '';
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
        } catch {
          continue;
        }

        const choice = parsed?.choices?.[0];
        const delta = choice?.delta || {};
        const message = choice?.message || {};
        const usage = parsed?.usage;

        // usage
        if (usage && typeof usage === 'object') {
          const p = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
          const c = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
          controller.enqueue({ type: 'usage', prompt_tokens: p, completion_tokens: c });
        }

        // tool_calls (delta)
        const toolCalls = delta.tool_calls || message.tool_calls || [];
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            const name = tc?.function?.name || tc?.name;
            let args: any = tc?.function?.arguments || tc?.arguments;
            if (typeof args === 'string') {
              try {
                args = JSON.parse(args);
              } catch {
                // keep raw string
              }
            }
            if (name) {
              controller.enqueue({ type: 'tool_call', name, arguments: args });
            }
          }
        }

        // text deltas
        const content = delta.content ?? message.content;
        if (typeof content === 'string' && content) {
          controller.enqueue({ type: 'text', delta: content });
        }
      }
    },
  });
}

/**
 * Start a Groq streaming request and return a stream of HarmonyEvent objects.
 */
export async function streamGroqHarmonyEvents(
  messages: GroqMessage[],
  env: Env
): Promise<ReadableStream<HarmonyEvent>> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Missing GROQ_API_KEY secret');

  const payload: GroqPayload = {
    model: GROQ_MODEL_ID,
    messages,
    stream: true,
    temperature: MODEL_PARAMS.temperature,
    max_tokens: MODEL_PARAMS.max_tokens,
    top_p: MODEL_PARAMS.top_p,
    stream_options: MODEL_PARAMS.stream_options,
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
    throw new Error(`Groq API error (${res.status}): ${errorBody}`);
  }

  return res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(createHarmonyTransform());
}

export const __test = { createHarmonyTransform };

export async function getGroqResponse(
  messages: GroqMessage[],
  env: Env
): Promise<string> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Missing GROQ_API_KEY secret');

  const payload: GroqPayload = {
    model: GROQ_MODEL_ID,
    messages,
    stream: false,
    temperature: MODEL_PARAMS.temperature,
    max_tokens: MODEL_PARAMS.max_tokens,
    top_p: MODEL_PARAMS.top_p,
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
    throw new Error(`Groq API error (${res.status}): ${errorBody}`);
  }

  const json: any = await res.json().catch(() => null);
  const content = json?.choices?.[0]?.message?.content;

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
        console.log(`[Groq][resp] usage: prompt=${prompt}, completion=${completion}, cost≈$${total.toFixed(6)} (in=$${costIn.toFixed(6)}, out=$${costOut.toFixed(6)})`);
      } else {
        console.log(`[Groq][resp] usage: prompt=${prompt}, completion=${completion}`);
      }
    }
  } catch {}

  if (!content) {
    throw new Error('Groq API returned an empty or invalid response');
  }

  return String(content);
}
