-- Add expiration support for conversation share links.
ALTER TABLE conversation_share_links ADD COLUMN expires_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_share_links_expires_at
ON conversation_share_links(expires_at);
