// Przywrócona wersja z backupu (UTF-8, poprawne polskie znaki)
// Przywrócona wersja z backupu (UTF-8, poprawne polskie znaki)
// extensions/asystent-klienta/assets/chat.ts
// Lekki, poprawiony klient czatu z obsĹ‚ugÄ… streaming SSE/JSON + fallback.
// Kompiluj do JS (np. tsc) przed uĹĽyciem w Theme App Extension.

/* ===== CART INTEGRATION ===== */

/**
 * Pobiera cart_id z Shopify Cart API (localStorage lub /cart.js)
 * Zwraca cart_id w formacie gid://shopify/Cart/xyz lub null
 */
async function getShopifyCartId() {
  try {
    // Shopify cart token jest dostępny w localStorage lub przez /cart.js
    const cartRes = await fetch('/cart.js', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!cartRes.ok) {
      console.warn('Failed to fetch Shopify cart:', cartRes.status);
      return null;
    }
    
    const cartData = await cartRes.json();
    // Shopify cart response: { token: "...", items: [...], ... }
    if (cartData && cartData.token) {
      // Convert token to GID format
      return `gid://shopify/Cart/${cartData.token}`;
    }
    
    return null;
  } catch (err) {
    // W getShopifyCartId() nie mamy kontekstu wiadomości (message id) ani renderMode.
    // Zgłaszamy błąd do Analytics i zwracamy null, aby chat mógł kontynuować.
    console.error('[Assistant] getShopifyCartId error', err);
    try { 
      reportUiExtensionError(err, { stage: 'get_cart_id' }); 
    } catch (e) { 
      console.warn('reportUiExtensionError failed', e); 
    }
    return null;
  }
}

/**
 * Parsuje odpowiedź asystenta i wyodrębnia specjalne akcje
 * Zwraca obiekt z parsed text + extracted actions
 */
function parseAssistantResponse(text) {
  const actions = {
    hasCheckoutUrl: false,
    checkoutUrl: null,
    hasCartUpdate: false,
    cartItems: [],
    hasOrderStatus: false,
    orderDetails: null
  };
  
  let cleanedText = text;
  
  // Wykryj checkout URL
  const checkoutUrlMatch = text.match(/https:\/\/[^\s]+\/checkouts\/[^\s]+/);
  if (checkoutUrlMatch) {
    actions.hasCheckoutUrl = true;
    actions.checkoutUrl = checkoutUrlMatch[0];
  }
  
  // Wykryj akcje koszyka w formacie [CART_UPDATED: ...]
  const cartActionMatch = text.match(/\[CART_UPDATED:([^\]]+)\]/);
  if (cartActionMatch) {
    actions.hasCartUpdate = true;
    cleanedText = cleanedText.replace(/\[CART_UPDATED:[^\]]+\]/, '').trim();
  }
  
  // Wykryj status zamĂłwienia w formacie [ORDER_STATUS: ...]
  const orderStatusMatch = text.match(/\[ORDER_STATUS:([^\]]+)\]/);
  if (orderStatusMatch) {
    actions.hasOrderStatus = true;
    try {
      actions.orderDetails = JSON.parse(orderStatusMatch[1]);
    } catch (e) {
      console.warn('Failed to parse order details:', e);
    }

    cleanedText = cleanedText.replace(/\[ORDER_STATUS:[^\]]+\]/, '').trim();
  }
  
  return { text: cleanedText, actions };
}

/**
 * Renderuje specjalny widget checkout button jeśli wykryto URL
 */
function renderCheckoutButton(checkoutUrl, messageEl) {
  const btn = document.createElement('a');
  btn.href = checkoutUrl;
  btn.className = 'epir-checkout-button';
  btn.textContent = 'Przejdź do kasy →';
  btn.setAttribute('target', '_blank');
  btn.setAttribute('rel', 'noopener noreferrer');
  btn.style.cssText = 'display:inline-block;margin-top:10px;padding:10px 20px;background:#000;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;';
  
  messageEl.appendChild(document.createElement('br'));
  messageEl.appendChild(btn);
}

