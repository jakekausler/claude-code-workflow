import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client.js';
import { useSSE } from './use-sse.js';
import { useInteractionStore } from '../store/interaction-store.js';
import { useCallback } from 'react';

// -- Mutations --

export function useSendMessage(stageId: string) {
  return useMutation({
    mutationFn: async (message: string) => {
      const res = await apiFetch<{ success: boolean }>(`/api/sessions/${stageId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      return res;
    },
  });
}

export function useApproveToolCall(stageId: string) {
  return useMutation({
    mutationFn: async (params: { requestId: string; decision: 'allow' | 'deny'; reason?: string }) => {
      const res = await apiFetch<{ success: boolean }>(`/api/sessions/${stageId}/approve`, {
        method: 'POST',
        body: JSON.stringify(params),
      });
      return res;
    },
  });
}

export function useAnswerQuestion(stageId: string) {
  return useMutation({
    mutationFn: async (params: { requestId: string; answers: Record<string, string> }) => {
      const res = await apiFetch<{ success: boolean }>(`/api/sessions/${stageId}/answer`, {
        method: 'POST',
        body: JSON.stringify(params),
      });
      return res;
    },
  });
}

export function useInterruptSession(stageId: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch<{ success: boolean }>(`/api/sessions/${stageId}/interrupt`, {
        method: 'POST',
      });
      return res;
    },
  });
}

// -- SSE subscription --

export function useInteractionSSE() {
  const store = useInteractionStore();

  const handler = useCallback(
    (channel: string, data: unknown) => {
      const payload = data as Record<string, unknown>;
      switch (channel) {
        case 'approval-requested':
          store.addApproval(payload as any);
          break;
        case 'question-requested':
          store.addQuestion(payload as any);
          break;
        case 'approval-cancelled':
          store.removeApproval((payload as any).requestId);
          break;
        case 'approval-resolved':
          store.removeApproval((payload as any).requestId);
          break;
        case 'message-queued':
          store.setQueuedMessage((payload as any).stageId, (payload as any).message);
          break;
        case 'message-sent':
          store.clearQueuedMessage((payload as any).stageId);
          break;
      }
    },
    [store],
  );

  useSSE(
    ['approval-requested', 'question-requested', 'approval-cancelled', 'approval-resolved', 'message-queued', 'message-sent'],
    handler,
  );
}
