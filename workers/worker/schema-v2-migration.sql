-- ============================================================================
-- PIXEL_EVENTS TABLE MIGRATION v1 → v2
-- ============================================================================
-- Migration strategy: Rename old table, create new structure, migrate data
-- Safe rollback: Keep old table as pixel_events_v1_backup
-- ============================================================================

-- Step 1: Rename existing table (backup)
ALTER TABLE pixel_events RENAME TO pixel_events_v1_backup;

-- Step 2: Create new table with structured columns (from schema.sql)
CREATE TABLE pixel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Session & Customer Identifiers (Shopify standard)
  customer_id TEXT,
  session_id TEXT,
  
  -- Event Metadata
  event_type TEXT NOT NULL,
  event_name TEXT,
  
  -- Product Context
  product_id TEXT,
  product_handle TEXT,
  product_type TEXT,
  product_vendor TEXT,
  product_title TEXT,
  variant_id TEXT,
  
  -- Cart Context
  cart_id TEXT,
  
  -- Page Context
  page_url TEXT,
  page_title TEXT,
  page_type TEXT,
  
  -- Raw Event Data
  event_data TEXT,
  
  -- Timestamps
  created_at INTEGER NOT NULL
);

-- Step 3: Migrate existing data from v1 backup
-- Extract structured fields from JSON blob
INSERT INTO pixel_events (
  event_type,
  event_data,
  created_at,
  product_id,
  product_handle,
  product_type,
  product_vendor,
  product_title,
  variant_id
)
SELECT
  -- Parse event type from JSON
  COALESCE(json_extract(event_data, '$.event'), 'unknown') AS event_type,
  
  -- Keep raw JSON
  event_data,
  
  -- Convert created_at to Unix timestamp (milliseconds)
  -- D1 stores TIMESTAMP as TEXT, convert to INTEGER
  CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS created_at,
  
  -- Extract product fields (only if event is product_viewed)
  CASE 
    WHEN json_extract(event_data, '$.event') = 'product_viewed'
    THEN json_extract(event_data, '$.data.productVariant.product.id')
    ELSE NULL
  END AS product_id,
  
  CASE 
    WHEN json_extract(event_data, '$.event') = 'product_viewed'
    THEN json_extract(event_data, '$.data.productVariant.product.url')
    ELSE NULL
  END AS product_handle,
  
  CASE 
    WHEN json_extract(event_data, '$.event') = 'product_viewed'
    THEN json_extract(event_data, '$.data.productVariant.product.type')
    ELSE NULL
  END AS product_type,
  
  CASE 
    WHEN json_extract(event_data, '$.event') = 'product_viewed'
    THEN json_extract(event_data, '$.data.productVariant.product.vendor')
    ELSE NULL
  END AS product_vendor,
  
  CASE 
    WHEN json_extract(event_data, '$.event') = 'product_viewed'
    THEN json_extract(event_data, '$.data.productVariant.product.title')
    ELSE NULL
  END AS product_title,
  
  CASE 
    WHEN json_extract(event_data, '$.event') = 'product_viewed'
    THEN json_extract(event_data, '$.data.productVariant.id')
    ELSE NULL
  END AS variant_id

FROM pixel_events_v1_backup;

-- Step 4: Create indexes
CREATE INDEX idx_pixel_customer ON pixel_events(customer_id, created_at);
CREATE INDEX idx_pixel_session ON pixel_events(session_id, created_at);
CREATE INDEX idx_pixel_product ON pixel_events(product_id, created_at);
CREATE INDEX idx_pixel_event_type ON pixel_events(event_type, created_at);
CREATE INDEX idx_pixel_created_at ON pixel_events(created_at);

-- Step 5: Verify migration
-- SELECT COUNT(*) as v1_count FROM pixel_events_v1_backup;
-- SELECT COUNT(*) as v2_count FROM pixel_events;
-- SELECT * FROM pixel_events ORDER BY id DESC LIMIT 3;

-- Step 6 (OPTIONAL): Drop backup table after verification
-- DROP TABLE pixel_events_v1_backup;
