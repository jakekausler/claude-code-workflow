import { describe, it, expect } from 'vitest';
import { transformChunksToConversation } from '../../src/client/utils/group-transformer.js';
import type {
  Chunk, UserChunk, AIChunk, SystemChunk, CompactChunk,
  EnhancedAIChunk, ParsedMessage, SemanticStep, Process,
} from '../../src/server/types/jsonl.js';
import { defaultMetrics } from './test-helpers.js';

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
  return {
    type: 'user',
    message: makeMsg({ content, type: 'user' }),
    timestamp: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeAIChunk(overrides: Partial<AIChunk> = {}): AIChunk {
  return {
    type: 'ai',
    messages: [
      makeMsg({
        type: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 },
      }),
    ],
    timestamp: new Date('2025-01-01T00:00:01Z'),
    ...overrides,
  };
}

function makeSystemChunk(content: string = 'system output'): SystemChunk {
  return {
    type: 'system',
    messages: [makeMsg({ type: 'system', content })],
    timestamp: new Date('2025-01-01T00:00:00Z'),
  };
}

function makeCompactChunk(summary: string = 'Conversation compacted'): CompactChunk {
  return {
    type: 'compact',
    summary,
    timestamp: new Date('2025-01-01T01:00:00Z'),
  };
}

describe('transformChunksToConversation', () => {
  it('empty chunks array produces empty conversation', () => {
    const result = transformChunksToConversation([], false);
    expect(result.items).toHaveLength(0);
    expect(result.totalUserGroups).toBe(0);
    expect(result.totalAIGroups).toBe(0);
    expect(result.totalSystemGroups).toBe(0);
    expect(result.totalCompactGroups).toBe(0);
    expect(result.sessionId).toBe('');
  });

  it('transforms a single user chunk into UserGroup with correct text', () => {
    const chunks: Chunk[] = [makeUserChunk('Hello world')];
    const result = transformChunksToConversation(chunks, false);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('user');
    expect(result.totalUserGroups).toBe(1);

    const group = result.items[0].group;
    expect('content' in group && group.content.rawText).toBe('Hello world');
    expect('index' in group && group.index).toBe(0);
  });

  it('transforms AI chunk with usage into AIGroup with correct token snapshot', () => {
    const chunks: Chunk[] = [makeAIChunk()];
    const result = transformChunksToConversation(chunks, false);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('ai');
    expect(result.totalAIGroups).toBe(1);

    const group = result.items[0].group;
    if ('tokens' in group) {
      expect(group.tokens.input).toBe(100);
      expect(group.tokens.output).toBe(50);
      expect(group.tokens.cacheRead).toBe(20);
      expect(group.tokens.total).toBe(150); // input + output
    }
  });

  it('uses LAST assistant message usage for token calculation (snapshot)', () => {
    const chunks: Chunk[] = [
      makeAIChunk({
        messages: [
          makeMsg({
            type: 'assistant',
            content: [{ type: 'text', text: 'First' }],
            usage: { input_tokens: 50, output_tokens: 10 },
          }),
          makeMsg({
            type: 'assistant',
            content: [{ type: 'text', text: 'Second' }],
            usage: { input_tokens: 200, output_tokens: 80 },
          }),
        ],
      }),
    ];
    const result = transformChunksToConversation(chunks, false);
    const group = result.items[0].group;
    if ('tokens' in group) {
      // Should use the LAST assistant's usage, not sum
      expect(group.tokens.input).toBe(200);
      expect(group.tokens.output).toBe(80);
    }
  });

  it('handles CompactChunk', () => {
    const chunks: Chunk[] = [makeCompactChunk('Compacted summary')];
    const result = transformChunksToConversation(chunks, false);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('compact');
    expect(result.totalCompactGroups).toBe(1);

    const group = result.items[0].group;
    if ('summary' in group) {
      expect(group.summary).toBe('Compacted summary');
    }
  });

  it('enriches CompactGroups with tokenDelta from surrounding AI groups', () => {
    const chunks: Chunk[] = [
      makeAIChunk({
        messages: [
          makeMsg({
            type: 'assistant',
            usage: { input_tokens: 500, output_tokens: 100 },
            content: [],
          }),
        ],
        timestamp: new Date('2025-01-01T00:00:00Z'),
      }),
      makeCompactChunk('Compacted'),
      makeAIChunk({
        messages: [
          makeMsg({
            type: 'assistant',
            usage: { input_tokens: 200, output_tokens: 50 },
            content: [],
          }),
        ],
        timestamp: new Date('2025-01-01T02:00:00Z'),
      }),
    ];

    const result = transformChunksToConversation(chunks, false);
    const compactItem = result.items.find((i) => i.type === 'compact');
    expect(compactItem).toBeDefined();
    const group = compactItem!.group;
    if ('tokenDelta' in group && group.tokenDelta) {
      expect(group.tokenDelta.preCompactionTokens).toBe(600); // 500 + 100
      expect(group.tokenDelta.postCompactionTokens).toBe(250); // 200 + 50
      expect(group.tokenDelta.delta).toBe(-350);
    }
  });

  it('marks last AI group as ongoing when isOngoing is true', () => {
    const chunks: Chunk[] = [
      makeUserChunk('Hello'),
      makeAIChunk(),
    ];
    const result = transformChunksToConversation(chunks, true);
    const aiItem = result.items.find((i) => i.type === 'ai');
    expect(aiItem).toBeDefined();
    const group = aiItem!.group;
    if ('isOngoing' in group) {
      expect(group.isOngoing).toBe(true);
    }
    if ('status' in group) {
      expect(group.status).toBe('in_progress');
    }
  });

  it('does not mark AI group as ongoing when isOngoing is false', () => {
    const chunks: Chunk[] = [makeAIChunk()];
    const result = transformChunksToConversation(chunks, false);
    const group = result.items[0].group;
    if ('isOngoing' in group) {
      expect(group.isOngoing).toBe(false);
    }
  });

  it('handles system chunk with command output', () => {
    const chunks: Chunk[] = [
      makeSystemChunk('<local-command-stdout>ls output</local-command-stdout>'),
    ];
    const result = transformChunksToConversation(chunks, false);
    expect(result.totalSystemGroups).toBe(1);
    const group = result.items[0].group;
    if ('commandOutput' in group) {
      expect(group.commandOutput).toBe('ls output');
    }
  });

  it('user content sanitization: strips XML noise tags', () => {
    const content = 'Hello<system-reminder>noise</system-reminder> world';
    const chunks: Chunk[] = [makeUserChunk(content)];
    const result = transformChunksToConversation(chunks, false);
    const group = result.items[0].group;
    if ('content' in group) {
      expect(group.content.rawText).toBe('Hello world');
    }
  });

  it('user content sanitization: converts command-name tags', () => {
    const content = '<command-name>commit</command-name>';
    const chunks: Chunk[] = [makeUserChunk(content)];
    const result = transformChunksToConversation(chunks, false);
    const group = result.items[0].group;
    if ('content' in group) {
      expect(group.content.rawText).toBe('/commit');
    }
  });

  it('assigns session ID', () => {
    const result = transformChunksToConversation([], false, 'session-123');
    expect(result.sessionId).toBe('session-123');
  });

  it('phase numbering across multiple compact groups', () => {
    const chunks: Chunk[] = [
      makeAIChunk({ timestamp: new Date('2025-01-01T00:00:00Z') }),
      makeCompactChunk('First compact'),
      makeAIChunk({ timestamp: new Date('2025-01-01T02:00:00Z') }),
      makeCompactChunk('Second compact'),
      makeAIChunk({ timestamp: new Date('2025-01-01T04:00:00Z') }),
    ];
    const result = transformChunksToConversation(chunks, false);
    const compacts = result.items.filter((i) => i.type === 'compact');
    expect(compacts).toHaveLength(2);

    if ('startingPhaseNumber' in compacts[0].group) {
      expect(compacts[0].group.startingPhaseNumber).toBe(1);
    }
    if ('startingPhaseNumber' in compacts[1].group) {
      expect(compacts[1].group.startingPhaseNumber).toBe(2);
    }
  });

  it('handles enhanced AI chunk with semantic steps', () => {
    const enhancedChunk: EnhancedAIChunk = {
      type: 'ai',
      messages: [
        makeMsg({
          type: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      ],
      timestamp: new Date('2025-01-01T00:00:00Z'),
      semanticSteps: [
        { type: 'thinking', content: 'Let me think...' },
        { type: 'output', content: 'Here is my answer' },
      ],
      subagents: [],
    };

    const chunks: Chunk[] = [enhancedChunk];
    const result = transformChunksToConversation(chunks, false);
    const group = result.items[0].group;
    if ('steps' in group) {
      expect(group.steps).toHaveLength(2);
      expect(group.steps[0].type).toBe('thinking');
    }
    if ('summary' in group) {
      expect(group.summary.thinkingPreview).toBe('Let me think...');
      expect(group.summary.outputMessageCount).toBe(1);
    }
  });

  it('detects interrupted status from interruption step', () => {
    const enhancedChunk: EnhancedAIChunk = {
      type: 'ai',
      messages: [
        makeMsg({
          type: 'assistant',
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      ],
      timestamp: new Date('2025-01-01T00:00:00Z'),
      semanticSteps: [
        { type: 'interruption', content: 'User cancelled' },
      ],
      subagents: [],
    };
    const chunks: Chunk[] = [enhancedChunk];
    const result = transformChunksToConversation(chunks, false);
    const group = result.items[0].group;
    if ('status' in group) {
      expect(group.status).toBe('interrupted');
    }
  });

  it('does not override interrupted status when marking ongoing', () => {
    const enhancedChunk: EnhancedAIChunk = {
      type: 'ai',
      messages: [
        makeMsg({
          type: 'assistant',
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      ],
      timestamp: new Date('2025-01-01T00:00:00Z'),
      semanticSteps: [
        { type: 'interruption', content: 'User cancelled' },
      ],
      subagents: [],
    };
    const chunks: Chunk[] = [enhancedChunk];
    const result = transformChunksToConversation(chunks, true);
    const group = result.items[0].group;
    if ('status' in group) {
      expect(group.status).toBe('interrupted');
    }
    if ('isOngoing' in group) {
      expect(group.isOngoing).toBeFalsy();
    }
  });

  it('extracts images from content blocks', () => {
    const chunks: Chunk[] = [
      makeUserChunk(''),
    ];
    // Override with content blocks that include image
    (chunks[0] as UserChunk).message.content = [
      { type: 'text', text: 'Check this image' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
    ];
    const result = transformChunksToConversation(chunks, false);
    const group = result.items[0].group;
    if ('content' in group) {
      expect(group.content.images).toHaveLength(1);
      expect(group.content.images[0].mediaType).toBe('image/png');
    }
  });

  it('extracts file references from @mentions', () => {
    const chunks: Chunk[] = [makeUserChunk('Check @src/index.ts and @README.md')];
    const result = transformChunksToConversation(chunks, false);
    const group = result.items[0].group;
    if ('content' in group) {
      expect(group.content.fileReferences).toHaveLength(2);
      expect(group.content.fileReferences[0].path).toBe('src/index.ts');
      expect(group.content.fileReferences[1].path).toBe('README.md');
    }
  });

  it('counts groups correctly with mixed types', () => {
    const chunks: Chunk[] = [
      makeUserChunk('Hello'),
      makeAIChunk(),
      makeSystemChunk('output'),
      makeUserChunk('Bye'),
      makeAIChunk(),
      makeCompactChunk('Summary'),
    ];
    const result = transformChunksToConversation(chunks, false);
    expect(result.totalUserGroups).toBe(2);
    expect(result.totalAIGroups).toBe(2);
    expect(result.totalSystemGroups).toBe(1);
    expect(result.totalCompactGroups).toBe(1);
    expect(result.items).toHaveLength(6);
  });
});
