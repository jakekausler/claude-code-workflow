import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { SessionPipeline } from '../../../src/server/services/session-pipeline.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures');

describe('SessionPipeline', () => {
  it('produces a complete ParsedSession from simple-conversation.jsonl', async () => {
    const pipeline = new SessionPipeline();
    const session = await pipeline.parseSession(fixturesDir, 'simple-conversation');

    // All top-level fields present
    expect(session).toHaveProperty('chunks');
    expect(session).toHaveProperty('metrics');
    expect(session).toHaveProperty('subagents');
    expect(session).toHaveProperty('isOngoing');

    // Chunks: simple-conversation has 4 messages (u1, a1, u2, a2)
    // buildChunks produces UserChunk, AIChunk, UserChunk, AIChunk
    expect(session.chunks.length).toBe(4);
    expect(session.chunks[0].type).toBe('user');
    expect(session.chunks[1].type).toBe('ai');
    expect(session.chunks[2].type).toBe('user');
    expect(session.chunks[3].type).toBe('ai');

    // Metrics should aggregate token usage from the two assistant messages
    // a1: input_tokens=100, output_tokens=20
    // a2: input_tokens=150, output_tokens=30
    expect(session.metrics.inputTokens).toBe(250);
    expect(session.metrics.outputTokens).toBe(50);
    expect(session.metrics.totalTokens).toBe(300);
    expect(session.metrics.turnCount).toBe(2);
    expect(session.metrics.toolCallCount).toBe(0); // no tool calls in simple-conversation

    // Duration: last timestamp - first timestamp = 12000ms
    expect(session.metrics.duration).toBe(12000);

    // No subagents in fixtures directory for this session
    expect(session.subagents).toEqual([]);

    // Last message is assistant → not ongoing
    expect(session.isOngoing).toBe(false);
  });

  it('returns the same object reference on second call (cache hit)', async () => {
    const pipeline = new SessionPipeline();
    const first = await pipeline.parseSession(fixturesDir, 'simple-conversation');
    const second = await pipeline.parseSession(fixturesDir, 'simple-conversation');

    // toBe checks reference equality
    expect(second).toBe(first);
  });

  it('returns a different object after invalidateSession()', async () => {
    const pipeline = new SessionPipeline();
    const first = await pipeline.parseSession(fixturesDir, 'simple-conversation');

    pipeline.invalidateSession(fixturesDir, 'simple-conversation');

    const second = await pipeline.parseSession(fixturesDir, 'simple-conversation');

    // After invalidation, a fresh parse produces a new object
    expect(second).not.toBe(first);
    // But data should be structurally equivalent
    expect(second).toEqual(first);
  });

  it('getMetrics() returns SessionMetrics with expected shape', async () => {
    const pipeline = new SessionPipeline();
    const metrics = await pipeline.getMetrics(fixturesDir, 'simple-conversation');

    expect(metrics).toHaveProperty('totalTokens');
    expect(metrics).toHaveProperty('inputTokens');
    expect(metrics).toHaveProperty('outputTokens');
    expect(metrics).toHaveProperty('cacheReadTokens');
    expect(metrics).toHaveProperty('cacheCreationTokens');
    expect(metrics).toHaveProperty('totalCost');
    expect(metrics).toHaveProperty('turnCount');
    expect(metrics).toHaveProperty('toolCallCount');
    expect(metrics).toHaveProperty('duration');

    expect(typeof metrics.totalTokens).toBe('number');
    expect(typeof metrics.duration).toBe('number');
    expect(metrics.totalTokens).toBeGreaterThan(0);
    expect(metrics.duration).toBeGreaterThan(0);
  });

  it('handles empty sessions with zero metrics', async () => {
    const pipeline = new SessionPipeline();
    const session = await pipeline.parseSession(fixturesDir, 'empty');

    expect(session.chunks).toEqual([]);
    expect(session.subagents).toEqual([]);
    expect(session.isOngoing).toBe(false);

    expect(session.metrics.totalTokens).toBe(0);
    expect(session.metrics.inputTokens).toBe(0);
    expect(session.metrics.outputTokens).toBe(0);
    expect(session.metrics.cacheReadTokens).toBe(0);
    expect(session.metrics.cacheCreationTokens).toBe(0);
    expect(session.metrics.totalCost).toBe(0);
    expect(session.metrics.turnCount).toBe(0);
    expect(session.metrics.toolCallCount).toBe(0);
    expect(session.metrics.duration).toBe(0);
  });

  it('counts tool executions in tool-calls.jsonl', async () => {
    const pipeline = new SessionPipeline();
    const session = await pipeline.parseSession(fixturesDir, 'tool-calls');

    // tool-calls.jsonl has 3 tool call/result pairs: Bash, Read, Edit
    expect(session.metrics.toolCallCount).toBe(3);
    expect(session.metrics.turnCount).toBe(4); // 4 assistant messages

    // Last message is assistant → not ongoing
    expect(session.isOngoing).toBe(false);
  });

  it('produces a valid empty ParsedSession for a non-existent file', async () => {
    const pipeline = new SessionPipeline();
    const session = await pipeline.parseSession('/nonexistent', 'missing');

    expect(session.chunks).toEqual([]);
    expect(session.subagents).toEqual([]);
    expect(session.isOngoing).toBe(false);

    expect(session.metrics.totalTokens).toBe(0);
    expect(session.metrics.inputTokens).toBe(0);
    expect(session.metrics.outputTokens).toBe(0);
    expect(session.metrics.cacheReadTokens).toBe(0);
    expect(session.metrics.cacheCreationTokens).toBe(0);
    expect(session.metrics.totalCost).toBe(0);
    expect(session.metrics.turnCount).toBe(0);
    expect(session.metrics.toolCallCount).toBe(0);
    expect(session.metrics.duration).toBe(0);
  });

  it('attaches semanticSteps to AI chunks after pipeline processing', async () => {
    const pipeline = new SessionPipeline();
    const session = await pipeline.parseSession(fixturesDir, 'tool-calls');

    const aiChunks = session.chunks.filter((c) => c.type === 'ai');
    expect(aiChunks.length).toBeGreaterThan(0);

    const firstAI = aiChunks[0] as unknown as { semanticSteps: unknown };
    expect(firstAI).toHaveProperty('semanticSteps');
    expect(Array.isArray(firstAI.semanticSteps)).toBe(true);
  });

  it('handles compact-summary.jsonl with compaction chunks', async () => {
    const pipeline = new SessionPipeline();
    const session = await pipeline.parseSession(fixturesDir, 'compact-summary');

    // compact-summary has: user, assistant, summary, user, assistant
    // buildChunks produces: UserChunk, AIChunk, CompactChunk, UserChunk, AIChunk
    const types = session.chunks.map((c) => c.type);
    expect(types).toContain('compact');
    expect(session.chunks.length).toBe(5);
  });
});
