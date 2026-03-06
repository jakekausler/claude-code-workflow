import { describe, it, expect } from 'vitest';
import { buildSummary } from '../../src/client/utils/display-summary.js';
import type { AIGroupDisplayItem } from '../../src/client/types/groups.js';
import type { Process } from '../../src/server/types/jsonl.js';
import { defaultMetrics, createTestProcess } from './test-helpers.js';

function makeProcess(overrides: Partial<Process> = {}): Process {
  return createTestProcess({
    ...overrides,
  });
}

describe('buildSummary', () => {
  it('returns "No items" for empty array', () => {
    expect(buildSummary([])).toBe('No items');
  });

  it('returns "1 tool call" for single tool', () => {
    const items: AIGroupDisplayItem[] = [
      {
        type: 'tool',
        tool: {
          id: 't1', name: 'Read', input: {}, inputPreview: '{}',
          startTime: new Date(), isOrphaned: false,
        },
      },
    ];
    expect(buildSummary(items)).toBe('1 tool call');
  });

  it('pluralizes tool calls correctly', () => {
    const items: AIGroupDisplayItem[] = [
      {
        type: 'tool',
        tool: {
          id: 't1', name: 'Read', input: {}, inputPreview: '{}',
          startTime: new Date(), isOrphaned: false,
        },
      },
      {
        type: 'tool',
        tool: {
          id: 't2', name: 'Edit', input: {}, inputPreview: '{}',
          startTime: new Date(), isOrphaned: false,
        },
      },
    ];
    expect(buildSummary(items)).toBe('2 tool calls');
  });

  it('handles mixed item types', () => {
    const items: AIGroupDisplayItem[] = [
      { type: 'thinking', content: 'hmm', timestamp: new Date(), tokenCount: 10 },
      { type: 'thinking', content: 'hmm2', timestamp: new Date(), tokenCount: 10 },
      {
        type: 'tool',
        tool: {
          id: 't1', name: 'Read', input: {}, inputPreview: '{}',
          startTime: new Date(), isOrphaned: false,
        },
      },
      { type: 'output', content: 'hello', timestamp: new Date() },
    ];
    expect(buildSummary(items)).toBe('2 thinking, 1 tool call, 1 message');
  });

  it('counts team subagents by unique memberName', () => {
    const items: AIGroupDisplayItem[] = [
      {
        type: 'subagent',
        subagent: makeProcess({
          id: 'p1',
          team: { teamName: 'team1', memberName: 'Alice', memberColor: 'blue' },
        }),
      },
      {
        type: 'subagent',
        subagent: makeProcess({
          id: 'p2',
          team: { teamName: 'team1', memberName: 'Alice', memberColor: 'blue' },
        }),
      },
      {
        type: 'subagent',
        subagent: makeProcess({
          id: 'p3',
          team: { teamName: 'team1', memberName: 'Bob', memberColor: 'red' },
        }),
      },
    ];
    expect(buildSummary(items)).toBe('2 teammates');
  });

  it('counts regular subagents (no team property) separately', () => {
    const items: AIGroupDisplayItem[] = [
      {
        type: 'subagent',
        subagent: makeProcess({ id: 'p1' }),
      },
      {
        type: 'subagent',
        subagent: makeProcess({ id: 'p2' }),
      },
    ];
    expect(buildSummary(items)).toBe('2 subagents');
  });

  it('reports teammate_message items', () => {
    const items: AIGroupDisplayItem[] = [
      {
        type: 'teammate_message',
        teammateMessage: {
          teammateId: 'tm1', content: 'hello', timestamp: new Date(),
        },
      },
    ];
    expect(buildSummary(items)).toBe('1 teammate message');
  });

  it('pluralizes teammate messages', () => {
    const items: AIGroupDisplayItem[] = [
      {
        type: 'teammate_message',
        teammateMessage: { teammateId: 'tm1', content: 'hi', timestamp: new Date() },
      },
      {
        type: 'teammate_message',
        teammateMessage: { teammateId: 'tm2', content: 'hey', timestamp: new Date() },
      },
    ];
    expect(buildSummary(items)).toBe('2 teammate messages');
  });

  it('counts slashes', () => {
    const items: AIGroupDisplayItem[] = [
      {
        type: 'slash',
        slash: { id: 's1', name: 'commit', timestamp: new Date() },
      },
    ];
    expect(buildSummary(items)).toBe('1 slash');
  });

  it('pluralizes slashes correctly', () => {
    const items: AIGroupDisplayItem[] = [
      {
        type: 'slash',
        slash: { id: 's1', name: 'commit', timestamp: new Date() },
      },
      {
        type: 'slash',
        slash: { id: 's2', name: 'review', timestamp: new Date() },
      },
    ];
    expect(buildSummary(items)).toBe('2 slashes');
  });

  it('counts compact boundaries', () => {
    const items: AIGroupDisplayItem[] = [
      {
        type: 'compact_boundary',
        content: 'Summary',
        timestamp: new Date(),
        phaseNumber: 1,
      },
    ];
    expect(buildSummary(items)).toBe('1 compaction');
  });

  it('reports all types together', () => {
    const items: AIGroupDisplayItem[] = [
      { type: 'thinking', content: 'think', timestamp: new Date() },
      {
        type: 'tool',
        tool: {
          id: 't1', name: 'Read', input: {}, inputPreview: '{}',
          startTime: new Date(), isOrphaned: false,
        },
      },
      { type: 'output', content: 'out', timestamp: new Date() },
      {
        type: 'subagent',
        subagent: makeProcess({
          team: { teamName: 'team1', memberName: 'Alice', memberColor: 'blue' },
        }),
      },
      {
        type: 'subagent',
        subagent: makeProcess({ id: 'p2' }),
      },
      {
        type: 'teammate_message',
        teammateMessage: { teammateId: 'tm1', content: 'hi', timestamp: new Date() },
      },
      {
        type: 'slash',
        slash: { id: 's1', name: 'commit', timestamp: new Date() },
      },
      {
        type: 'compact_boundary',
        content: 'Summary',
        timestamp: new Date(),
        phaseNumber: 1,
      },
    ];
    const result = buildSummary(items);
    expect(result).toBe('1 thinking, 1 tool call, 1 message, 1 teammate, 1 subagent, 1 teammate message, 1 slash, 1 compaction');
  });

  it('uses singular form for count of 1', () => {
    const items: AIGroupDisplayItem[] = [
      { type: 'output', content: 'hello', timestamp: new Date() },
    ];
    expect(buildSummary(items)).toBe('1 message');
  });

  it('uses plural form for count > 1', () => {
    const items: AIGroupDisplayItem[] = [
      { type: 'output', content: 'hello', timestamp: new Date() },
      { type: 'output', content: 'world', timestamp: new Date() },
    ];
    expect(buildSummary(items)).toBe('2 messages');
  });
});
