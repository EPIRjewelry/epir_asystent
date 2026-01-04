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
  message_count INTEGER DEFAULT 0
);

-- Indexes for sessions
CREATE INDEX IF NOT EXISTS idx_sessions_customer ON sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_archived_at ON sessions(archived_at);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);

-- Messages table: Individual conversation messages
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user', 'assistant', 'system', 'tool'
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_calls TEXT, -- JSON array of tool calls
  tool_call_id TEXT, -- For tool response messages
  name TEXT -- Tool name for tool responses
  -- FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);

-- Tool calls table: Detailed tracking of MCP tool invocations
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments TEXT, -- JSON arguments
  result TEXT, -- JSON result or error
  status TEXT, -- 'success', 'error', 'timeout'
  duration_ms INTEGER,
  timestamp INTEGER NOT NULL
  -- FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Indexes for tool_calls
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp ON tool_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_calls_status ON tool_calls(status);

-- Usage stats table: Token usage and model performance metrics
CREATE TABLE IF NOT EXISTS usage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL
  -- FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Indexes for usage_stats
CREATE INDEX IF NOT EXISTS idx_usage_stats_session ON usage_stats(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_stats_model ON usage_stats(model);
CREATE INDEX IF NOT EXISTS idx_usage_stats_timestamp ON usage_stats(timestamp);

-- Cart activity: Track cart-related actions for analytics
CREATE TABLE IF NOT EXISTS cart_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  cart_id TEXT,
  action TEXT NOT NULL, -- 'view', 'add', 'update', 'remove', 'checkout'
  product_id TEXT,
  variant_id TEXT,
  quantity INTEGER,
  timestamp INTEGER NOT NULL
  -- FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Indexes for cart_activity
CREATE INDEX IF NOT EXISTS idx_cart_activity_session ON cart_activity(session_id);
CREATE INDEX IF NOT EXISTS idx_cart_activity_cart_id ON cart_activity(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_activity_timestamp ON cart_activity(timestamp);
