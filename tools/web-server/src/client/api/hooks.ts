import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client.js';
import type { ParsedSession, SessionMetrics, Process } from '@server/types/jsonl.js';

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: string;
  timestamp: string;
}

// Board

export interface BoardTicketItem {
  type: 'ticket';
  id: string;
  epic: string;
  title: string;
  jira_key: string | null;
  source: string;
  repo?: string;
}

export interface PendingMergeParent {
  stage_id: string;
  branch: string;
  pr_url: string;
  pr_number: number;
}

export interface BoardStageItem {
  type: 'stage';
  id: string;
  ticket: string;
  epic: string;
  title: string;
  blocked_by?: string[];
  blocked_by_resolved?: boolean;
  session_active?: boolean;
  worktree_branch?: string;
  pending_merge_parents?: PendingMergeParent[];
  repo?: string;
}

export type BoardItem = BoardTicketItem | BoardStageItem;

export interface BoardStats {
  total_stages: number;
  total_tickets: number;
  by_column: Record<string, number>;
}

export interface BoardResponse {
  generated_at: string;
  repo: string;
  repos?: string[];
  columns: Record<string, BoardItem[]>;
  stats: BoardStats;
}

// Epics
export interface EpicListItem {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  file_path: string;
  ticket_count: number;
}

export interface TicketSummary {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  source: string;
  has_stages: boolean;
  stage_count: number;
}

export interface EpicDetail {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  file_path: string;
  tickets: TicketSummary[];
}

// Tickets
export interface TicketListItem {
  id: string;
  title: string;
  status: string;
  epic_id: string;
  jira_key: string | null;
  source: string;
  has_stages: boolean;
  file_path: string;
  stage_count: number;
}

export interface StageSummary {
  id: string;
  title: string;
  status: string;
  kanban_column: string;
  refinement_type: string[];
  worktree_branch: string;
  session_active: boolean;
  session_id: string | null;
  priority: number;
  due_date: string | null;
  pr_url: string | null;
}

export interface TicketDetail {
  id: string;
  title: string;
  status: string;
  epic_id: string;
  jira_key: string | null;
  source: string;
  has_stages: boolean;
  file_path: string;
  stages: StageSummary[];
}

// Stages
export interface StageListItem {
  id: string;
  title: string;
  status: string;
  ticket_id: string;
  epic_id: string;
  kanban_column: string;
  refinement_type: string[];
  worktree_branch: string;
  session_active: boolean;
  session_id: string | null;
  priority: number;
  due_date: string | null;
  pr_url: string | null;
  file_path: string;
}

export interface DependencyItem {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: boolean;
}

export interface StageDetail extends StageListItem {
  pr_number: number | null;
  is_draft: boolean;
  pending_merge_parents: string | null;
  mr_target_branch: string | null;
  depends_on: DependencyItem[];
  depended_on_by: DependencyItem[];
}

// Graph
export interface GraphNode {
  id: string;
  type: 'epic' | 'ticket' | 'stage';
  status: string;
  title: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  resolved: boolean;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
  critical_path: string[];
}

export interface MermaidResponse {
  mermaid: string;
}

// Sessions
export interface SessionListItem {
  sessionId: string;
  filePath: string;
  lastModified: string;
  fileSize: number;
}

// Repos
export interface RepoListItem {
  id: number;
  name: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function buildQueryString(
  params?: Record<string, string | boolean | undefined>,
): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  const searchParams = new URLSearchParams();
  entries.forEach(([k, v]) => searchParams.set(k, String(v)));
  return `?${searchParams.toString()}`;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Health check — useful for verifying connectivity. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
  });
}

// Board -------------------------------------------------------------------

export function useBoard(filters?: {
  epic?: string;
  ticket?: string;
  column?: string;
  excludeDone?: boolean;
  repo?: string;
}) {
  return useQuery({
    queryKey: ['board', filters],
    queryFn: () =>
      apiFetch<BoardResponse>(
        `/board${buildQueryString(filters as Record<string, string | boolean | undefined>)}`,
      ),
  });
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => apiFetch<BoardStats>('/stats'),
  });
}

