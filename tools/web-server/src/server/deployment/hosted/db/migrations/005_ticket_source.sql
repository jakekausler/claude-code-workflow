-- Migration 005: Add source_id column to tickets for hosted-mode duplicate detection.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_source_dedup_idx
  ON tickets (repo_id, source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;
