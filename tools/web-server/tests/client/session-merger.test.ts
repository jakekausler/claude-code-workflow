// Project test conventions:
// - Framework: Vitest with describe/it/expect
// - Types imported from ../../src/server/types/jsonl.js
// - Helper factory functions for mock data
// - Synchronous tests, no async needed here

import { describe, it, expect } from 'vitest';
import {
  mergeIncrementalUpdate,
} from '../../src/client/utils/session-merger.js';
import type { SSESessionUpdate, MergeableSession } from '../../src/client/utils/session-merger.js';
import type {
  Chunk,
  SessionMetrics,
  ParsedMessage,
  Process,
} from '../../src/client/types/session.js';

// ─── Mock data factories ──────────────────────────────────────────────────────

let msgCounter = 0;

function makeMetrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    totalTokens: 100,
    inputTokens: 50,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalCost: 0.01,
    turnCount: 1,
    toolCallCount: 0,
    duration: 5000,
    ...overrides,
  };
}

function makeMsg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    uuid: `msg-${++msgCounter}`,
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    content: [],
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

function makeUserChunk(overrides: Partial<{ timestamp: Date }> = {}): Chunk {
  const chunk: Chunk = {
    type: 'user',
    message: makeMsg({ type: 'user', role: 'user', content: 'user message' }),
    timestamp: overrides.timestamp ?? new Date('2025-01-01T00:00:00Z'),
  };
  return chunk;
}

function makeAIChunk(messages: ParsedMessage[] = [], overrides: Partial<{ timestamp: Date }> = {}): Chunk {
  const chunk: Chunk = {
    type: 'ai',
    messages: messages.length > 0 ? messages : [makeMsg()],
    timestamp: overrides.timestamp ?? new Date('2025-01-01T00:00:01Z'),
  };
  return chunk;
}

function makeSession(overrides: Partial<MergeableSession> & Record<string, unknown> = {}): MergeableSession & Record<string, unknown> {
  return {
    chunks: [],
    metrics: makeMetrics(),
    isOngoing: false,
    subagents: [] as Process[],
    ...overrides,
  };
}

