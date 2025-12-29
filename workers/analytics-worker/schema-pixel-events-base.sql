-- ============================================================================
-- Pixel Events Table (Complete Schema)
-- ============================================================================
-- Purpose: Store all web pixel events from Shopify Web Pixel API + heatmap v3
-- Used by: analytics-worker to track customer behavior and trigger AI analysis
-- Migration: Run with `wrangler d1 execute epir_art_jewellery --local --file=./schema-pixel-events-base.sql`
-- Note: This schema matches the D1 schema in workers/analytics-worker/src/index.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS pixel_events (
    -- Unique identifier for each event (auto-increment integer)
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Customer identification
    customer_id TEXT,
    session_id TEXT,
    
    -- Event metadata
    event_type TEXT NOT NULL,
    event_name TEXT,
    
    -- Product data (Shopify Web Pixels API)
    product_id TEXT,
    product_handle TEXT,
    product_type TEXT,
    product_vendor TEXT,
    product_title TEXT,
    variant_id TEXT,
    
    -- Cart data
    cart_id TEXT,
    
    -- Page context
    page_url TEXT,
    page_title TEXT,
    page_type TEXT,
    
    -- Raw event payload (JSON)
    event_data TEXT,
    
    -- Timestamp (Unix milliseconds as INTEGER)
    created_at INTEGER NOT NULL,
    
    -- Heatmap v3: Click tracking (from epir:click_with_position)
    click_x INTEGER,
    click_y INTEGER,
    viewport_w INTEGER,
    viewport_h INTEGER,
    
    -- Heatmap v3: Scroll tracking (from epir:scroll_depth)
    scroll_depth_percent INTEGER,
    
    -- Heatmap v3: Time on page (from epir:page_exit)
    time_on_page_seconds INTEGER,
    
    -- Heatmap v3: Form and input tracking (from DOM events)
    element_tag TEXT,
    element_id TEXT,
    element_class TEXT,
    input_name TEXT,
    form_id TEXT,
    
    -- Heatmap v3: Search tracking (from search_submitted)
    search_query TEXT,
    
    -- Heatmap v3: Collection tracking (from collection_viewed)
    collection_id TEXT,
    collection_handle TEXT,
    
    -- Heatmap v3: Checkout tracking
    checkout_token TEXT,
    
    -- Heatmap v3: Purchase tracking (from purchase_completed)
    order_id TEXT,
    order_value REAL,
    
    -- Heatmap v3: Alert tracking (from alert_displayed)
    alert_type TEXT,
    alert_message TEXT,
    
    -- Heatmap v3: Error tracking (from ui_extension_errored)
    error_message TEXT,
    extension_id TEXT,
    
    -- Heatmap v3: Mouse hover tracking (from epir:mouse_sample)
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

-- Index for querying by event type
CREATE INDEX IF NOT EXISTS idx_pixel_event_type 
    ON pixel_events(event_type, created_at);

-- Index for querying by product
CREATE INDEX IF NOT EXISTS idx_pixel_product 
    ON pixel_events(product_id, created_at);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_pixel_created_at 
    ON pixel_events(created_at);

-- ============================================================================
-- Heatmap v3 Indexes
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
-- This file now contains the complete schema matching index.ts implementation.
-- All heatmap v3 columns are included in the base table creation.
--
-- To apply this schema:
-- 1. Local testing:
--    wrangler d1 execute epir_art_jewellery --local --file=./schema-pixel-events-base.sql
--
-- 2. Production deployment:
--    wrangler d1 execute epir_art_jewellery --remote --file=./schema-pixel-events-base.sql
--
-- Note: The separate schema-pixel-events-v3-heatmap.sql file is now DEPRECATED
-- as all columns are defined in this single file.
-- ============================================================================
