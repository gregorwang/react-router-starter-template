-- Add persistent session settings fields for conversation-level runtime config.
ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT;
ALTER TABLE conversations ADD COLUMN enable_thinking INTEGER;
ALTER TABLE conversations ADD COLUMN thinking_budget INTEGER;
ALTER TABLE conversations ADD COLUMN thinking_level TEXT;
ALTER TABLE conversations ADD COLUMN output_tokens INTEGER;
ALTER TABLE conversations ADD COLUMN output_effort TEXT;
ALTER TABLE conversations ADD COLUMN web_search INTEGER;
ALTER TABLE conversations ADD COLUMN xai_search_mode TEXT;
ALTER TABLE conversations ADD COLUMN enable_tools INTEGER;