function makeUpdate(overrides: Partial<SSESessionUpdate> = {}): SSESessionUpdate {
  return {
    projectId: 'proj-1',
    sessionId: 'sess-1',
    type: 'incremental',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mergeIncrementalUpdate', () => {
  beforeEach(() => {
    msgCounter = 0;
  });

  it('returns existing session unchanged for full-refresh events', () => {
    const existing = makeSession({ chunks: [makeUserChunk()] });
    const update = makeUpdate({ type: 'full-refresh' });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result).toBe(existing);
  });

  it('returns existing session unchanged when newChunks is empty array', () => {
    const existing = makeSession({ chunks: [makeUserChunk()] });
    const update = makeUpdate({ type: 'incremental', newChunks: [] });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result).toBe(existing);
  });

  it('returns existing session unchanged when newChunks is undefined', () => {
    const existing = makeSession({ chunks: [makeUserChunk()] });
    const update = makeUpdate({ type: 'incremental', newChunks: undefined });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result).toBe(existing);
  });

  it('appends new user chunk after existing AI chunk', () => {
    const existingAI = makeAIChunk();
    const newUser = makeUserChunk();
    const existing = makeSession({ chunks: [existingAI] });
    const update = makeUpdate({ newChunks: [newUser] });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result).not.toBe(existing);
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]).toBe(existingAI);
    expect(result.chunks[1]).toBe(newUser);
  });

  it('merges boundary AI chunks when last existing and first new are both AI', () => {
    const msgA = makeMsg({ uuid: 'msg-a', content: [{ type: 'text', text: 'Hello' }] });
    const msgB = makeMsg({ uuid: 'msg-b', content: [{ type: 'text', text: 'World' }] });
    const existingAI = makeAIChunk([msgA]);
    const newAI = makeAIChunk([msgB]);
    const existing = makeSession({ chunks: [existingAI] });
    const update = makeUpdate({ newChunks: [newAI] });

    const result = mergeIncrementalUpdate(existing, update);

    // Should produce exactly one merged chunk, not two
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].type).toBe('ai');
    expect(result.chunks[0].messages).toHaveLength(2);
  });

  it('adds metrics from incremental update to existing metrics', () => {
    const existing = makeSession({
      metrics: makeMetrics({
        totalTokens: 100,
        inputTokens: 60,
        outputTokens: 40,
        cacheReadTokens: 10,
        cacheCreationTokens: 5,
        totalCost: 0.02,
        turnCount: 2,
        toolCallCount: 3,
        duration: 8000,
      }),
    });
    const incomingMetrics = makeMetrics({
      totalTokens: 50,
      inputTokens: 30,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheCreationTokens: 2,
      totalCost: 0.01,
      turnCount: 1,
      toolCallCount: 1,
      duration: 2000,
    });
    const update = makeUpdate({
      newChunks: [makeUserChunk()],
      metrics: incomingMetrics,
    });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result.metrics.totalTokens).toBe(150);
    expect(result.metrics.inputTokens).toBe(90);
    expect(result.metrics.outputTokens).toBe(60);
    expect(result.metrics.cacheReadTokens).toBe(15);
    expect(result.metrics.cacheCreationTokens).toBe(7);
    expect(result.metrics.totalCost).toBeCloseTo(0.03);
    expect(result.metrics.turnCount).toBe(3);
    expect(result.metrics.toolCallCount).toBe(4);
    expect(result.metrics.duration).toBe(10000);
  });

  it('preserves existing metrics when update has no metrics', () => {
    const existing = makeSession({});
    const update = makeUpdate({ newChunks: [makeUserChunk()] });
    delete (update as any).metrics;
    const result = mergeIncrementalUpdate(existing, update);
    expect(result.metrics).toEqual(existing.metrics);
  });

  it('updates isOngoing from the SSE event', () => {
    const existing = makeSession({ isOngoing: false });
    const update = makeUpdate({
      newChunks: [makeUserChunk()],
      isOngoing: true,
    });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result.isOngoing).toBe(true);
  });

  it('preserves existing isOngoing when update omits it', () => {
    const existing = makeSession({ isOngoing: true });
    const update = makeUpdate({
      newChunks: [makeUserChunk()],
      // isOngoing intentionally omitted
    });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result.isOngoing).toBe(true);
  });

  it('preserves extra fields like claudeMdFiles through the merge', () => {
    const claudeMdFiles = [
      { path: '/home/user/.claude/CLAUDE.md', estimatedTokens: 4900 },
    ];
    const existing = makeSession({ claudeMdFiles });
    const update = makeUpdate({ newChunks: [makeUserChunk()] });

    const result = mergeIncrementalUpdate(existing, update) as typeof existing;

    expect(result.claudeMdFiles).toBe(claudeMdFiles);
  });

  it('concatenates messages from both AI chunks in boundary merge', () => {
    const msg1 = makeMsg({ uuid: 'm1', content: [{ type: 'text', text: 'First message' }] });
    const msg2 = makeMsg({ uuid: 'm2', content: [{ type: 'text', text: 'Second message' }] });
    const msg3 = makeMsg({ uuid: 'm3', content: [{ type: 'text', text: 'Third message' }] });
    const existingAI = makeAIChunk([msg1, msg2]);
    const newAI = makeAIChunk([msg3]);
    const existing = makeSession({ chunks: [existingAI] });
    const update = makeUpdate({ newChunks: [newAI] });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result.chunks).toHaveLength(1);
    const merged = result.chunks[0];
    expect(merged.type).toBe('ai');
    expect(merged.messages).toHaveLength(3);
    expect(merged.messages[0].uuid).toBe('m1');
    expect(merged.messages[1].uuid).toBe('m2');
    expect(merged.messages[2].uuid).toBe('m3');
  });
});
