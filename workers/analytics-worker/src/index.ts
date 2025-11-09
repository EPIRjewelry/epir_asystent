/// <reference types="@cloudflare/workers-types" />

// ============================================================================
// ANALYTICS WORKER - Shopify Web Pixel Event Tracking
// ============================================================================
// Purpose: Receive and store customer behavior events from Shopify storefront
// Integration: Web Pixel → POST /pixel → D1 Database → Session DO notification
// Logs prefix: [ANALYTICS_WORKER]
// ============================================================================

interface Env {
  DB: D1Database;
  SESSION_DO: DurableObjectNamespace;
  AI_WORKER: Fetcher; // Service Binding to AI Worker for customer behavior analysis
}

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

async function ensurePixelTable(db: D1Database): Promise<void> {
  // Create table matching schema.sql structure (Shopify Web Pixels API + heatmap v3)
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS pixel_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT,
        session_id TEXT,
        event_type TEXT NOT NULL,
        event_name TEXT,
        product_id TEXT,
        product_handle TEXT,
        product_type TEXT,
        product_vendor TEXT,
        product_title TEXT,
        variant_id TEXT,
        cart_id TEXT,
        page_url TEXT,
        page_title TEXT,
        page_type TEXT,
        event_data TEXT,
        created_at INTEGER NOT NULL,
        click_x INTEGER,
        click_y INTEGER,
        viewport_w INTEGER,
        viewport_h INTEGER,
        scroll_depth_percent INTEGER,
        time_on_page_seconds INTEGER,
        element_tag TEXT,
        element_id TEXT,
        element_class TEXT,
        input_name TEXT,
        form_id TEXT,
        search_query TEXT,
        collection_id TEXT,
        collection_handle TEXT,
        checkout_token TEXT,
        order_id TEXT,
        order_value REAL,
        alert_type TEXT,
        alert_message TEXT,
        error_message TEXT,
        extension_id TEXT,
        mouse_x INTEGER,
        mouse_y INTEGER
      )`
    )
    .run()
    .catch(() => {});
  
  // Create indexes (idempotent)
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_customer ON pixel_events(customer_id, created_at)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_session ON pixel_events(session_id, created_at)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_product ON pixel_events(product_id, created_at)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_event_type ON pixel_events(event_type, created_at)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_created_at ON pixel_events(created_at)`).run().catch(() => {});
  
  // Heatmap-specific indexes (v3)
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_clicks ON pixel_events(page_url, event_type, click_x, click_y) WHERE click_x IS NOT NULL`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_scroll ON pixel_events(page_url, scroll_depth_percent) WHERE scroll_depth_percent IS NOT NULL`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_time_on_page ON pixel_events(page_url, time_on_page_seconds) WHERE time_on_page_seconds IS NOT NULL`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_search ON pixel_events(search_query, created_at) WHERE search_query IS NOT NULL`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pixel_collection ON pixel_events(collection_id, created_at) WHERE collection_id IS NOT NULL`).run().catch(() => {});
}

async function ensureCustomerSessionsTable(db: D1Database): Promise<void> {
  // Create customer_sessions table matching schema-customer-sessions.sql
  // Uses INTEGER timestamps (Unix milliseconds) for consistency
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS customer_sessions (
        customer_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_count INTEGER DEFAULT 0,
        first_event_at INTEGER NOT NULL,
        last_event_at INTEGER NOT NULL,
        ai_score REAL DEFAULT 0.0,
        ai_analysis TEXT,
        should_activate_chat INTEGER DEFAULT 0,
        chat_activated_at INTEGER,
        activation_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (customer_id, session_id)
      )`
    )
    .run()
    .catch(() => {});

  // Create indexes for customer_sessions (matching schema-customer-sessions.sql)
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer_id ON customer_sessions(customer_id)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_sessions_session_id ON customer_sessions(session_id)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_sessions_should_activate ON customer_sessions(should_activate_chat, chat_activated_at) WHERE should_activate_chat = 1 AND chat_activated_at IS NULL`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_sessions_last_event ON customer_sessions(last_event_at DESC)`).run().catch(() => {});
}

