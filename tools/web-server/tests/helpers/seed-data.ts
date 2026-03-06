/**
 * Reusable test helper that populates a SQLite database with known fixture data.
 * All route tests import this helper to get a predictable data set.
 */
import { KanbanDatabase } from '../../../kanban-cli/dist/db/database.js';
import { RepoRepository } from '../../../kanban-cli/dist/db/repositories/repo-repository.js';
import { EpicRepository } from '../../../kanban-cli/dist/db/repositories/epic-repository.js';
import { TicketRepository } from '../../../kanban-cli/dist/db/repositories/ticket-repository.js';
import { StageRepository } from '../../../kanban-cli/dist/db/repositories/stage-repository.js';
import { DependencyRepository } from '../../../kanban-cli/dist/db/repositories/dependency-repository.js';

export interface SeedResult {
  repoId: number;
}

export const SEED_IDS = {
  EPIC_AUTH: 'EPIC-001',
  EPIC_PAYMENTS: 'EPIC-002',
  TICKET_LOGIN: 'TICKET-001-001',
  TICKET_REGISTRATION: 'TICKET-001-002',
  TICKET_CHECKOUT: 'TICKET-002-001',
  STAGE_LOGIN_FORM: 'STAGE-001-001-001',
  STAGE_AUTH_API: 'STAGE-001-001-002',
  STAGE_SESSION_MGMT: 'STAGE-001-001-003',
  STAGE_SIGNUP_FORM: 'STAGE-001-002-001',
} as const;

export const SEED_TIMESTAMP = '2026-02-25T00:00:00.000Z';

/**
 * Seed a KanbanDatabase with a known hierarchy:
 *
 * EPIC-001 "Auth System" (In Progress)
 *   TICKET-001-001 "Login Flow" (In Progress)
 *     STAGE-001-001-001 "Login Form" (Complete, kanban_column=done)
 *     STAGE-001-001-002 "Auth API" (Build, kanban_column=build, session_active=false)
 *     STAGE-001-001-003 "Session Mgmt" (Not Started, kanban_column=backlog, depends on STAGE-001-001-002)
 *   TICKET-001-002 "Registration" (Not Started)
 *     STAGE-001-002-001 "Signup Form" (Not Started, kanban_column=ready_for_work)
 * EPIC-002 "Payments" (Not Started)
 *   TICKET-002-001 "Checkout" (Not Started, stages=[], source=jira, jira_key=PROJ-5678)
 */
