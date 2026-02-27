import { describe, it, expect } from 'vitest';
import { buildDisplayItems, buildDisplayItemsFromMessages, extractTeammateMessages, extractSlashCommands } from '../../src/client/utils/display-item-builder.js';
import type { SemanticStep, ParsedMessage, Process } from '../../src/server/types/jsonl.js';
import type { AIGroupLastOutput, SlashItem } from '../../src/client/types/groups.js';
import { defaultMetrics, createTestProcess } from './test-helpers.js';

function makeStep(overrides: Partial<SemanticStep> = {}): SemanticStep {
  return {
    type: 'output',
    content: '',
    ...overrides,
  };
}

function makeMsg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    uuid: 'msg-' + Math.random().toString(36).slice(2, 8),
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

function makeProcess(overrides: Partial<Process> = {}): Process {
  return createTestProcess({
    startTime: new Date('2025-01-01T00:00:00Z'),
    endTime: new Date('2025-01-01T00:01:00Z'),
    durationMs: 60000,
    ...overrides,
  });
}

describe('buildDisplayItems', () => {
  it('returns empty items for no steps', () => {
    const { items, linkedTools } = buildDisplayItems([], null, [], []);
    expect(items).toHaveLength(0);
    expect(linkedTools.size).toBe(0);
  });

  it('includes thinking items with token count', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'thinking', content: 'Let me think about this...' }),
    ];
    const { items } = buildDisplayItems(steps, null, [], []);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('thinking');
    if (items[0].type === 'thinking') {
      expect(items[0].content).toBe('Let me think about this...');
      expect(items[0].tokenCount).toBeGreaterThan(0);
    }
  });

  it('includes output items', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'output', content: 'Here is the answer' }),
    ];
    const { items } = buildDisplayItems(steps, null, [], []);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('output');
  });

  it('skips lastOutput step from display items (text match)', () => {
    const lastOutput: AIGroupLastOutput = {
      type: 'text',
      text: 'Final answer',
      timestamp: new Date(),
    };
    const steps: SemanticStep[] = [
      makeStep({ type: 'thinking', content: 'pondering' }),
      makeStep({ type: 'output', content: 'Final answer' }),
    ];
    const { items } = buildDisplayItems(steps, lastOutput, [], []);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('thinking');
  });

  it('skips Task tool calls that have associated subagents', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolCallId: 'tc-task', toolName: 'Task', content: 'Task' }),
      makeStep({ type: 'tool_result', toolCallId: 'tc-task', content: 'done' }),
    ];
    const messages = [
      makeMsg({
        toolCalls: [{ id: 'tc-task', name: 'Task', input: { description: 'test' }, isTask: true }],
      }),
      makeMsg({
        type: 'user',
        isMeta: true,
        toolResults: [{ toolUseId: 'tc-task', content: 'done', isError: false }],
      }),
    ];
    const processes = [makeProcess({ parentTaskId: 'tc-task' })];

    const { items } = buildDisplayItems(steps, null, processes, messages);
    // Task tool should be skipped, but subagent should not be present either since no subagent step
    const toolItems = items.filter((i) => i.type === 'tool');
    expect(toolItems).toHaveLength(0);
  });

  it('links tool calls correctly', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_call', toolCallId: 'tc-read', toolName: 'Read', content: 'Read' }),
      makeStep({ type: 'tool_result', toolCallId: 'tc-read', content: 'file data' }),
    ];
    const messages = [
      makeMsg({
        toolCalls: [{ id: 'tc-read', name: 'Read', input: { file_path: '/test' }, isTask: false }],
      }),
      makeMsg({
        type: 'user',
        isMeta: true,
        toolResults: [{ toolUseId: 'tc-read', content: 'file data', isError: false }],
      }),
    ];

    const { items, linkedTools } = buildDisplayItems(steps, null, [], messages);
    expect(linkedTools.size).toBe(1);
    expect(linkedTools.get('tc-read')!.name).toBe('Read');
    const toolItems = items.filter((i) => i.type === 'tool');
    expect(toolItems).toHaveLength(1);
  });

  it('includes subagent items', () => {
    const process = makeProcess({ id: 'sub-1' });
    const steps: SemanticStep[] = [
      makeStep({ type: 'subagent', content: 'subagent run', subagentId: 'sub-1' }),
    ];

    const { items } = buildDisplayItems(steps, null, [process], []);
    const subItems = items.filter((i) => i.type === 'subagent');
    expect(subItems).toHaveLength(1);
  });

  it('no longer produces interruption steps (filtered as hardNoise before reaching display)', () => {
    // Interruption messages are now classified as hardNoise and never reach
    // the display item builder. Only standard step types are handled.
    const steps: SemanticStep[] = [
      makeStep({ type: 'output', content: 'Some output text' }),
    ];
    const { items } = buildDisplayItems(steps, null, [], []);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('output');
  });

  it('items preserve step order (no re-sorting)', () => {
    // Create messages that produce teammate messages with different timestamps
    const messages = [
      makeMsg({
        type: 'user',
        isMeta: false,
        timestamp: new Date('2025-01-01T00:02:00Z'),
        content: '<teammate-message teammate-id="tm1">Hello</teammate-message>',
      }),
    ];
    const steps: SemanticStep[] = [
      makeStep({ type: 'thinking', content: 'hmm' }),
      makeStep({ type: 'output', content: 'response' }),
    ];

    const { items } = buildDisplayItems(steps, null, [], messages);
    // Items from steps should appear in step order, followed by appended items
    // (teammate messages, slash commands)
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].type).toBe('thinking');
    expect(items[1].type).toBe('output');
    // Teammate message is appended after step items
    const tmItems = items.filter((i) => i.type === 'teammate_message');
    expect(tmItems).toHaveLength(1);
  });
});

