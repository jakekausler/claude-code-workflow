import { useMemo, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Lock } from 'lucide-react';
import { ChatHistory } from './ChatHistory.js';
import { MessageInput } from './MessageInput.js';
import { InlineApproval } from './InlineApproval.js';
import { InlineQuestion } from './InlineQuestion.js';
import { ContextAccordion } from './context/ContextAccordion.js';
import { useSessionDetail } from '../../api/hooks.js';
import { useSSE } from '../../api/use-sse.js';
import { transformChunksToConversation } from '../../utils/group-transformer.js';
import { processSessionContextWithPhases } from '../../utils/context-tracker.js';
import { useSessionViewStore } from '../../store/session-store.js';
import { useInteractionStore } from '../../store/interaction-store.js';

interface EmbeddedSessionViewerProps {
  projectId: string;
  sessionId: string;
  /** The orchestrator stage/ticket ID used for interaction endpoints (message, approve, etc.). */
  interactionId?: string;
  isReadOnly?: boolean;
  /** When true, poll for session updates every 10 seconds (for active/ongoing sessions). */
  isActive?: boolean;
}

export function EmbeddedSessionViewer({
  projectId,
  sessionId,
  interactionId,
  isReadOnly = false,
  isActive = false,
}: EmbeddedSessionViewerProps) {
  const { data: session, isLoading, error } = useSessionDetail(projectId, sessionId, {
    refetchInterval: isActive ? 10000 : false,
  });
  const resetView = useSessionViewStore((s) => s.resetView);
  const queryClient = useQueryClient();
  const registerViewer = useInteractionStore((s) => s.registerViewer);
  const unregisterViewer = useInteractionStore((s) => s.unregisterViewer);
  const pendingApprovals = useInteractionStore((s) =>
    s.pendingApprovals.filter((a) => a.stageId === interactionId),
  );
  const pendingQuestions = useInteractionStore((s) =>
    s.pendingQuestions.filter((q) => q.stageId === interactionId),
  );

  // Register/unregister this viewer so the modal overlay skips our approvals
  useEffect(() => {
    if (!interactionId) return;
    registerViewer(interactionId);
    return () => unregisterViewer(interactionId);
  }, [interactionId, registerViewer, unregisterViewer]);

  // Reset view state when session changes
  useEffect(() => {
    resetView();
  }, [sessionId, resetView]);

  // Invalidate React Query cache when the underlying session file is re-parsed,
  // so stale token counts are not shown after a session update.
  const handleSSE = useCallback(
    (_channel: string, data: unknown) => {
      const event = data as { sessionId?: string; projectId?: string };
      if (event.sessionId === sessionId && event.projectId === projectId) {
        void queryClient.invalidateQueries({
          queryKey: ['session', projectId, sessionId],
        });
      }
    },
    [queryClient, projectId, sessionId],
  );

  useSSE(['session-update'], handleSSE);

  const chunks = session?.chunks ?? [];

  // Detect model from first assistant message with a model field
  const model = useMemo(() => {
    if (chunks.length === 0) return undefined;
    return chunks
      .filter((c): c is Extract<typeof c, { type: 'ai' }> => c.type === 'ai')
      .flatMap((c) => c.messages)
      .find((m) => m.model)?.model;
  }, [chunks]);

  // Enrichment pipeline: transform raw chunks into grouped ChatItems
  const conversation = useMemo(() => {
    if (!session) return null;
    return transformChunksToConversation(chunks, session.isOngoing, sessionId);
  }, [chunks, session, sessionId]);

  // Context tracking: compute per-turn context stats with phase boundaries
  const contextResult = useMemo(() => {
    if (!conversation) return null;
    return processSessionContextWithPhases(conversation.items);
  }, [conversation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={16} />
        Failed to load session: {error instanceof Error ? error.message : 'Not found'}
      </div>
    );
  }

  const { metrics } = session;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Read-only badge */}
      {isReadOnly && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
          <Lock size={12} />
          Read Only
        </div>
      )}

      {/* Context accordion (collapsed by default) */}
      {metrics && (
        <div className="flex-shrink-0">
          <ContextAccordion metrics={metrics} chunks={chunks} model={model} />
        </div>
      )}

      {/* Chat history (fills remaining space) */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatHistory
          items={conversation?.items ?? []}
          contextStats={contextResult?.statsMap}
        />
      </div>

      {/* Inline approval / question for this session */}
      {interactionId && pendingApprovals[0] ? (
        <div className="flex-shrink-0">
          <InlineApproval
            stageId={interactionId}
            approval={{
              requestId: pendingApprovals[0].requestId,
              toolName: pendingApprovals[0].toolName,
              toolInput: pendingApprovals[0].input as Record<string, unknown>,
            }}
            onResolved={() => {}}
          />
        </div>
      ) : interactionId && pendingQuestions[0] ? (
        <div className="flex-shrink-0">
          <InlineQuestion
            stageId={interactionId}
            question={{
              requestId: pendingQuestions[0].requestId,
              question: pendingQuestions[0].questions[0]?.question ?? '',
              options: pendingQuestions[0].questions[0]?.options?.map((o) => o.label),
            }}
            onResolved={() => {}}
          />
        </div>
      ) : null}

      {/* Message input for active (non-read-only) sessions */}
      {!isReadOnly && interactionId && (
        <div className="flex-shrink-0">
          <MessageInput
            stageId={interactionId}
            disabled={!isActive}
            light
          />
        </div>
      )}
    </div>
  );
}
