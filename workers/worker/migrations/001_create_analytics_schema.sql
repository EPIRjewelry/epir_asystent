-- Migration 001: Create analytics schema for archiving session data from Durable Objects
-- Purpose: Enable long-term storage and analytics of conversation data that DO cannot provide
-- Tables: sessions, messages, tool_calls, usage_stats

-- Sessions table: Metadata about each conversation session
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  customer_id TEXT,
  first_name TEXT,
  last_name TEXT,
  cart_id TEXT,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  archived_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  INDEX idx_customer (customer_id),
  INDEX idx_archived_at (archived_at),
  INDEX idx_created_at (created_at)
);

-- Messages table: Individual conversation messages
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user', 'assistant', 'system', 'tool'
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_calls TEXT, -- JSON array of tool calls
  tool_call_id TEXT, -- For tool response messages
  name TEXT, -- Tool name for tool responses
  INDEX idx_session (session_id),
  INDEX idx_timestamp (timestamp),
  INDEX idx_role (role),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Tool calls table: Detailed tracking of MCP tool invocations
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments TEXT, -- JSON arguments
  result TEXT, -- JSON result or error
  status TEXT, -- 'success', 'error', 'timeout'
  duration_ms INTEGER,
  timestamp INTEGER NOT NULL,
  INDEX idx_session (session_id),
  INDEX idx_tool_name (tool_name),
  INDEX idx_timestamp (timestamp),
  INDEX idx_status (status),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Usage stats table: Token usage and model performance metrics
CREATE TABLE IF NOT EXISTS usage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL,
  INDEX idx_session (session_id),
  INDEX idx_model (model),
  INDEX idx_timestamp (timestamp),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Cart activity: Track cart-related actions for analytics
CREATE TABLE IF NOT EXISTS cart_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  cart_id TEXT,
  action TEXT NOT NULL, -- 'view', 'add', 'update', 'remove', 'checkout'
  product_id TEXT,
  variant_id TEXT,
  quantity INTEGER,
  timestamp INTEGER NOT NULL,
  INDEX idx_session (session_id),
  INDEX idx_cart_id (cart_id),
  INDEX idx_timestamp (timestamp),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
