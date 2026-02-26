import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { ChatHistory } from '../components/chat/ChatHistory.js';
import { ContextAccordion } from '../components/chat/context/ContextAccordion.js';
import { SessionContextPanel } from '../components/chat/context/SessionContextPanel.js';
import { useSessionDetail } from '../api/hooks.js';
import { useSSE } from '../api/use-sse.js';
import { formatDuration, formatCost, formatTokenCount } from '../utils/session-formatters.js';
import { useSessionViewStore } from '../store/session-store.js';
import { transformChunksToConversation } from '../utils/group-transformer.js';
import { processSessionContextWithPhases } from '../utils/context-tracker.js';

export function SessionDetail() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const navigate = useNavigate();
  const resetView = useSessionViewStore((s) => s.resetView);

  // Reset view state when session changes
  useEffect(() => {
    resetView();
  }, [projectId, sessionId, resetView]);

  const queryClient = useQueryClient();

  const handleSSE = useCallback(
    (_channel: string, data: unknown) => {
      const event = data as { sessionId?: string; projectId?: string };
      // Only re-fetch if this event is for the session we're viewing
      if (event.sessionId === sessionId && event.projectId === projectId) {
        void queryClient.invalidateQueries({
          queryKey: ['session', projectId, sessionId],
        });
      }
    },
    [queryClient, projectId, sessionId],
  );

  useSSE(['session-update'], handleSSE);

  const { data: session, isLoading, error } = useSessionDetail(projectId || '', sessionId || '');

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
    return transformChunksToConversation(chunks, session.isOngoing, sessionId ?? '');
  }, [chunks, session, sessionId]);

  // Context tracking: compute per-turn context stats with phase boundaries
  // Pass claudeMdFiles and mentionedFileTokens from the server (read from disk)
  // so the tracker can attribute accurate token counts for injected context.
  const contextResult = useMemo(() => {
    if (!conversation) return null;
    return processSessionContextWithPhases(
      conversation.items,
      session?.claudeMdFiles,
      session?.mentionedFileTokens,
    );
  }, [conversation, session?.claudeMdFiles, session?.mentionedFileTokens]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-slate-600">Loading session…</span>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-slate-600">Failed to load session</p>
          <p className="text-sm text-slate-400 mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <button onClick={() => navigate(-1)} className="mt-4 text-sm text-blue-600 hover:text-blue-800">
            Go back
          </button>
        </div>
      </div>
    );
  }

  const { metrics } = session;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: session metadata */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-200 bg-white">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-600 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-800 truncate">
            Session {sessionId?.slice(0, 8)}
          </h1>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {model && <span>{model}</span>}
            <span>{formatDuration(metrics.duration)}</span>
            <span>{formatTokenCount(metrics.totalTokens)} tokens</span>
            <span>{formatCost(metrics.totalCost)}</span>
            {session.isOngoing && <span className="text-blue-600 font-medium">Live</span>}
          </div>
        </div>
      </div>

      {/* Main content: chat + context panel */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* Mobile/tablet: collapsible context accordion */}
        <div className="border-b border-slate-200 lg:hidden">
          <ContextAccordion metrics={metrics} chunks={chunks} model={model} />
        </div>

        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <ChatHistory
            items={conversation?.items ?? []}
            contextStats={contextResult?.statsMap}
            totalPhases={conversation?.totalPhases}
          />
        </div>
        <div className="w-80 flex-shrink-0 hidden lg:block">
          <SessionContextPanel metrics={metrics} chunks={chunks} model={model} />
        </div>
      </div>
    </div>
  );
}
