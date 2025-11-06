/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
}

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

async function ensurePixelTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS pixel_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .run()
    .catch(() => {});
}

async function handlePixelPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { type?: string; data?: unknown } | null;
  if (!body || typeof body.type !== 'string') {
    return json({ ok: false, error: 'Invalid payload' }, 400);
  }
  await ensurePixelTable(env.DB);
  try {
    const eventJson = JSON.stringify({ event: body.type, data: body.data, timestamp: Date.now() });
    await env.DB.prepare('INSERT INTO pixel_events (event_data) VALUES (?1)').bind(eventJson).run();
    return json({ ok: true }, 200);
  } catch (e) {
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
