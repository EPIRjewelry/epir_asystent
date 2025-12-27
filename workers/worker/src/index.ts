/// <reference types="@cloudflare/workers-types" />

/**
 * GŁÓWNY PLIK WORKERA (epir-art-jewellery-worker)
 *
 * WERSJA zoptymalizowana pod Llama 3.3 (Groq) z natywnymi tool_calls
 * - pełny streaming
 * - pętla wywołań narzędzi oparta na OpenAI tool_calls (bez Harmony <|call|>)
 */

// Importy bezpieczeństwa i DO
import { verifyAppProxyHmac, replayCheck } from './security';
import { RateLimiterDO } from './rate-limiter';
import { TokenVaultDO, TokenVault } from './token-vault';

// Importy AI i Narzędzi (BEZPOŚREDNIO z ai-client.ts)
import {
  streamGroqHarmonyEvents,
  HarmonyEvent,
  getGroqResponse,
  GroqMessage,
} from './ai-client';
import { GROQ_MODEL_ID } from './config/model-params';
import { LUXURY_SYSTEM_PROMPT } from './prompts/luxury-system-prompt';
import { generateMcpToolSchema } from './mcp/tool_schema';
import { callMcpToolDirect, handleMcpRequest } from './mcp_server';

// Importy RAG (teraz używane tylko przez narzędzia, a nie przez index.ts)
import {
  searchShopPoliciesAndFaqs,
  searchShopPoliciesAndFaqsWithMCP,
  searchProductCatalogWithMCP,
  formatRagContextForPrompt,
  type VectorizeIndex,
} from './rag-client-wrapper';

// Importy Klienta Shopify (używane przez mcp_server, ale nie tutaj)
import { getCart, getMostRecentOrderStatus } from './shopify-mcp-client';

// Typy sesji i żądań
type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

type StoredToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: any };
};

type HistoryEntry = {
  role: ChatRole;
  content: string | null;
  ts: number;
  tool_calls?: StoredToolCall[];
  tool_call_id?: string;
  name?: string;
};

interface ChatRequestBody {
  message: string;
  session_id?: string;
  cart_id?: string;
  stream?: boolean;
}

export interface Env {
  DB: D1Database;
  SESSIONS_KV: KVNamespace;
  SESSION_DO: DurableObjectNamespace;
  RATE_LIMITER_DO: DurableObjectNamespace;
  TOKEN_VAULT_DO: DurableObjectNamespace;
  VECTOR_INDEX?: VectorizeIndex;
  SHOPIFY_APP_SECRET: string;
  ALLOWED_ORIGIN?: string;
  ALLOWED_ORIGINS?: string; // Comma-separated whitelist for CORS
  SHOPIFY_STOREFRONT_TOKEN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
  SHOP_DOMAIN?: string;
  GROQ_API_KEY: string;
  DEV_BYPASS?: string;
  WORKER_ORIGIN?: string;
  // AI_WORKER removed - using direct ai-client.ts only
  RAG_WORKER?: Fetcher;
}

// Stałe konfiguracyjne
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const MAX_HISTORY_FOR_AI = 20; // Ogranicz liczbę wiadomości wysyłanych do AI
const MAX_HISTORY_IN_DO = 200; // Ogranicz przechowywanie w DO