describe('extractTeammateMessages', () => {
  it('extracts teammate messages from XML blocks', () => {
    const messages = [
      makeMsg({
        type: 'user',
        isMeta: false,
        content: '<teammate-message teammate-id="agent-1" color="blue" summary="Status update">Task complete</teammate-message>',
      }),
    ];

    const result = extractTeammateMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].teammateId).toBe('agent-1');
    expect(result[0].color).toBe('blue');
    expect(result[0].summary).toBe('Status update');
    expect(result[0].content).toBe('Task complete');
  });

  it('skips isMeta messages', () => {
    const messages = [
      makeMsg({
        type: 'user',
        isMeta: true,
        content: '<teammate-message teammate-id="agent-1">Hello</teammate-message>',
      }),
    ];
    expect(extractTeammateMessages(messages)).toHaveLength(0);
  });

  it('skips non-user messages', () => {
    const messages = [
      makeMsg({
        type: 'assistant',
        content: '<teammate-message teammate-id="agent-1">Hello</teammate-message>',
      }),
    ];
    expect(extractTeammateMessages(messages)).toHaveLength(0);
  });

  it('handles multiple teammate messages in one message', () => {
    const messages = [
      makeMsg({
        type: 'user',
        isMeta: false,
        content: '<teammate-message teammate-id="a1">First</teammate-message>\n<teammate-message teammate-id="a2">Second</teammate-message>',
      }),
    ];
    const result = extractTeammateMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].teammateId).toBe('a1');
    expect(result[1].teammateId).toBe('a2');
  });

  it('returns empty for no teammate messages', () => {
    const messages = [
      makeMsg({ type: 'user', isMeta: false, content: 'Just a normal message' }),
    ];
    expect(extractTeammateMessages(messages)).toHaveLength(0);
  });
});

describe('extractSlashCommands', () => {
  it('strategy 1: uses provided precedingSlash directly', () => {
    const precedingSlash: SlashItem = {
      id: 'slash-1',
      name: 'commit',
      args: '-m "fix"',
      timestamp: new Date('2025-01-01'),
    };

    const result = extractSlashCommands([], precedingSlash);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('commit');
  });

  it('strategy 1: attaches instructions from isMeta messages', () => {
    const precedingSlash: SlashItem = {
      id: 'slash-1',
      name: 'commit',
      timestamp: new Date('2025-01-01'),
    };
    const messages = [
      makeMsg({
        isMeta: true,
        content: 'Base directory for this skill: /home/user/project',
      }),
    ];

    const result = extractSlashCommands(messages, precedingSlash);
    expect(result[0].instructions).toBe('Base directory for this skill: /home/user/project');
    expect(result[0].instructionsTokenCount).toBeGreaterThan(0);
  });

  it('strategy 2: scans responses for command-name XML blocks', () => {
    const messages = [
      makeMsg({
        type: 'user',
        isMeta: false,
        uuid: 'user-msg-1',
        content: '<command-name>review-pr</command-name>',
      }),
    ];

    const result = extractSlashCommands(messages);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('review-pr');
    expect(result[0].commandMessageUuid).toBe('user-msg-1');
  });

  it('returns empty for no slash commands', () => {
    const messages = [
      makeMsg({ type: 'user', isMeta: false, content: 'No commands here' }),
    ];
    expect(extractSlashCommands(messages)).toHaveLength(0);
  });
});

