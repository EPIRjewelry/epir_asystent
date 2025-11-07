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
}

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

async function ensurePixelTable(db: D1Database): Promise<void> {
  // Create table matching schema.sql structure (Shopify Web Pixels API)
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
        created_at INTEGER NOT NULL
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
    
    // Store full event as JSON for debugging
    const eventJson = JSON.stringify({ event: eventType, data: eventData, timestamp });
    
    // Insert with structured columns
    await env.DB.prepare(
      `INSERT INTO pixel_events (
        event_type, event_name, event_data, created_at,
        customer_id, session_id,
        product_id, product_handle, product_type, product_vendor, product_title, variant_id,
        cart_id,
        page_url, page_title, page_type
      ) VALUES (
        ?1, ?2, ?3, ?4,
        ?5, ?6,
        ?7, ?8, ?9, ?10, ?11, ?12,
        ?13,
        ?14, ?15, ?16
      )`
    )
    .bind(
      eventType, eventType, eventJson, timestamp,
      customerId, sessionId,
      productId, productHandle, productType, productVendor, productTitle, variantId,
      cartId,
      pageUrl, pageTitle, pageType
    )
    .run();
    
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
    
    return json({ ok: true }, 200);
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
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
      return new Response('ok', { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  },
};
