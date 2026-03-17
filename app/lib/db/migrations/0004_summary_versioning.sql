-- Summary versioning: track changes to conversation summaries
-- for drift diagnosis and potential rollback.

-- Version history table
CREATE TABLE IF NOT EXISTS summary_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    summary_text TEXT NOT NULL,
    source_turn_range TEXT,
    change_description TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_summary_versions_conv
    ON summary_versions(conversation_id, version DESC);

-- Add version counter to conversations table
ALTER TABLE conversations ADD COLUMN summary_version INTEGER DEFAULT 0;
