/**
 * Row types that match the SQL table columns exactly.
 * These are database representations, not the frontmatter types.
 */

export interface EpicRow {
  id: string;
  repo_id: number;
  title: string | null;
  status: string | null;
  jira_key: string | null;
  file_path: string;
  last_synced: string;
}

export interface TicketRow {
  id: string;
  epic_id: string | null;
  repo_id: number;
  title: string | null;
  status: string | null;
  jira_key: string | null;
  source: string | null;
  has_stages: number | null;
  file_path: string;
  last_synced: string;
}

export interface StageRow {
  id: string;
  ticket_id: string | null;
  epic_id: string | null;
  repo_id: number;
  title: string | null;
  status: string | null;
  kanban_column: string | null;
  refinement_type: string | null;
  worktree_branch: string | null;
  pr_url: string | null;
  pr_number: number | null;
  priority: number;
  due_date: string | null;
  session_active: number;
  locked_at: string | null;
  locked_by: string | null;
  file_path: string;
  last_synced: string;
}

export interface DependencyRow {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: number;
  repo_id: number;
}

export interface SummaryRow {
  id: number;
  item_id: string;
  item_type: string;
  content_hash: string;
  model: string;
  summary: string;
  created_at: string;
  repo_id: number;
}