// --- Funkcje pomocnicze i parsery ---
function now(): number {
  return Date.now();
}
function isChatRole(value: unknown): value is ChatRole {
  return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool';
}
function parseChatRequestBody(input: unknown): ChatRequestBody | null {
  if (typeof input !== 'object' || input === null) return null;
  const maybe = input as Record<string, unknown>;
  if (typeof maybe.message !== 'string' || maybe.message.trim().length === 0) return null;
  const sessionId = typeof maybe.session_id === 'string' && maybe.session_id.length > 0 ? maybe.session_id : undefined;
  const cartId = typeof maybe.cart_id === 'string' && maybe.cart_id.length > 0 ? maybe.cart_id : undefined;
  const stream = typeof maybe.stream === 'boolean' ? maybe.stream : true; // Domyślnie włączamy stream
  return {
    message: String(maybe.message),
    session_id: sessionId,
    cart_id: cartId,
    stream,
  };
}
function ensureHistoryArray(input: unknown): HistoryEntry[] {
  if (typeof input === 'string' && input.trim().startsWith('[')) {
    try {
      input = JSON.parse(input);
    } catch (e) {
      console.warn('Failed to parse history string:', e);
      return [];
    }
  }
  if (!Array.isArray(input)) return [];
  const out: HistoryEntry[] = [];
  for (const candidate of input) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const raw = candidate as Record<string, unknown>;
    if (!isChatRole(raw.role)) continue;
    const ts = typeof raw.ts === 'number' ? raw.ts : now();
    const content = raw.content === null ? null : (typeof raw.content === 'string' ? raw.content : '');
    const entry: HistoryEntry = {
      role: raw.role,
      content,
      ts,
    };
    if (Array.isArray(raw.tool_calls)) entry.tool_calls = raw.tool_calls as StoredToolCall[];
    if (typeof raw.tool_call_id === 'string') entry.tool_call_id = raw.tool_call_id;
    if (typeof raw.name === 'string') entry.name = raw.name;
    out.push(entry);
  }
  return out.slice(-MAX_HISTORY_IN_DO);
}
function cors(env: Env, request?: Request): Record<string, string> {
  const requestOrigin = request?.headers.get('Origin');

  const allowedOrigins = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  let allowOrigin = '*';

  if (requestOrigin && allowedOrigins.length > 0) {
    if (allowedOrigins.includes(requestOrigin)) {
      allowOrigin = requestOrigin;
    } else if (requestOrigin === 'null' && allowedOrigins.includes('null')) {
      allowOrigin = 'null';
    } else {
      console.warn(`[worker] ⚠️ Rejected Origin (not whitelisted): ${requestOrigin}`);
    }
  } else if (!requestOrigin && allowedOrigins.length === 1 && allowedOrigins[0] !== '*') {
    allowOrigin = allowedOrigins[0];
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Shop-Signature',
  };
}

