import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useStage, useStageSession, useStageSessionHistory } from '../../api/hooks.js';
import { useDrawerStore } from '../../store/drawer-store.js';
import { useDrawerSessionStore } from '../../store/drawer-session-store.js';
import { StatusBadge } from './StatusBadge.js';
import { DependencyList } from './DependencyList.js';
import { PhaseSection } from './PhaseSection.js';
import { DrawerTabs } from './DrawerTabs.js';
import type { TabDef } from './DrawerTabs.js';
import { SessionHistoryDropdown } from '../chat/SessionHistoryDropdown.js';
import { EmbeddedSessionViewer } from '../chat/EmbeddedSessionViewer.js';
import { slugToTitle } from '../../utils/formatters.js';
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
  const { stageActiveTab, setStageActiveTab, activeStageSession, setStageSession } = useDrawerSessionStore();
  const { data: sessionHistoryData } = useStageSessionHistory(stageId);
  const sessions = sessionHistoryData?.sessions ?? [];
  const hasSessions = sessions.length > 0;

  // Build tabs array
  const tabs: TabDef[] = [
    { id: 'details', label: 'Details' },
  ];
  if (hasSessions) {
    const currentSession = sessions.find((s) => s.isCurrent);
    tabs.push({
      id: 'session',
      label: 'Session',
      badge: currentSession ? 'Live' : undefined,
      badgeVariant: currentSession ? 'success' : undefined,
    });
  }

  // When session tab is first opened, select the first session
  useEffect(() => {
    if (stageActiveTab === 'session' && !activeStageSession && sessions.length > 0) {
      const first = sessions[0];
      if (first.projectId) {
        setStageSession(first.projectId, first.sessionId);
      }
    }
  }, [stageActiveTab, activeStageSession, sessions, setStageSession]);

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

  const phases = getVisiblePhases(stage.status);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar (only show if stage has sessions) */}
      {hasSessions && (
        <DrawerTabs
          tabs={tabs}
          activeTab={stageActiveTab}
          onTabChange={(tabId) => {
            if (tabId === 'details' || tabId === 'session') {
              setStageActiveTab(tabId);
            }
          }}
        />
      )}

      {/* Details tab content — existing content, unchanged */}
      {stageActiveTab === 'details' && (
        <div className="space-y-6 overflow-y-auto flex-1">
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

          {/* Phase sections — derived from pipeline config and stage status */}
          {phases.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Phases</h3>
              {phases.map((phase) => (
                <PhaseSection
                  key={phase.name}
                  title={phase.name}
                  content=""
                  isComplete={phase.isComplete}
                  defaultExpanded={!phase.isComplete}
                />
              ))}
            </div>
          )}

          {/* Session link — only rendered when the stage has a linked session */}
          {stage.session_id && (
            <SessionLink stageId={stageId} />
          )}

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
      )}

      {/* Session tab content */}
      {stageActiveTab === 'session' && hasSessions && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Session dropdown */}
          <SessionHistoryDropdown
            sessions={sessions}
            selectedSessionId={activeStageSession?.sessionId ?? sessions[0]?.sessionId ?? ''}
            onSelect={(sessionId) => {
              const session = sessions.find((s) => s.sessionId === sessionId);
              if (session?.projectId) {
                setStageSession(session.projectId, sessionId);
              }
            }}
          />

          {/* Embedded session viewer */}
          {activeStageSession && (
            <EmbeddedSessionViewer
              projectId={activeStageSession.projectId}
              sessionId={activeStageSession.sessionId}
              isReadOnly={!sessions.find((s) => s.sessionId === activeStageSession.sessionId)?.isCurrent}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionLink — fetches the stage→session mapping and renders a link
//
// Note: This uses `useStageSession` (singular) to resolve the *primary*
// linked session (stage.session_id → projectId) for building the standalone
// session page link. The parent component uses `useStageSessionHistory`
// (plural) to list *all* sessions in the Session tab. The two hooks hit
// different endpoints and serve different purposes, so both are needed.
// ---------------------------------------------------------------------------

function SessionLink({ stageId }: { stageId: string }) {
  const { data, isLoading } = useStageSession(stageId);

  if (isLoading) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-400">
        <Loader2 className="animate-spin" size={14} />
        Loading session…
      </div>
    );
  }

  if (!data?.projectId) {
    // session_id exists on the stage but we couldn't resolve the projectId —
    // show session ID as informational text rather than a broken link.
    return (
      <div className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
        <ExternalLink size={14} />
        Session: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{data?.sessionId ?? 'unknown'}</code>
      </div>
    );
  }

  return (
    <Link
      to={`/sessions/${encodeURIComponent(data.projectId)}/${data.sessionId}`}
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
    >
      <ExternalLink size={14} />
      View Session
    </Link>
  );
}

/** Pipeline phases in execution order, derived from default pipeline config */
const PIPELINE_PHASES = [
  'Design',
  'User Design Feedback',
  'Build',
  'Automatic Testing',
  'Manual Testing',
  'Finalize',
  'PR Created',
  'Addressing Comments',
];

/**
 * Determine which phases to display based on the stage's current status.
 * Shows all completed phases plus the current phase. Phases after the
 * current one are not rendered.
 */
function getVisiblePhases(status: string): { name: string; isComplete: boolean }[] {
  if (status === 'Not Started') return [];
  if (status === 'Complete') {
    return PIPELINE_PHASES.map((name) => ({ name, isComplete: true }));
  }
  const currentIdx = PIPELINE_PHASES.indexOf(status);
  if (currentIdx === -1) return [];
  return PIPELINE_PHASES.slice(0, currentIdx + 1).map((name, i) => ({
    name,
    isComplete: i < currentIdx,
  }));
}
