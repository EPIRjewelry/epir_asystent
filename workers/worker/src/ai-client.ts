/**
 * worker/src/ai-client.ts
 * Ujednolicony klient do komunikacji z API Groq.
 * Zastępuje redundantne pliki `groq.ts` i `cloudflare-ai.ts`.
 * Odpowiedzialność: Wyłącznie obsługa żądań HTTP (streaming i non-streaming) do API.
 * NIE zawiera logiki biznesowej, budowania promptów ani promptów systemowych.
 */

import { GROQ_MODEL_ID, MODEL_PARAMS, GROQ_API_URL } from './config/model-params';

export type GroqToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type GroqToolCallDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
};

export type GroqMessage = { 
  role: 'system' | 'user' | 'assistant' | 'tool'; 
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;  // Opcjonalne dla wiadomości 'tool'
  name?: string;           // Opcjonalne dla wiadomości 'tool'
};

export type GroqStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: GroqToolCall }
  | { type: 'usage'; prompt_tokens: number; completion_tokens: number }
  | { type: 'done'; finish_reason?: string };

/**
 * Interfejs dla środowiska Cloudflare Worker.
 */
interface Env {
  GROQ_API_KEY: string;
  GROQ_PRICE_INPUT_PER_M?: number;   // np. 0.20
  GROQ_PRICE_OUTPUT_PER_M?: number;  // np. 0.30
}

/**
 * Parametry wywołania API Groq.
 */
interface GroqPayload {
  model: string;
  messages: GroqMessage[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  // Dla streamingu: poproś o usage w strumieniu (zgodne z OpenAI-compatible API)
  stream_options?: { include_usage?: boolean };
  tools?: GroqToolCallDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

/**
 * Wykonuje streamingowe zapytanie do Groq i zwraca ReadableStream z tekstem.
 * @param messages - Tablica wiadomości (system, user, assistant).
 * @param model - Nazwa modelu (np. 'llama3-70b-8192').
 * @param env - Środowisko Workera (dla API key).
 * @returns ReadableStream<string> - Strumień fragmentów tekstu (delta).
 */
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

  // Parsuj SSE stream z Groq i wyciągaj tylko fragmenty tekstu (delta content)
  // Dodatkowo: wyłapuj usage i loguj koszt (jeśli dostępne stawki w env)
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
                // Zapisz usage do logowania przy flush
                const p = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
                const c = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
                if (!Number.isNaN(p)) usagePrompt = p;
                if (!Number.isNaN(c)) usageCompletion = c;
                sawUsage = true;
              }
            } catch (e) {
              // Ignoruj nieparsowalne fragmenty
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
              // Ignoruj błędy przy finalnym flushowaniu
            }
          }
          // Po zakończeniu streamu — zaloguj usage i opcjonalnie koszt
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

function createGroqStreamTransform(): TransformStream<string, GroqStreamEvent> {
  let buffer = '';
  const toolBuffers = new Map<string, GroqToolCall>();

  return new TransformStream<string, GroqStreamEvent>({
    start() {
      buffer = '';
      toolBuffers.clear();
    },
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line === 'data: [DONE]' || line === '[DONE]') {
          controller.enqueue({ type: 'done', finish_reason: 'stop' });
          continue;
        }
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
        let parsed: any = null;
        try {
          parsed = JSON.parse(payload);
        } catch (_e) {
          continue;
        }

        const choice = parsed?.choices?.[0];
        if (choice?.finish_reason) {
          controller.enqueue({ type: 'done', finish_reason: choice.finish_reason });
        }

        const deltaText = choice?.delta?.content;
        const msgContent = choice?.message?.content;
        const text = typeof deltaText === 'string' ? deltaText : (typeof msgContent === 'string' ? msgContent : '');
        if (text) {
          controller.enqueue({ type: 'text', delta: text });
        }

        const toolCalls = choice?.delta?.tool_calls || choice?.message?.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const call of toolCalls) {
            const id = call.id || `call_${toolBuffers.size + 1}`;
            const name = call.function?.name || toolBuffers.get(id)?.name || '';
            const argDelta = typeof call.function?.arguments === 'string' ? call.function.arguments : '';
            const existing = toolBuffers.get(id) || { id, name, arguments: '' };
            const merged: GroqToolCall = {
              id,
              name: name || existing.name,
              arguments: `${existing.arguments}${argDelta || ''}`,
            };
            toolBuffers.set(id, merged);
            controller.enqueue({ type: 'tool_call', call: merged });
          }
        }

        const usage = parsed?.usage;
        if (usage && typeof usage === 'object') {
          const p = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
          const c = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
          controller.enqueue({ type: 'usage', prompt_tokens: p, completion_tokens: c });
        }
      }
    },
    flush(controller) {
      if (!buffer.trim()) return;
      const payload = buffer.trim().startsWith('data:') ? buffer.trim().slice(5).trim() : buffer.trim();
      try {
        const parsed = JSON.parse(payload);
        const choice = parsed?.choices?.[0];
        if (choice?.finish_reason) {
          controller.enqueue({ type: 'done', finish_reason: choice.finish_reason });
        }
        const deltaText = choice?.delta?.content;
        const msgContent = choice?.message?.content;
        const text = typeof deltaText === 'string' ? deltaText : (typeof msgContent === 'string' ? msgContent : '');
        if (text) {
          controller.enqueue({ type: 'text', delta: text });
        }
        const toolCalls = choice?.delta?.tool_calls || choice?.message?.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const call of toolCalls) {
            const id = call.id || `call_${toolBuffers.size + 1}`;
            const name = call.function?.name || toolBuffers.get(id)?.name || '';
            const argDelta = typeof call.function?.arguments === 'string' ? call.function.arguments : '';
            const existing = toolBuffers.get(id) || { id, name, arguments: '' };
            const merged: GroqToolCall = {
              id,
              name: name || existing.name,
              arguments: `${existing.arguments}${argDelta || ''}`,
            };
            toolBuffers.set(id, merged);
            controller.enqueue({ type: 'tool_call', call: merged });
          }
        }
        const usage = parsed?.usage;
        if (usage && typeof usage === 'object') {
          const p = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
          const c = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
          controller.enqueue({ type: 'usage', prompt_tokens: p, completion_tokens: c });
        }
      } catch (_e) {
        // ignore
      }
    },
  });
}

/**
 * Start a Groq streaming request and return a stream of GroqStreamEvent objects.
 * Consumers can handle text vs tool_call events as needed.
 */
export async function streamGroqEvents(
  messages: GroqMessage[],
  env: Env,
  tools?: GroqToolCallDefinition[]
): Promise<ReadableStream<GroqStreamEvent>> {
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
    tools,
    tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
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
    .pipeThrough(createGroqStreamTransform());
}

// Expose internal helpers for unit tests only
export const __test = { createGroqStreamTransform };

/**
 * Wykonuje standardowe (non-streaming) zapytanie do Groq.
 * @param messages - Tablica wiadomości (system, user, assistant).
 * @param model - Nazwa modelu (np. 'llama3-70b-8192').
 * @param env - Środowisko Workera (dla API key).
 * @returns Pełna odpowiedź tekstowa (content) od modelu.
 */
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

  // Logowanie usage + koszt (jeśli dostępne)
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
