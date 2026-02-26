/**
 * SQL statements to create the kanban workflow tables.
 * Uses IF NOT EXISTS so it is safe to run on every open.
 */

export const CREATE_REPOS_TABLE = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  name TEXT UNIQUE NOT NULL,
  registered_at TEXT NOT NULL
)`;

export const CREATE_EPICS_TABLE = `
CREATE TABLE IF NOT EXISTS epics (
  id TEXT PRIMARY KEY,
  repo_id INTEGER REFERENCES repos(id),
  title TEXT,
  status TEXT,
  jira_key TEXT,
  file_path TEXT NOT NULL,
  last_synced TEXT NOT NULL
)`;

export const CREATE_TICKETS_TABLE = `
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  epic_id TEXT REFERENCES epics(id),
  repo_id INTEGER REFERENCES repos(id),
  title TEXT,
  status TEXT,
  jira_key TEXT,
  source TEXT,
  has_stages BOOLEAN,
  file_path TEXT NOT NULL,
  last_synced TEXT NOT NULL
)`;

export const CREATE_STAGES_TABLE = `
CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT REFERENCES tickets(id),
  epic_id TEXT REFERENCES epics(id),
  repo_id INTEGER REFERENCES repos(id),
  title TEXT,
  status TEXT,
  kanban_column TEXT,
  refinement_type TEXT,
  worktree_branch TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  priority INTEGER DEFAULT 0,
  due_date TEXT,
  session_active BOOLEAN DEFAULT 0,
  locked_at TEXT,
  locked_by TEXT,
  is_draft BOOLEAN DEFAULT 0,
  pending_merge_parents TEXT,
  mr_target_branch TEXT,
  session_id TEXT DEFAULT NULL,
  file_path TEXT NOT NULL,
  last_synced TEXT NOT NULL
)`;

export const CREATE_DEPENDENCIES_TABLE = `
CREATE TABLE IF NOT EXISTS dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  from_type TEXT NOT NULL,
  to_type TEXT NOT NULL,
  resolved BOOLEAN DEFAULT 0,
  repo_id INTEGER REFERENCES repos(id),
  target_repo_name TEXT
)`;

export const CREATE_SUMMARIES_TABLE = `
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  repo_id INTEGER REFERENCES repos(id),
  UNIQUE(item_id, item_type, repo_id)
)`;

export const CREATE_PARENT_BRANCH_TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS parent_branch_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_stage_id TEXT NOT NULL,
  parent_stage_id TEXT NOT NULL,
  parent_branch TEXT NOT NULL,
  parent_pr_url TEXT,
  last_known_head TEXT,
  is_merged BOOLEAN DEFAULT 0,
  repo_id INTEGER REFERENCES repos(id),
  last_checked TEXT NOT NULL,
  UNIQUE(child_stage_id, parent_stage_id)
)`;

export const CREATE_MR_COMMENT_TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS mr_comment_tracking (
  stage_id TEXT PRIMARY KEY,
  last_poll_timestamp TEXT NOT NULL,
  last_known_unresolved_count INTEGER DEFAULT 0,
  repo_id INTEGER REFERENCES repos(id)
)`;

export const CREATE_STAGE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS stage_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id    TEXT NOT NULL REFERENCES stages(id),
  session_id  TEXT NOT NULL,
  phase       TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  is_current  INTEGER DEFAULT 0,
  UNIQUE(stage_id, session_id)
)`;

export const CREATE_TICKET_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS ticket_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id),
  session_id  TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'convert',
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  UNIQUE(ticket_id, session_id)
)`;

export const CREATE_STAGE_SESSIONS_STAGE_INDEX = `CREATE INDEX IF NOT EXISTS idx_stage_sessions_stage_id ON stage_sessions(stage_id)`;
export const CREATE_TICKET_SESSIONS_TICKET_INDEX = `CREATE INDEX IF NOT EXISTS idx_ticket_sessions_ticket_id ON ticket_sessions(ticket_id)`;

export const CREATE_EPICS_JIRA_KEY_INDEX = `CREATE INDEX IF NOT EXISTS idx_epics_jira_key ON epics(jira_key, repo_id)`;
export const CREATE_TICKETS_JIRA_KEY_INDEX = `CREATE INDEX IF NOT EXISTS idx_tickets_jira_key ON tickets(jira_key, repo_id)`;
export const CREATE_PARENT_TRACKING_CHILD_INDEX = `CREATE INDEX IF NOT EXISTS idx_parent_tracking_child ON parent_branch_tracking(child_stage_id)`;
export const CREATE_PARENT_TRACKING_PARENT_INDEX = `CREATE INDEX IF NOT EXISTS idx_parent_tracking_parent ON parent_branch_tracking(parent_stage_id)`;
export const CREATE_STAGES_SESSION_ID_INDEX = `CREATE INDEX IF NOT EXISTS idx_stages_session_id ON stages(session_id)`;

// Migration: adds UNIQUE constraint on repos.name for existing databases
// that were created before the column-level UNIQUE was added to CREATE_REPOS_TABLE.
// For fresh databases this is a no-op (SQLite already creates an implicit unique index).
export const CREATE_REPOS_NAME_UNIQUE_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_name ON repos(name)`;

/**
 * Migrations that may fail on existing databases and must be wrapped in
 * try/catch at execution time.  Includes ALTER TABLE ADD COLUMN (SQLite
 * throws if the column already exists) and CREATE UNIQUE INDEX (fails if
 * existing data violates the constraint).
 */
export const ALTER_TABLE_MIGRATIONS = [
  'ALTER TABLE stages ADD COLUMN is_draft BOOLEAN DEFAULT 0',
  'ALTER TABLE stages ADD COLUMN pending_merge_parents TEXT',
  'ALTER TABLE stages ADD COLUMN mr_target_branch TEXT',
  'ALTER TABLE dependencies ADD COLUMN target_repo_name TEXT',
  CREATE_REPOS_NAME_UNIQUE_INDEX,
  'ALTER TABLE stages ADD COLUMN session_id TEXT DEFAULT NULL',
] as const;

export const ALL_CREATE_STATEMENTS = [
  CREATE_REPOS_TABLE,
  CREATE_EPICS_TABLE,
  CREATE_TICKETS_TABLE,
  CREATE_STAGES_TABLE,
  CREATE_DEPENDENCIES_TABLE,
  CREATE_SUMMARIES_TABLE,
  CREATE_PARENT_BRANCH_TRACKING_TABLE,
  CREATE_MR_COMMENT_TRACKING_TABLE,
  CREATE_EPICS_JIRA_KEY_INDEX,
  CREATE_TICKETS_JIRA_KEY_INDEX,
  CREATE_PARENT_TRACKING_CHILD_INDEX,
  CREATE_PARENT_TRACKING_PARENT_INDEX,
  CREATE_STAGES_SESSION_ID_INDEX,
  CREATE_STAGE_SESSIONS_TABLE,
  CREATE_TICKET_SESSIONS_TABLE,
  CREATE_STAGE_SESSIONS_STAGE_INDEX,
  CREATE_TICKET_SESSIONS_TICKET_INDEX,
] as const;
