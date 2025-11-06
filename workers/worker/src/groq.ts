// worker/src/groq.ts
// Integracja Groq API dla EPIR-ART-JEWELLERY. Obsługuje luxury-system-prompt, walidację outputu, narzędzia MCP.

import { LUXURY_SYSTEM_PROMPT } from './prompts/luxury-system-prompt';

export async function streamGroqResponse({ 
  messages, 
  tools, 
  timeoutMs = 12000 
}: {
  messages: Array<{ role: string; content: string }>, 
  tools: Record<string, any>, 
  timeoutMs?: number
}) {
  // ...implementacja streamingu odpowiedzi Groq z timeoutem i MCP tool_call
  // Użyj LUXURY_SYSTEM_PROMPT jako system promptu
  // Waliduj output: musi być czysty JSON (reply/tool_call)
  // ...
  throw new Error('Not implemented: streamGroqResponse');
}

// Pomocnicze: bezpieczne sprawdzenie obiektu rekordu
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Pomocnicze: niepusty string
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Defensywna walidacja struktury wyjścia z GROQ/LLM.
 * Akceptuje:
 * - niepusty string
 * - obiekt z { text: string } lub { content: string }
 * - obiekt narzędzia: { tool?: string, name?: string, args/arguments?: object }
 * - warianty z polem type: 'final' | 'tool_call'
 */
export function validateGroqOutput(output: unknown): boolean {
  // Przypadek 1: zwykły niepusty tekst
  if (isNonEmptyString(output)) return true;

  // Tablice nie są oczekiwane
  if (Array.isArray(output)) return false;

  // Przypadek 2: obiektowe odpowiedzi
  if (isRecord(output)) {
    // Tekst końcowy
    if (isNonEmptyString(output.text) || isNonEmptyString(output.content)) {
      return true;
    }

    // Wywołanie narzędzia (tool call)
    const tool = output.tool as unknown;
    const name = output.name as unknown;
    const args = (output as Record<string, unknown>).args ?? (output as Record<string, unknown>).arguments;
    const hasToolIdent = isNonEmptyString(tool) || isNonEmptyString(name);
    const hasArgsObject = args === undefined || isRecord(args);
    if (hasToolIdent && hasArgsObject) {
      return true;
    }

    // Warianty typowane
    const type = (output as Record<string, unknown>).type;
    if (type === 'final' && (isNonEmptyString((output as any).text) || isNonEmptyString((output as any).content))) {
      return true;
    }
    if (type === 'tool_call' && hasToolIdent && hasArgsObject) {
      return true;
    }

    return false;
  }

  // Inne typy są niepoprawne
  return false;
}

export { LUXURY_SYSTEM_PROMPT };

// --- SSE fallback / stream helper ---
type StreamFactory = () => Promise<ReadableStream<Uint8Array> | null | undefined>;

export type StreamFallbackOptions = {
  timeoutMs?: number;
  fallbackEventName?: string;
  fallbackReason?: string;
};

function makeSseChunk(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function makeSseFallbackStream(eventName = 'fallback', reason = 'fallback'): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = [
    `event: ${eventName}\n`,
    `data: ${JSON.stringify({ reason })}\n\n`,
    `data: [DONE]\n\n`,
  ].join('');
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    }
  });
}

/**
 * Attempts to get a ReadableStream from callFn within timeoutMs. Returns the
 * provided stream or a small SSE fallback stream when timed out or on error.
 */
export async function streamGroqWithFallback(callFn: StreamFactory, opts: StreamFallbackOptions = {}): Promise<ReadableStream<Uint8Array>> {
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 5000;
  const fallbackEventName = opts.fallbackEventName ?? 'fallback';
  const fallbackReason = opts.fallbackReason ?? 'fallback';

  const streamPromise = (async () => {
    try {
      const s = await callFn();
      return s ?? null;
    } catch (err) {
      try { console.debug('[groq] stream factory threw, using fallback', { err: String(err) }); } catch {}
      return null;
    }
  })();

  const winner = await Promise.race([
    streamPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ]);

  if (winner && typeof (winner as ReadableStream).getReader === 'function') {
    return winner as ReadableStream<Uint8Array>;
  }

  return makeSseFallbackStream(fallbackEventName, fallbackReason);
}
