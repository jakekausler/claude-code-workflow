/**
 * SQL statements to create the kanban workflow tables.
 * Uses IF NOT EXISTS so it is safe to run on every open.
 */

export const CREATE_REPOS_TABLE = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
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
  repo_id INTEGER REFERENCES repos(id)
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

export const ALL_CREATE_STATEMENTS = [
  CREATE_REPOS_TABLE,
  CREATE_EPICS_TABLE,
  CREATE_TICKETS_TABLE,
  CREATE_STAGES_TABLE,
  CREATE_DEPENDENCIES_TABLE,
  CREATE_SUMMARIES_TABLE,
] as const;