async function ensureCustomerEventsTable(db: D1Database): Promise<void> {
  // Create customer_events table matching schema-events.sql
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS customer_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_timestamp INTEGER NOT NULL,
        event_data TEXT,
        page_url TEXT,
        page_title TEXT,
        referrer TEXT,
        product_id TEXT,
        product_title TEXT,
        product_price REAL,
        variant_id TEXT,
        cart_token TEXT,
        cart_total REAL,
        user_agent TEXT,
        ip_address TEXT,
        created_at INTEGER NOT NULL
      )`
    )
    .run()
    .catch(() => {});

  // Create indexes for customer_events (matching schema-events.sql)
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_events_customer_id ON customer_events(customer_id, event_timestamp DESC)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_events_session_id ON customer_events(session_id, event_timestamp DESC)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_events_event_type ON customer_events(event_type, event_timestamp DESC)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_events_product_id ON customer_events(product_id, event_timestamp DESC) WHERE product_id IS NOT NULL`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_events_timestamp ON customer_events(event_timestamp DESC)`).run().catch(() => {});
}

async function insertCustomerEvent(
  db: D1Database,
  customerId: string,
  sessionId: string,
  eventType: string,
  timestamp: number,
  eventData: {
    pageUrl?: string | null;
    pageTitle?: string | null;
    productId?: string | null;
    productTitle?: string | null;
    productPrice?: number | null;
    variantId?: string | null;
    cartToken?: string | null;
    cartTotal?: number | null;
    eventDataJson?: string | null;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO customer_events (
          customer_id, session_id, event_type, event_timestamp,
          page_url, page_title, product_id, product_title, product_price,
          variant_id, cart_token, cart_total, event_data, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
      )
      .bind(
        customerId,
        sessionId,
        eventType,
        timestamp,
        eventData.pageUrl || null,
        eventData.pageTitle || null,
        eventData.productId || null,
        eventData.productTitle || null,
        eventData.productPrice || null,
        eventData.variantId || null,
        eventData.cartToken || null,
        eventData.cartTotal || null,
        eventData.eventDataJson || null,
        timestamp
      )
      .run();
  } catch (e) {
    console.error('[ANALYTICS_WORKER] ❌ Failed to insert customer event:', e);
  }
}// ============================================================================
// CUSTOMER BEHAVIOR TRACKING & AI SCORING
// ============================================================================

/**
 * Upsert customer session record and update tracking stats
 */
async function upsertCustomerSession(
  db: D1Database,
  customerId: string,
  sessionId: string,
  timestamp: number
): Promise<void> {
  try {
    // Try to get existing session
    const existing = await db
      .prepare('SELECT event_count FROM customer_sessions WHERE customer_id = ?1 AND session_id = ?2')
      .bind(customerId, sessionId)
      .first<{ event_count: number }>();

    if (existing) {
      // Update existing session (using new column names)
      await db
        .prepare('UPDATE customer_sessions SET last_event_at = ?1, updated_at = ?1, event_count = event_count + 1 WHERE customer_id = ?2 AND session_id = ?3')
        .bind(timestamp, customerId, sessionId)
        .run();
    } else {
      // Insert new session (using new column names with INTEGER timestamps)
      await db
        .prepare(
          'INSERT INTO customer_sessions (customer_id, session_id, first_event_at, last_event_at, created_at, updated_at, event_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)'
        )
        .bind(customerId, sessionId, timestamp, timestamp, timestamp, timestamp)
        .run();
    }
  } catch (e) {
    console.error('[ANALYTICS_WORKER] ❌ Failed to upsert customer session:', e);
  }
}/**
 * Analyze customer behavior using AI Worker and update scoring
 * Returns true if chat should be activated based on AI analysis
 */
async function analyzeCustomerBehaviorWithAI(
  env: Env,
  customerId: string,
  sessionId: string
): Promise<boolean> {
  if (!env.AI_WORKER) {
    console.warn('[ANALYTICS_WORKER] ⚠️ AI_WORKER not configured, skipping analysis');
    return false;
  }
  
  try {
    // Get recent events for this customer session
    const events = await env.DB
      .prepare(
        `SELECT event_type, product_id, product_type, product_title, page_url, created_at 
         FROM pixel_events 
         WHERE customer_id = ?1 AND session_id = ?2 
         ORDER BY created_at DESC 
         LIMIT 20`
      )
      .bind(customerId, sessionId)
      .all();
    
    if (!events?.results || events.results.length === 0) {
      return false;
    }
    
    // Build prompt for AI analysis
    const eventsSummary = events.results
      .map((e: any) => `${e.event_type}: ${e.product_title || e.page_url || 'unknown'}`)
      .join('\n');
    
    const analysisPrompt = `Analyze customer behavior and assign engagement score (0-100):

Customer Session Events:
${eventsSummary}

