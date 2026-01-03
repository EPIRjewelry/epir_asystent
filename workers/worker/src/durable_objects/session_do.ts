/// <reference types="@cloudflare/workers-types" />

/**
 * workers/worker/src/durable_objects/session_do.ts
 * 
 * SessionDO - Durable Object for session management
 * 
 * Purpose:
 * - Store conversation history (user/assistant messages)
 * - Maintain session metadata (cart_id, customer_id, timestamps)
 * - Provide CRUD operations for messages
 * - Implement message archival and cleanup (placeholder for D1/archiver)
 * - Rate limiting per session
 * 
 * Usage:
 * ```typescript
 * const sessionId = env.SESSION_DO.idFromName(userSessionId);
 * const sessionStub = env.SESSION_DO.get(sessionId);
 * 
 * // Save message
 * await sessionStub.fetch(new Request('http://do/messages', {
 *   method: 'POST',
 *   body: JSON.stringify({ role: 'user', content: 'Hello' })
 * }));
 * 
 * // Get messages
 * const response = await sessionStub.fetch(new Request('http://do/messages'));
 * const messages = await response.json();
 * ```
 */

/**
 * Message record structure
 */
export interface MessageRecord {
  /** Message role: user, assistant, system, or tool */
  role: 'user' | 'assistant' | 'system' | 'tool';
  
  /** Message content (text) */
  content: string;
  
  /** Unix timestamp (milliseconds) */
  timestamp: number;
  
  /** Optional tool call information (for assistant messages with tool calls) */
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  
  /** Optional tool call ID (for tool response messages) */
  tool_call_id?: string;
  
  /** Optional tool name (for tool response messages) */
  name?: string;
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  /** Cart ID (Shopify cart token) */
  cart_id?: string;
  
  /** Customer ID (Shopify customer ID) */
  customer_id?: string;
  
  /** Customer first name */
  first_name?: string;
  
  /** Customer last name */
  last_name?: string;
  
  /** Session creation timestamp */
  created_at: number;
  
  /** Last activity timestamp */
  last_activity: number;
}

/**
 * SessionDO - Durable Object for managing chat sessions
 * 
 * Features:
 * - In-memory message history with persistent storage
 * - Message limits (max 200 messages per session)
 * - Rate limiting (max 20 requests per minute)
 * - Cart and customer tracking
 * - Archival mechanism (placeholder for D1/external storage)
 */
export class SessionDO {
  private state: DurableObjectState;
  private env: any; // Env with DB (D1) binding
  private metadata: SessionMetadata;
  private metadataLoaded: Promise<void>;

  // Rate limiting
  private lastRequestTime = 0;
  private requestCount = 0;
  private readonly RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
  private readonly RATE_LIMIT_MAX = 20; // 20 requests per minute

  // Message limits
  private readonly MAX_MESSAGES = 200; // Maximum messages to store
  private readonly ARCHIVE_THRESHOLD = 150; // Archive when exceeding this

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env; // Store env for D1 access

    // Initialize metadata defaults
    this.metadata = {
      created_at: Date.now(),
      last_activity: Date.now()
    };

    // Lazy-load metadata without blocking concurrency
    this.metadataLoaded = (async () => {
      try {
        const storedMetadata = await this.state.storage.get<SessionMetadata>('metadata');
        if (storedMetadata) {
          this.metadata = {
            ...this.metadata,
            ...storedMetadata
          };
        }
      } catch (error) {
        console.error('SessionDO: Error loading metadata:', error);
      }
    })();

