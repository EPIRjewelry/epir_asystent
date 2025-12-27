/**
 * worker/src/ai-client.ts
 * Ujednolicony klient do komunikacji z API Groq.
 * Zastępuje redundantne pliki `groq.ts` i `cloudflare-ai.ts`.
 * Odpowiedzialność: Wyłącznie obsługa żądań HTTP (streaming i non-streaming) do API.
 * NIE zawiera logiki biznesowej, budowania promptów ani promptów systemowych.
 */

import { GROQ_MODEL_ID, MODEL_PARAMS, GROQ_API_URL } from './config/model-params';

export type GroqMessage = { 
  role: 'system' | 'user' | 'assistant' | 'tool'; 
  content: string;
  tool_call_id?: string;  // Opcjonalne dla wiadomości 'tool'
  name?: string;           // Opcjonalne dla wiadomości 'tool'
};

// OpenAI Function Calling support — parsed event types
export type OpenAIEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string; index: number }
  | { type: 'tool_call_chunk'; id?: string; name?: string; arguments?: string; index: number }
  | { type: 'usage'; prompt_tokens: number; completion_tokens: number };

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

/**
 * Parse SSE "data:" lines coming from OpenAI-compatible API and emit function calling events.
 * This parser handles the standard OpenAI tool_calls format including deltas for streaming.
 * Compatible with Groq SSE streaming format.
 */
function createOpenAIFunctionCallingTransform(): TransformStream<string, OpenAIEvent> {
  let buffer = '';
  // State for accumulating tool call deltas per index
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
          // Not a JSON line; skip
          continue;
        }

        const choice = parsed?.choices?.[0];
        const delta = choice?.delta;
        const message = choice?.message;
        const usage = parsed?.usage;

        // Handle usage statistics
        if (usage && typeof usage === 'object') {
          const p = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
          const c = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
          controller.enqueue({ type: 'usage', prompt_tokens: p, completion_tokens: c });
        }

        // Handle message content (for non-streaming or final message)
        if (message?.content && typeof message.content === 'string') {
          controller.enqueue({ type: 'text', delta: message.content });
        }

        // Handle delta content (streaming text)
        if (delta?.content && typeof delta.content === 'string') {
          controller.enqueue({ type: 'text', delta: delta.content });
        }

        // Handle tool_calls in delta (streaming function calls)
        if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index ?? 0;
            
            // Get or create tool call accumulator for this index
            let accumulated = toolCallsByIndex.get(index);
            if (!accumulated) {
              accumulated = { arguments: '' };
              toolCallsByIndex.set(index, accumulated);
            }

            // Accumulate the deltas
            if (toolCallDelta.id) {
              accumulated.id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
              accumulated.name = toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              accumulated.arguments += toolCallDelta.function.arguments;
            }

            // Emit chunk event
            controller.enqueue({
              type: 'tool_call_chunk',
              id: toolCallDelta.id,
              name: toolCallDelta.function?.name,
              arguments: toolCallDelta.function?.arguments,
              index
            });
          }
        }

        // Handle complete tool_calls in message (non-streaming)
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
      // Emit any accumulated tool calls
      for (const [index, toolCall] of toolCallsByIndex.entries()) {
        if (toolCall.id && toolCall.name) {
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
 * Start a Groq streaming request and return a stream of OpenAI Function Calling events.
 * Consumers can handle text vs tool_call events as needed.
 */
export async function streamGroqFunctionCallEvents(
  messages: GroqMessage[],
  env: Env,
  tools?: any[]
): Promise<ReadableStream<OpenAIEvent>> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Missing GROQ_API_KEY secret');

  const payload: GroqPayload & { tools?: any[] } = {
    model: GROQ_MODEL_ID,
    messages,
    stream: true,
    temperature: MODEL_PARAMS.temperature,
    max_tokens: MODEL_PARAMS.max_tokens,
    top_p: MODEL_PARAMS.top_p,
    stream_options: MODEL_PARAMS.stream_options,
  };

  // Add tools if provided
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

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
    .pipeThrough(createOpenAIFunctionCallingTransform());
}

// Backwards compatibility alias
export const streamGroqHarmonyEvents = streamGroqFunctionCallEvents;

// Expose internal helpers for unit tests only
export const __test = { createOpenAIFunctionCallingTransform };

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
