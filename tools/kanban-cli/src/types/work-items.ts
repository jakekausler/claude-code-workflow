/**
 * System kanban columns — structural columns that always exist.
 * Pipeline columns (from config) appear between Ready for Work and Done.
 */
export const SYSTEM_COLUMNS = [
  'To Convert',
  'Backlog',
  'Ready for Work',
  'Done',
] as const;

export type SystemColumn = (typeof SYSTEM_COLUMNS)[number];

/**
 * A kanban column is either a system column or a pipeline-defined column (string).
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