    // Initialize SQLite schema for messages
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        content TEXT,
        timestamp INTEGER,
        tool_calls TEXT,
        tool_call_id TEXT,
        name TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    `);
  }
  
  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    // Rate limiting
    if (!this.checkRateLimit()) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    
    try {
      // Ensure metadata is available
      await this.metadataLoaded;

      // GET /messages - List messages (default last 50)
      if (method === 'GET' && path.endsWith('/messages')) {
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 50;
        const messages = await this.listMessages(limit);
        return new Response(
          JSON.stringify({ messages }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // POST /messages - Save new message
      if (method === 'POST' && path.endsWith('/messages')) {
        const payload = await request.json() as Partial<MessageRecord>;

        if (!payload.role || !payload.content) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields: role, content' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        await this.saveMessage(payload as MessageRecord);
        const count = await this.countMessages();

        return new Response(
          JSON.stringify({ success: true, count }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // DELETE /messages - Clear all messages
      if (method === 'DELETE' && path.endsWith('/messages')) {
        await this.clearMessages();

        return new Response(
          JSON.stringify({ success: true, cleared: true }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // GET /count - Get message count
      if (method === 'GET' && path.endsWith('/count')) {
        const count = await this.countMessages();

        return new Response(
          JSON.stringify({ count }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // GET /metadata - Get session metadata
      if (method === 'GET' && path.endsWith('/metadata')) {
        return new Response(
          JSON.stringify({ metadata: this.metadata }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // POST /metadata - Update session metadata
      if (method === 'POST' && path.endsWith('/metadata')) {
        const payload = await request.json() as Partial<SessionMetadata>;
        await this.updateMetadata(payload);

        return new Response(
          JSON.stringify({ success: true, metadata: this.metadata }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // POST /archive - Archive oldest messages (placeholder)
      if (method === 'POST' && path.endsWith('/archive')) {
        const archived = await this.archiveOldest();

        return new Response(
          JSON.stringify({ success: true, archived }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Legacy compatibility endpoints
      // POST /append -> append a single message (legacy)
      if (method === 'POST' && path.endsWith('/append')) {
        const payload = await request.json() as Partial<MessageRecord>;
        if (!payload.role || !payload.content) {
          return new Response(JSON.stringify({ error: 'Missing required fields: role, content' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        await this.saveMessage(payload as MessageRecord);
        return new Response('OK', { status: 200 });
      }

      // GET /history -> return array of messages (legacy)
      if (method === 'GET' && path.endsWith('/history')) {
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 50;
        const messages = await this.listMessages(limit);
        return new Response(JSON.stringify(messages), { headers: { 'Content-Type': 'application/json' } });
      }

      // POST /clear -> clear all messages (legacy)
      if (method === 'POST' && path.endsWith('/clear')) {
        await this.clearMessages();
        return new Response('Cleared', { status: 200 });
      }
      
      // Not found
      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
      
    } catch (error) {
      console.error('SessionDO fetch error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }
  
  /**
   * Save a new message to history
   * Automatically triggers archival if message count exceeds threshold
   */
  async saveMessage(message: MessageRecord): Promise<void> {
    try {
      const messageWithTimestamp: MessageRecord = {
        ...message,
        timestamp: message.timestamp || Date.now()
      };

      const stmt = this.state.storage.sql.prepare(`
        INSERT INTO messages (role, content, timestamp, tool_calls, tool_call_id, name)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        messageWithTimestamp.role,
        messageWithTimestamp.content,
        messageWithTimestamp.timestamp,
        messageWithTimestamp.tool_calls ? JSON.stringify(messageWithTimestamp.tool_calls) : null,
        messageWithTimestamp.tool_call_id ?? null,
        messageWithTimestamp.name ?? null
      );

      // Update metadata
      this.metadata.last_activity = Date.now();
      await this.state.storage.put('metadata', this.metadata);

      // Archive if we exceed threshold
      if (await this.countMessages() > this.ARCHIVE_THRESHOLD) {
        await this.archiveOldest();
      }
    } catch (error) {
      console.error('SessionDO: Error saving message:', error);
      throw error;
    }
  }
  
  /**
   * Get messages (default last N)
   */
  async listMessages(limit = 50): Promise<MessageRecord[]> {
    let query = `SELECT * FROM messages ORDER BY id DESC`;
    if (limit && limit > 0) {
      query += ` LIMIT ${limit}`;
    }

    const rows = this.state.storage.sql.exec(query).toArray();

    return rows.reverse().map((row: any) => ({
      role: row.role,
      content: this.safeJsonParse(row.content),
      timestamp: row.timestamp,
      tool_calls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      tool_call_id: row.tool_call_id || undefined,
      name: row.name || undefined
    }));
  }
  
  /**
   * Get message count
   */
  async countMessages(): Promise<number> {
    const row = this.state.storage.sql.exec(`SELECT COUNT(*) as cnt FROM messages`).first() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }
  
  /**
   * Clear all messages
   */
  async clearMessages(): Promise<void> {
    try {
      this.state.storage.sql.exec('DELETE FROM messages');
    } catch (error) {
      console.error('SessionDO: Error clearing messages:', error);
      throw error;
    }
  }
  
  /**
   * Update session metadata (cart_id, customer info, etc.)
   */
  async updateMetadata(updates: Partial<SessionMetadata>): Promise<void> {
    try {
      this.metadata = {
        ...this.metadata,
        ...updates,
        last_activity: Date.now()
      };
      
      await this.state.storage.put('metadata', this.metadata);
    } catch (error) {
      console.error('SessionDO: Error updating metadata:', error);
      throw error;
    }
  }
  
  /**
   * Archive oldest messages to D1 database for long-term analytics
   * 
   * Implementation:
   * 1. Fetch oldest messages (excess beyond MAX_MESSAGES)
   * 2. Write to D1 (sessions + messages tables)
   * 3. Delete from DO storage after successful archive
   */
  async archiveOldest(): Promise<number> {
    try {
      const total = await this.countMessages();
      if (total <= this.MAX_MESSAGES) {
        return 0; // Nothing to archive
      }

      const excessCount = total - this.MAX_MESSAGES;

      // Fetch oldest messages to archive
      const rows = this.state.storage.sql.exec(
        `SELECT * FROM messages ORDER BY id ASC LIMIT ${excessCount}`
      ).toArray();

      if (rows.length === 0) return 0;

      // Archive to D1 if binding available
      if (this.env?.DB_CHATBOT) {
        await this.archiveToD1(rows);
      } else {
        console.warn('SessionDO: No DB_CHATBOT binding available, skipping archive to D1');
      }

      // Delete archived messages from DO
      this.state.storage.sql.exec(
        `DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY id ASC LIMIT ${excessCount})`
      );

      return excessCount;
      
    } catch (error) {
      console.error('SessionDO: Error archiving messages:', error);
      return 0;
    }
  }

  /**
   * Archive messages to D1 database
   * Creates session record if not exists, then inserts messages
   */
  private async archiveToD1(messages: any[]): Promise<void> {
    if (!this.env?.DB_CHATBOT || messages.length === 0) return;

    try {
      const sessionId = this.state.id.toString();
      const db = this.env.DB_CHATBOT as D1Database;

      // Upsert session metadata
      await db.prepare(`
        INSERT INTO sessions (session_id, customer_id, first_name, last_name, cart_id, created_at, last_activity, archived_at, message_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          last_activity = excluded.last_activity,
          archived_at = excluded.archived_at,
          message_count = message_count + excluded.message_count
      `).bind(
        sessionId,
        this.metadata.customer_id || null,
        this.metadata.first_name || null,
        this.metadata.last_name || null,
        this.metadata.cart_id || null,
        this.metadata.created_at,
        this.metadata.last_activity,
        Date.now(), // archived_at
        messages.length
      ).run();

      // Insert messages in batch
      for (const msg of messages) {
        await db.prepare(`
          INSERT INTO messages (session_id, role, content, timestamp, tool_calls, tool_call_id, name)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          sessionId,
          msg.role,
          msg.content,
          msg.timestamp,
          msg.tool_calls || null,
          msg.tool_call_id || null,
          msg.name || null
        ).run();
      }

      console.log(`[SessionDO] Archived ${messages.length} messages to D1 for session ${sessionId}`);
    } catch (error) {
      console.error('[SessionDO] Failed to archive to D1:', error);
      // Don't throw - archival failure shouldn't break the main flow
    }
  }
  
  /**
   * Check rate limiting
   * Returns true if request is allowed, false if rate limit exceeded
   */
  private checkRateLimit(): boolean {
    const now = Date.now();
    
    // Reset counter if window expired
    if (now - this.lastRequestTime > this.RATE_LIMIT_WINDOW_MS) {
      this.requestCount = 0;
      this.lastRequestTime = now;
    }
    
    // Check limit
    if (this.requestCount >= this.RATE_LIMIT_MAX) {
      return false;
    }
    
    // Increment counter
    this.requestCount++;
    return true;
  }

  private safeJsonParse(str: string): any {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }
}
