/**
 * Database-agnostic row types for the repository abstraction layer.
 *
 * Boolean fields are typed as `boolean` (not `number`) — SQLite adapters
 * normalise 0/1 to false/true, and PostgreSQL returns native booleans.
 */

export interface RepoRow {
  id: number;
  path: string;
  name: string;
  registered_at: string;
}

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
  source_id: string | null;
  has_stages: boolean | null;
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
  session_active: boolean;
  locked_at: string | null;
  locked_by: string | null;
  is_draft: boolean;
  pending_merge_parents: string | null;
  mr_target_branch: string | null;
  session_id: string | null;
  file_path: string;
  last_synced: string;
}

export interface DependencyRow {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: boolean;
  repo_id: number;
  target_repo_name: string | null;
}

export interface StageSessionRow {
  id: number;
  stage_id: string;
  session_id: string;
  phase: string;
  started_at: string;
  ended_at: string | null;
  is_current: boolean;
}

export interface TicketSessionRow {
  id: number;
  ticket_id: string;
  session_id: string;
  session_type: string;
  started_at: string;
  ended_at: string | null;
}

// ── Upsert data types ────────────────────────────────────────────────

export interface EpicUpsertData {
  id: string;
  repo_id: number;
  title: string | null;
  status: string | null;
  jira_key: string | null;
  file_path: string;
  last_synced: string;
}

export interface TicketUpsertData {
  id: string;
  epic_id: string | null;
  repo_id: number;
  title: string | null;
  status: string | null;
  jira_key: string | null;
  source: string | null;
  source_id: string | null;
  has_stages: number | null;
  file_path: string;
  last_synced: string;
}

export interface StageUpsertData {
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
  is_draft?: number;
  pending_merge_parents?: string | null;
  mr_target_branch?: string | null;
  session_id?: string | null;
  file_path: string;
  last_synced: string;
}

export interface DependencyUpsertData {
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  repo_id: number;
  target_repo_name?: string | null;
}

// ── Repository interfaces ────────────────────────────────────────────

export interface IRepoRepository {
  findAll(): Promise<RepoRow[]>;
  findById(id: number): Promise<RepoRow | null>;
  findByPath(repoPath: string): Promise<RepoRow | null>;
  findByName(name: string): Promise<RepoRow | null>;
  upsert(repoPath: string, name: string): Promise<number>;
}

export interface IEpicRepository {
  findById(id: string): Promise<EpicRow | null>;
  listByRepo(repoId: number): Promise<EpicRow[]>;
  findByJiraKey(repoId: number, jiraKey: string): Promise<EpicRow | null>;
  upsert(data: EpicUpsertData): Promise<void>;
}

export interface ITicketRepository {
  findById(id: string): Promise<TicketRow | null>;
  listByRepo(repoId: number): Promise<TicketRow[]>;
  listByEpic(epicId: string, repoId?: number): Promise<TicketRow[]>;
  findByJiraKey(repoId: number, jiraKey: string): Promise<TicketRow | null>;
  upsert(data: TicketUpsertData): Promise<void>;
}

export interface IStageRepository {
  findById(id: string): Promise<StageRow | null>;
  listByRepo(repoId: number): Promise<StageRow[]>;
  listByTicket(ticketId: string, repoId?: number): Promise<StageRow[]>;
  listByColumn(repoId: number, column: string): Promise<StageRow[]>;
  listReady(repoId: number): Promise<StageRow[]>;
  findBySessionId(sessionId: string): Promise<StageRow | null>;
  updateSessionId(stageId: string, sessionId: string | null): Promise<void>;
  upsert(data: StageUpsertData): Promise<void>;
}

export interface IDependencyRepository {
  listByTarget(fromId: string): Promise<DependencyRow[]>;
  listBySource(toId: string): Promise<DependencyRow[]>;
  listByRepo(repoId: number): Promise<DependencyRow[]>;
  resolve(fromId: string, toId: string): Promise<void>;
  allResolved(fromId: string): Promise<boolean>;
  upsert(data: DependencyUpsertData): Promise<void>;
  deleteByRepo(repoId: number): Promise<void>;
}

export interface IStageSessionRepository {
  getSessionsByStageId(stageId: string): Promise<StageSessionRow[]>;
  addSession(stageId: string, sessionId: string, phase: string): Promise<void>;
  endSession(stageId: string, sessionId: string): Promise<void>;
  getCurrentSession(stageId: string): Promise<StageSessionRow | null>;
}

export interface ITicketSessionRepository {
  getSessionsByTicketId(ticketId: string): Promise<TicketSessionRow[]>;
  addSession(ticketId: string, sessionId: string, sessionType: string): Promise<void>;
}
