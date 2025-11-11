/// <reference types="@cloudflare/workers-types" />

/**
 * GŁÓWNY PLIK WORKERA (epir-art-jewellery-worker)
 *
 * WERSJA POPRAWIONA (Naprawia Błędy Intencji i Utraty Sesji)
 *
 * Ta wersja implementuje kluczowe poprawki:
 * 1.  **POPRAWKA UTRATY SESJI:** Natychmiast wysyła 'session_id' do klienta
 * przez dedykowany event SSE 'session', co zapewnia stanowość.
 * 2.  **POPRAWKA INTENCJI/RAG:** Usunięto agresywną logikę RAG z `handleChat`.
 * Teraz to AI decyduje, kiedy wywołać narzędzia (jak search_shop_catalog)
 * zgodnie z logiką w nowym prompcie Harmony.
 * 3.  **POPRAWKA HARMONY:** `streamAssistantResponse` poprawnie wywołuje
 * `streamGroqHarmonyEvents` (zamiast streamGroqResponse) i implementuje
 * pełną pętlę wywołań narzędzi (tool-calling loop).
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
import { LUXURY_SYSTEM_PROMPT } from './prompts/luxury-system-prompt'; // 🟢 Używa nowego promptu v2
import { generateMcpToolSchema } from './mcp/tool_schema'; // 🟢 Używa poprawionych schematów v2
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

interface HistoryEntry {
  role: ChatRole;
  content: string;
  ts: number;
  // Pola Harmony (przechowywane w DO, ale filtrowane przed wysłaniem do AI)
  tool_calls?: any;
  tool_call_id?: string;
  name?: string;
}

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

// --- Funkcje pomocnicze i parsery (bez zmian) ---
function now(): number {
  return Date.now();
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isChatRole(value: unknown): value is ChatRole {
  return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool';
}
function parseChatRequestBody(input: unknown): ChatRequestBody | null {
  if (typeof input !== 'object' || input === null) return null;
  const maybe = input as Record<string, unknown>;
  if (!isNonEmptyString(maybe.message)) return null;
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
    // Zezwalamy na 'tool' role w historii DO
    if (!isChatRole(raw.role) || !isNonEmptyString(raw.content)) continue;
    const ts = typeof raw.ts === 'number' ? raw.ts : now();
    const entry: HistoryEntry = {
      role: raw.role,
      content: String(raw.content),
      ts,
    };
    if (raw.tool_calls) entry.tool_calls = raw.tool_calls;
    if (typeof raw.tool_call_id === 'string') entry.tool_call_id = raw.tool_call_id;
    if (typeof raw.name === 'string') entry.name = raw.name;
    out.push(entry);
  }
  return out.slice(-MAX_HISTORY_IN_DO);
}
function cors(env: Env): Record<string, string> {
  const origin = env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
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
      if (!payload || !isChatRole(payload.role) || (payload.content === undefined && !payload.tool_calls)) { // Zezwól na content lub tool_calls
        return new Response('Bad Request', { status: 400 });
      }
      // Upewnij się, że content to string, nawet jeśli jest pusty (dla tool_calls)
      if (payload.content === undefined) payload.content = ""; 
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
      // Store with expiration (10 minutes) - use alarm or manual cleanup if needed
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
// ZMIENIONY: Usuwa logikę RAG, zawsze wywołuje streaming.
// ============================================================================
async function handleChat(request: Request, env: Env): Promise<Response> {
  const payload = parseChatRequestBody(await request.json().catch(() => null));
  if (!payload) {
    return new Response('Bad Request: message required', { status: 400, headers: cors(env) });
  }

  // [TOKEN VAULT] Bez zmian
  const url = new URL(request.url);
  const customerId = url.searchParams.get('logged_in_customer_id') || null;
  const shopId = url.searchParams.get('shop') || env.SHOP_DOMAIN;
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
  
  // 🔴 POPRAWKA SESJI: Używamy `payload.session_id` LUB generujemy nowy
  const sessionId = payload.session_id ?? crypto.randomUUID();
  const doId = env.SESSION_DO.idFromName(sessionId);
  const stub = env.SESSION_DO.get(doId);

  // 🔴 POPRAWKA SESJI: Jeśli sesja jest NOWA, zapisujemy jej ID w DO
  if (!payload.session_id) {
      await stub.fetch('https://session/set-session-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
      });
  }

  // Zapisz wiadomość użytkownika w DO
  await stub.fetch('https://session/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', content: payload.message, ts: now() } as HistoryEntry),
  });

  // Zapisz cart_id w DO, jeśli dostarczono
  if (payload.cart_id) {
    console.log('[handleChat] Saving cart_id to session:', payload.cart_id);
    await stub.fetch('https://session/set-cart-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart_id: payload.cart_id }),
    });
  }

  // [GREETING PREFILTER] Bez zmian - dobra optymalizacja
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

    // 🔴 POPRAWKA SESJI: Zwróć greeting, ale DOŁĄCZ session_id, aby klient mógł ją zapisać
    // (W trybie non-stream; w trybie stream jest to obsługiwane przez streamAssistantResponse)
    if (!payload.stream) {
        return new Response(JSON.stringify({ reply: greetingReply, session_id: sessionId }), {
          headers: { ...cors(env), 'Content-Type': 'application/json' },
        });
    }
    // Jeśli stream=true, przejdź do streamAssistantResponse
  }
  
  // 🔴 ZMIANA: Usunięto logikę `else` (non-streaming).
  // Zakładamy, że frontend *zawsze* obsługuje streaming (co jest prawdą wg assistant.js).
  // Zawsze wywołujemy `streamAssistantResponse`, który teraz zawiera pełną logikę Harmony.
  if (!payload.stream) {
      console.warn("[handleChat] Otrzymano żądanie non-stream, ale kod jest zoptymalizowany pod streaming. Uruchamiam stream mimo wszystko.");
  }

  console.log(`[handleChat] Przekierowanie do streamAssistantResponse dla sesji: ${sessionId}`);
  return streamAssistantResponse(sessionId, payload.message, stub, env, customerToken);
}

// ============================================================================
// HANDLER STREAMINGU (streamAssistantResponse)
// KRYTYCZNA AKTUALIZACJA: Pełna implementacja pętli wywołań narzędzi (Harmony).
// ============================================================================
async function streamAssistantResponse(
  sessionId: string,
  userMessage: string,
  stub: DurableObjectStub,
  env: Env,
  customerToken?: string
): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const encoder = new TextEncoder();

  // Uruchamiamy całą logikę asynchronicznie, aby natychmiast zwrócić stream
  (async () => {
    const writer = writable.getWriter();
    let history: HistoryEntry[] = []; // Historia dla tej tury
    let accumulatedResponse = ''; // Pełna odpowiedź tekstowa asystenta

    // Funkcja pomocnicza do wysyłania eventów SSE
    async function sendSSE(event: string, data: object | string) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        await writer.write(encoder.encode(`event: ${event}\ndata: ${payload}\n\n`));
    }
    // Funkcja pomocnicza do wysyłania fragmentów tekstu
    async function sendDelta(delta: string) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
    }

    try {
      // 🔴 KROK 1: POPRAWKA SESJI
      // Natychmiast wyślij klientowi ID sesji, aby mógł je zapisać.
      console.log(`[streamAssistant] Inicjalizacja strumienia dla sesji: ${sessionId}`);
      await sendSSE('session', { session_id: sessionId });

      // 🔴 KROK 2: POBIERZ HISTORIĘ I KONTEKST
      const historyResp = await stub.fetch('https://session/history');
      const historyData = await historyResp.json().catch(() => []);
      history = ensureHistoryArray(historyData); // Pełna historia (z rolami 'tool')

      const cartIdResp = await stub.fetch('https://session/cart-id');
      const cartIdData = (await cartIdResp.json().catch(() => ({ cart_id: null }))) as { cart_id?: string | null };
      const cartId = cartIdData.cart_id;

      // 🔴 KROK 3: ZBUDUJ WIADOMOŚCI DLA AI (Z LOGIKĄ RAG WORKER)
      
      // Filtrujemy historię, aby usunąć pola, których AI nie rozumie
      const aiHistory = history
        .slice(-MAX_HISTORY_FOR_AI) // Weź tylko X ostatnich wiadomości
        .map(h => ({
            role: h.role,
            content: h.content,
            ...(h.role === 'tool' && h.name && { name: h.name }),
            ...(h.role === 'tool' && h.tool_call_id && { tool_call_id: h.tool_call_id }),
        }));
        
      const messages: GroqMessage[] = [
        { role: 'system', content: LUXURY_SYSTEM_PROMPT },
        { role: 'system', content: `Oto dostępne schematy narzędzi:\n${generateMcpToolSchema()}` },
      ];

      // Dodaj kontekst systemowy (jeśli istnieje)
      if (cartId) {
        messages.push({ role: 'system', content: `Kontekst systemowy: Aktualny cart_id sesji to: ${cartId}` });
      }
      if (customerToken) {
        messages.push({ role: 'system', content: `Kontekst systemowy: Klient jest zalogowany. Jego anonimowy token to: ${customerToken}` });
      }

      // 🔴 KROK 3b: ZDELEGUJ LOGIKĘ RAG DO RAG_WORKER
      // Zamiast błędnie wykonywać RAG tutaj, pozwalamy AI zdecydować, czy go potrzebuje.
      // Jeśli AI wywoła `search_shop_catalog` lub `search_shop_policies_and_faqs`,
      // `callMcpToolDirect` w `mcp_server.ts` poprawnie wywoła `RAG_WORKER`.
      
      // W `index.ts` (stara wersja) była błędna logika RAG. Teraz jej nie ma.
      // AI samo zdecyduje o wywołaniu narzędzi RAG (search_..._catalog/policies).

      messages.push(...aiHistory);
      // Wiadomość użytkownika (ostatnia) jest już w `aiHistory`

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`[streamAssistant] Rozpoczynam pętlę AI. Sesja: ${sessionId}`);
      console.log('[streamAssistant] 🤖 Model (HARDCODED):', GROQ_MODEL_ID);
      console.log('[streamAssistant] 📜 System Prompt length:', LUXURY_SYSTEM_PROMPT.length, 'chars');
      console.log('[streamAssistant] 📚 History entries:', aiHistory.length);
      console.log('[streamAssistant] 📨 Total messages (do AI):', messages.length);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Weryfikacja klucza Groq
      const groqKey = typeof env.GROQ_API_KEY === 'string' ? env.GROQ_API_KEY.trim() : '';
      if (!groqKey) {
        throw new Error('AI service temporarily unavailable (Missing GROQ_API_KEY)');
      }

      // 🔴 KROK 4: PĘTLA WYWOŁAŃ NARZĘDZI (HARMONY)
      let currentMessages: GroqMessage[] = messages;
      const MAX_TOOL_CALLS = 5;
      
      // 🔴 FIX: accumulatedResponse poza pętlą - nie resetuj w każdej iteracji
      let finalTextResponse = ''; 

      for (let i = 0; i < MAX_TOOL_CALLS; i++) {
        const groqStream = await streamGroqHarmonyEvents(currentMessages, env);
        const reader = groqStream.getReader();
        let toolCallEvent: HarmonyEvent | null = null;
        let iterationText = ''; // Tymczasowy buffer dla tej iteracji

        while (true) {
          const { done, value: event } = await reader.read();
          if (done) break;

          switch (event.type) {
            case 'text':
              iterationText += event.delta;
              await sendDelta(event.delta);
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
        } // koniec while(reader)

        if (toolCallEvent && toolCallEvent.type === 'tool_call') {
          // TAK - Wywołaj narzędzie
          const { name, arguments: args } = toolCallEvent;
          
          // Zapisz wywołanie narzędzia (asystenta) do DO
          const toolCallContent = `<|call|>${JSON.stringify({ name, arguments: args })}<|end|>`;
          const assistantToolCallEntry: HistoryEntry = {
            role: 'assistant',
            content: toolCallContent,
            tool_calls: [{ name, arguments: args }], // Przechowujemy dla logiki DO
            ts: now(),
          };
          await stub.fetch('https://session/append', {
            method: 'POST',
            body: JSON.stringify(assistantToolCallEntry),
          });
          currentMessages.push(assistantToolCallEntry);

          // Wyślij "myśli" do klienta
          await sendSSE('status', { message: `Używam narzędzia: ${name}...` });

          // Wykonaj narzędzie
          console.log(`[streamAssistant] 🛠️ Wykonuję narzędzie: ${name} z argumentami:`, args);
          const toolResult = await callMcpToolDirect(env, name, args);
          const toolResultString = JSON.stringify(toolResult.error ? toolResult : toolResult.result);

          console.log(`[streamAssistant] 🛠️ Wynik narzędzia ${name}: ${toolResultString.substring(0, 100)}...`);

          // Dodaj wynik narzędzia do historii i kontynuuj pętlę
          const toolMessage: GroqMessage = {
            role: 'tool',
            name: name,
            content: toolResultString,
            // tool_call_id: ... // Harmony nie polega na ID, tylko na kolejności
          };
          currentMessages.push(toolMessage);
          
          // Zapisz wynik w DO
          await stub.fetch('https://session/append', {
            method: 'POST',
            body: JSON.stringify({ ...toolMessage, ts: now() } as HistoryEntry),
          });
          
          // Kontynuuj pętlę for, aby ponownie wywołać AI
          continue; 

        } else {
          // NIE - To była finalna odpowiedź tekstowa
          // 🔴 FIX: Zachowaj tekst z tej iteracji
          finalTextResponse = iterationText;
          break; // Wyjdź z pętli for
        }
      } // koniec for(MAX_TOOL_CALLS)

      // 🔴 KROK 5: FINALIZACJA I ZAPIS
      console.log('[streamAssistant] ✅ Strumień zakończony. Finalna odpowiedź (tekst):', finalTextResponse.substring(0, 100));
      await writer.write(encoder.encode('data: [DONE]\n\n'));

      // Zapisz finalną odpowiedź asystenta do DO
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
  })(); // koniec bloku async

  // Natychmiast zwróć strumień do klienta
  return new Response(readable, {
    headers: {
      ...cors(env),
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
      return new Response(null, { headers: cors(env) });
    }

    const url = new URL(request.url);

    // Healthcheck
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/ping' || url.pathname === '/health')) {
      return new Response('ok', { status: 200, headers: cors(env) });
    }

    // [BEZPIECZEŃSTWO] Globalny strażnik HMAC dla App Proxy
    if (url.pathname.startsWith('/apps/assistant/') && request.method === 'POST') {
      if (!env.SHOPIFY_APP_SECRET) {
        return new Response('Server misconfigured', { status: 500, headers: cors(env) });
      }
      
      const result = await verifyAppProxyHmac(request.clone(), env.SHOPIFY_APP_SECRET);
      if (!result.ok) {
        console.warn('HMAC verification failed:', result.reason);
        return new Response('Unauthorized: Invalid HMAC signature', { status: 401, headers: cors(env) });
      }

      // [BEZPIECZEŃSTWO] Replay protection
      const signature = url.searchParams.get('signature') ?? request.headers.get('x-shopify-hmac-sha256') ?? '';
      const timestamp = url.searchParams.get('timestamp') ?? '';
      if (signature && timestamp) {
        const doId = env.SESSION_DO.idFromName('replay-protection-global');
        const stub = env.SESSION_DO.get(doId);
        const replayResult = await replayCheck(stub, signature, timestamp);
        if (!replayResult.ok) {
          console.warn('Replay check failed:', replayResult.reason);
          return new Response('Unauthorized: Signature already used', { status: 401, headers: cors(env) });
        }
      }
    }

    // Endpoint czatu (zabezpieczony przez App Proxy)
    if (url.pathname === '/apps/assistant/chat' && request.method === 'POST') {
      return handleChat(request, env);
    }

    // Endpoint czatu (lokalny, deweloperski - bez HMAC)
    if (url.pathname === '/chat' && request.method === 'POST') {
      return handleChat(request, env);
    }

    // Endpoint serwera MCP (JSON-RPC 2.0)
    if (request.method === 'POST' && (url.pathname === '/mcp/tools/call' || url.pathname === '/apps/assistant/mcp')) {
      return handleMcpRequest(request, env);
    }

    return new Response('Not Found', { status: 404, headers: cors(env) });
  },
};

// Eksportujemy klasy DO, aby Cloudflare mógł je rozpoznać
export { RateLimiterDO } from './rate-limiter';
export { TokenVaultDO } from './token-vault';

// Eksporty dla testów (jeśli używane)
export {
  parseChatRequestBody,
  ensureHistoryArray,
  cors,
  handleChat,
  verifyAppProxyHmac,
  handleMcpRequest,
  getGroqResponse,
};