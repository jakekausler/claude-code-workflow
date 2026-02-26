import { create } from 'zustand';

export interface PendingApprovalUI {
  stageId: string;
  requestId: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

export interface PendingQuestionUI {
  stageId: string;
  requestId: string;
  questions: unknown[];
  input: unknown;
  createdAt: number;
}

interface InteractionState {
  pendingApprovals: PendingApprovalUI[];
  pendingQuestions: PendingQuestionUI[];
  queuedMessages: Map<string, string>;

  addApproval: (approval: PendingApprovalUI) => void;
  removeApproval: (requestId: string) => void;
  addQuestion: (question: PendingQuestionUI) => void;
  removeQuestion: (requestId: string) => void;
  setQueuedMessage: (stageId: string, message: string) => void;
  clearQueuedMessage: (stageId: string) => void;
  getPendingCountForStage: (stageId: string) => number;
  reset: () => void;
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  pendingApprovals: [],
  pendingQuestions: [],
  queuedMessages: new Map(),

  addApproval: (approval) =>
    set((s) => ({ pendingApprovals: [...s.pendingApprovals, approval] })),

  removeApproval: (requestId) =>
    set((s) => ({ pendingApprovals: s.pendingApprovals.filter((a) => a.requestId !== requestId) })),

  addQuestion: (question) =>
    set((s) => ({ pendingQuestions: [...s.pendingQuestions, question] })),

  removeQuestion: (requestId) =>
    set((s) => ({ pendingQuestions: s.pendingQuestions.filter((q) => q.requestId !== requestId) })),

  setQueuedMessage: (stageId, message) =>
    set((s) => {
      const next = new Map(s.queuedMessages);
      next.set(stageId, message);
      return { queuedMessages: next };
    }),

  clearQueuedMessage: (stageId) =>
    set((s) => {
      const next = new Map(s.queuedMessages);
      next.delete(stageId);
      return { queuedMessages: next };
    }),

  getPendingCountForStage: (stageId) => {
    const s = get();
    return (
      s.pendingApprovals.filter((a) => a.stageId === stageId).length +
      s.pendingQuestions.filter((q) => q.stageId === stageId).length
    );
  },

  reset: () =>
    set({
      pendingApprovals: [],
      pendingQuestions: [],
      queuedMessages: new Map(),
    }),
}));
