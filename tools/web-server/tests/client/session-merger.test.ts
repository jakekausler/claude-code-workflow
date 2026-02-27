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
  SemanticStep,
  EnhancedAIChunk,
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
    expect(result.chunks[1]).toStrictEqual(newUser);
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

  it('concatenates semanticSteps from both AI chunks in boundary merge', () => {
    const stepA: SemanticStep = { type: 'thinking', content: 'Analyzing...' };
    const stepB: SemanticStep = { type: 'tool_call', content: 'Read file', toolName: 'Read', toolCallId: 'tc-1' };
    const stepC: SemanticStep = { type: 'output', content: 'Done' };

    const existingAI: EnhancedAIChunk = {
      ...makeAIChunk([makeMsg({ uuid: 'e1' })]),
      type: 'ai',
      semanticSteps: [stepA, stepB],
      subagents: [],
    };
    const newAI: EnhancedAIChunk = {
      ...makeAIChunk([makeMsg({ uuid: 'n1' })]),
      type: 'ai',
      semanticSteps: [stepC],
      subagents: [],
    };

    const existing = makeSession({ chunks: [existingAI as Chunk] });
    const update = makeUpdate({ newChunks: [newAI as Chunk] });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result.chunks).toHaveLength(1);
    const merged = result.chunks[0] as EnhancedAIChunk;
    expect(merged.semanticSteps).toHaveLength(3);
    expect(merged.semanticSteps[0]).toBe(stepA);
    expect(merged.semanticSteps[1]).toBe(stepB);
    expect(merged.semanticSteps[2]).toBe(stepC);
  });

  it('preserves semanticSteps when only existing chunk has them', () => {
    const step: SemanticStep = { type: 'thinking', content: 'Hmm' };
    const existingAI: EnhancedAIChunk = {
      ...makeAIChunk([makeMsg({ uuid: 'e1' })]),
      type: 'ai',
      semanticSteps: [step],
      subagents: [],
    };
    const newAI = makeAIChunk([makeMsg({ uuid: 'n1' })]);

    const existing = makeSession({ chunks: [existingAI as Chunk] });
    const update = makeUpdate({ newChunks: [newAI] });

    const result = mergeIncrementalUpdate(existing, update);

    const merged = result.chunks[0] as EnhancedAIChunk;
    expect(merged.semanticSteps).toHaveLength(1);
    expect(merged.semanticSteps[0]).toBe(step);
  });

  it('preserves semanticSteps when only new chunk has them', () => {
    const step: SemanticStep = { type: 'output', content: 'Result' };
    const existingAI = makeAIChunk([makeMsg({ uuid: 'e1' })]);
    const newAI: EnhancedAIChunk = {
      ...makeAIChunk([makeMsg({ uuid: 'n1' })]),
      type: 'ai',
      semanticSteps: [step],
      subagents: [],
    };

    const existing = makeSession({ chunks: [existingAI] });
    const update = makeUpdate({ newChunks: [newAI as Chunk] });

    const result = mergeIncrementalUpdate(existing, update);

    const merged = result.chunks[0] as EnhancedAIChunk;
    expect(merged.semanticSteps).toHaveLength(1);
    expect(merged.semanticSteps[0]).toBe(step);
  });

  it('concatenates subagents from both AI chunks in boundary merge', () => {
    const subagentA = {
      id: 'sa-1', filePath: '/tmp/a.jsonl', messages: [],
      startTime: new Date(), endTime: new Date(), durationMs: 100,
      metrics: makeMetrics(), isParallel: false,
    } as Process;
    const subagentB = {
      id: 'sa-2', filePath: '/tmp/b.jsonl', messages: [],
      startTime: new Date(), endTime: new Date(), durationMs: 200,
      metrics: makeMetrics(), isParallel: false,
    } as Process;

    const existingAI: EnhancedAIChunk = {
      ...makeAIChunk([makeMsg({ uuid: 'e1' })]),
      type: 'ai',
      semanticSteps: [],
      subagents: [subagentA],
    };
    const newAI: EnhancedAIChunk = {
      ...makeAIChunk([makeMsg({ uuid: 'n1' })]),
      type: 'ai',
      semanticSteps: [],
      subagents: [subagentB],
    };

    const existing = makeSession({ chunks: [existingAI as Chunk] });
    const update = makeUpdate({ newChunks: [newAI as Chunk] });

    const result = mergeIncrementalUpdate(existing, update);

    const merged = result.chunks[0] as EnhancedAIChunk;
    expect(merged.subagents).toHaveLength(2);
    expect(merged.subagents[0]).toBe(subagentA);
    expect(merged.subagents[1]).toBe(subagentB);
  });

  it('rehydrates string timestamps to Date objects in incoming chunks', () => {
    // Simulate JSON.stringify → JSON.parse round-trip that turns Dates into strings
    const rawAIChunk = JSON.parse(JSON.stringify(
      makeAIChunk([makeMsg({ uuid: 'rt-1' })]),
    )) as Chunk;
    const rawUserChunk = JSON.parse(JSON.stringify(
      makeUserChunk(),
    )) as Chunk;

    // Verify they are strings after round-trip
    expect(typeof rawAIChunk.timestamp).toBe('string');
    expect(typeof rawUserChunk.timestamp).toBe('string');

    const existing = makeSession({});
    const update = makeUpdate({ newChunks: [rawUserChunk, rawAIChunk] });

    const result = mergeIncrementalUpdate(existing, update);

    // After merge, timestamps should be Date instances
    const userResult = result.chunks[0];
    expect(userResult.timestamp).toBeInstanceOf(Date);
    if (userResult.type === 'user') {
      expect(userResult.message.timestamp).toBeInstanceOf(Date);
    }

    const aiResult = result.chunks[1];
    expect(aiResult.timestamp).toBeInstanceOf(Date);
    if (aiResult.type === 'ai') {
      for (const msg of aiResult.messages) {
        expect(msg.timestamp).toBeInstanceOf(Date);
      }
    }
  });

  it('leaves already-Date timestamps untouched during rehydration', () => {
    const dateObj = new Date('2025-06-15T12:00:00Z');
    const chunk = makeAIChunk([makeMsg({ uuid: 'dt-1', timestamp: dateObj })], { timestamp: dateObj });

    const existing = makeSession({});
    const update = makeUpdate({ newChunks: [chunk] });

    const result = mergeIncrementalUpdate(existing, update);

    expect(result.chunks[0].timestamp).toBeInstanceOf(Date);
    expect((result.chunks[0].timestamp as Date).toISOString()).toBe('2025-06-15T12:00:00.000Z');
  });
});
