-- PostgreSQL schema for hosted deployment mode.
-- Auth tables (new) + kanban tables (mirrored from SQLite).

BEGIN;

-- ============================================================
-- Auth tables
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    username        TEXT,
    display_name    TEXT,
    avatar_url      TEXT,
    os_username     TEXT,
    claude_home_path TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    refresh_token_id UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    provider        TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email           TEXT,
    UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS revoked_refresh_tokens (
    token_id        UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id),
    revoked_reason  TEXT,
    revoked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Kanban tables (mirrored from SQLite schema in kanban-cli)
-- ============================================================

CREATE TABLE IF NOT EXISTS repos (
    id              SERIAL PRIMARY KEY,
    path            TEXT UNIQUE NOT NULL,
    name            TEXT UNIQUE NOT NULL,
    registered_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS epics (
    id              TEXT PRIMARY KEY,
    repo_id         INTEGER REFERENCES repos(id),
    title           TEXT,
    status          TEXT,
    jira_key        TEXT,
    file_path       TEXT NOT NULL,
    last_synced     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
    id              TEXT PRIMARY KEY,
    epic_id         TEXT REFERENCES epics(id),
    repo_id         INTEGER REFERENCES repos(id),
    title           TEXT,
    status          TEXT,
    jira_key        TEXT,
    source          TEXT,
    has_stages      BOOLEAN,
    file_path       TEXT NOT NULL,
    last_synced     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stages (
    id              TEXT PRIMARY KEY,
    ticket_id       TEXT REFERENCES tickets(id),
    epic_id         TEXT REFERENCES epics(id),
    repo_id         INTEGER REFERENCES repos(id),
    title           TEXT,
    status          TEXT,
    kanban_column   TEXT,
    refinement_type TEXT,
    worktree_branch TEXT,
    pr_url          TEXT,
    pr_number       INTEGER,
    priority        INTEGER DEFAULT 0,
    due_date        TEXT,
    session_active  BOOLEAN DEFAULT FALSE,
    locked_at       TEXT,
    locked_by       TEXT,
    is_draft        BOOLEAN DEFAULT FALSE,
    pending_merge_parents TEXT,
    mr_target_branch TEXT,
    session_id      TEXT DEFAULT NULL,
    file_path       TEXT NOT NULL,
    last_synced     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dependencies (
    id              SERIAL PRIMARY KEY,
    from_id         TEXT NOT NULL,
    to_id           TEXT NOT NULL,
    from_type       TEXT NOT NULL,
    to_type         TEXT NOT NULL,
    resolved        BOOLEAN DEFAULT FALSE,
    repo_id         INTEGER REFERENCES repos(id),
    target_repo_name TEXT
);

CREATE TABLE IF NOT EXISTS summaries (
    id              SERIAL PRIMARY KEY,
    item_id         TEXT NOT NULL,
    item_type       TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    model           TEXT NOT NULL,
    summary         TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    repo_id         INTEGER REFERENCES repos(id),
    UNIQUE(item_id, item_type, repo_id)
);

CREATE TABLE IF NOT EXISTS parent_branch_tracking (
    id              SERIAL PRIMARY KEY,
    child_stage_id  TEXT NOT NULL,
    parent_stage_id TEXT NOT NULL,
    parent_branch   TEXT NOT NULL,
    parent_pr_url   TEXT,
    last_known_head TEXT,
    is_merged       BOOLEAN DEFAULT FALSE,
    repo_id         INTEGER REFERENCES repos(id),
    last_checked    TEXT NOT NULL,
    UNIQUE(child_stage_id, parent_stage_id)
);

CREATE TABLE IF NOT EXISTS mr_comment_tracking (
    stage_id                    TEXT PRIMARY KEY,
    last_poll_timestamp         TEXT NOT NULL,
    last_known_unresolved_count INTEGER DEFAULT 0,
    repo_id                     INTEGER REFERENCES repos(id)
);

CREATE TABLE IF NOT EXISTS stage_sessions (
    id          SERIAL PRIMARY KEY,
    stage_id    TEXT NOT NULL REFERENCES stages(id),
    session_id  TEXT NOT NULL,
    phase       TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    is_current  INTEGER DEFAULT 0,
    UNIQUE(stage_id, session_id)
);

CREATE TABLE IF NOT EXISTS ticket_sessions (
    id           SERIAL PRIMARY KEY,
    ticket_id    TEXT NOT NULL REFERENCES tickets(id),
    session_id   TEXT NOT NULL,
    session_type TEXT NOT NULL DEFAULT 'convert',
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    UNIQUE(ticket_id, session_id)
);

-- ============================================================
-- Indexes (mirrored from SQLite schema)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_epics_jira_key ON epics(jira_key, repo_id);
CREATE INDEX IF NOT EXISTS idx_tickets_jira_key ON tickets(jira_key, repo_id);
CREATE INDEX IF NOT EXISTS idx_parent_tracking_child ON parent_branch_tracking(child_stage_id);
CREATE INDEX IF NOT EXISTS idx_parent_tracking_parent ON parent_branch_tracking(parent_stage_id);
CREATE INDEX IF NOT EXISTS idx_stages_session_id ON stages(session_id);
CREATE INDEX IF NOT EXISTS idx_stage_sessions_stage_id ON stage_sessions(stage_id);
CREATE INDEX IF NOT EXISTS idx_stage_sessions_session_id ON stage_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_ticket_sessions_ticket_id ON ticket_sessions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_sessions_session_id ON ticket_sessions(session_id);

-- Auth indexes
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_refresh_tokens_user_id ON revoked_refresh_tokens(user_id);

COMMIT;
