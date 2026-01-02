-- Session persistence for Durable Object + D1
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  shop_domain TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  summary TEXT,
  preferences TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens INTEGER,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS customer_profiles (
  customer_id TEXT PRIMARY KEY,
  shop_domain TEXT,
  global_preferences TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Helper to prime ON CONFLICT(customer_id) upsert path
INSERT INTO customer_profiles (customer_id, shop_domain, global_preferences, created_at, updated_at)
VALUES ('__bootstrap__', NULL, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000)
ON CONFLICT(customer_id) DO UPDATE SET updated_at = excluded.updated_at;

-- D1 schema for conversations/messages
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id)
);

-- Index for session lookups and example insert
CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);

-- Cart actions table for analytics and debugging
CREATE TABLE IF NOT EXISTS cart_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  cart_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cart_actions_session_id ON cart_actions(session_id);
CREATE INDEX IF NOT EXISTS idx_cart_actions_cart_id ON cart_actions(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_actions_created_at ON cart_actions(created_at);

-- Example insert for testing:
-- INSERT INTO conversations (session_id, started_at, ended_at) VALUES ('test-session', 1690000000000, 1690000001000);
-- INSERT INTO cart_actions (session_id, cart_id, action, details, created_at) VALUES ('test-session', 'cart123', 'add_to_cart', '{"product_id":"123","quantity":1}', 1690000000000);

-- ============================================================================
-- PIXEL EVENTS TABLE (Shopify Web Pixel tracking)
-- ============================================================================
-- Stores customer behavior events from Shopify storefront
-- Schema follows Shopify Web Pixels API standard event structure
-- Docs: https://shopify.dev/docs/api/web-pixels-api/standard-events
-- ============================================================================

CREATE TABLE IF NOT EXISTS pixel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Session & Customer Identifiers (Shopify standard)
  customer_id TEXT,           -- anonymous_id OR gid://shopify/Customer/123
  session_id TEXT,            -- Browser session ID (from analytics.init.data)
  
  -- Event Metadata (Shopify Web Pixels API)
  event_type TEXT NOT NULL,   -- Shopify standard: 'page_viewed' | 'product_viewed' | 'cart_updated' | 'checkout_started' | 'purchase_completed'
  event_name TEXT,            -- Alias for event_type (Shopify uses both)
  
  -- Product Context (Shopify Product API fields)
  -- Only populated for product_viewed events
  product_id TEXT,            -- gid://shopify/Product/123 OR numeric ID
  product_handle TEXT,        -- URL-safe slug: 'gold-ring-vintage'
  product_type TEXT,          -- Product classification: 'Ring' | 'Bracelet' | 'Necklace'
  product_vendor TEXT,        -- Brand/vendor name: 'EPIR Jewelry'
  product_title TEXT,         -- Display name: 'Vintage Gold Ring'
  variant_id TEXT,            -- gid://shopify/ProductVariant/456 OR numeric ID
  
  -- Cart Context (for cart_updated events)
  cart_id TEXT,               -- Shopify cart token
  
  -- Page Context (for page_viewed events)
  page_url TEXT,              -- Full URL of the page
  page_title TEXT,            -- Browser page title
  page_type TEXT,             -- Shopify page type: 'product' | 'collection' | 'cart' | 'home'
  
  -- Raw Event Data (for debugging and future compatibility)
  event_data TEXT,            -- Full JSON payload from Web Pixel
  
  -- Timestamps
  created_at INTEGER NOT NULL -- Unix timestamp (milliseconds)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_pixel_customer ON pixel_events(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pixel_session ON pixel_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pixel_product ON pixel_events(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pixel_event_type ON pixel_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_pixel_created_at ON pixel_events(created_at);

-- Example inserts for testing:
-- Product view event:
-- INSERT INTO pixel_events (customer_id, session_id, event_type, product_id, product_handle, product_type, product_title, event_data, created_at)
-- VALUES ('anon_abc123', 'sess_xyz', 'product_viewed', 'gid://shopify/Product/7890', 'gold-ring-vintage', 'Ring', 'Vintage Gold Ring', '{"full":"payload"}', 1730966400000);
--
-- Page view event:
-- INSERT INTO pixel_events (customer_id, session_id, event_type, page_url, page_title, page_type, event_data, created_at)
-- VALUES ('anon_abc123', 'sess_xyz', 'page_viewed', 'https://example.com/products/gold-ring', 'Gold Ring | EPIR', 'product', '{"full":"payload"}', 1730966400000);
