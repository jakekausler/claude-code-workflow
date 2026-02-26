import { describe, it, expect } from 'vitest';
import { processSessionContextWithPhases } from '../../src/client/utils/context-tracker.js';
import type { ChatItem, UserGroup, AIGroup, CompactGroup } from '../../src/client/types/groups.js';
import type { ParsedMessage, SemanticStep } from '../../src/server/types/jsonl.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    uuid: 'msg-' + Math.random().toString(36).slice(2, 8),
    parentUuid: null,
    type: 'user',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    content: '',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

function makeUserItem(text: string, opts?: {
  fileReferences?: { path: string }[];
  rawText?: string;
}): ChatItem {
  const rawText = opts?.rawText ?? text;
  const group: UserGroup = {
    id: `user-${Math.random().toString(36).slice(2, 8)}`,
    message: makeMsg({ content: rawText }),
    timestamp: new Date('2025-01-01T00:00:00Z'),
    content: {
      text,
      rawText,
      commands: [],
      images: [],
      fileReferences: opts?.fileReferences ?? [],
    },
    index: 0,
  };
  return { type: 'user', group };
}

function makeAIItem(steps: SemanticStep[], id?: string): ChatItem {
  const group: AIGroup = {
    id: id ?? `ai-${Math.random().toString(36).slice(2, 8)}`,
    turnIndex: 0,
    startTime: new Date('2025-01-01T00:00:01Z'),
    endTime: new Date('2025-01-01T00:00:02Z'),
    durationMs: 1000,
    steps,
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150 },
    summary: {
      toolCallCount: steps.filter(s => s.type === 'tool_call').length,
      outputMessageCount: steps.filter(s => s.type === 'output').length,
      subagentCount: 0,
      totalDurationMs: 1000,
      totalTokens: 150,
      outputTokens: 50,
      cachedTokens: 0,
    },
    status: 'complete',
    processes: [],
    chunkId: 'chunk-0',
    responses: [],
    isOngoing: false,
  };
  return { type: 'ai', group };
}

function makeCompactItem(): ChatItem {
  const group: CompactGroup = {
    id: `compact-${Date.now()}`,
    timestamp: new Date('2025-01-01T01:00:00Z'),
    summary: 'Conversation compacted',
    message: makeMsg({ type: 'summary', content: 'Conversation compacted' }),
  };
  return { type: 'compact', group };
}

