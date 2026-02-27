import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client.js';
import { useSSE } from './use-sse.js';
import { useInteractionStore, PendingApprovalUI, PendingQuestionUI } from '../store/interaction-store.js';
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
  const handler = useCallback(
    (_channel: string, data: unknown) => {
      const payload = data as Record<string, unknown>;
      const store = useInteractionStore.getState();
      switch (_channel) {
        case 'approval-requested': {
          const p = payload as PendingApprovalUI;
          if (p.requestId && p.stageId) {
            store.addApproval(p);
          }
          break;
        }
        case 'question-requested': {
          const p = payload as PendingQuestionUI;
          if (p.requestId && p.stageId) {
            store.addQuestion(p);
          }
          break;
        }
        case 'approval-cancelled': {
          const p = payload as { requestId: string };
          if (p.requestId) {
            store.removeApproval(p.requestId);
          }
          break;
        }
        case 'message-queued': {
          const p = payload as { stageId: string; message: string };
          if (p.stageId && p.message) {
            store.setQueuedMessage(p.stageId, p.message);
          }
          break;
        }
        case 'message-sent': {
          const p = payload as { stageId: string };
          if (p.stageId) {
            store.clearQueuedMessage(p.stageId);
          }
          break;
        }
      }
    },
    [],
  );

  useSSE(
    ['approval-requested', 'question-requested', 'approval-cancelled', 'message-queued', 'message-sent'],
    handler,
  );
}
