-- Structured memory items: L2 layer for user preferences,
-- constraints, facts, and other long-term knowledge.

CREATE TABLE IF NOT EXISTS memory_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    category TEXT NOT NULL DEFAULT 'fact',
    content TEXT NOT NULL,
    source TEXT DEFAULT 'auto',
    importance INTEGER DEFAULT 5,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memory_items_user
    ON memory_items(user_id, is_active, category);

CREATE INDEX IF NOT EXISTS idx_memory_items_user_conv
    ON memory_items(user_id, conversation_id);
