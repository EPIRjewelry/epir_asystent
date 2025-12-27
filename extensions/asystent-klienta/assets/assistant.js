// Przywrócona wersja z backupu (UTF-8, poprawne polskie znaki)
// Przywrócona wersja z backupu (UTF-8, poprawne polskie znaki)
// extensions/asystent-klienta/assets/chat.ts
// Lekki, poprawiony klient czatu z obsługą streaming SSE/JSON + fallback.
// Kompiluj do JS (np. tsc) przed użyciem w Theme App Extension.

/* ===== CART INTEGRATION ===== */

/**
 * Pobiera cart_id z Shopify Cart API (localStorage lub /cart.js)
 * Zwraca cart_id w formacie gid://shopify/Cart/xyz lub null
 */
async function getShopifyCartId() {
  try {
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
    if (cartData && cartData.token) {
      return `gid://shopify/Cart/${cartData.token}`;
    }
    
    return null;
  } catch (err) {
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
 * - usuwa Harmony-tagowane wywołania (<|call|>...<|end|>) z tekstu
 * - zachowuje wyłuskane wywołania narzędzi w actions.toolCalls
 */
function parseAssistantResponse(text) {
  const actions = {
    hasCheckoutUrl: false,
    checkoutUrl: null,
    hasCartUpdate: false,
    cartItems: [],
    hasOrderStatus: false,
    orderDetails: null,
    toolCalls: [],
  };
  let cleanedText = text || '';

  // Usuń i sparsuj ewentualne Harmony bloki (bez pokazywania surowego JSON w UI)
  const toolCallRegex = /<\|call\|>([\s\S]*?)<\|end\|>/g;
  cleanedText = cleanedText.replace(toolCallRegex, (_match, inner) => {
    try {
      const obj = JSON.parse(inner);
      if (obj && obj.name) {
        actions.toolCalls.push({ name: obj.name, arguments: obj.arguments || {} });
      }
    } catch (e) {
      console.warn('[Assistant] Failed to parse <|call|> JSON', e);
      try { reportUiExtensionError(e, { stage: 'parse_call', snippet: String(inner).slice(0, 500) }); } catch (e2) {}
    }
    return '';
  }).trim();

  // Wykryj checkout URL
  const checkoutUrlMatch = cleanedText.match(/https:\/\/[^\s]+\/checkouts\/[^\s]+/);
  if (checkoutUrlMatch) {
    actions.hasCheckoutUrl = true;
    actions.checkoutUrl = checkoutUrlMatch[0];
  }
  
  // Wykryj akcje koszyka w formacie [CART_UPDATED: ...]
  const cartActionMatch = cleanedText.match(/\[CART_UPDATED:([^\]]+)\]/);
  if (cartActionMatch) {
    actions.hasCartUpdate = true;
    cleanedText = cleanedText.replace(/\[CART_UPDATED:[^\]]+\]/, '').trim();
  }
  
  // Wykryj status zamówienia w formacie [ORDER_STATUS: ...]
  const orderStatusMatch = cleanedText.match(/\[ORDER_STATUS:([^\]]+)\]/);
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
      toggle.setAttribute('aria-expanded', isClosed ? 'false' : 'true');
    });

    const messagesEl = document.getElementById('assistant-messages');
    let localName = null;
    try {
      localName = localStorage.getItem('epir_customer_name') || sessionStorage.getItem('epir_customer_name');
    } catch {}
    const loggedInCustomerId = section.dataset.loggedInCustomerId || '';
    if (localName && !loggedInCustomerId && messagesEl) {
      const welcomeDiv = document.createElement('div');
      welcomeDiv.className = 'msg msg-assistant welcome-message';
      welcomeDiv.setAttribute('role', 'status');
      welcomeDiv.textContent = `Witaj ponownie, ${localName}! Miło Cię widzieć.`;
      messagesEl.insertBefore(welcomeDiv, messagesEl.firstChild);
    }

    const banner = document.getElementById('local-memory-banner');
    if (banner && !loggedInCustomerId && localName) {
      banner.style.display = 'block';
    }

    window.addEventListener('epir:activate-chat', (event) => {
      console.log('[EPIR Assistant] 🚀 Proactive chat activation triggered:', event.detail);
      
      if (content && content.classList.contains('is-closed')) {
        content.classList.remove('is-closed');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
        console.log('[EPIR Assistant] ✅ Chat opened proactively');
      }
      
      if (messagesEl && event.detail?.reason) {
        const proactiveMsg = document.createElement('div');
        proactiveMsg.className = 'msg msg-assistant proactive-greeting';
        proactiveMsg.setAttribute('role', 'status');
        proactiveMsg.innerHTML = `<strong>👋 Cześć!</strong> Widzę, że przeglądasz naszą kolekcję. Mogę Ci w czymś pomóc?`;
        messagesEl.appendChild(proactiveMsg);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  } catch (e) {
    console.warn('Assistant init error', e);
  }
});

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

      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

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
          throw new Error('Błąd komunikacji: otrzymano nieprawidłowe dane strumienia.');
        }

        if (parsed.error) throw new Error(parsed.error);

        if (parsed.session_id) {
          try { sessionStorage.setItem(sessionIdKey, parsed.session_id); } catch (e) { /* silent */ }
        }

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

    if (buffer.trim()) {
      const lines = buffer.split(/\r?\n/);
      const dataLines = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5));
      const dataStr = dataLines.join('\n').trim();
      if (dataStr && dataStr !== '[DONE]') {
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.session_id) try { sessionStorage.setItem(sessionIdKey, parsed.session_id); } catch {}
          if (parsed.delta !== undefined) {
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

async function sendMessageToWorker(
  text,
  endpoint,
  sessionIdKey,
  messagesEl,
  setLoading,
  controller
) {
  const globalLoader = document.getElementById('assistant-loader');
  const showGlobalLoader = () => { try { if (globalLoader) globalLoader.style.display = 'flex'; } catch {}
  };
  const hideGlobalLoader = () => { try { if (globalLoader) globalLoader.style.display = 'none'; } catch {}
  };

  const sectionEl = document.getElementById('epir-assistant-section');
  const renderMode = (sectionEl && sectionEl.dataset && sectionEl.dataset.streamRender) || 'growing';

  setLoading(true);
  showGlobalLoader();
  createUserMessage(messagesEl, text);
  const { id: msgId } = createAssistantMessage(messagesEl);
  let accumulated = '';
  let lastParsedActions = null;
  const tStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  let firstChunkAt = null;
  let chunks = 0;

  try {
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
        cart_id: cartId,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await (async () => { try { return await res.text(); } catch { return ''; } })();
      console.error('Server error:', res.status, errText);
      throw new Error(`Serwer zwrócił błąd (${res.status}).`);
    }

    const contentType = res.headers.get('content-type') || '';
    const hasStreamAPI = res.body && typeof (res.body).getReader === 'function';

    if (hasStreamAPI && contentType.includes('text/event-stream')) {
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
        
        if (actions.hasCheckoutUrl || actions.hasCartUpdate || actions.hasOrderStatus || actions.toolCalls.length) {
          lastParsedActions = actions;
        }
      });
    } else if (hasStreamAPI && contentType.includes('application/ndjson')) {
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
        if (actions.hasCheckoutUrl || actions.hasCartUpdate || actions.hasOrderStatus || actions.toolCalls.length) {
          lastParsedActions = actions;
        }
      });
    } else {
      const data = await res.json().catch((e) => { throw new Error('Nieprawidłowa odpowiedź serwera.'); });
      if (data.error) throw new Error(data.error);
      accumulated = (data.reply) || 'Otrzymano pustą odpowiedź.';
      
      const { text: cleanedText, actions } = parseAssistantResponse(accumulated);
      updateAssistantMessage(msgId, cleanedText);
      if (actions.hasCheckoutUrl || actions.hasCartUpdate || actions.hasOrderStatus || actions.toolCalls.length) {
        lastParsedActions = actions;
      }
      
      if (data.session_id) {
        try { sessionStorage.setItem(sessionIdKey, data.session_id); } catch {}
      }
    }
    
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
        const sectionEl = document.getElementById('epir-assistant-section');
        let endpoint = '/apps/assistant/chat';
        if (sectionEl && sectionEl.dataset) {
          const shop = sectionEl.dataset.shopDomain || '';
          const customerId = sectionEl.dataset.loggedInCustomerId || '';
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