// ============================================================================
// DURABLE OBJECT (SessionDO)
// ============================================================================
export class SessionDO {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private history: HistoryEntry[] = [];
  private cartId: string | null = null;
  private sessionId: string | null = null;
  private lastRequestTimestamp = 0;
  private requestsInWindow = 0;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    this.state.blockConcurrencyWhile(async () => {
      const rawHistory = await this.state.storage.get<unknown>('history');
      const storedCartId = await this.state.storage.get<string>('cart_id');
      const storedSessionId = await this.state.storage.get<string>('session_id');
      this.history = ensureHistoryArray(rawHistory);
      if (storedCartId) {
        this.cartId = storedCartId;
      }
      if (storedSessionId) {
        this.sessionId = storedSessionId;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.rateLimitOk()) {
      return new Response('Rate limit exceeded', { status: 429 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    // GET /history
    if (method === 'GET' && pathname.endsWith('/history')) {
      return new Response(JSON.stringify(this.history), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /append
    if (method === 'POST' && pathname.endsWith('/append')) {
      const payload = (await request.json().catch(() => null)) as HistoryEntry | null;
      if (!payload || !isChatRole(payload.role) || (payload.content === undefined && !payload.tool_calls)) {
        return new Response('Bad Request', { status: 400 });
      }
      if (payload.content === undefined) payload.content = null;
      await this.append(payload);
      return new Response('ok');
    }

    // POST /set-session-id
    if (method === 'POST' && pathname.endsWith('/set-session-id')) {
        const payload = (await request.json().catch(() => null)) as { session_id?: string } | null;
         if (payload?.session_id) {
            this.sessionId = payload.session_id;
            await this.state.storage.put('session_id', payload.session_id);
            return new Response('session_id set');
         }
         return new Response('Bad Request', { status: 400 });
    }

    // POST /set-customer - attach/update recognized customer info for this session
    if (method === 'POST' && pathname.endsWith('/set-customer')) {
      const payload = (await request.json().catch(() => null)) as { customer_id?: string; first_name?: string; last_name?: string } | null;
      if (!payload || !payload.customer_id) {
        return new Response('Bad Request: customer_id required', { status: 400 });
      }
      const customer = {
        customer_id: payload.customer_id,
        first_name: payload.first_name || null,
        last_name: payload.last_name || null,
      };
      await this.state.storage.put('customer', customer);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // GET /customer - retrieve known customer info for this session
    if (method === 'GET' && pathname.endsWith('/customer')) {
      const customer = await this.state.storage.get('customer');
      return new Response(JSON.stringify({ customer: customer ?? null }), { headers: { 'Content-Type': 'application/json' } });
    }
    
    // GET /cart-id
    if (method === 'GET' && pathname.endsWith('/cart-id')) {
      return new Response(JSON.stringify({ cart_id: this.cartId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /set-cart-id
    if (method === 'POST' && pathname.endsWith('/set-cart-id')) {
      const payload = (await request.json().catch(() => null)) as { cart_id?: string } | null;
      if (!payload || typeof payload.cart_id !== 'string') {
        return new Response('Bad Request', { status: 400 });
      }
      this.cartId = payload.cart_id;
      await this.state.storage.put('cart_id', this.cartId);
      return new Response('ok');
    }

    // POST /replay-check
    if (method === 'POST' && pathname.endsWith('/replay-check')) {
      const payload = await request.json().catch(() => null);
      const p = payload as { signature?: string; timestamp?: string } | null;
      if (!p || !p.signature || !p.timestamp) {
        return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
      }
      const { signature, timestamp } = p;
      const key = `replay:${signature}`;
      const used = await this.state.storage.get<boolean>(key);
      if (used) {
        return new Response(JSON.stringify({ used: true }), { status: 200 });
      }
      await this.state.storage.put(key, true);
      return new Response(JSON.stringify({ used: false }), { status: 200 });
    }

    // POST /track-product-view (z analytics-worker)
    if (method === 'POST' && pathname.endsWith('/track-product-view')) {
      const payload = (await request.json().catch(() => null)) as { product_id?: string; product_type?: string; product_title?: string; duration?: number } | null;
      if (!payload || typeof payload.product_id !== 'string') {
        return new Response('Bad Request: product_id required', { status: 400 });
      }
      await this.trackProductView(payload.product_id, payload.product_type, payload.product_title, payload.duration || 0);
      return new Response('ok');
    }

    // POST /activate-proactive-chat (z analytics-worker)
    if (method === 'POST' && pathname.endsWith('/activate-proactive-chat')) {
        const payload = (await request.json().catch(() => null)) as { customer_id?: string; session_id?: string; reason?: string; timestamp?: number } | null;
        if (!payload || !payload.customer_id || !payload.session_id) {
            return new Response('Bad Request: customer_id and session_id required', { status: 400 });
        }
        await this.activateProactiveChat(payload.customer_id, payload.session_id, payload.reason || 'unknown', payload.timestamp || now());
        return new Response('ok');
    }

    return new Response('Not Found', { status: 404 });
  }

  private rateLimitOk(): boolean {
    const current = now();
    if (current - this.lastRequestTimestamp > RATE_LIMIT_WINDOW_MS) {
      this.requestsInWindow = 1;
      this.lastRequestTimestamp = current;
      return true;
    }
    this.requestsInWindow += 1;
    return this.requestsInWindow <= RATE_LIMIT_MAX_REQUESTS;
  }

  private async append(payload: HistoryEntry): Promise<void> {
    this.history.push({ ...payload, ts: payload.ts || now() });
    this.history = this.history.slice(-MAX_HISTORY_IN_DO);
    await this.state.storage.put('history', this.history);
  }

  private async trackProductView(
    productId: string,
    productType?: string,
    productTitle?: string,
    duration?: number
  ): Promise<void> {
    const productView = {
      product_id: productId,
      product_type: productType || null,
      product_title: productTitle || null,
      duration: duration || 0,
      timestamp: now(),
      session_id: this.sessionId,
    };
    await this.state.storage.put('last_product_view', productView);
    const productViews = (await this.state.storage.get<Array<any>>('product_views')) || [];
    productViews.push(productView);
    const trimmedViews = productViews.slice(-10);
    await this.state.storage.put('product_views', trimmedViews);
    console.log(`[SessionDO] 👁️ Product view tracked: ${productId} (${duration}s)`, productType);
  }

  private async activateProactiveChat(
    customerId: string,
    sessionId: string,
    reason: string,
    timestamp: number
  ): Promise<void> {
    const activationEvent = {
      customer_id: customerId,
      session_id: sessionId,
      reason: reason,
      timestamp: timestamp,
      activated: true,
    };
    await this.state.storage.put('proactive_chat_active', true);
    await this.state.storage.put('proactive_chat_event', activationEvent);
    const activationHistory = (await this.state.storage.get<Array<any>>('proactive_activations')) || [];
    activationHistory.push(activationEvent);
    const trimmed = activationHistory.slice(-5);
    await this.state.storage.put('proactive_activations', trimmed);
    console.log(`[SessionDO] 🚀 Proactive chat activated for ${customerId}/${sessionId}, reason: ${reason}`);
  }
}

// ============================================================================
// GŁÓWNY HANDLER CZATU (handleChat)
// ============================================================================
async function handleChat(request: Request, env: Env): Promise<Response> {
  const payload = parseChatRequestBody(await request.json().catch(() => null));
  if (!payload) {
    return new Response('Bad Request: message required', { status: 400, headers: cors(env, request) });
  }

  const url = new URL(request.url);
  const customerId = url.searchParams.get('logged_in_customer_id') || null;
  const shopId = url.searchParams.get('shop') || env.SHOP_DOMAIN;
  
  const sessionId = payload.session_id ?? crypto.randomUUID();
  const doId = env.SESSION_DO.idFromName(sessionId);
  const stub = env.SESSION_DO.get(doId);
  
  let customerToken: string | undefined;
  if (customerId && shopId) {
    try {
      console.log('[handleChat] 🔐 TokenVault: Generating token...');
      const tokenVaultId = env.TOKEN_VAULT_DO.idFromName('global');
      const tokenVaultStub = env.TOKEN_VAULT_DO.get(tokenVaultId);
      const vault = new TokenVault(tokenVaultStub);
      customerToken = await vault.getOrCreateToken(customerId, shopId);
      console.log('[handleChat] ✅ TokenVault: Token generated:', customerToken.substring(0, 16) + '...');
    } catch (error) {
      console.error('[handleChat] ❌ TokenVault error:', error);
    }
  } else {
    console.log('[handleChat] ⚠️ TokenVault: SKIPPED (customer not logged in or missing shop)');
  }

  if (customerId && stub) {
    try {
      const { getCustomerById } = await import('./shopify-mcp-client');
      const customer = await getCustomerById(env, customerId);
      if (customer && (customer.firstName || customer.lastName)) {
        await stub.fetch('https://session/set-customer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer_id: customerId, first_name: customer.firstName, last_name: customer.lastName }),
        });
        console.log('[handleChat] SessionDO: set customer for session:', customerId);
      }
    } catch (e) {
      console.warn('[handleChat] Unable to fetch/store customer profile:', e);
    }
  }

  if (!payload.session_id) {
      await stub.fetch('https://session/set-session-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
      });
  }

  await stub.fetch('https://session/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', content: payload.message, ts: now() } as HistoryEntry),
  });

  if (payload.cart_id) {
    console.log('[handleChat] Saving cart_id to session:', payload.cart_id);
    await stub.fetch('https://session/set-cart-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart_id: payload.cart_id }),
    });
  }

  const greetingCheck = payload.message.toLowerCase().trim();
  const greetingPattern = /^(cześć|czesc|hej|witaj|witam|dzień dobry|dzien dobry|dobry wieczór|dobry wieczor|hi|hello|hey)$/i;
  const isShortGreeting = greetingCheck.length < 15 && greetingPattern.test(greetingCheck);

  if (isShortGreeting) {
    const greetingReply = 'Witaj! Jestem Aura, doradca z pracowni EPIR Art Jewellery. Jak mogę Ci dzisiaj pomóc? 🌟';
    await stub.fetch('https://session/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content: greetingReply, ts: now() } as HistoryEntry),
    });

    if (!payload.stream) {
        return new Response(JSON.stringify({ reply: greetingReply, session_id: sessionId }), {
          headers: { ...cors(env), 'Content-Type': 'application/json' },
        });
    }
  }
  
  if (!payload.stream) {
      console.warn("[handleChat] Otrzymano żądanie non-stream, ale kod jest zoptymalizowany pod streaming. Uruchamiam stream mimo wszystko.");
  }

  console.log(`[handleChat] Przekierowanie do streamAssistantResponse dla sesji: ${sessionId}`);
  return streamAssistantResponse(request, sessionId, payload.message, stub, env, customerToken);
}

// ============================================================================
// HANDLER STREAMINGU (streamAssistantResponse) — natywne tool_calls
// ============================================================================
async function streamAssistantResponse(
  request: Request,
  sessionId: string,
  userMessage: string,
  stub: DurableObjectStub,
  env: Env,
  customerToken?: string
): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const encoder = new TextEncoder();

  (async () => {
    const writer = writable.getWriter();
    let history: HistoryEntry[] = [];
    let accumulatedResponse = '';

    async function sendSSE(event: string, data: object | string) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        await writer.write(encoder.encode(`event: ${event}\ndata: ${payload}\n\n`));
    }
    async function sendDelta(delta: string) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
    }

    try {
      console.log(`[streamAssistant] Inicjalizacja strumienia dla sesji: ${sessionId}`);
      await sendSSE('session', { session_id: sessionId });

      const historyResp = await stub.fetch('https://session/history');
      const historyData = await historyResp.json().catch(() => []);
      history = ensureHistoryArray(historyData);

      const cartIdResp = await stub.fetch('https://session/cart-id');
      const cartIdData = (await cartIdResp.json().catch(() => ({ cart_id: null }))) as { cart_id?: string | null };
      const cartId = cartIdData.cart_id;

      const aiHistory: GroqMessage[] = history
        .slice(-MAX_HISTORY_FOR_AI)
        .map((h) => ({
          role: h.role,
          content: h.content ?? null,
          ...(h.role === 'tool' && h.name ? { name: h.name } : {}),
          ...(h.role === 'tool' && h.tool_call_id ? { tool_call_id: h.tool_call_id } : {}),
          ...(h.role === 'assistant' && h.tool_calls ? { tool_calls: h.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function?.name,
              arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}),
            }
          })) } : {}),
        }));
        
      const messages: GroqMessage[] = [
        { role: 'system', content: LUXURY_SYSTEM_PROMPT },
        { role: 'system', content: `Oto dostępne schematy narzędzi:\n${generateMcpToolSchema()}` },
      ];

      if (cartId) {
        messages.push({ role: 'system', content: `Kontekst systemowy: Aktualny cart_id sesji to: ${cartId}` });
      }
      if (customerToken) {
        messages.push({ role: 'system', content: `Kontekst systemowy: Klient jest zalogowany. Jego anonimowy token to: ${customerToken}` });
      }

      messages.push(...aiHistory);

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`[streamAssistant] Rozpoczynam pętlę AI. Sesja: ${sessionId}`);
      console.log('[streamAssistant] 🤖 Model:', GROQ_MODEL_ID);
      console.log('[streamAssistant] 📜 System Prompt length:', LUXURY_SYSTEM_PROMPT.length, 'chars');
      console.log('[streamAssistant] 📚 History entries:', aiHistory.length);
      console.log('[streamAssistant] 📨 Total messages (do AI):', messages.length);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const groqKey = typeof env.GROQ_API_KEY === 'string' ? env.GROQ_API_KEY.trim() : '';
      if (!groqKey) {
        throw new Error('AI service temporarily unavailable (Missing GROQ_API_KEY)');
      }

      let currentMessages: GroqMessage[] = messages;
      const MAX_TOOL_CALLS = 5;
      let finalTextResponse = '';

      for (let i = 0; i < MAX_TOOL_CALLS; i++) {
        const groqStream = await streamGroqHarmonyEvents(currentMessages, env);
        const reader = groqStream.getReader();
        let toolCallEvent: HarmonyEvent | null = null;
        let iterationText = '';

        while (true) {
          const { done, value: event } = await reader.read();
          if (done) break;

          switch (event.type) {
              case 'text':
                iterationText += event.delta;
              break;

            case 'tool_call':
              console.log(`[streamAssistant] 🤖 Wykryto wywołanie narzędzia: ${event.name}`);
              toolCallEvent = event;
              break;

            case 'usage':
              console.log(`[streamAssistant] 📊 Statystyki użycia: ${JSON.stringify(event)}`);
              break;
            case 'tool_return':
              break;
          }
        }

        if (toolCallEvent && toolCallEvent.type === 'tool_call') {
          const { id, name, arguments: args } = toolCallEvent;

          const assistantToolCallEntry: HistoryEntry = {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: id || 'call_1', type: 'function', function: { name, arguments: args } }],
            ts: now(),
          };
          await stub.fetch('https://session/append', {
            method: 'POST',
            body: JSON.stringify(assistantToolCallEntry),
          });

          currentMessages.push({
            role: assistantToolCallEntry.role,
            content: null,
            tool_calls: [
              {
                id: id || 'call_1',
                type: 'function',
                function: {
                  name,
                  arguments: JSON.stringify(args ?? {}),
                },
              },
            ],
          });

          await sendSSE('status', { message: `Używam narzędzia: ${name}...` });

          console.log(`[streamAssistant] 🛠️ Wykonuję narzędzie: ${name} z argumentami:`, args);
          const toolResult = await callMcpToolDirect(env, name, args);
          const toolResultString = JSON.stringify(toolResult.error ? toolResult : toolResult.result);

          console.log(`[streamAssistant] 🛠️ Wynik narzędzia ${name}: ${toolResultString.substring(0, 100)}...`);

          const toolMessage: GroqMessage = {
            role: 'tool',
            name: name,
            tool_call_id: id || 'call_1',
            content: toolResultString,
          };
          currentMessages.push(toolMessage);
          await stub.fetch('https://session/append', {
            method: 'POST',
            body: JSON.stringify({ ...toolMessage, ts: now() } as HistoryEntry),
          });

          continue; 

        } else {
          finalTextResponse = iterationText;
          if (iterationText) {
            await sendDelta(iterationText);
          }
          break;
        }
      }

      console.log('[streamAssistant] ✅ Strumień zakończony. Finalna odpowiedź (tekst):', finalTextResponse.substring(0, 100));
      await writer.write(encoder.encode('data: [DONE]\n\n'));

      if (finalTextResponse.trim()) {
        await stub.fetch('https://session/append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'assistant',
            content: finalTextResponse,
            ts: now(),
          } as HistoryEntry),
        });
      }

    } catch (err) {
      console.error('Error in streamAssistantResponse:', err);
      try {
        const errorMsg = `event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`;
        await writer.write(encoder.encode(errorMsg));
      } catch (writeErr) {
        console.error('Failed to write error to stream:', writeErr);
      }
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      ...cors(env, request),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// ============================================================================
// GŁÓWNY EXPORT WORKERA
// ============================================================================
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors(env, request) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/pixel' || url.pathname.startsWith('/pixel/')) {
      if (!env.RAG_WORKER) {
        return new Response('analytics-worker not configured', { status: 500 });
      }
      return env.RAG_WORKER.fetch(request);
    }

    if (url.pathname === '/proxy') {
      const authHeader = request.headers.get('X-Shop-Signature');
      const timestamp = request.headers.get('X-Shop-Timestamp');
      const allowedOrigin = env.ALLOWED_ORIGIN || env.ALLOWED_ORIGINS || '*';
      const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Shop-Signature, X-Shop-Timestamp',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (!authHeader || !timestamp) {
        return new Response(JSON.stringify({ error: 'Missing required headers' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const signature = authHeader;
      const validSignature = verifyAppProxyHmac(request, env.SHOPIFY_APP_SECRET);
      if (!validSignature) {
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const replayResponse = await replayCheck(request, env);
      if (replayResponse) {
        return new Response(JSON.stringify({ error: 'Replay attack detected' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const originHeader = request.headers.get('Origin');
      if (originHeader && allowedOrigin !== '*' && allowedOrigin.split(',').map(o => o.trim()).indexOf(originHeader) === -1) {
        return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const proxiedResponse = await env.RAG_WORKER.fetch(request);
      const proxiedBody = await proxiedResponse.text();
      return new Response(proxiedBody, {
        status: proxiedResponse.status,
        headers: { ...corsHeaders, 'Content-Type': proxiedResponse.headers.get('Content-Type') || 'application/json' },
      });
    }

    if (url.pathname === '/chat') {
      return handleChat(request, env);
    }

    if (url.pathname.startsWith('/mcp')) {
      return handleMcpRequest(request, env);
    }

    return new Response('Not Found', { status: 404, headers: cors(env, request) });
  },
};