function step(type: SemanticStep['type'], content: string, toolName?: string): SemanticStep {
  return {
    type,
    content,
    ...(toolName ? { toolName } : {}),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processSessionContextWithPhases', () => {
  it('empty items array produces empty map and no phases', () => {
    const result = processSessionContextWithPhases([]);
    expect(result.statsMap.size).toBe(0);
    expect(result.phases).toHaveLength(0);
  });

  it('computes per-turn stats for a sequence of user + AI items', () => {
    const items: ChatItem[] = [
      makeUserItem('Hello world'),
      makeAIItem([step('output', 'Hi there')], 'ai-turn-0'),
      makeUserItem('Second message'),
      makeAIItem([step('output', 'Another response')], 'ai-turn-1'),
    ];

    const result = processSessionContextWithPhases(items);

    expect(result.statsMap.size).toBe(2);
    expect(result.statsMap.has('ai-turn-0')).toBe(true);
    expect(result.statsMap.has('ai-turn-1')).toBe(true);

    const stats0 = result.statsMap.get('ai-turn-0')!;
    expect(stats0.turnIndex).toBe(0);
    expect(stats0.turnTokens.userMessages).toBeGreaterThan(0);
    expect(stats0.turnTokens.thinkingText).toBeGreaterThan(0);

    const stats1 = result.statsMap.get('ai-turn-1')!;
    expect(stats1.turnIndex).toBe(1);
  });

  it('cumulative tokens accumulate across turns', () => {
    const items: ChatItem[] = [
      makeUserItem('Hello'),
      makeAIItem([step('output', 'Response A')], 'ai-0'),
      makeUserItem('World'),
      makeAIItem([step('output', 'Response B')], 'ai-1'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats0 = result.statsMap.get('ai-0')!;
    const stats1 = result.statsMap.get('ai-1')!;

    // Cumulative at turn 1 should include tokens from both turns
    expect(stats1.cumulativeTokens.userMessages).toBeGreaterThan(
      stats0.cumulativeTokens.userMessages,
    );
    expect(stats1.totalTokens).toBeGreaterThan(stats0.totalTokens);
  });

  it('phase boundaries (compact items) reset cumulative counts', () => {
    const items: ChatItem[] = [
      makeUserItem('Pre-compact message'),
      makeAIItem([step('output', 'Pre-compact response')], 'ai-pre'),
      makeCompactItem(),
      makeUserItem('Post-compact message'),
      makeAIItem([step('output', 'Post-compact response')], 'ai-post'),
    ];

    const result = processSessionContextWithPhases(items);
    const statsPre = result.statsMap.get('ai-pre')!;
    const statsPost = result.statsMap.get('ai-post')!;

    // Post-compact cumulative should only reflect post-compact turn
    // (cumulative was reset by compact boundary)
    expect(statsPost.cumulativeTokens.userMessages).toBe(statsPost.turnTokens.userMessages);
    expect(statsPost.cumulativeTokens.thinkingText).toBe(statsPost.turnTokens.thinkingText);

    // Pre-compact stats should be independent of post-compact
    expect(statsPre.turnIndex).toBe(0);
    expect(statsPost.turnIndex).toBe(1);
  });

  it('CLAUDE.md content attributed to claudeMd category', () => {
    const items: ChatItem[] = [
      makeUserItem(
        'Here is the CLAUDE.md content with instructions',
        { rawText: 'Here is the CLAUDE.md content with instructions' },
      ),
      makeAIItem([step('output', 'Ok')], 'ai-claude-md'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-claude-md')!;

    expect(stats.turnTokens.claudeMd).toBeGreaterThan(0);
    expect(stats.turnTokens.userMessages).toBe(0);
    expect(stats.turnTokens.mentionedFiles).toBe(0);
  });

  it('system-reminder content attributed to claudeMd category', () => {
    const items: ChatItem[] = [
      makeUserItem(
        'Instructions <system-reminder>Some config</system-reminder>',
        { rawText: 'Instructions <system-reminder>Some config</system-reminder>' },
      ),
      makeAIItem([step('output', 'Acknowledged')], 'ai-sysrem'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-sysrem')!;

    expect(stats.turnTokens.claudeMd).toBeGreaterThan(0);
    expect(stats.turnTokens.userMessages).toBe(0);
  });

  it('file reference content attributed to mentionedFiles category', () => {
    const items: ChatItem[] = [
      makeUserItem('Check @src/main.ts please', {
        fileReferences: [{ path: 'src/main.ts' }],
      }),
      makeAIItem([step('output', 'Reading file')], 'ai-files'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-files')!;

    expect(stats.turnTokens.mentionedFiles).toBeGreaterThan(0);
    expect(stats.turnTokens.userMessages).toBe(0);
    expect(stats.turnTokens.claudeMd).toBe(0);
  });

  it('regular user messages attributed to userMessages category', () => {
    const items: ChatItem[] = [
      makeUserItem('Just a plain question'),
      makeAIItem([step('output', 'Answer')], 'ai-plain'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-plain')!;

    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);
    expect(stats.turnTokens.claudeMd).toBe(0);
    expect(stats.turnTokens.mentionedFiles).toBe(0);
  });

  it('tool calls attributed to toolOutputs for regular tools', () => {
    const items: ChatItem[] = [
      makeAIItem([
        step('tool_call', 'Read file content', 'Read'),
        step('tool_result', 'File content here'),
      ], 'ai-tool'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-tool')!;

    expect(stats.turnTokens.toolOutputs).toBeGreaterThan(0);
    expect(stats.turnTokens.taskCoordination).toBe(0);
  });

  it('coordination tools attributed to taskCoordination category', () => {
    const items: ChatItem[] = [
      makeAIItem([
        step('tool_call', 'Create task for implementation', 'TaskCreate'),
        step('tool_result', 'Task created'),
        step('tool_call', 'Send message to subagent', 'SendMessage'),
        step('tool_result', 'Message sent'),
      ], 'ai-coord'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-coord')!;

    expect(stats.turnTokens.taskCoordination).toBeGreaterThan(0);
    // tool_result steps go to toolOutputs regardless of the tool name
    expect(stats.turnTokens.toolOutputs).toBeGreaterThan(0);
  });

  it('thinking steps attributed to thinkingText category', () => {
    const items: ChatItem[] = [
      makeAIItem([
        step('thinking', 'Let me analyze this problem carefully...'),
        step('output', 'Here is the answer'),
      ], 'ai-thinking'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-thinking')!;

    expect(stats.turnTokens.thinkingText).toBeGreaterThan(0);
  });

  it('multiple phases created correctly with compact boundaries', () => {
    const items: ChatItem[] = [
      makeUserItem('Phase 1 msg 1'),
      makeAIItem([step('output', 'R1')], 'ai-p1-0'),
      makeUserItem('Phase 1 msg 2'),
      makeAIItem([step('output', 'R2')], 'ai-p1-1'),
      makeCompactItem(),
      makeUserItem('Phase 2 msg 1'),
      makeAIItem([step('output', 'R3')], 'ai-p2-0'),
      makeCompactItem(),
      makeUserItem('Phase 3 msg 1'),
      makeAIItem([step('output', 'R4')], 'ai-p3-0'),
    ];

    const result = processSessionContextWithPhases(items);

    expect(result.phases).toHaveLength(3);

    expect(result.phases[0].phaseIndex).toBe(0);
    expect(result.phases[0].startTurn).toBe(0);
    expect(result.phases[0].endTurn).toBe(1);
    expect(result.phases[0].compactedTokens).toBeGreaterThan(0);
    expect(result.phases[0].label).toBe('Phase 1');

    expect(result.phases[1].phaseIndex).toBe(1);
    expect(result.phases[1].startTurn).toBe(2);
    expect(result.phases[1].endTurn).toBe(2);
    expect(result.phases[1].compactedTokens).toBeGreaterThan(0);
    expect(result.phases[1].label).toBe('Phase 2');

    expect(result.phases[2].phaseIndex).toBe(2);
    expect(result.phases[2].startTurn).toBe(3);
    expect(result.phases[2].endTurn).toBe(3);
    expect(result.phases[2].compactedTokens).toBe(0); // Last phase not compacted
    expect(result.phases[2].label).toBe('Phase 3');
  });

  it('AI item without preceding user item produces stats with zero user tokens', () => {
    const items: ChatItem[] = [
      makeAIItem([step('output', 'Autonomous response')], 'ai-no-user'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-no-user')!;

    expect(stats.turnTokens.userMessages).toBe(0);
    expect(stats.turnTokens.claudeMd).toBe(0);
    expect(stats.turnTokens.mentionedFiles).toBe(0);
    expect(stats.turnTokens.thinkingText).toBeGreaterThan(0);
  });

  it('system items are skipped and do not affect stats', () => {
    const systemItem: ChatItem = {
      type: 'system',
      group: {
        id: 'system-1',
        message: makeMsg({ type: 'system', content: 'command output' }),
        timestamp: new Date('2025-01-01T00:00:00Z'),
        commandOutput: 'command output',
      },
    };

    const items: ChatItem[] = [
      makeUserItem('Hello'),
      systemItem,
      makeAIItem([step('output', 'Hi')], 'ai-with-system'),
    ];

    const result = processSessionContextWithPhases(items);
    expect(result.statsMap.size).toBe(1);
    const stats = result.statsMap.get('ai-with-system')!;
    expect(stats.turnIndex).toBe(0);
    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);
  });
});