Task:
1. Calculate engagement score (0-100) based on:
   - Product views (high value)
   - Time spent (inferred from event frequency)
   - Cart interactions
   - Page navigation patterns
2. Determine if proactive chat should be activated (score > 70)

Respond with JSON only:
{
  "score": <number 0-100>,
  "should_activate_chat": <boolean>,
  "reason": "<brief explanation>"
}`;
    
    // Call AI Worker for analysis
    const aiResponse = await env.AI_WORKER.fetch('https://ai-worker/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a customer behavior analyst. Respond with valid JSON only.' },
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });
    
    if (!aiResponse.ok) {
      console.error('[ANALYTICS_WORKER] ❌ AI Worker returned error:', aiResponse.status);
      return false;
    }
    
    const aiResult = await aiResponse.json() as { content: string };
    const analysis = JSON.parse(aiResult.content);
    
    console.log('[ANALYTICS_WORKER] 🤖 AI Analysis:', analysis);
    
    // Update customer_sessions with AI score
    await env.DB
      .prepare(
        'UPDATE customer_sessions SET ai_score = ?1, should_activate_chat = ?2 WHERE customer_id = ?3 AND session_id = ?4'
      )
      .bind(
        analysis.score,
        analysis.should_activate_chat ? 1 : 0,
        customerId,
        sessionId
      )
      .run();
    
    return analysis.should_activate_chat === true;
  } catch (e) {
    console.error('[ANALYTICS_WORKER] ❌ AI analysis failed:', e);
    return false;
  }
}

/**
 * Check if proactive chat should be activated for this customer session
 * Returns true only if:
 * 1. AI score indicates activation (should_activate_chat = 1)
 * 2. Chat hasn't been activated yet for this session (chat_activated_at IS NULL)
 */
async function shouldActivateProactiveChat(
  db: D1Database,
  customerId: string,
  sessionId: string
): Promise<boolean> {
  try {
    const session = await db
      .prepare(
        'SELECT should_activate_chat, chat_activated_at FROM customer_sessions WHERE customer_id = ?1 AND session_id = ?2'
      )
      .bind(customerId, sessionId)
      .first<{ should_activate_chat: number; chat_activated_at: number | null }>();
    
    if (!session) {
      return false;
    }
    
    // Activate only if AI recommends AND chat hasn't been activated yet
    return session.should_activate_chat === 1 && session.chat_activated_at === null;
  } catch (e) {
    console.error('[ANALYTICS_WORKER] ❌ Failed to check activation status:', e);
    return false;
  }
}

/**
 * Mark chat as activated for this customer session
 */
async function markChatActivated(
  db: D1Database,
  customerId: string,
  sessionId: string,
  timestamp: number
): Promise<void> {
  try {
    await db
      .prepare('UPDATE customer_sessions SET chat_activated_at = ?1 WHERE customer_id = ?2 AND session_id = ?3')
      .bind(timestamp, customerId, sessionId)
      .run();
    console.log(`[ANALYTICS_WORKER] ✅ Marked chat as activated for ${customerId}/${sessionId}`);
  } catch (e) {
    console.error('[ANALYTICS_WORKER] ❌ Failed to mark chat as activated:', e);
  }
}

async function handlePixelPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { type?: string; data?: unknown } | null;
  if (!body || typeof body.type !== 'string') {
    return json({ ok: false, error: 'Invalid payload' }, 400);
  }
  await ensurePixelTable(env.DB);
  
  try {
    const eventType = body.type; // e.g., 'product_viewed', 'page_viewed', 'cart_updated'
    const eventData = body.data || {};
    const timestamp = Date.now();
    
    // Extract structured fields based on event type (Shopify Web Pixels API standard)
    let customerId: string | null = null;
    let sessionId: string | null = null;
    let productId: string | null = null;
    let productHandle: string | null = null;
    let productType: string | null = null;
    let productVendor: string | null = null;
    let productTitle: string | null = null;
    let variantId: string | null = null;
    let cartId: string | null = null;
    let pageUrl: string | null = null;
    let pageTitle: string | null = null;
    let pageType: string | null = null;
    
    // Parse event data (Shopify structure varies by event type)
    if (typeof eventData === 'object' && eventData !== null) {
      const data = eventData as Record<string, unknown>;
      
      // Product viewed event (Shopify Web Pixels API: data.productVariant.product.*)
      if (eventType === 'product_viewed' && data.productVariant && typeof data.productVariant === 'object') {
        const variant = data.productVariant as Record<string, unknown>;
        if (variant.product && typeof variant.product === 'object') {
          const product = variant.product as Record<string, unknown>;
          productId = String(product.id || '');
          productHandle = String(product.url || '').replace('/products/', ''); // Extract handle from URL
          productType = String(product.type || '');
          productVendor = String(product.vendor || '');
          productTitle = String(product.title || product.untranslatedTitle || '');
        }
        variantId = String(variant.id || '');
      }
      
      // Cart viewed event
      if (eventType === 'cart_viewed' && data.cart && typeof data.cart === 'object') {
        const cart = data.cart as Record<string, unknown>;
        cartId = String(cart.id || cart.token || '');
      }
      
      // Product added to cart
      if (eventType === 'product_added_to_cart') {
        if (data.cartLine && typeof data.cartLine === 'object') {
          const cartLine = data.cartLine as Record<string, unknown>;
          if (cartLine.merchandise && typeof cartLine.merchandise === 'object') {
            const merch = cartLine.merchandise as Record<string, unknown>;
            variantId = String(merch.id || '');
            if (merch.product && typeof merch.product === 'object') {
              const product = merch.product as Record<string, unknown>;
              productId = String(product.id || '');
              productTitle = String(product.title || '');
              productHandle = String(product.handle || '');
            }
          }
        }
        if (data.cart && typeof data.cart === 'object') {
          const cart = data.cart as Record<string, unknown>;
          cartId = String(cart.id || cart.token || '');
        }
      }
      
      // Product removed from cart
      if (eventType === 'product_removed_from_cart') {
        if (data.cartLine && typeof data.cartLine === 'object') {
          const cartLine = data.cartLine as Record<string, unknown>;
          if (cartLine.merchandise && typeof cartLine.merchandise === 'object') {
            const merch = cartLine.merchandise as Record<string, unknown>;
            variantId = String(merch.id || '');
            if (merch.product && typeof merch.product === 'object') {
              const product = merch.product as Record<string, unknown>;
              productId = String(product.id || '');
              productTitle = String(product.title || '');
            }
          }
        }
        if (data.cart && typeof data.cart === 'object') {
          const cart = data.cart as Record<string, unknown>;
          cartId = String(cart.id || cart.token || '');
        }
      }
      
      // Cart updated event (Shopify Web Pixels API: data.cart.id)
      if (eventType === 'cart_updated' && data.cart && typeof data.cart === 'object') {
        const cart = data.cart as Record<string, unknown>;
        cartId = String(cart.id || cart.token || '');
      }
      
      // Page viewed event (Shopify Web Pixels API: data.context.document.*)
      if (eventType === 'page_viewed') {
        if (data.context && typeof data.context === 'object') {
          const context = data.context as Record<string, unknown>;
          if (context.document && typeof context.document === 'object') {
            const doc = context.document as Record<string, unknown>;
            const location = doc.location as Record<string, unknown> | undefined;
            pageUrl = String(location?.href || doc.url || '');
            pageTitle = String(doc.title || '');
          }
          if (context.window && typeof context.window === 'object') {
            const win = context.window as Record<string, unknown>;
            const shopify = win.Shopify as Record<string, unknown> | undefined;
            const location = win.location as Record<string, unknown> | undefined;
            const pathname = location?.pathname as string | undefined;
            pageType = String(shopify?.designMode ? 'theme_editor' : pathname?.split('/')[1] || '');
          }
        }
      }
      
      // Customer ID (from analytics.init.data or custom tracking)
      if (data.customerId) {
        customerId = String(data.customerId);
      }
      if (data.sessionId) {
        sessionId = String(data.sessionId);
      }
    }
    
    // ============================================================================
    // HEATMAP DATA EXTRACTION (for v3 schema)
    // ============================================================================
    let clickX: number | null = null;
    let clickY: number | null = null;
    let viewportW: number | null = null;
    let viewportH: number | null = null;
    let scrollDepth: number | null = null;
    let timeOnPage: number | null = null;
    let elementTag: string | null = null;
    let elementId: string | null = null;
    let elementClass: string | null = null;
    let inputName: string | null = null;
    let formId: string | null = null;
    let searchQuery: string | null = null;
    let collectionId: string | null = null;
    let collectionHandle: string | null = null;
    let checkoutToken: string | null = null;
    let orderId: string | null = null;
    let orderValue: number | null = null;
    let alertType: string | null = null;
    let alertMessage: string | null = null;
    let errorMessage: string | null = null;
    let extensionId: string | null = null;
    let mouseX: number | null = null;
    let mouseY: number | null = null;
    
    if (typeof eventData === 'object' && eventData !== null) {
      const data = eventData as Record<string, unknown>;
      
      // Click with position (epir:click_with_position)
      if (eventType === 'click_with_position') {
        clickX = typeof data.x === 'number' ? data.x : null;
        clickY = typeof data.y === 'number' ? data.y : null;
        elementTag = typeof data.element === 'string' ? data.element : null;
        elementId = typeof data.id === 'string' ? data.id : null;
        elementClass = typeof data.className === 'string' ? data.className : null;
        if (data.viewport && typeof data.viewport === 'object') {
          const vp = data.viewport as Record<string, unknown>;
          viewportW = typeof vp.w === 'number' ? vp.w : null;
          viewportH = typeof vp.h === 'number' ? vp.h : null;
        }
      }
      
      // Scroll depth (epir:scroll_depth)
      if (eventType === 'scroll_depth') {
        scrollDepth = typeof data.depth === 'number' ? data.depth : null;
      }
      
      // Page exit / time on page (epir:page_exit)
      if (eventType === 'page_exit') {
        timeOnPage = typeof data.time_on_page_seconds === 'number' ? data.time_on_page_seconds : null;
        scrollDepth = typeof data.max_scroll_percent === 'number' ? data.max_scroll_percent : null;
      }
      
      // DOM clicked event (standard Shopify)
      if (eventType === 'clicked') {
        if (data.element && typeof data.element === 'string') {
          elementTag = data.element;
        }
        if (data.id && typeof data.id === 'string') {
          elementId = data.id;
        }
        if (data.className && typeof data.className === 'string') {
          elementClass = data.className;
        }
      }
      
      // Form and input events
      if (eventType === 'form_submitted' && data.form && typeof data.form === 'object') {
        const form = data.form as Record<string, unknown>;
        formId = typeof form.id === 'string' ? form.id : null;
      }
      if (['input_focused', 'input_blurred', 'input_changed'].includes(eventType)) {
        if (data.input && typeof data.input === 'object') {
          const input = data.input as Record<string, unknown>;
          inputName = typeof input.name === 'string' ? input.name : null;
          elementTag = typeof input.type === 'string' ? input.type : null;
        }
      }
      
      // Search submitted
      if (eventType === 'search_submitted' && data.searchQuery && typeof data.searchQuery === 'string') {
        searchQuery = data.searchQuery;
      }
      
      // Collection viewed
      if (eventType === 'collection_viewed' && data.collection && typeof data.collection === 'object') {
        const coll = data.collection as Record<string, unknown>;
        collectionId = typeof coll.id === 'string' ? coll.id : null;
        collectionHandle = typeof coll.handle === 'string' ? coll.handle : null;
      }
      
      // Checkout events (all checkout_* events including checkout_started)
      if (eventType.startsWith('checkout_') && data.checkout && typeof data.checkout === 'object') {
        const checkout = data.checkout as Record<string, unknown>;
        checkoutToken = typeof checkout.token === 'string' ? checkout.token : null;
        
        // For checkout_started, also extract cart_id if available
        if (eventType === 'checkout_started') {
          // Checkout object may contain cart reference
          if (checkout.lineItems && Array.isArray(checkout.lineItems)) {
            // Store line items count in event_data for analytics
            console.log(`[ANALYTICS_WORKER] 🛒 Checkout started with ${checkout.lineItems.length} items`);
          }
        }
      }
      
      // Purchase completed
      if (eventType === 'purchase_completed') {
        if (data.checkout && typeof data.checkout === 'object') {
          const checkout = data.checkout as Record<string, unknown>;
          checkoutToken = typeof checkout.token === 'string' ? checkout.token : null;
          if (checkout.order && typeof checkout.order === 'object') {
            const order = checkout.order as Record<string, unknown>;
            orderId = typeof order.id === 'string' ? order.id : null;
          }
          if (typeof checkout.totalPrice === 'object' && checkout.totalPrice !== null) {
            const price = checkout.totalPrice as Record<string, unknown>;
            orderValue = typeof price.amount === 'number' ? price.amount : null;
          }
        }
      }
      
      // Alert displayed
      if (eventType === 'alert_displayed') {
        alertType = typeof data.type === 'string' ? data.type : null;
        alertMessage = typeof data.message === 'string' ? data.message : null;
      }
      
      // UI extension errored
      if (eventType === 'ui_extension_errored') {
        errorMessage = typeof data.message === 'string' ? data.message : null;
        extensionId = typeof data.extensionId === 'string' ? data.extensionId : null;
      }
      
      // Mouse sample (epir:mouse_sample)
      if (eventType === 'mouse_sample') {
        mouseX = typeof data.x === 'number' ? data.x : null;
        mouseY = typeof data.y === 'number' ? data.y : null;
      }
    }
    
    // Store full event as JSON for debugging
    const eventJson = JSON.stringify({ event: eventType, data: eventData, timestamp });
    
    // Insert with structured columns (v3 schema with heatmap fields)
    await env.DB.prepare(
      `INSERT INTO pixel_events (
        event_type, event_name, event_data, created_at,
        customer_id, session_id,
        product_id, product_handle, product_type, product_vendor, product_title, variant_id,
        cart_id,
        page_url, page_title, page_type,
        click_x, click_y, viewport_w, viewport_h,
        scroll_depth_percent, time_on_page_seconds,
        element_tag, element_id, element_class,
        input_name, form_id,
        search_query, collection_id, collection_handle,
        checkout_token, order_id, order_value,
        alert_type, alert_message,
        error_message, extension_id,
        mouse_x, mouse_y
      ) VALUES (
        ?1, ?2, ?3, ?4,
        ?5, ?6,
        ?7, ?8, ?9, ?10, ?11, ?12,
        ?13,
        ?14, ?15, ?16,
        ?17, ?18, ?19, ?20,
        ?21, ?22,
        ?23, ?24, ?25,
        ?26, ?27,
        ?28, ?29, ?30,
        ?31, ?32, ?33,
        ?34, ?35,
        ?36, ?37,
        ?38, ?39
      )`
    )
    .bind(
      eventType, eventType, eventJson, timestamp,
      customerId, sessionId,
      productId, productHandle, productType, productVendor, productTitle, variantId,
      cartId,
      pageUrl, pageTitle, pageType,
      clickX, clickY, viewportW, viewportH,
      scrollDepth, timeOnPage,
      elementTag, elementId, elementClass,
      inputName, formId,
      searchQuery, collectionId, collectionHandle,
      checkoutToken, orderId, orderValue,
      alertType, alertMessage,
      errorMessage, extensionId,
      mouseX, mouseY
    )
    .run();
    
    // ============================================================================
    // CUSTOMER SESSION TRACKING & AI ANALYSIS
    // ============================================================================
    // Upsert customer session and trigger AI analysis for behavior scoring
    let activateChat = false; // Flag to return in response for Web Pixel
    if (customerId && sessionId) {
      await ensureCustomerSessionsTable(env.DB);
      await ensureCustomerEventsTable(env.DB);
      await upsertCustomerSession(env.DB, customerId, sessionId, timestamp);
      
      // Insert event to customer_events table for journey tracking
      await insertCustomerEvent(env.DB, customerId, sessionId, eventType, timestamp, {
        pageUrl,
        pageTitle,
        productId,
        productTitle,
        variantId,
        cartToken: cartId,
        eventDataJson: eventJson,
      });
      
      // Get current event count for this session
      const sessionData = await env.DB
        .prepare('SELECT event_count FROM customer_sessions WHERE customer_id = ?1 AND session_id = ?2')
        .bind(customerId, sessionId)
        .first<{ event_count: number }>();
      
      // Run AI analysis every 3 events (configurable threshold)
      const eventCount = sessionData?.event_count || 0;
      if (eventCount % 3 === 0) {
        console.log(`[ANALYTICS_WORKER] 🤖 Triggering AI analysis for customer ${customerId} (${eventCount} events)`);
        const shouldActivate = await analyzeCustomerBehaviorWithAI(env, customerId, sessionId);
        
        if (shouldActivate) {
          console.log(`[ANALYTICS_WORKER] 🚀 AI recommends activating proactive chat for ${customerId}`);
          
          // Double-check if chat should be activated (not already activated)
          const finalCheck = await shouldActivateProactiveChat(env.DB, customerId, sessionId);
          if (finalCheck) {
            activateChat = true; // Set flag for response
            
            // ============================================================================
            // PROACTIVE CHAT ACTIVATION: Analytics Worker → Session DO (Coordinator)
            // ============================================================================
            // Session DO acts as coordinator (Cloudflare Best Practice for DO communication)
            try {
              if (env.SESSION_DO) {
                const sessionDoId = env.SESSION_DO.idFromName(sessionId);
                const sessionDoStub = env.SESSION_DO.get(sessionDoId);
                
                await sessionDoStub.fetch('https://do/activate-proactive-chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    customer_id: customerId,
                    session_id: sessionId,
                    reason: 'high_engagement_score',
                    timestamp: timestamp
                  }),
                });
                
                // Mark as activated in DB to prevent duplicate activations
                await markChatActivated(env.DB, customerId, sessionId, timestamp);
                
                console.log(`[ANALYTICS_WORKER] ✅ Proactive chat activated for ${customerId}/${sessionId}`);
              } else {
                console.warn('[ANALYTICS_WORKER] ⚠️ SESSION_DO not configured, cannot activate proactive chat');
              }
            } catch (e) {
              console.error('[ANALYTICS_WORKER] ❌ Failed to activate proactive chat:', e);
            }
          }
        }
      }
    }
    
    // ============================================================================
    // INTEGRATION: Analytics Worker → Session DO (product view tracking)
    // ============================================================================
    // After storing to D1, notify Session DO about product views
    // This enables proactive chat triggers based on customer behavior
    if (eventType === 'product_viewed' && productId && sessionId && env.SESSION_DO) {
      try {
        const sessionDoId = env.SESSION_DO.idFromName(sessionId);
        const sessionDoStub = env.SESSION_DO.get(sessionDoId);
        
        await sessionDoStub.fetch('https://do/track-product-view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: productId,
            product_type: productType,
            product_title: productTitle,
            duration: 0, // TODO: Calculate from frontend tracking
          }),
        });
        
        console.log(`[ANALYTICS_WORKER] ✅ Notified Session DO: ${sessionId} viewed product ${productId}`);
      } catch (e) {
        console.error('[ANALYTICS_WORKER] ❌ Failed to notify Session DO:', e);
        // Don't fail the request if DO notification fails
      }
    }
    
    // ============================================================================
    // RESPONSE: Return activation flag to Web Pixel (Best Practice: push over pull)
    // ============================================================================
    return json({ 
      ok: true, 
      activate_chat: activateChat,
      reason: activateChat ? 'high_engagement_score' : null
    }, 200);
  } catch (e) {
    console.error('[ANALYTICS_WORKER] ❌ Insert failed:', e);
    return json({ ok: false, error: 'insert_failed' }, 500);
  }
}

async function handlePixelCount(env: Env): Promise<Response> {
  await ensurePixelTable(env.DB);
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) as cnt FROM pixel_events').first<{ cnt: number }>();
    const count = (row && typeof row.cnt === 'number') ? row.cnt : 0;
    return json({ count }, 200);
  } catch (e) {
    return json({ count: 0 }, 200);
  }
}

async function handlePixelEvents(env: Env, limitParam?: string | null): Promise<Response> {
  const parsedLimit = Number(limitParam) || 20;
  const limit = Math.max(1, Math.min(200, parsedLimit));
  await ensurePixelTable(env.DB);
  try {
    const sql = `SELECT id, event_data, created_at FROM pixel_events ORDER BY id DESC LIMIT ${limit}`;
  const rows: { results: Array<{ id: number; event_data: string; created_at: string }> } = await env.DB.prepare(sql).all();
    if (!rows?.results || !Array.isArray(rows.results)) {
      console.warn('[pixel] Invalid or missing rows.results from D1 query');
      return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  const events = rows.results.map((r) => {
      let parsed: unknown = r.event_data;
      try {
        parsed = JSON.parse(r.event_data);
      } catch (e) {
        console.warn('[pixel] Failed to parse event_data JSON:', e);
      }
      return {
        id: r.id,
        ...((typeof parsed === 'object' && parsed !== null) ? parsed : { raw: r.event_data }),
        created_at: r.created_at,
      } as Record<string, unknown>;
    });
    return json({ events }, 200);
  } catch (e) {
    console.warn('[pixel] events read failed:', e);
    return json({ events: [] }, 200);
  }
}

async function handleCustomerJourney(env: Env, url: URL): Promise<Response> {
  await ensureCustomerEventsTable(env.DB);
  
  const customerId = url.searchParams.get('customer_id');
  const sessionId = url.searchParams.get('session_id');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
  
  try {
    let query: string;
    let bindings: string[];
    
    if (sessionId) {
      // Get all events for a specific session
      query = `
        SELECT 
          customer_id, 
          session_id, 
          event_type, 
          event_timestamp,
          page_url,
          page_title,
          product_id,
          product_title,
          variant_id,
          cart_token,
          event_data
        FROM customer_events
        WHERE session_id = ?1
        ORDER BY event_timestamp ASC
        LIMIT ${limit}
      `;
      bindings = [sessionId];
    } else if (customerId) {
      // Get all events for a customer (across sessions)
      query = `
        SELECT 
          customer_id, 
          session_id, 
          event_type, 
          event_timestamp,
          page_url,
          page_title,
          product_id,
          product_title,
          variant_id,
          cart_token,
          event_data
        FROM customer_events
        WHERE customer_id = ?1
        ORDER BY event_timestamp ASC
        LIMIT ${limit}
      `;
      bindings = [customerId];
    } else {
      // Get all recent events grouped by customer
      query = `
        SELECT 
          customer_id, 
          session_id, 
          event_type, 
          event_timestamp,
          page_url,
          page_title,
          product_id,
          product_title,
          variant_id,
          cart_token,
          event_data
        FROM customer_events
        ORDER BY event_timestamp DESC
        LIMIT ${limit}
      `;
      bindings = [];
    }
    
    const stmt = env.DB.prepare(query);
    const result = bindings.length > 0 ? await stmt.bind(...bindings).all() : await stmt.all();
    
    if (!result?.results) {
      return json({ journey: [] }, 200);
    }
    
    // Group by customer and session for easier analysis
    const groupedByCustomer: Record<string, any> = {};
    
    for (const event of result.results as any[]) {
      const cid = event.customer_id;
      const sid = event.session_id;
      
      if (!groupedByCustomer[cid]) {
        groupedByCustomer[cid] = {
          customer_id: cid,
          sessions: {},
        };
      }
      
      if (!groupedByCustomer[cid].sessions[sid]) {
        groupedByCustomer[cid].sessions[sid] = {
          session_id: sid,
          events: [],
        };
      }
      
      groupedByCustomer[cid].sessions[sid].events.push({
        event_type: event.event_type,
        timestamp: event.event_timestamp,
        page_url: event.page_url,
        page_title: event.page_title,
        product_id: event.product_id,
        product_title: event.product_title,
        variant_id: event.variant_id,
        cart_token: event.cart_token,
      });
    }
    
    return json({ 
      journey: Object.values(groupedByCustomer).map(customer => ({
        customer_id: customer.customer_id,
        sessions: Object.values(customer.sessions),
      }))
    }, 200);
  } catch (e) {
    console.error('[ANALYTICS_WORKER] ❌ Failed to get customer journey:', e);
    return json({ journey: [], error: String(e) }, 500);
  }
}

async function handleCustomerSessions(env: Env, url: URL): Promise<Response> {
  await ensureCustomerSessionsTable(env.DB);
  
  const customerId = url.searchParams.get('customer_id');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
  
  try {
    let query: string;
    let bindings: string[] = [];
    
    if (customerId) {
      query = `
        SELECT 
          customer_id,
          session_id,
          event_count,
          first_event_at,
          last_event_at,
          ai_score,
          should_activate_chat,
          chat_activated_at,
          activation_reason
        FROM customer_sessions
        WHERE customer_id = ?1
        ORDER BY first_event_at DESC
        LIMIT ${limit}
      `;
      bindings = [customerId];
    } else {
      query = `
        SELECT 
          customer_id,
          session_id,
          event_count,
          first_event_at,
          last_event_at,
          ai_score,
          should_activate_chat,
          chat_activated_at,
          activation_reason
        FROM customer_sessions
        ORDER BY last_event_at DESC
        LIMIT ${limit}
      `;
    }
    
    const stmt = env.DB.prepare(query);
    const result = bindings.length > 0 ? await stmt.bind(...bindings).all() : await stmt.all();
    
    return json({ sessions: result?.results || [] }, 200);
  } catch (e) {
    console.error('[ANALYTICS_WORKER] ❌ Failed to get customer sessions:', e);
    return json({ sessions: [], error: String(e) }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/pixel') {
      return handlePixelPost(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/pixel/count') {
      return handlePixelCount(env);
    }
    if (request.method === 'GET' && url.pathname === '/pixel/events') {
      return handlePixelEvents(env, url.searchParams.get('limit'));
    }
    if (request.method === 'GET' && url.pathname === '/journey') {
      return handleCustomerJourney(env, url);
    }
    if (request.method === 'GET' && url.pathname === '/sessions') {
      return handleCustomerSessions(env, url);
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
      return new Response('ok', { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  },
};