// Epics -------------------------------------------------------------------

export function useEpics() {
  return useQuery({
    queryKey: ['epics'],
    queryFn: () => apiFetch<EpicListItem[]>('/epics'),
  });
}

export function useEpic(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['epics', id],
    queryFn: () => apiFetch<EpicDetail>(`/epics/${id}`),
    enabled: options?.enabled ?? !!id,
  });
}

// Tickets -----------------------------------------------------------------

export function useTickets(filters?: { epic?: string }) {
  return useQuery({
    queryKey: ['tickets', filters],
    queryFn: () => apiFetch<TicketListItem[]>(`/tickets${buildQueryString(filters)}`),
  });
}

export function useTicket(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['tickets', id],
    queryFn: () => apiFetch<TicketDetail>(`/tickets/${id}`),
    enabled: options?.enabled ?? !!id,
  });
}

// Stages ------------------------------------------------------------------

export function useStages(filters?: { ticket?: string }) {
  return useQuery({
    queryKey: ['stages', filters],
    queryFn: () => apiFetch<StageListItem[]>(`/stages${buildQueryString(filters)}`),
  });
}

export function useStage(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['stages', id],
    queryFn: () => apiFetch<StageDetail>(`/stages/${id}`),
    enabled: options?.enabled ?? !!id,
  });
}

// Graph -------------------------------------------------------------------

/** Fetch dependency graph as JSON. */
export function useGraph(filters?: { epic?: string }) {
  return useQuery({
    queryKey: ['graph', filters],
    queryFn: () => apiFetch<GraphResponse>(`/graph${buildQueryString(filters)}`),
  });
}

/** Fetch dependency graph as Mermaid diagram string. */
export function useGraphMermaid(filters?: { epic?: string }) {
  return useQuery({
    queryKey: ['graph', 'mermaid', filters],
    queryFn: () =>
      apiFetch<MermaidResponse>(
        `/graph${buildQueryString({ ...filters, mermaid: true })}`,
      ),
  });
}

// Sessions ----------------------------------------------------------------

export function useSessions(projectId: string) {
  return useQuery({
    queryKey: ['sessions', projectId],
    queryFn: () =>
      apiFetch<SessionListItem[]>(
        `/sessions/${encodeURIComponent(projectId)}`,
      ),
    enabled: !!projectId,
  });
}

// Repos -------------------------------------------------------------------

export function useRepos() {
  return useQuery({
    queryKey: ['repos'],
    queryFn: () => apiFetch<RepoListItem[]>('/repos'),
  });
}

// Session Detail ----------------------------------------------------------

export function useSessionDetail(projectId: string, sessionId: string) {
  return useQuery({
    queryKey: ['session', projectId, sessionId],
    queryFn: () =>
      apiFetch<ParsedSession>(
        `/sessions/${encodeURIComponent(projectId)}/${sessionId}`,
      ),
    enabled: !!projectId && !!sessionId,
  });
}

export function useSessionMetrics(projectId: string, sessionId: string) {
  return useQuery({
    queryKey: ['session', projectId, sessionId, 'metrics'],
    queryFn: () =>
      apiFetch<SessionMetrics>(
        `/sessions/${encodeURIComponent(projectId)}/${sessionId}/metrics`,
      ),
    enabled: !!projectId && !!sessionId,
  });
}

export function useSubagent(
  projectId: string,
  sessionId: string,
  agentId: string,
) {
  return useQuery({
    queryKey: ['session', projectId, sessionId, 'subagent', agentId],
    queryFn: () =>
      apiFetch<Process>(
        `/sessions/${encodeURIComponent(projectId)}/${sessionId}/subagents/${agentId}`,
      ),
    enabled: !!projectId && !!sessionId && !!agentId,
  });
}

export function useStageSession(stageId: string) {
  return useQuery({
    queryKey: ['stage', stageId, 'session'],
    queryFn: () =>
      apiFetch<{ sessionId: string; stageId: string; projectId: string | null }>(
        `/stages/${stageId}/session`,
      ),
    enabled: !!stageId,
  });
}
