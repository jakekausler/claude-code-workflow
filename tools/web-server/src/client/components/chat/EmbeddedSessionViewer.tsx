import { useMemo, useEffect } from 'react';
import { Loader2, AlertCircle, Lock } from 'lucide-react';
import { ChatHistory } from './ChatHistory.js';
import { ContextAccordion } from './context/ContextAccordion.js';
import { useSessionDetail } from '../../api/hooks.js';
import { transformChunksToConversation } from '../../utils/group-transformer.js';
import { processSessionContextWithPhases } from '../../utils/context-tracker.js';
import { useSessionViewStore } from '../../store/session-store.js';

interface EmbeddedSessionViewerProps {
  projectId: string;
  sessionId: string;
  isReadOnly?: boolean;
}

export function EmbeddedSessionViewer({
  projectId,
  sessionId,
  isReadOnly = false,
}: EmbeddedSessionViewerProps) {
  const { data: session, isLoading, error } = useSessionDetail(projectId, sessionId);
  const resetView = useSessionViewStore((s) => s.resetView);

  // Reset view state when session changes
  useEffect(() => {
    resetView();
  }, [sessionId, resetView]);

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
        <ContextAccordion metrics={metrics} chunks={chunks} model={model} />
      )}

      {/* Chat history (fills remaining space) */}
      <div className="flex-1 min-h-0">
        <ChatHistory
          items={conversation?.items ?? []}
          contextStats={contextResult?.statsMap}
        />
      </div>
    </div>
  );
}
