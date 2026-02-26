import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  classifyMessage,
  buildChunks,
  extractSemanticSteps,
} from '../../../src/server/services/chunk-builder.js';
import { parseSessionFile } from '../../../src/server/services/session-parser.js';
import { buildToolExecutions } from '../../../src/server/services/tool-execution-builder.js';
import type { ParsedMessage, AIChunk } from '../../../src/server/types/jsonl.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures');

describe('ChunkBuilder', () => {
  describe('classifyMessage', () => {
    it('classifies real user input as "user"', () => {
      const msg = {
        type: 'user',
        isMeta: false,
        content: 'Hello world',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('user');
    });

    it('classifies isMeta tool result user messages as "ai"', () => {
      const msg = {
        type: 'user',
        isMeta: true,
        content: [{ type: 'tool_result', tool_use_id: 'x', content: 'result' }],
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('ai');
    });

    it('classifies assistant messages as "ai"', () => {
      const msg = {
        type: 'assistant',
        isMeta: false,
        content: [{ type: 'text', text: 'Hello' }],
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('ai');
    });

    it('classifies system entry type as "hardNoise"', () => {
      const msg = {
        type: 'system',
        isMeta: true,
        content: '',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('hardNoise');
    });

    it('classifies summary entries as "hardNoise"', () => {
      const msg = {
        type: 'summary',
        content: 'Summary text',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('hardNoise');
    });

    it('classifies file-history-snapshot as "hardNoise"', () => {
      const msg = {
        type: 'file-history-snapshot',
        content: '',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('hardNoise');
    });

    it('classifies queue-operation as "hardNoise"', () => {
      const msg = {
        type: 'queue-operation',
        content: '',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('hardNoise');
    });

    it('classifies synthetic assistant as "hardNoise"', () => {
      const msg = {
        type: 'assistant',
        model: '<synthetic>',
        content: [{ type: 'text', text: '' }],
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('hardNoise');
    });

    it('classifies local-command-stdout as "system"', () => {
      const msg = {
        type: 'user',
        isMeta: false,
        content: '<local-command-stdout>Set model to sonnet</local-command-stdout>',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('system');
    });

    it('classifies system-reminder content as "hardNoise"', () => {
      const msg = {
        type: 'user',
        isMeta: false,
        content: '<system-reminder>Some reminder text</system-reminder>',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('hardNoise');
    });

    it('classifies local-command-caveat as "hardNoise"', () => {
      const msg = {
        type: 'user',
        isMeta: false,
        content: '<local-command-caveat>Warning</local-command-caveat>',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('hardNoise');
    });

    it('classifies interruption text as "ai" (recovered as interruption step)', () => {
      const msg = {
        type: 'user',
        isMeta: false,
        content: '[Request interrupted by user]',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('ai');
    });

    it('classifies "interrupted for tool use" text as "ai"', () => {
      const msg = {
        type: 'user',
        isMeta: false,
        content: '[Request interrupted by user for tool use]',
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('ai');
    });

    it('classifies non-isMeta user message with only tool_result blocks as "ai"', () => {
      const msg = {
        type: 'user',
        isMeta: false,
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'result text' }],
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('ai');
    });

    it('classifies non-isMeta user message with text blocks as "user"', () => {
      const msg = {
        type: 'user',
        isMeta: false,
        content: [{ type: 'text', text: 'Hello from the user' }],
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('user');
    });

    it('classifies non-isMeta user message with both text and tool_result blocks as "user"', () => {
      const msg = {
        type: 'user',
        isMeta: false,
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'result' },
          { type: 'text', text: 'And some user text' },
        ],
        toolCalls: [],
        toolResults: [],
      } as unknown as ParsedMessage;
      expect(classifyMessage(msg)).toBe('user');
    });
  });

  describe('buildChunks', () => {
    it('returns empty array for empty messages', () => {
      expect(buildChunks([])).toEqual([]);
    });

    it('produces [UserChunk, AIChunk, UserChunk, AIChunk] for simple conversation', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'simple-conversation.jsonl'));
      const chunks = buildChunks(messages);
      expect(chunks).toHaveLength(4);
      expect(chunks[0].type).toBe('user');
      expect(chunks[1].type).toBe('ai');
      expect(chunks[2].type).toBe('user');
      expect(chunks[3].type).toBe('ai');
    });

    it('groups tool call + result messages into single AIChunk', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'tool-calls.jsonl'));
      const chunks = buildChunks(messages);
      // Should be: UserChunk, AIChunk (containing all assistant + tool result messages)
      expect(chunks[0].type).toBe('user');
      expect(chunks[1].type).toBe('ai');
      const aiChunk = chunks[1] as { type: 'ai'; messages: ParsedMessage[] };
      // AI chunk should contain multiple messages (assistant + tool results)
      expect(aiChunk.messages.length).toBeGreaterThan(1);
    });

    it('creates CompactChunk for summary entries', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'compact-summary.jsonl'));
      const chunks = buildChunks(messages);
      const compactChunks = chunks.filter((c) => c.type === 'compact');
      expect(compactChunks).toHaveLength(1);
      expect((compactChunks[0] as { type: 'compact'; summary: string }).summary).toContain(
        'feature X',
      );
    });

    it('filters out hard noise entries', () => {
      const messages: ParsedMessage[] = [
        {
          uuid: 'u1',
          type: 'user',
          isMeta: false,
          content: 'Hello',
          timestamp: new Date(),
          isSidechain: false,
          toolCalls: [],
          toolResults: [],
        },
        {
          uuid: 'sys1',
          type: 'system',
          isMeta: true,
          content: '',
          timestamp: new Date(),
          isSidechain: false,
          toolCalls: [],
          toolResults: [],
        },
        {
          uuid: 'a1',
          type: 'assistant',
          isMeta: false,
          content: [{ type: 'text', text: 'Hi' }],
          timestamp: new Date(),
          isSidechain: false,
          toolCalls: [],
          toolResults: [],
        },
      ] as ParsedMessage[];
      const chunks = buildChunks(messages);
      // system entry is hard noise, filtered out
      // Should be: UserChunk, AIChunk
      expect(chunks).toHaveLength(2);
      expect(chunks[0].type).toBe('user');
      expect(chunks[1].type).toBe('ai');
    });

    it('classifies isMeta tool result messages as ai, not user', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'tool-calls.jsonl'));
      const chunks = buildChunks(messages);
      // The tool result messages (isMeta=true) should be inside AIChunks, not as separate UserChunks
      const userChunks = chunks.filter((c) => c.type === 'user');
      expect(userChunks).toHaveLength(1); // Only the initial real user message
    });

    it('creates SystemChunk for local-command-stdout messages', () => {
      const messages: ParsedMessage[] = [
        {
          uuid: 'u1',
          type: 'user',
          isMeta: false,
          content: 'Hello',
          timestamp: new Date('2026-02-25T10:00:00Z'),
          isSidechain: false,
          toolCalls: [],
          toolResults: [],
        },
        {
          uuid: 'cmd1',
          type: 'user',
          isMeta: false,
          content: '<local-command-stdout>Set model to sonnet</local-command-stdout>',
          timestamp: new Date('2026-02-25T10:00:01Z'),
          isSidechain: false,
          toolCalls: [],
          toolResults: [],
        },
        {
          uuid: 'a1',
          type: 'assistant',
          isMeta: false,
          content: [{ type: 'text', text: 'Done' }],
          timestamp: new Date('2026-02-25T10:00:02Z'),
          isSidechain: false,
          toolCalls: [],
          toolResults: [],
        },
      ] as ParsedMessage[];
      const chunks = buildChunks(messages);
      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe('user');
      expect(chunks[1].type).toBe('system');
      expect(chunks[2].type).toBe('ai');
    });

    it('groups assistant and non-isMeta tool_result messages into one AI chunk', () => {
      const now = new Date();
      const messages: ParsedMessage[] = [
        {
          uuid: 'u1',
          type: 'user',
          isMeta: false,
          content: 'Do something',
          timestamp: now,
          isSidechain: false,
          toolCalls: [],
          toolResults: [],
        },
        {
          uuid: 'a1',
          type: 'assistant',
          isMeta: false,
          content: [
            { type: 'text', text: 'Let me run a tool.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
          ],
          timestamp: now,
          isSidechain: false,
          toolCalls: [{ id: 'toolu_1', name: 'Bash', input: { command: 'ls' }, isTask: false }],
          toolResults: [],
        },
        {
          uuid: 'tr1',
          type: 'user',
          isMeta: false,
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file1.txt\nfile2.txt' },
          ],
          timestamp: now,
          isSidechain: false,
          toolCalls: [],
          toolResults: [{ toolUseId: 'toolu_1', content: 'file1.txt\nfile2.txt', isError: false }],
        },
        {
          uuid: 'a2',
          type: 'assistant',
          isMeta: false,
          content: [{ type: 'text', text: 'Here are the files.' }],
          timestamp: now,
          isSidechain: false,
          toolCalls: [],
          toolResults: [],
        },
      ] as ParsedMessage[];
      const chunks = buildChunks(messages);
      // Should be: 1 UserChunk + 1 AIChunk (all three AI-category messages merged)
      expect(chunks).toHaveLength(2);
      expect(chunks[0].type).toBe('user');
      expect(chunks[1].type).toBe('ai');
      const aiChunk = chunks[1] as { type: 'ai'; messages: ParsedMessage[] };
      expect(aiChunk.messages).toHaveLength(3);
    });

    it('handles malformed fixture gracefully', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'malformed.jsonl'));
      const chunks = buildChunks(messages);
      // Should still produce chunks from the valid entries
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('extractSemanticSteps', () => {
    it('extracts text output steps', () => {
      const chunk: AIChunk = {
        type: 'ai',
        messages: [
          {
            uuid: 'a1',
            type: 'assistant',
            content: [{ type: 'text', text: 'Hello world' }],
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            toolCalls: [],
            toolResults: [],
          },
        ] as ParsedMessage[],
        timestamp: new Date(),
      };
      const steps = extractSemanticSteps(chunk, []);
      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe('output');
      expect(steps[0].content).toBe('Hello world');
    });

    it('extracts thinking steps', () => {
      const chunk: AIChunk = {
        type: 'ai',
        messages: [
          {
            uuid: 'a1',
            type: 'assistant',
            content: [{ type: 'thinking', thinking: 'Let me think...', signature: 'sig' }],
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            toolCalls: [],
            toolResults: [],
          },
        ] as ParsedMessage[],
        timestamp: new Date(),
      };
      const steps = extractSemanticSteps(chunk, []);
      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe('thinking');
      expect(steps[0].content).toBe('Let me think...');
    });

    it('extracts tool_call steps with duration from executions', () => {
      const chunk: AIChunk = {
        type: 'ai',
        messages: [
          {
            uuid: 'a1',
            type: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }],
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            toolCalls: [{ id: 'toolu_1', name: 'Bash', input: { command: 'ls' }, isTask: false }],
            toolResults: [],
          },
        ] as ParsedMessage[],
        timestamp: new Date(),
      };
      const executions = [
        {
          toolCallId: 'toolu_1',
          toolName: 'Bash',
          input: {},
          startTime: new Date(),
          endTime: new Date(),
          durationMs: 500,
          isOrphaned: false,
        },
      ];
      const steps = extractSemanticSteps(chunk, executions);
      const toolStep = steps.find((s) => s.type === 'tool_call');
      expect(toolStep).toBeDefined();
      expect(toolStep!.toolName).toBe('Bash');
      expect(toolStep!.durationMs).toBe(500);
    });

    it('extracts subagent steps for Task tool calls', () => {
      const chunk: AIChunk = {
        type: 'ai',
        messages: [
          {
            uuid: 'a1',
            type: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_task',
                name: 'Task',
                input: { description: 'Search files', subagent_type: 'Explore' },
              },
            ],
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            toolCalls: [
              {
                id: 'toolu_task',
                name: 'Task',
                input: { description: 'Search files' },
                isTask: true,
                taskDescription: 'Search files',
                taskSubagentType: 'Explore',
              },
            ],
            toolResults: [],
          },
        ] as ParsedMessage[],
        timestamp: new Date(),
      };
      const steps = extractSemanticSteps(chunk, []);
      const subagentStep = steps.find((s) => s.type === 'subagent');
      expect(subagentStep).toBeDefined();
      expect(subagentStep!.content).toBe('Search files');
      expect(subagentStep!.subagentId).toBe('toolu_task');
    });

    it('extracts tool_result steps', () => {
      const chunk: AIChunk = {
        type: 'ai',
        messages: [
          {
            uuid: 'tr1',
            type: 'user',
            isMeta: true,
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: 'file.txt',
                is_error: false,
              },
            ],
            timestamp: new Date(),
            isSidechain: false,
            toolCalls: [],
            toolResults: [{ toolUseId: 'toolu_1', content: 'file.txt', isError: false }],
          },
        ] as ParsedMessage[],
        timestamp: new Date(),
      };
      const steps = extractSemanticSteps(chunk, []);
      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe('tool_result');
      expect(steps[0].content).toBe('file.txt');
      expect(steps[0].isError).toBe(false);
    });

    it('extracts interruption step from "[Request interrupted by user]" message', () => {
      const chunk: AIChunk = {
        type: 'ai',
        messages: [
          {
            uuid: 'a1',
            type: 'assistant',
            content: [{ type: 'text', text: 'Working on it...' }],
            timestamp: new Date(),
            isSidechain: false,
            isMeta: false,
            toolCalls: [],
            toolResults: [],
          },
          {
            uuid: 'int1',
            type: 'user',
            isMeta: false,
            content: '[Request interrupted by user]',
            timestamp: new Date(),
            isSidechain: false,
            toolCalls: [],
            toolResults: [],
          },
        ] as ParsedMessage[],
        timestamp: new Date(),
      };
      const steps = extractSemanticSteps(chunk, []);
      expect(steps).toHaveLength(2);
      expect(steps[0].type).toBe('output');
      expect(steps[1].type).toBe('interruption');
      expect(steps[1].content).toBe('[Request interrupted by user]');
    });

    it('extracts interruption step from "interrupted for tool use" message', () => {
      const chunk: AIChunk = {
        type: 'ai',
        messages: [
          {
            uuid: 'int1',
            type: 'user',
            isMeta: false,
            content: '[Request interrupted by user for tool use]',
            timestamp: new Date(),
            isSidechain: false,
            toolCalls: [],
            toolResults: [],
          },
        ] as ParsedMessage[],
        timestamp: new Date(),
      };
      const steps = extractSemanticSteps(chunk, []);
      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe('interruption');
      expect(steps[0].content).toBe('[Request interrupted by user for tool use]');
    });

    it('returns empty array for chunk with no content', () => {
      const chunk: AIChunk = { type: 'ai', messages: [], timestamp: new Date() };
      expect(extractSemanticSteps(chunk, [])).toEqual([]);
    });

    it('extracts steps from tool-calls fixture with executions', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'tool-calls.jsonl'));
      const chunks = buildChunks(messages);
      const executions = buildToolExecutions(messages);

      const aiChunks = chunks.filter((c) => c.type === 'ai') as AIChunk[];
      expect(aiChunks.length).toBeGreaterThan(0);

      const steps = extractSemanticSteps(aiChunks[0], executions);
      // Should have text output + tool call + tool result steps at minimum
      expect(steps.length).toBeGreaterThan(0);
      const toolCalls = steps.filter((s) => s.type === 'tool_call');
      expect(toolCalls.length).toBeGreaterThan(0);
    });
  });
});
