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

  /** Optional token usage for analytics */
  tokens?: number;
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

  /** Preferred shop domain for analytics */
  shop_domain?: string;

  /** Extracted or stored customer preferences */
  preferences?: unknown;
  
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
  private messages: MessageRecord[] = [];
  private metadata: SessionMetadata;
  private db?: D1Database;
  private readonly sessionId: string;
  private readonly INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
  
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
    this.db = (env as { DB?: D1Database }).DB;
    this.sessionId = this.state.id.toString();
    
    // Initialize metadata
    this.metadata = {
      created_at: Date.now(),
      last_activity: Date.now()
    };
    
    // Load state from storage
    this.state.blockConcurrencyWhile(async () => {
      try {
        const storedMessages = await this.state.storage.get<MessageRecord[]>('messages');
        const storedMetadata = await this.state.storage.get<SessionMetadata>('metadata');
        
        if (storedMessages && Array.isArray(storedMessages)) {
          this.messages = storedMessages;
        }
        
        if (storedMetadata) {
          this.metadata = {
            ...this.metadata,
            ...storedMetadata
          };
        }
      } catch (error) {
        console.error('SessionDO: Error loading state:', error);
      }
    });
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

    if (method === 'POST') {
      await this.state.storage.setAlarm(Date.now() + this.INACTIVITY_TIMEOUT_MS);
    }
    
    try {
      // GET /messages - List all messages
      if (method === 'GET' && path.endsWith('/messages')) {
        const limit = url.searchParams.get('limit');
        const messages = limit 
          ? this.messages.slice(-parseInt(limit, 10))
          : this.messages;
        
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
        
        return new Response(
          JSON.stringify({ success: true, count: this.messages.length }),
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
        const count = this.countMessages();
        
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
      // Add timestamp if not provided
      const messageWithTimestamp: MessageRecord = {
        ...message,
        timestamp: message.timestamp || Date.now()
      };
      
      // Add to messages array
      this.messages.push(messageWithTimestamp);
      
      // Update metadata
      this.metadata.last_activity = Date.now();

      this.state.waitUntil(
        this.logMessageToD1(
          this.sessionId,
          messageWithTimestamp.role,
          messageWithTimestamp.content,
          messageWithTimestamp.tokens,
          messageWithTimestamp.timestamp
        )
      );
      
      // Check if we need to archive
      if (this.messages.length > this.ARCHIVE_THRESHOLD) {
        await this.archiveOldest();
      }
      
      // Persist to storage
      await this.state.storage.put('messages', this.messages);
      await this.state.storage.put('metadata', this.metadata);
      
    } catch (error) {
      console.error('SessionDO: Error saving message:', error);
      throw error;
    }
  }

  /**
   * Log a message asynchronously to D1 without blocking responses.
   */
  private async logMessageToD1(
    sessionId: string,
    role: MessageRecord['role'],
    content: string,
    tokens?: number,
    timestamp?: number
  ): Promise<void> {
    if (!this.db) {
      return;
    }

    const now = Date.now();
    const messageTimestamp = timestamp ?? now;

    try {
      const customerId = this.metadata.customer_id ?? null;
      const shopDomain = this.metadata.shop_domain ?? null;
      const preferences = this.metadata.preferences ? JSON.stringify(this.metadata.preferences) : null;

      await this.db
        .prepare(
          `INSERT OR IGNORE INTO sessions (id, customer_id, shop_domain, status, summary, preferences, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'open', NULL, ?4, ?5, ?5)`
        )
        .bind(sessionId, customerId, shopDomain, preferences, now)
        .run();

      await this.db
        .prepare(
          `INSERT INTO chat_messages (session_id, role, content, tokens, timestamp)
           VALUES (?1, ?2, ?3, ?4, ?5)`
        )
        .bind(sessionId, role, content, tokens ?? null, messageTimestamp)
        .run();

      await this.db
        .prepare(
          `UPDATE sessions SET updated_at = ?1, status = 'open' WHERE id = ?2`
        )
        .bind(messageTimestamp, sessionId)
        .run();
    } catch (error) {
      console.error('SessionDO: logMessageToD1 failed:', error);
    }
  }
  
  /**
   * Get all messages (or limited count)
   */
  listMessages(limit?: number): MessageRecord[] {
    if (limit && limit > 0) {
      return this.messages.slice(-limit);
    }
    return [...this.messages];
  }
  
  /**
   * Get message count
   */
  countMessages(): number {
    return this.messages.length;
  }
  
  /**
   * Clear all messages
   */
  async clearMessages(): Promise<void> {
    try {
      this.messages = [];
      await this.state.storage.put('messages', this.messages);
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
   * Archive oldest messages to external storage
   * 
   * TODO: Implement actual archival to D1 database or external storage
   * Current implementation: removes oldest messages to stay under MAX_MESSAGES
   * 
   * Future implementation:
   * 1. Send oldest 50 messages to D1 database
   * 2. Send to analytics/archiver worker
   * 3. Keep only recent messages in DO memory
   */
  async archiveOldest(): Promise<number> {
    try {
      if (this.messages.length <= this.MAX_MESSAGES) {
        return 0; // Nothing to archive
      }
      
      const excessCount = this.messages.length - this.MAX_MESSAGES;
      const toArchive = this.messages.slice(0, excessCount);
      
      // TODO: Implement actual archival
      // Example:
      // await env.DB.prepare(
      //   'INSERT INTO archived_messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)'
      // ).bind(sessionId, msg.role, msg.content, msg.timestamp).run();
      
      console.log(`SessionDO: Archiving ${toArchive.length} messages (placeholder)`);
      
      // Remove archived messages from memory
      this.messages = this.messages.slice(excessCount);
      
      // Persist updated messages
      await this.state.storage.put('messages', this.messages);
      
      return toArchive.length;
      
    } catch (error) {
      console.error('SessionDO: Error archiving messages:', error);
      return 0;
    }
  }

  /**
   * Alarm handler triggered after inactivity window.
   * Generates summary placeholder, closes session, and upserts customer profile.
   */
  async alarm(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      const storedMessages = await this.state.storage.get<MessageRecord[]>('messages');
      const storedMetadata = await this.state.storage.get<SessionMetadata>('metadata');

      if (storedMessages && Array.isArray(storedMessages)) {
        this.messages = storedMessages;
      }

      if (storedMetadata) {
        this.metadata = {
          ...this.metadata,
          ...storedMetadata
        };
      }

      const summary = 'Session summary placeholder';
      const preferences = this.metadata.preferences ? JSON.stringify(this.metadata.preferences) : null;
      const now = Date.now();

      await this.db
        .prepare(
          `INSERT OR IGNORE INTO sessions (id, customer_id, shop_domain, status, summary, preferences, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'open', NULL, ?4, ?5, ?5)`
        )
        .bind(
          this.sessionId,
          this.metadata.customer_id ?? null,
          this.metadata.shop_domain ?? null,
          preferences,
          now
        )
        .run();

      await this.db
        .prepare(
          `UPDATE sessions
             SET status = 'closed', summary = ?1, preferences = ?2, updated_at = ?3
           WHERE id = ?4`
        )
        .bind(summary, preferences, now, this.sessionId)
        .run();

      if (this.metadata.customer_id) {
        await this.db
          .prepare(
            `INSERT INTO customer_profiles (customer_id, shop_domain, global_preferences, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(customer_id) DO UPDATE SET
               shop_domain = excluded.shop_domain,
               global_preferences = excluded.global_preferences,
               updated_at = excluded.updated_at`
          )
          .bind(
            this.metadata.customer_id,
            this.metadata.shop_domain ?? null,
            preferences,
            now,
            now
          )
          .run();
      }
    } catch (error) {
      console.error('SessionDO: alarm handler failed:', error);
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
}
