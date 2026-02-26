import { describe, it, expect } from 'vitest';
import { enhanceAIGroup } from '../../src/client/utils/ai-group-enhancer.js';
import type { AIGroup, SlashItem } from '../../src/client/types/groups.js';
import type { SemanticStep, ParsedMessage, Process } from '../../src/server/types/jsonl.js';
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

function makeAIGroup(overrides: Partial<AIGroup> = {}): AIGroup {
  return {
    id: 'ai-group-1',
    turnIndex: 0,
    startTime: new Date('2025-01-01T00:00:00Z'),
    endTime: new Date('2025-01-01T00:01:00Z'),
    durationMs: 60000,
    steps: [],
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150 },
    summary: {
      thinkingPreview: undefined,
      toolCallCount: 0,
      outputMessageCount: 0,
      subagentCount: 0,
      totalDurationMs: 60000,
      totalTokens: 150,
      outputTokens: 50,
      cachedTokens: 0,
    },
    status: 'complete',
    processes: [],
    chunkId: 'chunk-1',
    responses: [],
    ...overrides,
  };
}

describe('enhanceAIGroup', () => {
  it('produces EnhancedAIGroup with all fields populated', () => {
    const group = makeAIGroup({
      steps: [
        makeStep({ type: 'thinking', content: 'Let me consider this...' }),
        makeStep({ type: 'output', content: 'Here is my response.' }),
      ],
      responses: [
        makeMsg({ model: 'claude-sonnet-4-5-20250929' }),
      ],
    });

    const result = enhanceAIGroup(group, { paths: ['/project/.claude/CLAUDE.md'], totalTokens: 500 });

    // All EnhancedAIGroup fields present
    expect(result.lastOutput).not.toBeUndefined();
    expect(result.displayItems).toBeInstanceOf(Array);
    expect(result.linkedTools).toBeInstanceOf(Map);
    expect(typeof result.itemsSummary).toBe('string');
    expect(result.mainModel).not.toBeUndefined();
    expect(result.subagentModels).toBeInstanceOf(Array);
    expect(result.claudeMdStats).not.toBeNull();

    // Original AIGroup fields preserved
    expect(result.id).toBe('ai-group-1');
    expect(result.turnIndex).toBe(0);
    expect(result.tokens.total).toBe(150);
  });

  it('detects lastOutput from the last output step', () => {
    const group = makeAIGroup({
      steps: [
        makeStep({ type: 'thinking', content: 'Analyzing...' }),
        makeStep({ type: 'output', content: 'Final answer here.' }),
      ],
    });

    const result = enhanceAIGroup(group);
    expect(result.lastOutput).not.toBeNull();
    expect(result.lastOutput!.type).toBe('text');
    expect(result.lastOutput!.text).toBe('Final answer here.');
  });

  it('builds displayItems from steps (excluding lastOutput step)', () => {
    const group = makeAIGroup({
      steps: [
        makeStep({ type: 'thinking', content: 'pondering' }),
        makeStep({ type: 'output', content: 'intermediate text' }),
        makeStep({ type: 'output', content: 'final text' }),
      ],
    });

    const result = enhanceAIGroup(group);

    // lastOutput = 'final text' (last output step), so it's excluded from displayItems
    // displayItems should contain: 1 thinking + 1 output ('intermediate text')
    expect(result.lastOutput!.text).toBe('final text');
    const thinkingItems = result.displayItems.filter((i) => i.type === 'thinking');
    const outputItems = result.displayItems.filter((i) => i.type === 'output');
    expect(thinkingItems).toHaveLength(1);
    expect(outputItems).toHaveLength(1);
    if (outputItems[0].type === 'output') {
      expect(outputItems[0].content).toBe('intermediate text');
    }
  });

  it('generates correct itemsSummary string', () => {
    const group = makeAIGroup({
      steps: [
        makeStep({ type: 'thinking', content: 'think 1' }),
        makeStep({ type: 'thinking', content: 'think 2' }),
        makeStep({ type: 'output', content: 'message 1' }),
        makeStep({ type: 'output', content: 'message 2 - last' }),
      ],
    });

    const result = enhanceAIGroup(group);

    // lastOutput = 'message 2 - last' (excluded), so display has: 2 thinking, 1 message
    expect(result.itemsSummary).toBe('2 thinking, 1 message');
  });

  it('extracts mainModel from responses', () => {
    const group = makeAIGroup({
      steps: [makeStep({ type: 'output', content: 'hello' })],
      responses: [
        makeMsg({ model: 'claude-sonnet-4-5-20250929' }),
        makeMsg({ model: 'claude-sonnet-4-5-20250929' }),
      ],
    });

    const result = enhanceAIGroup(group);
    expect(result.mainModel).not.toBeNull();
    expect(result.mainModel!.family).toBe('sonnet');
    expect(result.mainModel!.majorVersion).toBe(4);
    expect(result.mainModel!.minorVersion).toBe(5);
  });

  it('extracts subagentModels and deduplicates against mainModel', () => {
    const subProc = makeProcess({
      id: 'sub-1',
      messages: [
        makeMsg({ model: 'claude-haiku-3-5-20250929' }),
      ],
    });

    const group = makeAIGroup({
      steps: [makeStep({ type: 'output', content: 'hello' })],
      responses: [
        makeMsg({ model: 'claude-sonnet-4-5-20250929' }),
      ],
      processes: [subProc],
    });

    const result = enhanceAIGroup(group);
    expect(result.subagentModels).toHaveLength(1);
    expect(result.subagentModels[0].family).toBe('haiku');
  });

  it('attaches mainSessionImpact to processes with parentTaskId', () => {
    const toolCallId = 'task-tool-1';
    const subProc = makeProcess({
      id: 'sub-1',
      parentTaskId: toolCallId,
      messages: [],
    });

    const steps: SemanticStep[] = [
      makeStep({
        type: 'tool_call',
        toolCallId: toolCallId,
        toolName: 'Task',
        content: 'Run analysis',
      }),
      makeStep({
        type: 'tool_result',
        toolCallId: toolCallId,
        toolName: 'Task',
        content: 'Analysis done with results: all tests passed.',
      }),
      makeStep({ type: 'output', content: 'Completed.' }),
    ];

    // The responses need tool calls for linkToolCallsToResults to work
    const responses = [
      makeMsg({
        toolCalls: [{
          id: toolCallId,
          name: 'Task',
          input: { description: 'Run analysis' },
        }],
      }),
    ];

    const group = makeAIGroup({
      steps,
      responses,
      processes: [subProc],
    });

    const result = enhanceAIGroup(group);

    // The subagent process should have mainSessionImpact set
    const enhancedProc = result.processes.find((p) => p.id === 'sub-1');
    expect(enhancedProc).toBeDefined();
    expect(enhancedProc!.mainSessionImpact).toBeDefined();
    expect(enhancedProc!.mainSessionImpact!.callTokens).toBeGreaterThan(0);
    expect(enhancedProc!.mainSessionImpact!.totalTokens).toBeGreaterThan(0);
  });

  it('passes precedingSlash through and includes it in display items', () => {
    const slash: SlashItem = {
      id: 'slash-1',
      name: 'review-pr',
      args: '123',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    };

    const group = makeAIGroup({
      steps: [makeStep({ type: 'output', content: 'Reviewing PR...' })],
      responses: [makeMsg()],
    });

    const result = enhanceAIGroup(group, undefined, slash);

    const slashItems = result.displayItems.filter((i) => i.type === 'slash');
    expect(slashItems).toHaveLength(1);
    if (slashItems[0].type === 'slash') {
      expect(slashItems[0].slash.name).toBe('review-pr');
      expect(slashItems[0].slash.args).toBe('123');
    }
  });

  it('includes claudeMdStats when provided, null when omitted', () => {
    const group = makeAIGroup({
      steps: [makeStep({ type: 'output', content: 'hello' })],
    });

    // When provided
    const withStats = enhanceAIGroup(group, { paths: ['/a/.claude/CLAUDE.md'], totalTokens: 800 });
    expect(withStats.claudeMdStats).toEqual({ paths: ['/a/.claude/CLAUDE.md'], totalTokens: 800 });

    // When omitted
    const withoutStats = enhanceAIGroup(group);
    expect(withoutStats.claudeMdStats).toBeNull();
  });

  it('handles ongoing group with no lastOutput text', () => {
    const group = makeAIGroup({
      steps: [
        makeStep({ type: 'thinking', content: 'still working...' }),
      ],
      isOngoing: true,
    });

    const result = enhanceAIGroup(group);
    expect(result.lastOutput).not.toBeNull();
    expect(result.lastOutput!.type).toBe('ongoing');
  });

  it('does not attach mainSessionImpact when process has no parentTaskId', () => {
    const proc = makeProcess({ id: 'proc-no-parent', parentTaskId: undefined });

    const group = makeAIGroup({
      steps: [makeStep({ type: 'output', content: 'done' })],
      processes: [proc],
    });

    const result = enhanceAIGroup(group);
    const p = result.processes.find((p) => p.id === 'proc-no-parent');
    expect(p).toBeDefined();
    expect(p!.mainSessionImpact).toBeUndefined();
  });
});
