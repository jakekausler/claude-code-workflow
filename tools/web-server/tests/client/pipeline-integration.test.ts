import { describe, it, expect } from 'vitest';
import { transformChunksToConversation } from '../../src/client/utils/group-transformer.js';
import { enhanceAIGroup } from '../../src/client/utils/ai-group-enhancer.js';
import { processSessionContextWithPhases } from '../../src/client/utils/context-tracker.js';
import type {
  Chunk, UserChunk, AIChunk, CompactChunk, EnhancedAIChunk,
  ParsedMessage, SemanticStep,
} from '../../src/server/types/jsonl.js';
import type { AIGroup } from '../../src/client/types/groups.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    uuid: 'msg-' + Math.random().toString(36).slice(2, 8),
    parentUuid: null,
    type: 'user',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    content: 'Hello world',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

function makeUserChunk(content: string = 'Hello', overrides: Partial<UserChunk> = {}): UserChunk {
  const msg = makeMsg({ content, type: 'user' });
  return {
    type: 'user',
    id: `user-${msg.uuid}`,
    message: msg,
    timestamp: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeAIChunk(overrides: Partial<AIChunk> = {}): AIChunk {
  const msgs = overrides.messages ?? [
    makeMsg({
      type: 'assistant',
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 },
      model: 'claude-sonnet-4-5-20250929',
    }),
  ];
  return {
    type: 'ai',
    id: `ai-${msgs[0]?.uuid ?? 'unknown'}`,
    messages: msgs,
    timestamp: new Date('2025-01-01T00:00:01Z'),
    ...overrides,
  };
}

function makeEnhancedAIChunk(
  steps: SemanticStep[],
  overrides: Partial<EnhancedAIChunk> = {},
): EnhancedAIChunk {
  const msgs = overrides.messages ?? [
    makeMsg({
      type: 'assistant',
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 },
      model: 'claude-sonnet-4-5-20250929',
    }),
  ];
  return {
    type: 'ai',
    id: `ai-${msgs[0]?.uuid ?? 'unknown'}`,
    messages: msgs,
    timestamp: new Date('2025-01-01T00:00:01Z'),
    semanticSteps: steps,
    subagents: [],
    ...overrides,
  };
}

let compactCounter = 0;
function makeCompactChunk(summary: string = 'Conversation compacted'): CompactChunk {
  return {
    type: 'compact',
    id: `compact-test-${++compactCounter}`,
    summary,
    timestamp: new Date('2025-01-01T01:00:00Z'),
  };
}

// ─── Integration tests ──────────────────────────────────────────────────────

