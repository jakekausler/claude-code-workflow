import { describe, it, expect } from 'vitest';
import { linkToolCallsToResults, estimateTokens } from '../../src/client/utils/tool-linking-engine.js';
import type { SemanticStep, ParsedMessage } from '../../src/server/types/jsonl.js';

function makeStep(overrides: Partial<SemanticStep> = {}): SemanticStep {
  return {
    type: 'tool_call',
    content: 'Read',
    ...overrides,
  };
}

function makeMsg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    uuid: 'msg-1',
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

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(estimateTokens(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('estimates 1 token for 1-4 chars', () => {
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('estimates Math.ceil(length / 4)', () => {
    expect(estimateTokens('hello')).toBe(2); // 5 / 4 = 1.25 -> ceil = 2
    expect(estimateTokens('12345678')).toBe(2); // 8 / 4 = 2
    expect(estimateTokens('123456789')).toBe(3); // 9 / 4 = 2.25 -> ceil = 3
  });

  it('handles long text', () => {
    const text = 'x'.repeat(1000);
    expect(estimateTokens(text)).toBe(250);
  });
});

describe('linkToolCallsToResults', () => {
  it('links a tool_call step to matching tool_result step by ID', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolCallId: 'tc-1', toolName: 'Read', content: 'Read' }),
      makeStep({ type: 'tool_result', toolCallId: 'tc-1', content: 'file content' }),
    ];
    const messages = [
      makeMsg({
        toolCalls: [{ id: 'tc-1', name: 'Read', input: { file_path: '/test' }, isTask: false }],
      }),
      makeMsg({
        type: 'user',
        isMeta: true,
        toolResults: [{ toolUseId: 'tc-1', content: 'file content', isError: false }],
      }),
    ];

    const result = linkToolCallsToResults(steps, messages);
    expect(result.size).toBe(1);

    const linked = result.get('tc-1')!;
    expect(linked.name).toBe('Read');
    expect(linked.input).toEqual({ file_path: '/test' });
    expect(linked.isOrphaned).toBe(false);
    expect(linked.result).toBeDefined();
    expect(linked.result!.isError).toBe(false);
  });

  it('marks orphaned tool_call (no matching result) with isOrphaned: true', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolCallId: 'tc-2', toolName: 'Bash', content: 'Bash' }),
    ];
    const messages = [
      makeMsg({
        toolCalls: [{ id: 'tc-2', name: 'Bash', input: { command: 'ls' }, isTask: false }],
      }),
    ];

    const result = linkToolCallsToResults(steps, messages);
    const linked = result.get('tc-2')!;
    expect(linked.isOrphaned).toBe(true);
    expect(linked.result).toBeUndefined();
  });

  it('extracts skill instructions from isMeta messages with sourceToolUseID', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolCallId: 'tc-skill', toolName: 'Skill', content: 'Skill' }),
      makeStep({ type: 'tool_result', toolCallId: 'tc-skill', content: 'skill loaded' }),
    ];
    const messages = [
      makeMsg({
        toolCalls: [{ id: 'tc-skill', name: 'Skill', input: { skill: 'commit' }, isTask: false }],
      }),
      makeMsg({
        type: 'user',
        isMeta: true,
        sourceToolUseID: 'tc-skill',
        content: 'Base directory for this skill: /home/user/project',
        toolResults: [{ toolUseId: 'tc-skill', content: 'skill loaded', isError: false }],
      }),
    ];

    const result = linkToolCallsToResults(steps, messages);
    const linked = result.get('tc-skill')!;
    expect(linked.skillInstructions).toBe('Base directory for this skill: /home/user/project');
    expect(linked.skillInstructionsTokenCount).toBeGreaterThan(0);
  });

  it('links multiple tool calls correctly', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolCallId: 'tc-a', toolName: 'Read', content: 'Read' }),
      makeStep({ type: 'tool_result', toolCallId: 'tc-a', content: 'content a' }),
      makeStep({ type: 'tool_call', toolCallId: 'tc-b', toolName: 'Edit', content: 'Edit' }),
      makeStep({ type: 'tool_result', toolCallId: 'tc-b', content: 'content b' }),
    ];
    const messages = [
      makeMsg({
        toolCalls: [
          { id: 'tc-a', name: 'Read', input: { file_path: '/a' }, isTask: false },
          { id: 'tc-b', name: 'Edit', input: { file_path: '/b' }, isTask: false },
        ],
      }),
      makeMsg({
        type: 'user',
        isMeta: true,
        toolResults: [
          { toolUseId: 'tc-a', content: 'content a', isError: false },
          { toolUseId: 'tc-b', content: 'content b', isError: false },
        ],
      }),
    ];

    const result = linkToolCallsToResults(steps, messages);
    expect(result.size).toBe(2);
    expect(result.get('tc-a')!.name).toBe('Read');
    expect(result.get('tc-b')!.name).toBe('Edit');
    expect(result.get('tc-a')!.isOrphaned).toBe(false);
    expect(result.get('tc-b')!.isOrphaned).toBe(false);
  });

  it('computes duration from timestamps when available', () => {
    const t1 = new Date('2025-01-01T00:00:00Z');
    const t2 = new Date('2025-01-01T00:00:05Z');
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolCallId: 'tc-dur', toolName: 'Bash', content: 'Bash' }),
      makeStep({ type: 'tool_result', toolCallId: 'tc-dur', content: 'done' }),
    ];
    const messages = [
      makeMsg({
        timestamp: t1,
        toolCalls: [{ id: 'tc-dur', name: 'Bash', input: { command: 'ls' }, isTask: false }],
      }),
      makeMsg({
        type: 'user',
        timestamp: t2,
        isMeta: true,
        toolResults: [{ toolUseId: 'tc-dur', content: 'done', isError: false }],
      }),
    ];

    const result = linkToolCallsToResults(steps, messages);
    const linked = result.get('tc-dur')!;
    expect(linked.durationMs).toBe(5000);
  });

  it('uses step durationMs when available (takes priority over computed)', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolCallId: 'tc-x', toolName: 'Read', content: 'Read', durationMs: 1234 }),
      makeStep({ type: 'tool_result', toolCallId: 'tc-x', content: 'ok' }),
    ];
    const messages = [
      makeMsg({
        toolCalls: [{ id: 'tc-x', name: 'Read', input: {}, isTask: false }],
      }),
    ];

    const result = linkToolCallsToResults(steps, messages);
    expect(result.get('tc-x')!.durationMs).toBe(1234);
  });

  it('skips steps without toolCallId', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolName: 'Read', content: 'Read' }), // no toolCallId
    ];
    const messages: ParsedMessage[] = [];
    const result = linkToolCallsToResults(steps, messages);
    expect(result.size).toBe(0);
  });

  it('returns empty map for empty steps', () => {
    const result = linkToolCallsToResults([], []);
    expect(result.size).toBe(0);
  });

  it('computes callTokens from tool name + input', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolCallId: 'tc-tok', toolName: 'Read', content: 'Read' }),
    ];
    const messages = [
      makeMsg({
        toolCalls: [{ id: 'tc-tok', name: 'Read', input: { file_path: '/test.ts' }, isTask: false }],
      }),
    ];

    const result = linkToolCallsToResults(steps, messages);
    const linked = result.get('tc-tok')!;
    expect(linked.callTokens).toBeGreaterThan(0);
    // callTokens = estimateTokens('Read' + JSON.stringify({file_path: '/test.ts'}))
    const expectedText = 'Read' + JSON.stringify({ file_path: '/test.ts' });
    expect(linked.callTokens).toBe(Math.ceil(expectedText.length / 4));
  });
});
