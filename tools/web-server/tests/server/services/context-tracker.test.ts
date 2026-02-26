import { describe, it, expect } from 'vitest';
import { trackContext } from '../../../src/server/services/context-tracker.js';
import type {
  Chunk,
  AIChunk,
  UserChunk,
  CompactChunk,
  SystemChunk,
  ParsedMessage,
} from '../../../src/server/types/jsonl.js';

describe('ContextTracker', () => {
  describe('trackContext', () => {
    it('returns empty stats for empty chunks', () => {
      const result = trackContext([]);
      expect(result.perTurn).toEqual([]);
      expect(result.phases).toEqual([]);
    });

    it('tracks user message tokens', () => {
      const chunks: Chunk[] = [
        createUserChunk('Hello, how are you?'),
        createAIChunk([createAssistantMsg('I am doing well!', 50, 20)]),
      ];
      const result = trackContext(chunks);
      expect(result.perTurn).toHaveLength(2);
      expect(result.perTurn[0].turnTokens.userMessages).toBeGreaterThan(0);
    });

    it('tracks thinking and text output tokens', () => {
      const chunks: Chunk[] = [
        createUserChunk('What is 2+2?'),
        createAIChunk([
          {
            uuid: 'a1',
            parentUuid: null,
            type: 'assistant',
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            content: [
              {
                type: 'thinking',
                thinking: 'Let me calculate this...',
                signature: 'sig',
              },
              { type: 'text', text: 'The answer is 4.' },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
            model: 'claude-sonnet-4-6',
            toolCalls: [],
            toolResults: [],
          } as ParsedMessage,
        ]),
      ];
      const result = trackContext(chunks);
      const aiTurn = result.perTurn[1];
      expect(aiTurn.turnTokens.thinkingText).toBeGreaterThan(0);
    });

    it('attributes tool calls to toolOutputs category', () => {
      const chunks: Chunk[] = [
        createUserChunk('Run ls'),
        createAIChunk([
          {
            uuid: 'a1',
            parentUuid: null,
            type: 'assistant',
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Bash',
                input: { command: 'ls -la' },
              },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
            toolCalls: [
              {
                id: 'toolu_1',
                name: 'Bash',
                input: { command: 'ls -la' },
                isTask: false,
              },
            ],
            toolResults: [],
          } as ParsedMessage,
          {
            uuid: 'tr1',
            parentUuid: null,
            type: 'user',
            timestamp: new Date(),
            isSidechain: false,
            isMeta: true,
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: 'file1.txt\nfile2.txt',
                is_error: false,
              },
            ],
            toolCalls: [],
            toolResults: [
              {
                toolUseId: 'toolu_1',
                content: 'file1.txt\nfile2.txt',
                isError: false,
              },
            ],
          } as ParsedMessage,
        ]),
      ];
      const result = trackContext(chunks);
      const aiTurn = result.perTurn[1];
      expect(aiTurn.turnTokens.toolOutputs).toBeGreaterThan(0);
    });

    it('attributes Task tool calls to taskCoordination', () => {
      const chunks: Chunk[] = [
        createUserChunk('Search'),
        createAIChunk([
          {
            uuid: 'a1',
            parentUuid: null,
            type: 'assistant',
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            content: [
              {
                type: 'tool_use',
                id: 'toolu_t1',
                name: 'Task',
                input: { description: 'Search files', prompt: 'find tests' },
              },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
            toolCalls: [
              {
                id: 'toolu_t1',
                name: 'Task',
                input: {},
                isTask: true,
              },
            ],
            toolResults: [],
          } as ParsedMessage,
        ]),
      ];
      const result = trackContext(chunks);
      const aiTurn = result.perTurn[1];
      expect(aiTurn.turnTokens.taskCoordination).toBeGreaterThan(0);
      expect(aiTurn.turnTokens.toolOutputs).toBe(0);
    });

    it('compaction creates phase boundary', () => {
      const chunks: Chunk[] = [
        createUserChunk('First message'),
        createAIChunk([createAssistantMsg('First response', 100, 50)]),
        {
          type: 'compact',
          summary: 'Previous conversation was about...',
          timestamp: new Date(),
        } as CompactChunk,
        createUserChunk('Second message'),
        createAIChunk([createAssistantMsg('Second response', 80, 40)]),
      ];
      const result = trackContext(chunks);
      expect(result.phases).toHaveLength(2);
      expect(result.phases[0].phaseIndex).toBe(0);
      expect(result.phases[0].startTurn).toBe(0);
      expect(result.phases[0].endTurn).toBe(1);
      expect(result.phases[0].compactedTokens).toBeGreaterThan(0);
      expect(result.phases[1].phaseIndex).toBe(1);
      expect(result.phases[1].startTurn).toBe(2);
      expect(result.phases[1].compactedTokens).toBe(0); // final phase not compacted

      // After compaction, cumulative resets: the first turn's cumulative should equal its turnTokens
      const firstTurnAfterCompact = result.perTurn[2]; // turnIndex 2 is first after compaction
      expect(firstTurnAfterCompact.cumulativeTokens).toEqual(
        firstTurnAfterCompact.turnTokens,
      );
    });

    it('cumulative totals increase across turns', () => {
      const chunks: Chunk[] = [
        createUserChunk('Question 1'),
        createAIChunk([createAssistantMsg('Answer 1', 100, 50)]),
        createUserChunk('Question 2'),
        createAIChunk([createAssistantMsg('Answer 2', 150, 60)]),
      ];
      const result = trackContext(chunks);
      expect(result.perTurn).toHaveLength(4);
      // Cumulative totals should increase
      expect(result.perTurn[1].totalTokens).toBeGreaterThan(
        result.perTurn[0].totalTokens,
      );
      expect(result.perTurn[3].totalTokens).toBeGreaterThan(
        result.perTurn[1].totalTokens,
      );
    });

    it('creates single phase when no compaction', () => {
      const chunks: Chunk[] = [
        createUserChunk('Hello'),
        createAIChunk([createAssistantMsg('Hi', 50, 10)]),
      ];
      const result = trackContext(chunks);
      expect(result.phases).toHaveLength(1);
      expect(result.phases[0].label).toBe('Phase 1');
    });

    it('system chunks produce zero perTurn entries and do not affect phases', () => {
      const systemChunk: SystemChunk = {
        type: 'system',
        messages: [
          {
            uuid: 's1',
            parentUuid: null,
            type: 'user',
            timestamp: new Date(),
            isSidechain: false,
            isMeta: true,
            content: 'system output text',
            toolCalls: [],
            toolResults: [],
          } as ParsedMessage,
        ],
        timestamp: new Date(),
      };
      const chunks: Chunk[] = [systemChunk];
      const result = trackContext(chunks);
      expect(result.perTurn).toEqual([]);
      expect(result.phases).toEqual([]);
    });

    it('multiple consecutive compactions skip empty phases', () => {
      const chunks: Chunk[] = [
        createUserChunk('First message'),
        createAIChunk([createAssistantMsg('First response', 100, 50)]),
        {
          type: 'compact',
          summary: 'Compaction 1',
          timestamp: new Date(),
        } as CompactChunk,
        // Second compaction immediately — no turns between compactions
        {
          type: 'compact',
          summary: 'Compaction 2',
          timestamp: new Date(),
        } as CompactChunk,
        createUserChunk('After both compactions'),
        createAIChunk([createAssistantMsg('Response after compactions', 80, 40)]),
      ];
      const result = trackContext(chunks);
      // Phase 0: turns 0-1, then compact closes it.
      // Second compact has no turns since phaseStartTurn === turnIndex, so no empty phase is created.
      // Phase 2: turns 2-3 (final phase).
      expect(result.phases).toHaveLength(2);
      expect(result.phases[0].phaseIndex).toBe(0);
      expect(result.phases[0].startTurn).toBe(0);
      expect(result.phases[0].endTurn).toBe(1);
      expect(result.phases[1].phaseIndex).toBe(2);
      expect(result.phases[1].startTurn).toBe(2);
      expect(result.phases[1].endTurn).toBe(3);
      expect(result.phases[1].compactedTokens).toBe(0); // final phase
    });
  });
});

// Helper factories
function createUserChunk(content: string): UserChunk {
  return {
    type: 'user',
    message: {
      uuid: `u${Math.random()}`,
      parentUuid: null,
      type: 'user',
      timestamp: new Date(),
      isSidechain: false,
      isMeta: false,
      content,
      toolCalls: [],
      toolResults: [],
    } as ParsedMessage,
    timestamp: new Date(),
  };
}

function createAIChunk(messages: ParsedMessage[]): AIChunk {
  return { type: 'ai', messages, timestamp: new Date() };
}

function createAssistantMsg(
  text: string,
  inputTokens: number,
  outputTokens: number,
): ParsedMessage {
  return {
    uuid: `a${Math.random()}`,
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date(),
    isSidechain: false,
    isMeta: false,
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    model: 'claude-sonnet-4-6',
    toolCalls: [],
    toolResults: [],
  } as ParsedMessage;
}
