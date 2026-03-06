-- Migration 004: Issue sync configuration and status tracking tables.

CREATE TABLE IF NOT EXISTS issue_sync_configs (
    id          SERIAL PRIMARY KEY,
    repo_id     INTEGER NOT NULL REFERENCES repos(id),
    provider    TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
    remote_owner TEXT,
    remote_repo  TEXT,
    instance_url TEXT,
    token       TEXT,
    labels      TEXT[],
    milestones  TEXT[],
    assignees   TEXT[],
    enabled     BOOLEAN DEFAULT TRUE,
    interval_ms INTEGER DEFAULT 3600000,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issue_sync_status (
    id              SERIAL PRIMARY KEY,
    config_id       INTEGER NOT NULL REFERENCES issue_sync_configs(id) ON DELETE CASCADE,
    last_sync_at    TIMESTAMPTZ,
    items_synced    INTEGER DEFAULT 0,
    last_error      TEXT,
    next_sync_at    TIMESTAMPTZ
);