describe('buildDisplayItemsFromMessages', () => {
  it('handles thinking blocks from assistant messages', () => {
    const messages = [
      makeMsg({
        type: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I need to think about this', signature: 'sig' },
          { type: 'text', text: 'Here is my answer' },
        ],
      }),
    ];

    const items = buildDisplayItemsFromMessages(messages);
    const thinkingItems = items.filter((i) => i.type === 'thinking');
    const outputItems = items.filter((i) => i.type === 'output');
    expect(thinkingItems).toHaveLength(1);
    expect(outputItems).toHaveLength(1);
  });

  it('handles compact boundary entries', () => {
    const messages = [
      makeMsg({
        type: 'summary',
        isCompactSummary: true,
        content: 'Previous conversation was compacted',
        timestamp: new Date('2025-01-01T01:00:00Z'),
      }),
    ];

    const items = buildDisplayItemsFromMessages(messages);
    const compactItems = items.filter((i) => i.type === 'compact_boundary');
    expect(compactItems).toHaveLength(1);
    if (compactItems[0].type === 'compact_boundary') {
      expect(compactItems[0].content).toBe('Previous conversation was compacted');
    }
  });

  it('links tool_use blocks to tool_result messages', () => {
    const messages = [
      makeMsg({
        type: 'assistant',
        timestamp: new Date('2025-01-01T00:00:00Z'),
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/test' } },
        ],
        toolCalls: [{ id: 'tu-1', name: 'Read', input: { file_path: '/test' }, isTask: false }],
      }),
      makeMsg({
        type: 'user',
        isMeta: true,
        timestamp: new Date('2025-01-01T00:00:05Z'),
        toolResults: [{ toolUseId: 'tu-1', content: 'file content', isError: false }],
      }),
    ];

    const items = buildDisplayItemsFromMessages(messages);
    const toolItems = items.filter((i) => i.type === 'tool');
    expect(toolItems).toHaveLength(1);
    if (toolItems[0].type === 'tool') {
      expect(toolItems[0].tool.name).toBe('Read');
      expect(toolItems[0].tool.isOrphaned).toBe(false);
    }
  });

  it('returns empty for empty messages', () => {
    expect(buildDisplayItemsFromMessages([])).toHaveLength(0);
  });

  it('skips Task tools with associated subagents', () => {
    const subagent = makeProcess({ parentTaskId: 'tu-task' });
    const messages = [
      makeMsg({
        type: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-task', name: 'Task', input: { description: 'test' } },
        ],
        toolCalls: [{ id: 'tu-task', name: 'Task', input: { description: 'test' }, isTask: true }],
      }),
      makeMsg({
        type: 'user',
        isMeta: true,
        toolResults: [{ toolUseId: 'tu-task', content: 'done', isError: false }],
      }),
    ];

    const items = buildDisplayItemsFromMessages(messages, [subagent]);
    const toolItems = items.filter((i) => i.type === 'tool');
    // Task tool should be skipped
    expect(toolItems).toHaveLength(0);
    // But subagent should appear
    const subItems = items.filter((i) => i.type === 'subagent');
    expect(subItems).toHaveLength(1);
  });
});

// Helper to extract timestamp from display item for sorting validation
function getItemTimestamp(item: any): Date {
  if (item.timestamp) return item.timestamp;
  if (item.tool?.startTime) return item.tool.startTime;
  if (item.subagent?.startTime) return item.subagent.startTime;
  if (item.slash?.timestamp) return item.slash.timestamp;
  if (item.teammateMessage?.timestamp) return item.teammateMessage.timestamp;
  return new Date(0);
}
