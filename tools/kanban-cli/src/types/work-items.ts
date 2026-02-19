/**
 * System kanban columns — structural columns that always exist (snake_case keys).
 * Pipeline columns (from config) appear between ready_for_work and done.
 */
export const SYSTEM_COLUMNS = [
  'to_convert',
  'backlog',
  'ready_for_work',
  'done',
] as const;

export type SystemColumn = (typeof SYSTEM_COLUMNS)[number];

/**
 * A kanban column is either a system column or a pipeline-defined column (string).
 * All column keys use snake_case.
 */
export type KanbanColumn = SystemColumn | (string & {});

/**
 * Discriminator for work item types.
 */
export type WorkItemType = 'epic' | 'ticket' | 'stage';

/**
 * A registered repository.
 */
export interface RepoRecord {
  id: number;
  path: string;
  name: string;
  registered_at: string;
}

/**
 * An epic parsed from YAML frontmatter.
 */
export interface Epic {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  tickets: string[];
  depends_on: string[];
  file_path: string;
}

/**
 * A ticket parsed from YAML frontmatter.
 */
export interface Ticket {
  id: string;
  epic: string;
  title: string;
  status: string;
  jira_key: string | null;
  source: 'local' | 'jira';
  stages: string[];
  depends_on: string[];
  file_path: string;
}

/**
 * A stage parsed from YAML frontmatter.
 */
export interface Stage {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  status: string;
  session_active: boolean;
  refinement_type: string[];
  depends_on: string[];
  worktree_branch: string | null;
  pr_url: string | null;
  pr_number: number | null;
  priority: number;
  due_date: string | null;
  file_path: string;
}

/**
 * A dependency edge between work items.
 */
export interface Dependency {
  from_id: string;
  to_id: string;
  from_type: WorkItemType;
  to_type: WorkItemType;
}
