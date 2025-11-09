-- ============================================================================
-- Customer Events Tracking Table
-- ============================================================================
-- Purpose: Track individual customer events for detailed journey analysis
-- Used by: analytics-worker to store all customer interactions
-- Migration: Run with `wrangler d1 execute epir_art_jewellery --local --file=./schema-events.sql`
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_events (
    -- Event ID
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Identifiers
    customer_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    
    -- Event details
    event_type TEXT NOT NULL,                     -- e.g., 'page_view', 'product_view', 'add_to_cart', 'checkout_started'
    event_timestamp INTEGER NOT NULL,             -- Unix timestamp (milliseconds)
    
    -- Event data (JSON)
    event_data TEXT,                              -- JSON with event-specific data (product_id, page_url, etc.)
    
    -- Page context
    page_url TEXT,
    page_title TEXT,
    referrer TEXT,
    
    -- Product context (if applicable)
    product_id TEXT,
    product_title TEXT,
    product_price REAL,
    variant_id TEXT,
    
    -- Cart context (if applicable)
    cart_token TEXT,
    cart_total REAL,
    
    -- Device/Browser info
    user_agent TEXT,
    ip_address TEXT,
    
    -- Timestamps
    created_at INTEGER NOT NULL,                  -- Unix timestamp (milliseconds)
    
    -- Foreign key to sessions table
    FOREIGN KEY (customer_id, session_id) REFERENCES customer_sessions(customer_id, session_id)
);

-- ============================================================================
-- Indexes for performance
-- ============================================================================

-- Index for querying by customer_id (to find all events for a customer)
CREATE INDEX IF NOT EXISTS idx_customer_events_customer_id 
    ON customer_events(customer_id, event_timestamp DESC);

-- Index for querying by session_id (to find all events in a session)
CREATE INDEX IF NOT EXISTS idx_customer_events_session_id 
    ON customer_events(session_id, event_timestamp DESC);

-- Index for querying by event_type (to analyze specific event types)
CREATE INDEX IF NOT EXISTS idx_customer_events_event_type 
    ON customer_events(event_type, event_timestamp DESC);

-- Index for product analytics
CREATE INDEX IF NOT EXISTS idx_customer_events_product_id 
    ON customer_events(product_id, event_timestamp DESC) 
    WHERE product_id IS NOT NULL;

-- Index for finding recent events
CREATE INDEX IF NOT EXISTS idx_customer_events_timestamp 
    ON customer_events(event_timestamp DESC);

-- ============================================================================
-- Common Queries
-- ============================================================================

-- 1. Get customer journey (all events for a specific customer):
-- SELECT customer_id, session_id, event_type, event_timestamp, page_url, product_title
-- FROM customer_events
-- WHERE customer_id = 'customer_123'
-- ORDER BY event_timestamp;

-- 2. Get session details (all events in a session):
-- SELECT event_type, event_timestamp, page_url, product_title, event_data
-- FROM customer_events
-- WHERE session_id = 'session_abc'
-- ORDER BY event_timestamp;

-- 3. Get events grouped by customer:
-- SELECT customer_id, COUNT(*) as total_events, 
--        GROUP_CONCAT(event_type || ' (' || event_timestamp || ')') as journey
-- FROM customer_events
-- GROUP BY customer_id
-- ORDER BY total_events DESC;

-- 4. Get product view funnel:
-- SELECT 
--     product_id,
--     product_title,
--     SUM(CASE WHEN event_type = 'product_view' THEN 1 ELSE 0 END) as views,
--     SUM(CASE WHEN event_type = 'add_to_cart' THEN 1 ELSE 0 END) as adds_to_cart,
--     SUM(CASE WHEN event_type = 'checkout_started' THEN 1 ELSE 0 END) as checkouts
-- FROM customer_events
-- WHERE product_id IS NOT NULL
-- GROUP BY product_id, product_title
-- ORDER BY views DESC;

-- ============================================================================
-- Migration Notes
-- ============================================================================
-- 1. Run locally first for testing:
--    wrangler d1 execute epir_art_jewellery --local --file=./schema-events.sql
--
-- 2. Run in production after testing:
--    wrangler d1 execute epir_art_jewellery --remote --file=./schema-events.sql
--
-- 3. Verify table was created:
--    wrangler d1 execute epir_art_jewellery --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name='customer_events';"
-- ============================================================================