export function seedDatabase(db: KanbanDatabase, repoPath = '/tmp/test-repo'): SeedResult {
  const repos = new RepoRepository(db);
  const epics = new EpicRepository(db);
  const tickets = new TicketRepository(db);
  const stages = new StageRepository(db);
  const deps = new DependencyRepository(db);

  // --- Repo ---
  const repoId = repos.upsert(repoPath, 'test-repo');

  // --- Epics ---
  epics.upsert({
    id: SEED_IDS.EPIC_AUTH,
    repo_id: repoId,
    title: 'Auth System',
    status: 'In Progress',
    jira_key: null,
    file_path: `${repoPath}/epics/${SEED_IDS.EPIC_AUTH}.md`,
    last_synced: SEED_TIMESTAMP,
  });

  epics.upsert({
    id: SEED_IDS.EPIC_PAYMENTS,
    repo_id: repoId,
    title: 'Payments',
    status: 'Not Started',
    jira_key: null,
    file_path: `${repoPath}/epics/${SEED_IDS.EPIC_PAYMENTS}.md`,
    last_synced: SEED_TIMESTAMP,
  });

  // --- Tickets ---
  tickets.upsert({
    id: SEED_IDS.TICKET_LOGIN,
    epic_id: SEED_IDS.EPIC_AUTH,
    repo_id: repoId,
    title: 'Login Flow',
    status: 'In Progress',
    jira_key: null,
    source: null,
    has_stages: 1,
    file_path: `${repoPath}/epics/${SEED_IDS.EPIC_AUTH}/${SEED_IDS.TICKET_LOGIN}.md`,
    last_synced: SEED_TIMESTAMP,
  });

  tickets.upsert({
    id: SEED_IDS.TICKET_REGISTRATION,
    epic_id: SEED_IDS.EPIC_AUTH,
    repo_id: repoId,
    title: 'Registration',
    status: 'Not Started',
    jira_key: null,
    source: null,
    has_stages: 1,
    file_path: `${repoPath}/epics/${SEED_IDS.EPIC_AUTH}/${SEED_IDS.TICKET_REGISTRATION}.md`,
    last_synced: SEED_TIMESTAMP,
  });

  tickets.upsert({
    id: SEED_IDS.TICKET_CHECKOUT,
    epic_id: SEED_IDS.EPIC_PAYMENTS,
    repo_id: repoId,
    title: 'Checkout',
    status: 'Not Started',
    jira_key: 'PROJ-5678',
    source: 'jira',
    has_stages: 0,
    file_path: `${repoPath}/epics/${SEED_IDS.EPIC_PAYMENTS}/${SEED_IDS.TICKET_CHECKOUT}.md`,
    last_synced: SEED_TIMESTAMP,
  });

  // --- Stages ---
  stages.upsert({
    id: SEED_IDS.STAGE_LOGIN_FORM,
    ticket_id: SEED_IDS.TICKET_LOGIN,
    epic_id: SEED_IDS.EPIC_AUTH,
    repo_id: repoId,
    title: 'Login Form',
    status: 'Complete',
    kanban_column: 'done',
    refinement_type: 'frontend',
    worktree_branch: null,
    pr_url: null,
    pr_number: null,
    priority: 0,
    due_date: null,
    session_active: 0,
    locked_at: null,
    locked_by: null,
    session_id: null,
    file_path: `${repoPath}/epics/${SEED_IDS.EPIC_AUTH}/${SEED_IDS.TICKET_LOGIN}/${SEED_IDS.STAGE_LOGIN_FORM}.md`,
    last_synced: SEED_TIMESTAMP,
  });

  stages.upsert({
    id: SEED_IDS.STAGE_AUTH_API,
    ticket_id: SEED_IDS.TICKET_LOGIN,
    epic_id: SEED_IDS.EPIC_AUTH,
    repo_id: repoId,
    title: 'Auth API',
    status: 'Build',
    kanban_column: 'build',
    refinement_type: 'backend',
    worktree_branch: null,
    pr_url: null,
    pr_number: null,
    priority: 1,
    due_date: '2026-03-15',
    session_active: 0,
    locked_at: null,
    locked_by: null,
    session_id: 'test-session-uuid-001',
    file_path: `${repoPath}/epics/${SEED_IDS.EPIC_AUTH}/${SEED_IDS.TICKET_LOGIN}/${SEED_IDS.STAGE_AUTH_API}.md`,
    last_synced: SEED_TIMESTAMP,
  });

  stages.upsert({
    id: SEED_IDS.STAGE_SESSION_MGMT,
    ticket_id: SEED_IDS.TICKET_LOGIN,
    epic_id: SEED_IDS.EPIC_AUTH,
    repo_id: repoId,
    title: 'Session Mgmt',
    status: 'Not Started',
    kanban_column: 'backlog',
    refinement_type: 'backend',
    worktree_branch: null,
    pr_url: null,
    pr_number: null,
    priority: 0,
    due_date: null,
    session_active: 0,
    locked_at: null,
    locked_by: null,
    session_id: null,
    file_path: `${repoPath}/epics/${SEED_IDS.EPIC_AUTH}/${SEED_IDS.TICKET_LOGIN}/${SEED_IDS.STAGE_SESSION_MGMT}.md`,
    last_synced: SEED_TIMESTAMP,
  });

  stages.upsert({
    id: SEED_IDS.STAGE_SIGNUP_FORM,
    ticket_id: SEED_IDS.TICKET_REGISTRATION,
    epic_id: SEED_IDS.EPIC_AUTH,
    repo_id: repoId,
    title: 'Signup Form',
    status: 'Not Started',
    kanban_column: 'ready_for_work',
    refinement_type: 'frontend',
    worktree_branch: null,
    pr_url: null,
    pr_number: null,
    priority: 0,
    due_date: null,
    session_active: 0,
    locked_at: null,
    locked_by: null,
    session_id: null,
    file_path: `${repoPath}/epics/${SEED_IDS.EPIC_AUTH}/${SEED_IDS.TICKET_REGISTRATION}/${SEED_IDS.STAGE_SIGNUP_FORM}.md`,
    last_synced: SEED_TIMESTAMP,
  });

  // --- Dependencies ---
  // STAGE-001-001-003 depends on STAGE-001-001-002
  deps.upsert({
    from_id: SEED_IDS.STAGE_SESSION_MGMT,
    to_id: SEED_IDS.STAGE_AUTH_API,
    from_type: 'stage',
    to_type: 'stage',
    repo_id: repoId,
  });

  return { repoId };
}
