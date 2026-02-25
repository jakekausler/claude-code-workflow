import type { PipelineConfig } from '../../types/pipeline.js';
import { StateMachine } from '../../engine/state-machine.js';
import { toColumnKey } from './board.js';

// ---------- Input data shapes ----------

export interface NextStageRow {
  id: string;
  ticket_id: string;
  epic_id: string;
  title: string;
  status: string;
  kanban_column: string;
  refinement_type: string; // JSON array string
  worktree_branch: string;
  priority: number;
  due_date: string | null;
  session_active: boolean;
  repo?: string;
}

export interface NextDependencyRow {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: boolean;
}

export interface NextTicketRow {
  id: string;
  epic_id: string;
  has_stages: boolean;
}

// ---------- Output types ----------

export interface ReadyStage {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  worktree_branch: string;
  refinement_type: string[];
  priority_score: number;
  priority_reason: string;
  needs_human: boolean;
  repo?: string;
}

export interface NextOutput {
  ready_stages: ReadyStage[];
  blocked_count: number;
  in_progress_count: number;
  to_convert_count: number;
  repos?: string[];
}

export interface BuildNextInput {
  config: PipelineConfig;
  stages: NextStageRow[];
  dependencies: NextDependencyRow[];
  tickets: NextTicketRow[];
  max?: number;
}

// ---------- Priority scoring ----------

/**
 * Statuses that indicate human input is needed.
 * These are identified by checking if the pipeline state name
 * contains "Manual" or "User" or "Feedback".
 */
const HUMAN_KEYWORDS = ['manual', 'user', 'feedback'];

function isHumanRequired(status: string, config: PipelineConfig): boolean {
  const sm = StateMachine.fromConfig(config);
  const state = sm.getStateByStatus(status);
  if (!state) return false;
  const lowerName = state.name.toLowerCase();
  return HUMAN_KEYWORDS.some((kw) => lowerName.includes(kw));
}

/**
 * Determine the priority reason from the stage status.
 */
function getPriorityReason(status: string, kanbanColumn: string, config: PipelineConfig): string {
  const sm = StateMachine.fromConfig(config);
  const state = sm.getStateByStatus(status);

  if (state && state.name === 'Addressing Comments') return 'review_comments_pending';
  if (state && state.name.toLowerCase().includes('manual')) return 'manual_testing_pending';
  if (state && state.name.toLowerCase().includes('automatic')) return 'automatic_testing_ready';
  if (state && state.name === 'Build') return 'build_ready';

  // Pipeline states that aren't specifically named
  if (state) return `${toColumnKey(state.name)}_ready`;

  // System columns
  if (kanbanColumn === 'ready_for_work') return 'design_ready';

  return 'normal';
}

/**
 * Compute priority score for a stage. Higher = should be worked on sooner.
 *
 * Score ranges:
 * - 700-799: Addressing Comments (review comments to address)
 * - 600-699: Manual Testing (needs user approval)
 * - 500-599: Automatic Testing ready
 * - 400-499: Build ready
 * - 300-399: Design ready (Not Started + deps resolved)
 * - 200-299: Other pipeline states
 *
 * Bonuses:
 * - priority field: +10 per priority level
 * - due_date proximity: +0 to +50 based on days until due
 */
export function computePriorityScore(stage: NextStageRow, config: PipelineConfig): number {
  const sm = StateMachine.fromConfig(config);
  const state = sm.getStateByStatus(stage.status);

  let baseScore = 200; // default for pipeline states

  if (state) {
    const name = state.name;
    if (name === 'Addressing Comments') {
      baseScore = 700;
    } else if (name.toLowerCase().includes('manual')) {
      baseScore = 600;
    } else if (name.toLowerCase().includes('automatic') || name.toLowerCase().includes('testing')) {
      // Automatic Testing gets 500, other testing-related gets 500
      if (name.toLowerCase().includes('automatic')) {
        baseScore = 500;
      }
    } else if (name === 'Build') {
      baseScore = 400;
    }
  }

  // Ready for Work (Not Started, deps resolved) = Design ready
  if (stage.kanban_column === 'ready_for_work') {
    baseScore = 300;
  }

  // Priority field bonus
  const priorityBonus = stage.priority * 10;

  // Due date proximity bonus (0-50)
  let dueDateBonus = 0;
  if (stage.due_date) {
    const dueDate = new Date(stage.due_date);
    const now = new Date();
    const daysUntil = Math.max(0, (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    // Closer due date = higher bonus. 0 days = 50, 30+ days = 0
    dueDateBonus = Math.max(0, Math.round(50 - (daysUntil / 30) * 50));
  }

  return baseScore + priorityBonus + dueDateBonus;
}

// ---------- Core logic ----------

export function buildNext(input: BuildNextInput): NextOutput {
  const { config, stages, dependencies, tickets, max } = input;

  // Count blocked stages (in backlog with unresolved deps)
  const blockedStages = stages.filter((s) => s.kanban_column === 'backlog');
  const blockedCount = blockedStages.length;

  // Count in-progress stages (session_active = true)
  const inProgressCount = stages.filter((s) => s.session_active).length;

  // Count to-convert tickets (tickets without stages)
  const toConvertCount = tickets.filter((t) => !t.has_stages).length;

  // Filter to workable stages:
  // - Not in backlog (blocked)
  // - Not in done
  // - Not session_active
  const workableStages = stages.filter((s) => {
    if (s.kanban_column === 'backlog') return false;
    if (s.kanban_column === 'done') return false;
    if (s.session_active) return false;
    return true;
  });

  // Score and sort
  const scored = workableStages.map((stage) => {
    const priorityScore = computePriorityScore(stage, config);
    const priorityReason = getPriorityReason(stage.status, stage.kanban_column, config);
    const needsHuman = isHumanRequired(stage.status, config);

    let refinementType: string[] = [];
    try {
      refinementType = JSON.parse(stage.refinement_type);
    } catch {
      refinementType = [];
    }

    return {
      id: stage.id,
      ticket: stage.ticket_id,
      epic: stage.epic_id,
      title: stage.title,
      worktree_branch: stage.worktree_branch,
      refinement_type: refinementType,
      priority_score: priorityScore,
      priority_reason: priorityReason,
      needs_human: needsHuman,
      ...(stage.repo ? { repo: stage.repo } : {}),
    } satisfies ReadyStage;
  });

  // Sort by priority score descending
  scored.sort((a, b) => b.priority_score - a.priority_score);

  // Apply max limit
  const limited = max !== undefined ? scored.slice(0, max) : scored;

  return {
    ready_stages: limited,
    blocked_count: blockedCount,
    in_progress_count: inProgressCount,
    to_convert_count: toConvertCount,
  };
}
