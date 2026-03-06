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

    it('tracks CLAUDE.md and user message tokens independently', () => {
      const content =
        'Hello, help me.\n<system-reminder>Important config</system-reminder>';
      const chunks: Chunk[] = [
        createUserChunk(content),
        createAIChunk([createAssistantMsg('Sure', 50, 10)]),
      ];
      const result = trackContext(chunks);
      const userTurn = result.perTurn[0];
      // Both claudeMd and userMessages should be non-zero
      expect(userTurn.turnTokens.claudeMd).toBeGreaterThan(0);
      expect(userTurn.turnTokens.userMessages).toBeGreaterThan(0);
    });

    it('tracks CLAUDE.md + @-mentioned files + user text independently', () => {
      const content =
        'Please review this.\n' +
        'Contents of /home/user/.claude/CLAUDE.md\nSome instructions.\n' +
        'Also check @src/main.ts';
      const chunks: Chunk[] = [
        createUserChunk(content),
        createAIChunk([createAssistantMsg('Ok', 50, 10)]),
      ];
      const result = trackContext(chunks);
      const userTurn = result.perTurn[0];
      expect(userTurn.turnTokens.claudeMd).toBeGreaterThan(0);
      expect(userTurn.turnTokens.mentionedFiles).toBeGreaterThan(0);
      // User text ("Please review this.\n...Also check ") also tracked
      expect(userTurn.turnTokens.userMessages).toBeGreaterThan(0);
    });

    it('pure @-mentioned file content tracked independently from user text', () => {
      const content = 'Check @src/utils.ts for the helper function';
      const chunks: Chunk[] = [
        createUserChunk(content),
        createAIChunk([createAssistantMsg('Found it', 50, 10)]),
      ];
      const result = trackContext(chunks);
      const userTurn = result.perTurn[0];
      // mentionedFiles and userMessages are tracked independently
      expect(userTurn.turnTokens.mentionedFiles).toBeGreaterThan(0);
      expect(userTurn.turnTokens.claudeMd).toBe(0);
      // userMessages also gets tokens (independent tracking, no claudeMd to subtract)
      expect(userTurn.turnTokens.userMessages).toBeGreaterThan(0);
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

    it('creates separate toolOutputItem per individual tool call', () => {
      // 4 Read calls should produce 4 separate entries, not 1 aggregated "Read" entry
      const chunks: Chunk[] = [
        createUserChunk('Read four files'),
        createAIChunk([
          {
            uuid: 'a1',
            parentUuid: null,
            type: 'assistant',
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            content: [
              { type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: 'a.ts' } },
              { type: 'tool_use', id: 'tu_2', name: 'Read', input: { path: 'b.ts' } },
              { type: 'tool_use', id: 'tu_3', name: 'Read', input: { path: 'c.ts' } },
              { type: 'tool_use', id: 'tu_4', name: 'Read', input: { path: 'd.ts' } },
            ],
            usage: { input_tokens: 100, output_tokens: 50 },
            toolCalls: [],
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
              { type: 'tool_result', tool_use_id: 'tu_1', content: 'content of a.ts' },
              { type: 'tool_result', tool_use_id: 'tu_2', content: 'content of b.ts' },
              { type: 'tool_result', tool_use_id: 'tu_3', content: 'content of c.ts' },
              { type: 'tool_result', tool_use_id: 'tu_4', content: 'content of d.ts' },
            ],
            toolCalls: [],
            toolResults: [],
          } as ParsedMessage,
        ]),
      ];
      const result = trackContext(chunks);
      const aiTurn = result.perTurn[1];
      expect(aiTurn.toolOutputItems).toBeDefined();
      expect(aiTurn.toolOutputItems!).toHaveLength(4);
      // Each entry should be "Read" with non-zero tokens
      for (const item of aiTurn.toolOutputItems!) {
        expect(item.toolName).toBe('Read');
        expect(item.tokenCount).toBeGreaterThan(0);
      }
    });

    it('pairs tool_result with tool_use by id', () => {
      const chunks: Chunk[] = [
        createUserChunk('Run and read'),
        createAIChunk([
          {
            uuid: 'a1',
            parentUuid: null,
            type: 'assistant',
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            content: [
              { type: 'tool_use', id: 'tu_bash', name: 'Bash', input: { command: 'ls' } },
              { type: 'tool_use', id: 'tu_read', name: 'Read', input: { path: 'x.ts' } },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
            toolCalls: [],
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
              { type: 'tool_result', tool_use_id: 'tu_bash', content: 'file1.txt' },
              { type: 'tool_result', tool_use_id: 'tu_read', content: 'export const x = 1;' },
            ],
            toolCalls: [],
            toolResults: [],
          } as ParsedMessage,
        ]),
      ];
      const result = trackContext(chunks);
      const aiTurn = result.perTurn[1];
      expect(aiTurn.toolOutputItems).toBeDefined();
      expect(aiTurn.toolOutputItems!).toHaveLength(2);

      const bashEntry = aiTurn.toolOutputItems!.find(t => t.toolName === 'Bash');
      const readEntry = aiTurn.toolOutputItems!.find(t => t.toolName === 'Read');
      expect(bashEntry).toBeDefined();
      expect(readEntry).toBeDefined();
      // Each includes both call input + result tokens
      expect(bashEntry!.tokenCount).toBeGreaterThan(0);
      expect(readEntry!.tokenCount).toBeGreaterThan(0);
    });

    it('coordination tool results go to taskCoordination, not toolOutputs', () => {
      const chunks: Chunk[] = [
        createUserChunk('Create tasks'),
        createAIChunk([
          {
            uuid: 'a1',
            parentUuid: null,
            type: 'assistant',
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            content: [
              { type: 'tool_use', id: 'tu_tc', name: 'TaskCreate', input: { subject: 'do stuff' } },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
            toolCalls: [],
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
              { type: 'tool_result', tool_use_id: 'tu_tc', content: 'Task created: #1' },
            ],
            toolCalls: [],
            toolResults: [],
          } as ParsedMessage,
        ]),
      ];
      const result = trackContext(chunks);
      const aiTurn = result.perTurn[1];
      expect(aiTurn.turnTokens.taskCoordination).toBeGreaterThan(0);
      expect(aiTurn.turnTokens.toolOutputs).toBe(0);
      // Coordination items breakdown
      expect(aiTurn.taskCoordinationItems).toBeDefined();
      expect(aiTurn.taskCoordinationItems!).toHaveLength(1);
      expect(aiTurn.taskCoordinationItems![0].label).toBe('TaskCreate');
    });

    it('includes TaskList, TaskGet, and TeamDelete as coordination tools', () => {
      const coordNames = ['TaskList', 'TaskGet', 'TeamDelete'];
      for (const toolName of coordNames) {
        const chunks: Chunk[] = [
          createUserChunk('coord test'),
          createAIChunk([
            {
              uuid: 'a1',
              parentUuid: null,
              type: 'assistant',
              timestamp: new Date(),
              isSidechain: false,
              isMeta: false,
              content: [
                { type: 'tool_use', id: `tu_${toolName}`, name: toolName, input: {} },
              ],
              usage: { input_tokens: 50, output_tokens: 30 },
              toolCalls: [],
              toolResults: [],
            } as ParsedMessage,
          ]),
        ];
        const result = trackContext(chunks);
        const aiTurn = result.perTurn[1];
        expect(aiTurn.turnTokens.taskCoordination).toBeGreaterThan(0);
        expect(aiTurn.turnTokens.toolOutputs).toBe(0);
      }
    });

    it('thinking and text breakdown tracks separately', () => {
      const thinkingText = 'Let me analyze this complex problem step by step...';
      const outputText = 'The answer is 42.';
      const chunks: Chunk[] = [
        createUserChunk('What is the meaning of life?'),
        createAIChunk([
          {
            uuid: 'a1',
            parentUuid: null,
            type: 'assistant',
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            content: [
              { type: 'thinking', thinking: thinkingText, signature: 'sig' },
              { type: 'text', text: outputText },
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
      expect(aiTurn.thinkingTextDetail).toBeDefined();
      expect(aiTurn.thinkingTextDetail!.thinking).toBe(Math.ceil(thinkingText.length / 4));
      expect(aiTurn.thinkingTextDetail!.text).toBe(Math.ceil(outputText.length / 4));
      expect(aiTurn.turnTokens.thinkingText).toBe(
        aiTurn.thinkingTextDetail!.thinking + aiTurn.thinkingTextDetail!.text,
      );
    });

    it('CLAUDE.md detection splits per-file with correct token estimates', () => {
      const content =
        'Contents of /home/user/.claude/CLAUDE.md\n' +
        'Global instructions here, keep it simple.\n' +
        'Contents of /project/CLAUDE.md\n' +
        'Project-specific guidelines.';
      const chunks: Chunk[] = [
        createUserChunk(content),
        createAIChunk([createAssistantMsg('Got it', 50, 10)]),
      ];
      const result = trackContext(chunks);
      const userTurn = result.perTurn[0];
      expect(userTurn.claudeMdItems).toBeDefined();
      expect(userTurn.claudeMdItems!).toHaveLength(2);
      expect(userTurn.claudeMdItems![0].label).toContain('.claude/CLAUDE.md');
      expect(userTurn.claudeMdItems![1].label).toContain('/project/CLAUDE.md');
      // Each section has its own token estimate
      expect(userTurn.claudeMdItems![0].tokens).toBeGreaterThan(0);
      expect(userTurn.claudeMdItems![1].tokens).toBeGreaterThan(0);
      // Total claudeMd = sum of both sections
      expect(userTurn.turnTokens.claudeMd).toBe(
        userTurn.claudeMdItems![0].tokens + userTurn.claudeMdItems![1].tokens,
      );
    });

    it('user message tokens = remainder after CLAUDE.md extraction', () => {
      const userText = 'Please help me with this task.';
      const claudeMdSection = 'Contents of /home/user/.claude/CLAUDE.md\nDo not use emojis.';
      const fullContent = userText + '\n' + claudeMdSection;
      const chunks: Chunk[] = [
        createUserChunk(fullContent),
        createAIChunk([createAssistantMsg('Ok', 50, 10)]),
      ];
      const result = trackContext(chunks);
      const userTurn = result.perTurn[0];

      // claudeMd section tokens are extracted
      const claudeMdTokens = userTurn.turnTokens.claudeMd;
      expect(claudeMdTokens).toBeGreaterThan(0);

      // user message tokens = total - claudeMd tokens (remainder)
      const totalTokens = Math.ceil(fullContent.length / 4);
      expect(userTurn.turnTokens.userMessages).toBe(totalTokens - claudeMdTokens);
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
