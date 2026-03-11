import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTicket, useTicketSessions, useConvertTicket, useDeletePreview, useDeleteTicket } from '../../api/hooks.js';
import { useDrawerStore } from '../../store/drawer-store.js';
import { useDrawerSessionStore } from '../../store/drawer-session-store.js';
import { StatusBadge } from './StatusBadge.js';
import { DrawerTabs } from './DrawerTabs.js';
import type { TabDef } from './DrawerTabs.js';
import { SessionHistoryDropdown } from '../chat/SessionHistoryDropdown.js';
import { EmbeddedSessionViewer } from '../chat/EmbeddedSessionViewer.js';
import { EpicSelectModal } from '../ticket/EpicSelectModal.js';
import { slugToTitle, columnColor } from '../../utils/formatters.js';
import { useSSE } from '../../api/use-sse.js';
import { DeleteConfirmationDialog } from '../shared/DeleteConfirmationDialog.js';
import { ExternalLink, Loader2, AlertCircle, Zap, Trash2 } from 'lucide-react';
import { JIRA_BASE_URL } from '../../utils/constants.js';
import { MarkdownContent } from './MarkdownContent.js';

interface TicketDetailContentProps {
  ticketId: string;
}

export function TicketDetailContent({ ticketId }: TicketDetailContentProps) {
  const { data: ticket, isLoading, error } = useTicket(ticketId);
  const { open, closeAll } = useDrawerStore();
  const { ticketActiveTab, setTicketActiveTab, activeTicketSession, setTicketSession } = useDrawerSessionStore();
  const { data: sessionHistoryData, refetch: refetchSessions } = useTicketSessions(ticketId);
  const sessions = sessionHistoryData?.sessions ?? [];
  const hasSessions = sessions.length > 0;
  const queryClient = useQueryClient();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { data: deletePreview } = useDeletePreview('tickets', showDeleteDialog ? ticketId : null);
  const deleteTicket = useDeleteTicket();

  const handleDelete = () => {
    deleteTicket.mutate(ticketId, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['tickets'] });
        void queryClient.invalidateQueries({ queryKey: ['board'] });
        void queryClient.invalidateQueries({ queryKey: ['epics'] });
        void queryClient.invalidateQueries({ queryKey: ['stages'] });
        void queryClient.invalidateQueries({ queryKey: ['graph'] });
        setShowDeleteDialog(false);
        closeAll();
      },
    });
  };

  const [showEpicModal, setShowEpicModal] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionStarted, setConversionStarted] = useState(false);
  const [conversionTimedOut, setConversionTimedOut] = useState(false);
  const conversionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { mutate: convertTicket } = useConvertTicket();

  const isToConvert = ticket?.status === 'to_convert';

  // Build tabs array
  const tabs: TabDef[] = [
    { id: 'details', label: 'Details' },
  ];
  if (hasSessions || isConverting) {
    tabs.push({
      id: 'session',
      label: 'Session',
      badge: sessions.length > 0 ? String(sessions.length) : undefined,
    });
  }

  // When session tab is first opened, select the first session
  useEffect(() => {
    if (ticketActiveTab === 'session' && !activeTicketSession && sessions.length > 0) {
      const first = sessions[0];
      if (first.projectId) {
        setTicketSession(first.projectId, first.sessionId);
      }
    }
  }, [ticketActiveTab, activeTicketSession, sessions, setTicketSession]);

  // Poll for sessions while conversion is in progress (every 5 seconds)
  useEffect(() => {
    if (!isConverting) return;
    const interval = setInterval(() => {
      void refetchSessions();
    }, 5_000);
    return () => clearInterval(interval);
  }, [isConverting, refetchSessions]);

  // Listen for board-update SSE to refresh ticket data after conversion completes
  const handleSSE = useCallback(
    (_channel: string, _data: unknown) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId, 'sessions'] });
      void refetchSessions();
    },
    [queryClient, ticketId, refetchSessions],
  );
  useSSE(['board-update'], handleSSE);

  // Listen for session-status SSE to detect live conversion sessions immediately
  const handleSessionStatus = useCallback(
    (_channel: string, data: unknown) => {
      const event = data as { stageId?: string };
      if (event.stageId === ticketId) {
        void refetchSessions();
      }
    },
    [ticketId, refetchSessions],
  );
  useSSE(['session-status'], handleSessionStatus);

  // Conversion timeout: if no progress after 5 minutes, show error
  useEffect(() => {
    if (isConverting && !conversionTimedOut) {
      conversionTimerRef.current = setTimeout(() => {
        setConversionTimedOut(true);
      }, 300_000);
    } else if (conversionTimerRef.current) {
      clearTimeout(conversionTimerRef.current);
      conversionTimerRef.current = null;
    }
    return () => {
      if (conversionTimerRef.current) {
        clearTimeout(conversionTimerRef.current);
        conversionTimerRef.current = null;
      }
    };
  }, [isConverting, conversionTimedOut]);

  // Clear converting state when stages appear (conversion succeeded)
  useEffect(() => {
    if (isConverting && ticket && ticket.stages.length > 0) {
      setIsConverting(false);
      setConversionStarted(false);
      setConversionTimedOut(false);
    }
  }, [isConverting, ticket]);

  function handleConvertClick() {
    setConvertError(null);
    if (!ticket) return;
    // If ticket already has an epic, go straight to conversion
    if (ticket.epic_id) {
      startConversion(ticket.epic_id);
    } else {
      setShowEpicModal(true);
    }
  }

  function startConversion(epicId: string) {
    setShowEpicModal(false);
    setIsConverting(true);
    setConvertError(null);
    convertTicket(
      { ticketId, epicId },
      {
        onSuccess: () => {
          // Switch to session tab so user can watch progress
          setConversionStarted(true);
          setTicketActiveTab('session');
          void refetchSessions();
        },
        onError: (err) => {
          setIsConverting(false);
          setConversionStarted(false);
          setConvertError(err instanceof Error ? err.message : 'Conversion failed');
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={16} />
        Failed to load ticket: {error?.message ?? 'Not found'}
      </div>
    );
  }

  const showTabs = hasSessions || isConverting;

  return (
    <div className="flex flex-col h-full">
      {showEpicModal && (
        <EpicSelectModal
          ticketId={ticketId}
          onConfirm={(epicId) => startConversion(epicId)}
          onCancel={() => setShowEpicModal(false)}
        />
      )}

      {/* Tab bar (only show if ticket has sessions or conversion in progress) */}
      {showTabs && (
        <DrawerTabs
          tabs={tabs}
          activeTab={ticketActiveTab}
          onTabChange={(tabId) => {
            if (tabId === 'details' || tabId === 'session') {
              setTicketActiveTab(tabId);
            }
          }}
        />
      )}

      {/* Details tab content */}
      {ticketActiveTab === 'details' && (
        <div className="space-y-6 overflow-y-auto flex-1">
          {/* Header metadata */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={ticket.status} type="ticket" />
              {ticket.epic_id && (
                <button
                  onClick={() => open({ type: 'epic', id: ticket.epic_id! })}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {ticket.epic_id}
                </button>
              )}
              {ticket.source && (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {ticket.source}
                </span>
              )}
              {ticket.jira_key && (
                <a
                  href={`${JIRA_BASE_URL}/${ticket.jira_key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  {ticket.jira_key}
                  <ExternalLink size={12} />
                </a>
              )}
            </div>

            {/* Convert button — only shown for to_convert tickets */}
            {isToConvert && (
              <div className="mt-3">
                {convertError && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle size={14} />
                    {convertError}
                  </div>
                )}
                <button
                  onClick={handleConvertClick}
                  disabled={isConverting}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isConverting ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <Zap size={14} />
                  )}
                  {isConverting ? 'Converting…' : 'Convert to Stages'}
                </button>
              </div>
            )}
          </div>

          {/* Stage list */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              Stages ({ticket.stages.length})
            </h3>
            {ticket.stages.length === 0 ? (
              <p className="text-sm italic text-slate-400">No stages</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Column</th>
                    <th className="px-3 py-2 text-center">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ticket.stages.map((stage) => (
                    <tr
                      key={stage.id}
                      tabIndex={0}
                      role="button"
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => open({ type: 'stage', id: stage.id })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          open({ type: 'stage', id: stage.id });
                        }
                      }}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {stage.id}
                      </td>
                      <td className="px-3 py-2 text-slate-900">{stage.title}</td>
                      <td className="px-3 py-2">
                        {stage.kanban_column ? (
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: columnColor(stage.kanban_column) + '20',
                              color: columnColor(stage.kanban_column),
                            }}
                          >
                            {slugToTitle(stage.kanban_column)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {stage.session_active && (
                          <span className="inline-block h-2 w-2 rounded-full bg-green-500" title="Session active" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Markdown body content */}
          {ticket.body && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Content</h3>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <MarkdownContent content={ticket.body} />
              </div>
            </div>
          )}

          {/* Delete */}
          <div className="border-t border-slate-200 pt-4">
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              <Trash2 size={14} />
              Delete Ticket
            </button>
          </div>

          <DeleteConfirmationDialog
            isOpen={showDeleteDialog}
            onClose={() => setShowDeleteDialog(false)}
            onConfirm={handleDelete}
            isDeleting={deleteTicket.isPending}
            preview={deletePreview ?? null}
            error={deleteTicket.isError ? String(deleteTicket.error) : null}
          />
        </div>
      )}

      {/* Session tab content */}
      {ticketActiveTab === 'session' && (
        <div className="flex flex-col flex-1 min-h-0">
          {hasSessions ? (
            <>
              {/* Session dropdown */}
              <SessionHistoryDropdown
                sessions={sessions}
                selectedSessionId={activeTicketSession?.sessionId ?? sessions[0]?.sessionId ?? ''}
                onSelect={(sessionId) => {
                  const session = sessions.find((s) => s.sessionId === sessionId);
                  if (session?.projectId) {
                    setTicketSession(session.projectId, sessionId);
                  }
                }}
              />

              {/* Embedded session viewer — read-only only for completed sessions */}
              {activeTicketSession && (() => {
                const selectedSession = sessions.find((s) => s.sessionId === activeTicketSession.sessionId);
                const isEnded = !!selectedSession?.endedAt;
                return (
                  <EmbeddedSessionViewer
                    projectId={activeTicketSession.projectId}
                    sessionId={activeTicketSession.sessionId}
                    isReadOnly={isEnded}
                    isActive={!isEnded}
                  />
                );
              })()}
            </>
          ) : isConverting ? (
            conversionTimedOut ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-red-600">
                <AlertCircle size={24} />
                <p>Conversion timed out. The orchestrator may not be connected.</p>
                <p className="text-xs text-slate-400">Try refreshing or retrying the conversion.</p>
                <button
                  onClick={() => {
                    setIsConverting(false);
                    setConversionStarted(false);
                    setConversionTimedOut(false);
                    setConvertError(null);
                  }}
                  className="mt-2 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-slate-500">
                <Loader2 className="animate-spin text-indigo-400" size={24} />
                <p>{conversionStarted ? 'Conversion session active — Claude is working…' : 'Conversion session starting…'}</p>
                <p className="text-xs text-slate-400">
                  {conversionStarted
                    ? 'The session viewer will appear once the session is recorded.'
                    : 'The session will appear here once it begins.'}
                </p>
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
