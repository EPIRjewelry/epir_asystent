-- ============================================================================
-- Pixel Events Base Table
-- ============================================================================
-- Purpose: Store all web pixel events from Shopify Web Pixel API
-- Used by: analytics-worker to track customer behavior and trigger AI analysis
-- Migration: Run with `wrangler d1 execute epir_art_jewellery --local --file=./schema-pixel-events-base.sql`
-- ============================================================================

CREATE TABLE IF NOT EXISTS pixel_events (
    -- Unique identifier for each event
    id TEXT PRIMARY KEY,
    
    -- Event metadata
    event_type TEXT NOT NULL,
    event_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    
    -- Customer identification
    customer_id TEXT,
    session_id TEXT,
    
    -- Context data
    page_url TEXT,
    page_title TEXT,
    referrer TEXT,
    user_agent TEXT,
    
    -- Product data (for product-related events)
    product_id TEXT,
    product_title TEXT,
    product_variant_id TEXT,
    product_price REAL,
    product_quantity INTEGER,
    
    -- Cart data (for cart events)
    cart_total REAL,
    
    -- Raw event payload (JSON)
    raw_data TEXT,
    
    -- Timestamps
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- Base Indexes
-- ============================================================================

-- Index for querying by customer
CREATE INDEX IF NOT EXISTS idx_pixel_events_customer 
    ON pixel_events(customer_id, created_at DESC);

-- Index for querying by session
CREATE INDEX IF NOT EXISTS idx_pixel_events_session 
    ON pixel_events(session_id, created_at DESC);

-- Index for querying by event type
CREATE INDEX IF NOT EXISTS idx_pixel_events_type 
    ON pixel_events(event_type, created_at DESC);

-- Index for querying by page
CREATE INDEX IF NOT EXISTS idx_pixel_events_page 
    ON pixel_events(page_url, created_at DESC);

-- Index for product analytics
CREATE INDEX IF NOT EXISTS idx_pixel_events_product 
    ON pixel_events(product_id, event_type, created_at DESC) 
    WHERE product_id IS NOT NULL;

-- ============================================================================
-- Migration Notes
-- ============================================================================
-- 1. Run locally first for testing:
--    wrangler d1 execute epir_art_jewellery --local --file=./schema-pixel-events-base.sql
--
-- 2. Run heatmap extension after this:
--    wrangler d1 execute epir_art_jewellery --local --file=./schema-pixel-events-v3-heatmap.sql
--
-- 3. Run in production after testing:
--    wrangler d1 execute epir_art_jewellery --remote --file=./schema-pixel-events-base.sql
--    wrangler d1 execute epir_art_jewellery --remote --file=./schema-pixel-events-v3-heatmap.sql
-- ============================================================================
