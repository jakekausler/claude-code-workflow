import { useStage } from '../../api/hooks.js';
import { useDrawerStore } from '../../store/drawer-store.js';
import { StatusBadge } from './StatusBadge.js';
import { DependencyList } from './DependencyList.js';
import { PhaseSection } from './PhaseSection.js';
import { slugToTitle, refinementColor } from '../../utils/formatters.js';
import {
  ExternalLink,
  GitBranch,
  Loader2,
  AlertCircle,
  FileCode,
} from 'lucide-react';

interface StageDetailContentProps {
  stageId: string;
}

export function StageDetailContent({ stageId }: StageDetailContentProps) {
  const { data: stage, isLoading, error } = useStage(stageId);
  const { open } = useDrawerStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (error || !stage) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={16} />
        Failed to load stage: {error?.message ?? 'Not found'}
      </div>
    );
  }

  const currentPhase = columnToPhase(stage.kanban_column);

  return (
    <div className="space-y-6">
      {/* Header metadata */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge
            status={stage.status}
            type="stage"
            kanbanColumn={stage.kanban_column ?? undefined}
          />
          {stage.epic_id && (
            <button
              onClick={() => open({ type: 'epic', id: stage.epic_id! })}
              className="text-xs text-blue-600 hover:underline"
            >
              {stage.epic_id}
            </button>
          )}
          {stage.ticket_id && (
            <button
              onClick={() => open({ type: 'ticket', id: stage.ticket_id! })}
              className="text-xs text-blue-600 hover:underline"
            >
              {stage.ticket_id}
            </button>
          )}
        </div>

        {/* Refinement type badges */}
        {stage.refinement_type.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {stage.refinement_type.map((rt) => (
              <span
                key={rt}
                className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: refinementColor(rt) + '20',
                  color: refinementColor(rt),
                }}
              >
                {rt}
              </span>
            ))}
          </div>
        )}

        {/* Worktree branch + PR link */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {stage.worktree_branch && (
            <span className="inline-flex items-center gap-1">
              <GitBranch size={12} />
              <code className="rounded bg-slate-100 px-1.5 py-0.5">
                {stage.worktree_branch}
              </code>
            </span>
          )}
          {stage.pr_url && (
            <a
              href={stage.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            >
              <FileCode size={12} />
              PR {stage.pr_number ? `#${stage.pr_number}` : 'Link'}
              {stage.is_draft && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                  Draft
                </span>
              )}
              <ExternalLink size={10} />
            </a>
          )}
          {stage.kanban_column && (
            <span>
              Column: <strong>{slugToTitle(stage.kanban_column)}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Phase sections — content not available from API, show placeholders */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Phases</h3>
        <PhaseSection
          title="Design"
          content=""
          isComplete={isPastPhase(stage.kanban_column, 'design')}
          defaultExpanded={currentPhase === 'design'}
        />
        <PhaseSection
          title="Build"
          content=""
          isComplete={isPastPhase(stage.kanban_column, 'build')}
          defaultExpanded={currentPhase === 'build'}
        />
        <PhaseSection
          title="Refinement"
          content=""
          isComplete={isPastPhase(stage.kanban_column, 'refinement')}
          defaultExpanded={currentPhase === 'refinement'}
        />
        <PhaseSection
          title="Finalize"
          content=""
          isComplete={isPastPhase(stage.kanban_column, 'finalize')}
          defaultExpanded={currentPhase === 'finalize'}
        />
      </div>

      {/* Session link placeholder */}
      <div>
        <button
          disabled
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
          title="Available after Stage 9E"
        >
          View Latest Session
          <span className="text-xs">(coming in 9E)</span>
        </button>
      </div>

      {/* Dependencies */}
      {(stage.depends_on.length > 0 || stage.depended_on_by.length > 0) && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Dependencies</h3>
          <DependencyList
            label="Blocked by"
            dependencies={stage.depends_on}
            displayField="to_id"
          />
          <DependencyList
            label="Blocks"
            dependencies={stage.depended_on_by}
            displayField="from_id"
          />
        </div>
      )}
    </div>
  );
}

/** Pipeline column order for determining phase completion */
const COLUMN_ORDER = [
  'backlog',
  'ready_for_work',
  'design',
  'user_design_feedback',
  'build',
  'automatic_testing',
  'manual_testing',
  'refinement',
  'finalize',
  'pr_created',
  'addressing_comments',
  'review',
  'done',
  'archived',
];

/** Map any pipeline column to its parent phase for section expansion */
function columnToPhase(column: string | null): string | null {
  if (!column) return null;
  const PHASE_MAP: Record<string, string> = {
    design: 'design',
    user_design_feedback: 'design',
    build: 'build',
    automatic_testing: 'build',
    manual_testing: 'refinement',
    refinement: 'refinement',
    finalize: 'finalize',
    pr_created: 'finalize',
    addressing_comments: 'finalize',
    review: 'finalize',
  };
  return PHASE_MAP[column] ?? null;
}

function isPastPhase(currentColumn: string | null, phase: string): boolean {
  if (!currentColumn) return false;
  const currentIdx = COLUMN_ORDER.indexOf(currentColumn);
  const phaseIdx = COLUMN_ORDER.indexOf(phase);
  if (currentIdx === -1 || phaseIdx === -1) return false;
  return currentIdx > phaseIdx;
}
