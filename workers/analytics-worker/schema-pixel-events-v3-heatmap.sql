-- ============================================================================
-- ⚠️ DEPRECATED: pixel_events Schema Extension for Full Spectrum Tracking
-- ============================================================================
<<<<<<< HEAD
-- ⚠️ WARNING: This file is DEPRECATED as of the schema consolidation update.
-- ⚠️ All heatmap v3 columns are now included in schema-pixel-events-base.sql
-- ⚠️ 
-- ⚠️ DO NOT USE this file for new deployments.
-- ⚠️ Use schema-pixel-events-base.sql instead, which contains all columns.
-- ============================================================================
-- 
-- Purpose: This file previously added columns for heatmap data (click coordinates, 
-- scroll depth, time on page) via ALTER TABLE statements.
-- 
-- Migration: This approach is now obsolete. The base schema includes all columns.
-- 
-- Historical Command: wrangler d1 execute epir_art_jewellery --local --file=./schema-pixel-events-v3-heatmap.sql
=======
-- ⚠️ DEPRECATED: This file is no longer needed as all columns are now
--    defined in schema-pixel-events-base.sql
--
-- Purpose: This file previously added heatmap columns via ALTER TABLE.
--          All columns are now included in the base schema for consistency.
--
-- Migration: Use schema-pixel-events-base.sql instead, which includes all fields.
>>>>>>> origin/main
-- ============================================================================

-- ⚠️ DO NOT USE THIS FILE FOR NEW DATABASES
-- If you previously used this file, the columns should already exist in your database.
-- For new databases, use schema-pixel-events-base.sql which includes everything.

-- ============================================================================
-- LEGACY ALTER TABLE STATEMENTS (kept for reference only)
-- ============================================================================
-- These ALTER TABLE statements are kept for historical reference.
-- They are no longer needed because schema-pixel-events-base.sql now includes
-- all these columns in the CREATE TABLE statement.

-- Click tracking (from epir:click_with_position) - NOW IN BASE SCHEMA
ALTER TABLE pixel_events ADD COLUMN click_x INTEGER DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN click_y INTEGER DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN viewport_w INTEGER DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN viewport_h INTEGER DEFAULT NULL;

-- Scroll tracking (from epir:scroll_depth)
ALTER TABLE pixel_events ADD COLUMN scroll_depth_percent INTEGER DEFAULT NULL;

-- Time on page (from epir:page_exit)
ALTER TABLE pixel_events ADD COLUMN time_on_page_seconds INTEGER DEFAULT NULL;

-- Form and input tracking (from DOM events)
ALTER TABLE pixel_events ADD COLUMN element_tag TEXT DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN element_id TEXT DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN element_class TEXT DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN input_name TEXT DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN form_id TEXT DEFAULT NULL;

-- Search tracking (from search_submitted)
ALTER TABLE pixel_events ADD COLUMN search_query TEXT DEFAULT NULL;

-- Collection tracking (from collection_viewed)
ALTER TABLE pixel_events ADD COLUMN collection_id TEXT DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN collection_handle TEXT DEFAULT NULL;

-- Checkout tracking
ALTER TABLE pixel_events ADD COLUMN checkout_token TEXT DEFAULT NULL;

-- Purchase tracking (from purchase_completed)
ALTER TABLE pixel_events ADD COLUMN order_id TEXT DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN order_value REAL DEFAULT NULL;

-- Alert tracking (from alert_displayed)
ALTER TABLE pixel_events ADD COLUMN alert_type TEXT DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN alert_message TEXT DEFAULT NULL;

-- Error tracking (from ui_extension_errored)
ALTER TABLE pixel_events ADD COLUMN error_message TEXT DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN extension_id TEXT DEFAULT NULL;

-- Mouse hover tracking (from epir:mouse_sample)
ALTER TABLE pixel_events ADD COLUMN mouse_x INTEGER DEFAULT NULL;
ALTER TABLE pixel_events ADD COLUMN mouse_y INTEGER DEFAULT NULL;

-- ============================================================================
-- LEGACY INDEXES (kept for reference only)
-- ============================================================================
-- These indexes are now created in schema-pixel-events-base.sql
-- This section is kept for historical reference only.

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
-- LEGACY VERIFICATION QUERIES (kept for reference only)
-- ============================================================================
-- For current verification queries, see schema-pixel-events-base.sql
-- These are kept for historical reference only.
--
-- After migration, run these to verify:
--
-- 1. Check schema:
--    PRAGMA table_info(pixel_events);
--
-- 2. Test click heatmap query:
--    SELECT page_url, click_x, click_y, COUNT(*) as clicks
--    FROM pixel_events
--    WHERE event_type = 'click_with_position' AND click_x IS NOT NULL
--    GROUP BY page_url, click_x, click_y
--    ORDER BY clicks DESC LIMIT 10;
--
-- 3. Test scroll depth:
--    SELECT page_url, AVG(scroll_depth_percent) as avg_scroll
--    FROM pixel_events
--    WHERE scroll_depth_percent IS NOT NULL
--    GROUP BY page_url
--    ORDER BY avg_scroll DESC;
-- ============================================================================
