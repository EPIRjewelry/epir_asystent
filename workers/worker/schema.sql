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