describe('pipeline integration', () => {
  it('transforms chunks to conversation and enhances AI groups', () => {
    const chunks: Chunk[] = [
      makeUserChunk('Explain how dependency injection works'),
      makeEnhancedAIChunk(
        [
          { type: 'thinking', content: 'Let me explain DI patterns...' },
          { type: 'output', content: 'Dependency injection is a design pattern where...' },
        ],
        {
          messages: [
            makeMsg({
              type: 'assistant',
              content: [{ type: 'text', text: 'Dependency injection is a design pattern where...' }],
              usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 50 },
              model: 'claude-sonnet-4-5-20250929',
            }),
          ],
        },
      ),
    ];

    // Step 1: Transform chunks to conversation
    const conversation = transformChunksToConversation(chunks, false, 'test-session');
    expect(conversation.items).toHaveLength(2);
    expect(conversation.totalUserGroups).toBe(1);
    expect(conversation.totalAIGroups).toBe(1);
    expect(conversation.items[0].type).toBe('user');
    expect(conversation.items[1].type).toBe('ai');

    // Step 2: Enhance the AI group
    const aiItem = conversation.items[1];
    expect(aiItem.type).toBe('ai');
    const aiGroup = (aiItem as { type: 'ai'; group: AIGroup }).group;

    const enhanced = enhanceAIGroup(aiGroup);

    // Verify enhanced fields
    expect(enhanced.mainModel).not.toBeNull();
    expect(enhanced.mainModel!.family).toBe('sonnet');
    expect(enhanced.lastOutput).not.toBeNull();
    expect(enhanced.lastOutput!.type).toBe('text');
    expect(typeof enhanced.itemsSummary).toBe('string');
    expect(enhanced.displayItems).toBeInstanceOf(Array);
    expect(enhanced.linkedTools).toBeInstanceOf(Map);
  });

  it('computes context stats with phase boundaries', () => {
    const chunks: Chunk[] = [
      makeUserChunk('First question'),
      makeEnhancedAIChunk(
        [{ type: 'output', content: 'First answer' }],
        {
          messages: [
            makeMsg({
              type: 'assistant',
              content: [{ type: 'text', text: 'First answer' }],
              usage: { input_tokens: 100, output_tokens: 40 },
              model: 'claude-sonnet-4-5-20250929',
            }),
          ],
          timestamp: new Date('2025-01-01T00:00:01Z'),
        },
      ),
      makeCompactChunk('Summary of first phase'),
      makeUserChunk('Second question'),
      makeEnhancedAIChunk(
        [{ type: 'output', content: 'Second answer' }],
        {
          messages: [
            makeMsg({
              type: 'assistant',
              content: [{ type: 'text', text: 'Second answer' }],
              usage: { input_tokens: 80, output_tokens: 30 },
              model: 'claude-sonnet-4-5-20250929',
            }),
          ],
          timestamp: new Date('2025-01-01T02:00:01Z'),
        },
      ),
    ];

    const conversation = transformChunksToConversation(chunks, false, 'test-session');
    expect(conversation.items).toHaveLength(5);

    const { statsMap, phases } = processSessionContextWithPhases(conversation.items);

    // 2 AI groups should be in the statsMap
    expect(statsMap.size).toBe(2);

    // 2 phases: one before compact, one after
    expect(phases).toHaveLength(2);
    expect(phases[0].label).toBe('Phase 1');
    expect(phases[1].label).toBe('Phase 2');

    // Phase 1 has turn 0, phase 2 has turn 1
    expect(phases[0].startTurn).toBe(0);
    expect(phases[0].endTurn).toBe(0);
    expect(phases[1].startTurn).toBe(1);
    expect(phases[1].endTurn).toBe(1);

    // Post-compact cumulative should equal turn tokens (reset by compact)
    const postCompactAIItems = conversation.items.filter(i => i.type === 'ai');
    const postCompactId = (postCompactAIItems[1] as { type: 'ai'; group: AIGroup }).group.id;
    const postStats = statsMap.get(postCompactId)!;
    expect(postStats.cumulativeTokens.thinkingText).toBe(postStats.turnTokens.thinkingText);
    expect(postStats.cumulativeTokens.userMessages).toBe(postStats.turnTokens.userMessages);
  });

  it('uses token snapshot from last assistant message, not sum', () => {
    const chunks: Chunk[] = [
      makeAIChunk({
        messages: [
          makeMsg({
            type: 'assistant',
            content: [{ type: 'text', text: 'First response part' }],
            usage: { input_tokens: 50, output_tokens: 20 },
            model: 'claude-sonnet-4-5-20250929',
          }),
          makeMsg({
            type: 'assistant',
            content: [{ type: 'text', text: 'Second response part' }],
            usage: { input_tokens: 300, output_tokens: 120 },
            model: 'claude-sonnet-4-5-20250929',
          }),
        ],
      }),
    ];

    const conversation = transformChunksToConversation(chunks, false);
    const aiItem = conversation.items[0];
    expect(aiItem.type).toBe('ai');
    const aiGroup = (aiItem as { type: 'ai'; group: AIGroup }).group;

    // Tokens come from LAST assistant message's usage (snapshot), not sum
    expect(aiGroup.tokens.input).toBe(300);
    expect(aiGroup.tokens.output).toBe(120);
    expect(aiGroup.tokens.total).toBe(420); // 300 + 120
  });

  it('enriches compact groups with token delta', () => {
    const chunks: Chunk[] = [
      makeAIChunk({
        messages: [
          makeMsg({
            type: 'assistant',
            content: [],
            usage: { input_tokens: 500, output_tokens: 200 },
            model: 'claude-sonnet-4-5-20250929',
          }),
        ],
        timestamp: new Date('2025-01-01T00:00:00Z'),
      }),
      makeCompactChunk('Context compacted after large conversation'),
      makeAIChunk({
        messages: [
          makeMsg({
            type: 'assistant',
            content: [],
            usage: { input_tokens: 150, output_tokens: 60 },
            model: 'claude-sonnet-4-5-20250929',
          }),
        ],
        timestamp: new Date('2025-01-01T02:00:00Z'),
      }),
    ];

    const conversation = transformChunksToConversation(chunks, false);
    const compactItem = conversation.items.find(i => i.type === 'compact');
    expect(compactItem).toBeDefined();

    const compactGroup = compactItem!.group;
    expect('summary' in compactGroup).toBe(true);
    if ('tokenDelta' in compactGroup && compactGroup.tokenDelta) {
      // Pre-compaction = 500 + 200 = 700 (total from last AI group before compact)
      expect(compactGroup.tokenDelta.preCompactionTokens).toBe(700);
      // Post-compaction = 150 + 60 = 210 (total from first AI group after compact)
      expect(compactGroup.tokenDelta.postCompactionTokens).toBe(210);
      // Delta = 210 - 700 = -490
      expect(compactGroup.tokenDelta.delta).toBe(-490);
    } else {
      // Force failure if tokenDelta is missing
      expect(compactGroup).toHaveProperty('tokenDelta');
    }
  });

  it('links tool calls to results in enhanced AI groups', () => {
    const toolCallId = 'tool-read-1';
    const chunks: Chunk[] = [
      makeUserChunk('Read the file'),
      makeEnhancedAIChunk(
        [
          {
            type: 'tool_call',
            content: 'Reading file...',
            toolCallId,
            toolName: 'Read',
          },
          {
            type: 'tool_result',
            content: 'File content: export function hello() {}',
            toolCallId,
            toolName: 'Read',
          },
          { type: 'output', content: 'The file exports a hello function.' },
        ],
        {
          messages: [
            makeMsg({
              type: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: toolCallId,
                  name: 'Read',
                  input: { file_path: '/src/hello.ts' },
                },
                { type: 'text', text: 'The file exports a hello function.' },
              ],
              usage: { input_tokens: 200, output_tokens: 60 },
              model: 'claude-sonnet-4-5-20250929',
              toolCalls: [{
                id: toolCallId,
                name: 'Read',
                input: { file_path: '/src/hello.ts' },
                isTask: false,
              }],
              toolResults: [{
                toolUseId: toolCallId,
                content: 'File content: export function hello() {}',
                isError: false,
              }],
            }),
          ],
        },
      ),
    ];

    const conversation = transformChunksToConversation(chunks, false);
    expect(conversation.totalAIGroups).toBe(1);

    const aiItem = conversation.items.find(i => i.type === 'ai')!;
    const aiGroup = (aiItem as { type: 'ai'; group: AIGroup }).group;

    const enhanced = enhanceAIGroup(aiGroup);

    // linkedTools should have the Read tool call linked to its result
    expect(enhanced.linkedTools.size).toBeGreaterThanOrEqual(1);
    expect(enhanced.linkedTools.has(toolCallId)).toBe(true);

    const linkedTool = enhanced.linkedTools.get(toolCallId)!;
    expect(linkedTool.name).toBe('Read');

    // displayItems should include tool items
    const toolDisplayItems = enhanced.displayItems.filter(i => i.type === 'tool');
    expect(toolDisplayItems.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty chunk array', () => {
    const conversation = transformChunksToConversation([], false);
    expect(conversation.items).toEqual([]);

    const { statsMap, phases } = processSessionContextWithPhases(conversation.items);
    expect(statsMap.size).toBe(0);
    expect(phases).toEqual([]);
  });

  it('runs full pipeline: chunks through transform, enhance, and context tracking', () => {
    // Build a realistic multi-turn session
    const chunks: Chunk[] = [
      makeUserChunk('What is TypeScript?'),
      makeEnhancedAIChunk(
        [
          { type: 'thinking', content: 'User asks about TypeScript...' },
          { type: 'output', content: 'TypeScript is a typed superset of JavaScript.' },
        ],
        {
          messages: [
            makeMsg({
              type: 'assistant',
              content: [{ type: 'text', text: 'TypeScript is a typed superset of JavaScript.' }],
              usage: { input_tokens: 150, output_tokens: 40 },
              model: 'claude-sonnet-4-5-20250929',
            }),
          ],
          timestamp: new Date('2025-01-01T00:00:01Z'),
        },
      ),
      makeUserChunk('Show me an example'),
      makeEnhancedAIChunk(
        [
          { type: 'output', content: 'Here is an example: const x: number = 42;' },
        ],
        {
          messages: [
            makeMsg({
              type: 'assistant',
              content: [{ type: 'text', text: 'Here is an example: const x: number = 42;' }],
              usage: { input_tokens: 250, output_tokens: 60 },
              model: 'claude-sonnet-4-5-20250929',
            }),
          ],
          timestamp: new Date('2025-01-01T00:01:01Z'),
        },
      ),
    ];

    // Transform
    const conversation = transformChunksToConversation(chunks, false, 'full-pipeline-session');
    expect(conversation.sessionId).toBe('full-pipeline-session');
    expect(conversation.items).toHaveLength(4);
    expect(conversation.totalUserGroups).toBe(2);
    expect(conversation.totalAIGroups).toBe(2);

    // Enhance each AI group
    const aiItems = conversation.items.filter(i => i.type === 'ai');
    const enhanced0 = enhanceAIGroup(
      (aiItems[0] as { type: 'ai'; group: AIGroup }).group,
    );
    const enhanced1 = enhanceAIGroup(
      (aiItems[1] as { type: 'ai'; group: AIGroup }).group,
    );

    expect(enhanced0.mainModel!.family).toBe('sonnet');
    expect(enhanced1.mainModel!.family).toBe('sonnet');
    expect(enhanced0.lastOutput).not.toBeNull();
    expect(enhanced1.lastOutput).not.toBeNull();

    // Context tracking
    const { statsMap, phases } = processSessionContextWithPhases(conversation.items);
    expect(statsMap.size).toBe(2);
    expect(phases).toHaveLength(1);
    expect(phases[0].label).toBe('Phase 1');
    expect(phases[0].startTurn).toBe(0);
    expect(phases[0].endTurn).toBe(1);

    // Second turn cumulative > first turn cumulative
    const id0 = (aiItems[0] as { type: 'ai'; group: AIGroup }).group.id;
    const id1 = (aiItems[1] as { type: 'ai'; group: AIGroup }).group.id;
    const stats0 = statsMap.get(id0)!;
    const stats1 = statsMap.get(id1)!;
    expect(stats1.totalTokens).toBeGreaterThan(stats0.totalTokens);
  });
});
