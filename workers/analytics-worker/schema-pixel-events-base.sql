-- ============================================================================
-- Pixel Events Base Table
-- ============================================================================
-- Purpose: Store all web pixel events from Shopify Web Pixel API
-- Used by: analytics-worker to track customer behavior and trigger AI analysis
-- Migration: Run with `wrangler d1 execute epir_art_jewellery --local --file=./schema-pixel-events-base.sql`
-- ============================================================================

CREATE TABLE IF NOT EXISTS pixel_events (
    -- Unique identifier for each event (auto-incrementing integer)
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Customer identification
    customer_id TEXT,
    session_id TEXT,
    
    -- Event metadata
    event_type TEXT NOT NULL,
    event_name TEXT,
    
    -- Product data (for product-related events)
    product_id TEXT,
    product_handle TEXT,
    product_type TEXT,
    product_vendor TEXT,
    product_title TEXT,
    variant_id TEXT,
    
    -- Cart data (for cart events)
    cart_id TEXT,
    
    -- Page context data
    page_url TEXT,
    page_title TEXT,
    page_type TEXT,
    
    -- Raw event payload (JSON)
    event_data TEXT,
    
    -- Timestamps (Unix milliseconds for consistency with Cloudflare Workers)
    created_at INTEGER NOT NULL,
    
    -- Heatmap data (click coordinates, viewport dimensions)
    click_x INTEGER,
    click_y INTEGER,
    viewport_w INTEGER,
    viewport_h INTEGER,
    
    -- Scroll tracking
    scroll_depth_percent INTEGER,
    
    -- Time on page tracking
    time_on_page_seconds INTEGER,
    
    -- DOM element tracking (for click and form events)
    element_tag TEXT,
    element_id TEXT,
    element_class TEXT,
    input_name TEXT,
    form_id TEXT,
    
    -- Search tracking
    search_query TEXT,
    
    -- Collection tracking
    collection_id TEXT,
    collection_handle TEXT,
    
    -- Checkout tracking
    checkout_token TEXT,
    
    -- Purchase tracking
    order_id TEXT,
    order_value REAL,
    
    -- Alert tracking
    alert_type TEXT,
    alert_message TEXT,
    
    -- Error tracking
    error_message TEXT,
    extension_id TEXT,
    
    -- Mouse hover tracking
    mouse_x INTEGER,
    mouse_y INTEGER
);

-- ============================================================================
-- Base Indexes
-- ============================================================================

-- Index for querying by customer
CREATE INDEX IF NOT EXISTS idx_pixel_customer 
    ON pixel_events(customer_id, created_at);

-- Index for querying by session
CREATE INDEX IF NOT EXISTS idx_pixel_session 
    ON pixel_events(session_id, created_at);

-- Index for querying by product
CREATE INDEX IF NOT EXISTS idx_pixel_product 
    ON pixel_events(product_id, created_at);

-- Index for querying by event type
CREATE INDEX IF NOT EXISTS idx_pixel_event_type 
    ON pixel_events(event_type, created_at);

-- Index for querying by timestamp
CREATE INDEX IF NOT EXISTS idx_pixel_created_at 
    ON pixel_events(created_at);

-- ============================================================================
-- Heatmap-specific indexes (for v3 schema with inline heatmap fields)
-- ============================================================================

-- Click heatmaps by page
CREATE INDEX IF NOT EXISTS idx_pixel_clicks 
    ON pixel_events(page_url, event_type, click_x, click_y) 
    WHERE click_x IS NOT NULL;

-- Scroll depth analysis
CREATE INDEX IF NOT EXISTS idx_pixel_scroll 
    ON pixel_events(page_url, scroll_depth_percent) 
    WHERE scroll_depth_percent IS NOT NULL;

-- Time on page analysis
CREATE INDEX IF NOT EXISTS idx_pixel_time_on_page 
    ON pixel_events(page_url, time_on_page_seconds) 
    WHERE time_on_page_seconds IS NOT NULL;

-- Search queries ranking
CREATE INDEX IF NOT EXISTS idx_pixel_search 
    ON pixel_events(search_query, created_at) 
    WHERE search_query IS NOT NULL;

-- Collection popularity
CREATE INDEX IF NOT EXISTS idx_pixel_collection 
    ON pixel_events(collection_id, created_at) 
    WHERE collection_id IS NOT NULL;

-- ============================================================================
-- Migration Notes
-- ============================================================================
-- This schema now includes ALL fields inline (base + heatmap v3).
-- The separate schema-pixel-events-v3-heatmap.sql file is now DEPRECATED
-- because all columns are defined in this base schema.
--
-- 1. Run locally first for testing:
--    wrangler d1 execute epir_art_jewellery --local --file=./schema-pixel-events-base.sql
--
-- 2. Run in production after testing:
--    wrangler d1 execute epir_art_jewellery --remote --file=./schema-pixel-events-base.sql
--
-- 3. Verify table schema:
--    wrangler d1 execute epir_art_jewellery --local --command="PRAGMA table_info(pixel_events);"
--
-- 4. Test event insertion:
--    wrangler d1 execute epir_art_jewellery --local --command="INSERT INTO pixel_events (event_type, created_at) VALUES ('test', 1234567890); SELECT * FROM pixel_events WHERE event_type='test';"
-- ============================================================================
