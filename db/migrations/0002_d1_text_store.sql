-- Migration 0002: remove R2 as a Phase-2 blocker.
-- Existing databases keep r2_text_key NOT NULL; D1-backed rows use d1:// pseudo-keys.

ALTER TABLE source_versions ADD COLUMN manifest_json TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN content_text TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_chunks_version_status
  ON knowledge_chunks(version_id, status);
