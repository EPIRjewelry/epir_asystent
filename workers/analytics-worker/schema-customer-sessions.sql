-- ============================================================================
-- Customer Sessions Tracking Table
-- ============================================================================
-- Purpose: Track customer behavior across sessions for AI-driven proactive chat
-- Used by: analytics-worker to store AI analysis results and activation decisions
-- Migration: Run with `wrangler d1 execute epir_art_jewellery --local --file=./schema-customer-sessions.sql`
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_sessions (
    -- Identifiers
    customer_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    
    -- Tracking metrics
    event_count INTEGER DEFAULT 0,
    first_event_at INTEGER NOT NULL,              -- Unix timestamp (milliseconds)
    last_event_at INTEGER NOT NULL,               -- Unix timestamp (milliseconds)
    
    -- AI Analysis results
    ai_score REAL DEFAULT 0.0,                    -- Score from AI model (0.0 - 1.0)
    ai_analysis TEXT,                             -- JSON with AI reasoning
    should_activate_chat INTEGER DEFAULT 0,       -- Boolean: 1 = should activate
    
    -- Activation tracking
    chat_activated_at INTEGER,                    -- Unix timestamp when chat was activated
    activation_reason TEXT,                       -- Why chat was activated (for analytics)
    
    -- Timestamps
    created_at INTEGER NOT NULL,                  -- Unix timestamp (milliseconds)
    updated_at INTEGER NOT NULL,                  -- Unix timestamp (milliseconds)
    
    -- Primary key constraint
    PRIMARY KEY (customer_id, session_id)
);

-- ============================================================================
-- Indexes for performance
-- ============================================================================

-- Index for querying by customer_id (to find all sessions for a customer)
CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer_id 
    ON customer_sessions(customer_id);

-- Index for finding sessions that should activate chat but haven't yet
CREATE INDEX IF NOT EXISTS idx_customer_sessions_should_activate 
    ON customer_sessions(should_activate_chat, chat_activated_at) 
    WHERE should_activate_chat = 1 AND chat_activated_at IS NULL;

-- Index for querying by session_id (to find specific session)
CREATE INDEX IF NOT EXISTS idx_customer_sessions_session_id 
    ON customer_sessions(session_id);

-- Index for finding recently active sessions (for cleanup/analytics)
CREATE INDEX IF NOT EXISTS idx_customer_sessions_last_event 
    ON customer_sessions(last_event_at DESC);

-- ============================================================================
-- Migration Notes
-- ============================================================================
-- 1. Run locally first for testing:
--    wrangler d1 execute epir_art_jewellery --local --file=./schema-customer-sessions.sql
--
-- 2. Run in production after testing:
--    wrangler d1 execute epir_art_jewellery --remote --file=./schema-customer-sessions.sql
--
-- 3. Verify table was created:
--    wrangler d1 execute epir_art_jewellery --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name='customer_sessions';"
-- ============================================================================