function reportUiExtensionError(error, context = {}) {
  try {
    const publish = typeof Shopify !== 'undefined' && Shopify?.analytics && typeof Shopify.analytics.publish === 'function'
      ? Shopify.analytics.publish
      : null;
    if (!publish) return;

    const safeError = error instanceof Error ? error : new Error(String(error));
    publish('ui_extension_errored', {
      source: 'assistant',
      message: safeError.message,
      stack: safeError.stack || null,
      url: typeof window !== 'undefined' ? window.location.href : null,
      timestamp: Date.now(),
      ...context,
    });
  } catch (publishErr) {
    console.warn('[EPIR Assistant] Failed to publish ui_extension_errored', publishErr);
  }
}

// Minimal initializer: bind toggle button to open/close the assistant
document.addEventListener('DOMContentLoaded', () => {
  try {
    const section = document.getElementById('epir-assistant-section');
    if (!section) return;
    const toggle = document.getElementById('assistant-toggle-button');
    const content = document.getElementById('assistant-content');
    const startClosed = section.dataset.startClosed === 'true' || section.getAttribute('data-start-closed') === 'true';
    if (startClosed && content) content.classList.add('is-closed');
    if (!toggle) return;
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      const isClosed = content && content.classList.toggle('is-closed');
      // update ARIA
      toggle.setAttribute('aria-expanded', isClosed ? 'false' : 'true');
    });

    // --- Powitanie klienta imieniem z localStorage/sessionStorage ---
    const messagesEl = document.getElementById('assistant-messages');
    let localName = null;
    try {
      localName = localStorage.getItem('epir_customer_name') || sessionStorage.getItem('epir_customer_name');
    } catch {}
    const loggedInCustomerId = section.dataset.loggedInCustomerId || '';
    if (localName && !loggedInCustomerId && messagesEl) {
      // Dodaj powitanie z imieniem tylko dla lokalnie rozpoznanego klienta
      const welcomeDiv = document.createElement('div');
      welcomeDiv.className = 'msg msg-assistant welcome-message';
      welcomeDiv.setAttribute('role', 'status');
      welcomeDiv.textContent = `Witaj ponownie, ${localName}! Miło Cię widzieć.`;
      messagesEl.insertBefore(welcomeDiv, messagesEl.firstChild);
    }

    // --- Banner informacyjny dla klientów rozpoznanych lokalnie, ale nie zalogowanych ---
    const banner = document.getElementById('local-memory-banner');
    if (banner && !loggedInCustomerId && localName) {
      banner.style.display = 'block';
    }

    // ============================================================================
    // PROACTIVE CHAT ACTIVATION - Listen for events from Web Pixel
    // ============================================================================
    // Web Pixel emits 'epir:activate-chat' when analytics-worker recommends activation
    window.addEventListener('epir:activate-chat', (event) => {
      console.log('[EPIR Assistant] 🚀 Proactive chat activation triggered:', event.detail);
      
      // Auto-open chat if closed
      if (content && content.classList.contains('is-closed')) {
        content.classList.remove('is-closed');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
        console.log('[EPIR Assistant] ✅ Chat opened proactively');
      }
      
      // Optional: Add proactive greeting message
      if (messagesEl && event.detail?.reason) {
        const proactiveMsg = document.createElement('div');
        proactiveMsg.className = 'msg msg-assistant proactive-greeting';
        proactiveMsg.setAttribute('role', 'status');
        proactiveMsg.innerHTML = `<strong>👋 Cześć!</strong> Widzę, że przeglądasz naszą kolekcję. Mogę Ci w czymś pomóc?`;
        messagesEl.appendChild(proactiveMsg);
        
        // Scroll to show new message
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  } catch (e) {
    console.warn('Assistant init error', e);
  }
});

/* Typy - usuniÄ™te dla kompatybilnoĹ›ci z przeglÄ…darkÄ… (TypeScript â†’ JavaScript) */
// type MessageElement = { id; el };
// type StreamPayload = { content?; delta?; session_id?; error?; done? };

/* Pomocnicze UI */
function createAssistantMessage(messagesEl) {
  const id = `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const div = document.createElement('div');
  div.className = 'msg msg-assistant msg-typing';
  div.id = id;
  div.setAttribute('role', 'status');
  div.textContent = '...';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return { id, el: div };
}

function updateAssistantMessage(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  const parent = el.parentElement;
  if (parent) parent.scrollTop = parent.scrollHeight;
}

function finalizeAssistantMessage(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('msg-typing');
  // accessibility: usuĹ„ aria-busy jeĹ›li ustawione, pozostaw role=status
  el.removeAttribute('aria-busy');
  el.setAttribute('role', 'status');
}

function createUserMessage(messagesEl, text) {
  const div = document.createElement('div');
  div.className = 'msg msg-user';
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* Robustny parser SSE/JSONL z obsługą delta (nowy) i content (fallback) */
async function processSSEStream(
  body,
  msgId,
  sessionIdKey,
  onUpdate
) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Procesuj peĹ‚ne eventy (oddzielone pustÄ… liniÄ…)
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        // ZĹ‚ĂłĹĽ wszystkie linie 'data:' w rawEvent
        const lines = rawEvent.split(/\r?\n/);
        const dataLines = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5));
        const dataStr = dataLines.join('\n').trim();
        if (!dataStr) continue;

        if (dataStr === '[DONE]') return;

        let parsed;
        try {
          parsed = JSON.parse(dataStr);
        } catch (e) {
          console.error('SSE JSON parse error', e, dataStr);
              reportUiExtensionError(e, { stage: 'parse_sse', stream_chunk: dataStr.slice(0, 500) });
          throw new Error('BĹ‚Ä…d komunikacji: otrzymano nieprawidĹ‚owe dane strumienia.');
        }

        if (parsed.error) throw new Error(parsed.error);

        if (parsed.session_id) {
          try { sessionStorage.setItem(sessionIdKey, parsed.session_id); } catch (e) { /* silent */ }
        }

        // Obsługa natywnych tool_calls (status)
        if (parsed.tool_call) {
          const calls = Array.isArray(parsed.tool_call) ? parsed.tool_call : [parsed.tool_call];
          const names = calls.map((c) => c.name || c.id || 'narzędzie').join(', ');
          const statusMsg = `Wywołuję narzędzie: ${names}...`;
          onUpdate(statusMsg, parsed);
          continue;
        }

        // Nowa obsługa: delta (incremental) lub content (full replacement)
        if (parsed.delta !== undefined) {
          accumulated += parsed.delta;
          onUpdate(accumulated, parsed);
        } else if (parsed.content !== undefined) {
          accumulated = parsed.content;
          onUpdate(accumulated, parsed);
        }

        if (parsed.done) return;
      }
    }

    // Po zakoĹ„czeniu odczytu: sprĂłbuj przetworzyÄ‡ pozostaĹ‚oĹ›ci w bufferze
    if (buffer.trim()) {
      const lines = buffer.split(/\r?\n/);
      const dataLines = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5));
      const dataStr = dataLines.join('\n').trim();
      if (dataStr && dataStr !== '[DONE]') {
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.session_id) try { sessionStorage.setItem(sessionIdKey, parsed.session_id); } catch {}
          if (parsed.tool_call) {
            const calls = Array.isArray(parsed.tool_call) ? parsed.tool_call : [parsed.tool_call];
            const names = calls.map((c) => c.name || c.id || 'narzędzie').join(', ');
            const statusMsg = `Wywołuję narzędzie: ${names}...`;
            onUpdate(statusMsg, parsed);
          } else if (parsed.delta !== undefined) {
            accumulated += parsed.delta;
            onUpdate(accumulated, parsed);
          } else if (parsed.content !== undefined) {
            accumulated = parsed.content;
            onUpdate(accumulated, parsed);
          }
        } catch (e) {
          console.warn('Nieparsowalny ostatni event SSE', e);
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

/* Główna funkcja wysyłki z fallbackiem JSON */
async function sendMessageToWorker(
  text,
  endpoint,
  sessionIdKey,
  messagesEl,
  setLoading,
  controller
) {
  // Small UX helpers: global loader below messages
  const globalLoader = document.getElementById('assistant-loader');
  const showGlobalLoader = () => { try { if (globalLoader) globalLoader.style.display = 'flex'; } catch {}
  };
  const hideGlobalLoader = () => { try { if (globalLoader) globalLoader.style.display = 'none'; } catch {}
  };

  // Render mode: 'growing' (default) or 'dots' (keeps '...' until finish)
  const sectionEl = document.getElementById('epir-assistant-section');
  const renderMode = (sectionEl && sectionEl.dataset && sectionEl.dataset.streamRender) || 'growing';

  setLoading(true);
  showGlobalLoader();
  createUserMessage(messagesEl, text);
  const { id: msgId, el: msgEl } = createAssistantMessage(messagesEl);
  let accumulated = '';
  let lastParsedActions = null;
  // Perf metrics
  const tStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  let firstChunkAt = null;
  let chunks = 0;

  try {
    // Pobierz cart_id z Shopify przed wysĹ‚aniem
    const cartId = await getShopifyCartId();
    console.log('[Assistant] Cart ID:', cartId);
    
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        message: text,
        session_id: (() => { try { return sessionStorage.getItem(sessionIdKey); } catch { return null; } })(),
        cart_id: cartId, // WyĹ›lij cart_id w sesji
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await (async () => { try { return await res.text(); } catch { return ''; } })();
      console.error('Server error:', res.status, errText);
      throw new Error(`Serwer zwrĂłciĹ‚ bĹ‚Ä…d (${res.status}).`);
    }

    const contentType = res.headers.get('content-type') || '';
    const hasStreamAPI = res.body && typeof (res.body).getReader === 'function';

    if (hasStreamAPI && contentType.includes('text/event-stream')) {
      // streaming SSE
      await processSSEStream(res.body, msgId, sessionIdKey, (content, parsed) => {
        accumulated = content;
        chunks += 1;
        if (!firstChunkAt) {
          firstChunkAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        }
        
        // Parsuj odpowiedĹş i wykryj akcje (checkout URL, cart updates)
        const { text: cleanedText, actions } = parseAssistantResponse(accumulated);
        if (renderMode === 'growing') {
          updateAssistantMessage(msgId, cleanedText);
        } // in 'dots' mode we keep the initial '...' until stream completes
        
        // Zapisz akcje do renderowania po zakoĹ„czeniu streamu
        if (actions.hasCheckoutUrl || actions.hasCartUpdate || actions.hasOrderStatus) {
          lastParsedActions = actions;
        }
      });
    } else if (hasStreamAPI && contentType.includes('application/ndjson')) {
      // ewentualne inne formy newline-delimited json - moĹĽna dodaÄ‡ parser
      await processSSEStream(res.body, msgId, sessionIdKey, (content, parsed) => {
        accumulated = content;
        chunks += 1;
        if (!firstChunkAt) {
          firstChunkAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        }
        const { text: cleanedText, actions } = parseAssistantResponse(accumulated);
        if (renderMode === 'growing') {
          updateAssistantMessage(msgId, cleanedText);
        }
        if (actions.hasCheckoutUrl || actions.hasCartUpdate || actions.hasOrderStatus) {
          lastParsedActions = actions;
        }
      });
    } else {
      // fallback JSON (serwer buforuje / starsze przeglÄ…darki)
      const data = await res.json().catch((e) => { throw new Error('NieprawidĹ‚owa odpowiedĹş serwera.'); });
      if (data.error) throw new Error(data.error);
      accumulated = (data.reply) || 'Otrzymano pustÄ… odpowiedĹş.';
      
      // Parsuj odpowiedĹş w trybie non-streaming
      const { text: cleanedText, actions } = parseAssistantResponse(accumulated);
      updateAssistantMessage(msgId, cleanedText);
      if (actions.hasCheckoutUrl || actions.hasCartUpdate || actions.hasOrderStatus) {
        lastParsedActions = actions;
      }
      
      if (data.session_id) {
        try { sessionStorage.setItem(sessionIdKey, data.session_id); } catch {}
      }
    }
    
    // Po zakończeniu streamu: uzupełnij treść w trybie 'dots', renderuj akcje (checkout button, cart status)
      const msgElement = document.getElementById(msgId);
      if (renderMode === 'dots') {
        let finalText = '';
        if (accumulated) {
          const { text } = parseAssistantResponse(accumulated);
          finalText = text;
        } else {
          finalText = 'Brak wyników, spróbuj innego zapytania.';
        }
        updateAssistantMessage(msgId, finalText);
      }
      if (lastParsedActions && msgElement) {
        if (lastParsedActions.hasCheckoutUrl && lastParsedActions.checkoutUrl) {
          console.log('[Assistant] Rendering checkout button:', lastParsedActions.checkoutUrl);
          renderCheckoutButton(lastParsedActions.checkoutUrl, msgElement);
        }
        if (lastParsedActions.hasCartUpdate) {
          console.log('[Assistant] Cart was updated');
          try {
            document.dispatchEvent(new CustomEvent('cart:refresh'));
          } catch (e) {
            console.warn('Failed to dispatch cart:refresh event', e);
          }
        }
        if (lastParsedActions.hasOrderStatus && lastParsedActions.orderDetails) {
          console.log('[Assistant] Order status:', lastParsedActions.orderDetails);
          // Można dodać rendering szczegółów zamówienia
        }
      }
  } catch (err) {
    console.error('Błąd czatu:', err);
    reportUiExtensionError(err, {
      stage: 'chat_execution',
      user_message_len: text.length,
      render_mode: renderMode,
    });
    const safeMsg = err instanceof Error ? err.message : 'Nieznany błąd.';
    const finalText = accumulated.length > 0 ? `${accumulated} (Błąd: ${safeMsg})` : 'Przepraszam, wystąpił błąd. Spróbuj ponownie.';
    updateAssistantMessage(msgId, finalText);
    const el = document.getElementById(msgId);
    if (el) el.classList.add('msg-error');
  } finally {
    finalizeAssistantMessage(msgId);
    setLoading(false);
    hideGlobalLoader();
    // Perf summary
    const tEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const ttfb = firstChunkAt ? Math.round(firstChunkAt - tStart) : null;
    const total = Math.round(tEnd - tStart);
    const avgChunkMs = chunks > 0 ? Math.round((tEnd - (firstChunkAt || tStart)) / Math.max(1, chunks)) : null;
    console.log('[Assistant][Perf]', {
      messageLen: text.length,
      chunks,
      timeToFirstChunkMs: ttfb,
      totalMs: total,
      avgChunkMs,
      renderMode,
    });
  }
}

// Kod ładowany bezpośrednio w przeglądarce - brak eksportów

// DODANE: fix przeładowania strony (preventDefault) i wywołanie /apps/assistant/chat
document.addEventListener('DOMContentLoaded', () => {
  try {
    const form = document.querySelector('#assistant-form');
    if (!form) {
      console.warn('assistant.js: #assistant-form not found');
      return;
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.querySelector('#assistant-input');
      const messagesEl = document.querySelector('#assistant-messages');
      const text = (input && input.value && input.value.trim()) || '';
      if (!text || !messagesEl) {
        console.warn('assistant.js: input or messages container not found');
        return;
      }
      input.value = '';
      const controller = new AbortController();
      const setLoading = (b) => {
        if (!messagesEl) return;
        if (b) messagesEl.classList.add('is-loading'); else messagesEl.classList.remove('is-loading');
      };
      try {
        // Build endpoint from section dataset so we include shop and customer_id in query params
        const sectionEl = document.getElementById('epir-assistant-section');
        let endpoint = '/apps/assistant/chat';
        if (sectionEl && sectionEl.dataset) {
          const shop = sectionEl.dataset.shopDomain || '';
          const customerId = sectionEl.dataset.loggedInCustomerId || '';
          // append as query params (worker expects logged_in_customer_id & shop in URL)
          const params = new URLSearchParams();
          if (shop) params.set('shop', shop);
          if (customerId) params.set('logged_in_customer_id', customerId);
          const paramStr = params.toString();
          if (paramStr) endpoint = `${endpoint}?${paramStr}`;
        }
        await sendMessageToWorker(text, endpoint, 'epir-assistant-session', messagesEl, setLoading, controller);
      } catch (err) {
        console.error('Fetch error:', err);
      }
    });
  } catch (e) {
    console.error('assistant.js DOMContentLoaded submit handler error:', e);
  }
});
