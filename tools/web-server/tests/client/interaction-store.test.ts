import { describe, it, expect, beforeEach } from 'vitest';
import { useInteractionStore } from '../../src/client/store/interaction-store.js';

describe('interaction-store', () => {
  beforeEach(() => {
    useInteractionStore.getState().reset();
  });

  it('starts with no pending approvals', () => {
    const state = useInteractionStore.getState();
    expect(state.pendingApprovals).toEqual([]);
    expect(state.pendingQuestions).toEqual([]);
  });

  it('addApproval adds to pendingApprovals', () => {
    const store = useInteractionStore.getState();
    store.addApproval({
      stageId: 'STAGE-A',
      requestId: 'req-001',
      toolName: 'Bash',
      input: { command: 'ls' },
      createdAt: 123,
    });

    expect(useInteractionStore.getState().pendingApprovals).toHaveLength(1);
    expect(useInteractionStore.getState().pendingApprovals[0].requestId).toBe('req-001');
  });

  it('removeApproval removes by requestId', () => {
    const store = useInteractionStore.getState();
    store.addApproval({
      stageId: 'STAGE-A',
      requestId: 'req-001',
      toolName: 'Bash',
      input: {},
      createdAt: 123,
    });
    store.removeApproval('req-001');
    expect(useInteractionStore.getState().pendingApprovals).toHaveLength(0);
  });

  it('addQuestion adds to pendingQuestions', () => {
    const store = useInteractionStore.getState();
    store.addQuestion({
      stageId: 'STAGE-A',
      requestId: 'req-002',
      questions: [{ question: 'DB?' }],
      input: {},
      createdAt: 123,
    });
    expect(useInteractionStore.getState().pendingQuestions).toHaveLength(1);
  });

  it('removeQuestion removes by requestId', () => {
    const store = useInteractionStore.getState();
    store.addQuestion({
      stageId: 'STAGE-A',
      requestId: 'req-002',
      questions: [{ question: 'DB?' }],
      input: {},
      createdAt: 123,
    });
    store.removeQuestion('req-002');
    expect(useInteractionStore.getState().pendingQuestions).toHaveLength(0);
  });

  it('getPendingCountForStage filters by stageId', () => {
    const store = useInteractionStore.getState();
    store.addApproval({ stageId: 'STAGE-A', requestId: 'r1', toolName: 'Bash', input: {}, createdAt: 1 });
    store.addApproval({ stageId: 'STAGE-B', requestId: 'r2', toolName: 'Read', input: {}, createdAt: 2 });

    const stageA = useInteractionStore.getState().getPendingCountForStage('STAGE-A');
    expect(stageA).toBe(1);
  });

  it('getPendingCountForStage counts both approvals and questions', () => {
    const store = useInteractionStore.getState();
    store.addApproval({ stageId: 'STAGE-A', requestId: 'r1', toolName: 'Bash', input: {}, createdAt: 1 });
    store.addQuestion({ stageId: 'STAGE-A', requestId: 'r2', questions: [], input: {}, createdAt: 2 });

    const count = useInteractionStore.getState().getPendingCountForStage('STAGE-A');
    expect(count).toBe(2);
  });

  it('setQueuedMessage and clearQueuedMessage', () => {
    const store = useInteractionStore.getState();
    store.setQueuedMessage('STAGE-A', 'Fix this');
    expect(useInteractionStore.getState().queuedMessages.get('STAGE-A')).toBe('Fix this');

    store.clearQueuedMessage('STAGE-A');
    expect(useInteractionStore.getState().queuedMessages.has('STAGE-A')).toBe(false);
  });
});
