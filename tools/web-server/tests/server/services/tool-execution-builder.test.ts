import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { buildToolExecutions } from '../../../src/server/services/tool-execution-builder.js';
import { parseSessionFile } from '../../../src/server/services/session-parser.js';
import type { ParsedMessage } from '../../../src/server/types/jsonl.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures');

describe('ToolExecutionBuilder', () => {
  describe('buildToolExecutions', () => {
    it('returns empty array for empty messages', () => {
      expect(buildToolExecutions([])).toEqual([]);
    });

    it('returns empty array for messages with no tool calls', () => {
      const messages: ParsedMessage[] = [
        {
          uuid: 'u1',
          parentUuid: null,
          type: 'user',
          timestamp: new Date('2026-02-25T10:00:00Z'),
          isSidechain: false,
          isMeta: false,
          content: 'Hello',
          toolCalls: [],
          toolResults: [],
        },
        {
          uuid: 'a1',
          parentUuid: 'u1',
          type: 'assistant',
          timestamp: new Date('2026-02-25T10:00:01Z'),
          isSidechain: false,
          isMeta: false,
          content: [{ type: 'text', text: 'Hi' }],
          toolCalls: [],
          toolResults: [],
        },
      ] as ParsedMessage[];
      expect(buildToolExecutions(messages)).toEqual([]);
    });

    it('matches tool_use to tool_result by sourceToolUseID', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'tool-calls.jsonl'));
      const executions = buildToolExecutions(messages);
      // Should find Bash, Read, and Edit tool executions
      expect(executions).toHaveLength(3);
      // All should be matched (not orphaned)
      expect(executions.every((e) => !e.isOrphaned)).toBe(true);
      expect(executions.map((e) => e.toolName)).toEqual(['Bash', 'Read', 'Edit']);
    });

    it('calculates correct duration in milliseconds', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'tool-calls.jsonl'));
      const executions = buildToolExecutions(messages);
      for (const exec of executions) {
        if (!exec.isOrphaned) {
          expect(exec.durationMs).toBeDefined();
          expect(exec.durationMs).toBeGreaterThanOrEqual(0);
          expect(exec.endTime).toBeDefined();
        }
      }
    });

    it('falls back to tool_result.tool_use_id matching', () => {
      // Create messages where sourceToolUseID is NOT set, but tool_result has tool_use_id
      const messages: ParsedMessage[] = [
        {
          uuid: 'a1',
          parentUuid: 'u1',
          type: 'assistant',
          timestamp: new Date('2026-02-25T10:00:01Z'),
          isSidechain: false,
          isMeta: false,
          content: [
            { type: 'tool_use', id: 'toolu_99', name: 'Bash', input: { command: 'echo hi' } },
          ],
          toolCalls: [
            { id: 'toolu_99', name: 'Bash', input: { command: 'echo hi' }, isTask: false },
          ],
          toolResults: [],
        },
        {
          uuid: 'tr1',
          parentUuid: 'a1',
          type: 'user',
          timestamp: new Date('2026-02-25T10:00:02Z'),
          isSidechain: false,
          isMeta: true,
          // NO sourceToolUseID — fallback to toolResult.toolUseId
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_99',
              content: 'hi',
              is_error: false,
            },
          ],
          toolCalls: [],
          toolResults: [{ toolUseId: 'toolu_99', content: 'hi', isError: false }],
        },
      ] as ParsedMessage[];

      const executions = buildToolExecutions(messages);
      expect(executions).toHaveLength(1);
      expect(executions[0].toolCallId).toBe('toolu_99');
      expect(executions[0].isOrphaned).toBe(false);
      expect(executions[0].durationMs).toBe(1000);
    });

    it('detects orphaned tool calls (no result)', () => {
      const messages: ParsedMessage[] = [
        {
          uuid: 'a1',
          parentUuid: 'u1',
          type: 'assistant',
          timestamp: new Date('2026-02-25T10:00:01Z'),
          isSidechain: false,
          isMeta: false,
          content: [],
          toolCalls: [
            { id: 'toolu_orphan', name: 'Bash', input: { command: 'sleep 100' }, isTask: false },
          ],
          toolResults: [],
        },
      ] as ParsedMessage[];

      const executions = buildToolExecutions(messages);
      expect(executions).toHaveLength(1);
      expect(executions[0].toolCallId).toBe('toolu_orphan');
      expect(executions[0].isOrphaned).toBe(true);
      expect(executions[0].result).toBeUndefined();
      expect(executions[0].endTime).toBeUndefined();
      expect(executions[0].durationMs).toBeUndefined();
    });

    it('selects the correct result by toolUseId when message has multiple tool results', () => {
      // Scenario: a message has sourceToolUseID='call-B' but toolResults[0] belongs to 'call-A'.
      // Without the fix, toolResults[0] (call-A's result) would be mis-attributed to call-B.
      const messages: ParsedMessage[] = [
        {
          uuid: 'a1',
          parentUuid: 'u1',
          type: 'assistant',
          timestamp: new Date('2026-02-25T10:00:01Z'),
          isSidechain: false,
          isMeta: false,
          content: [],
          toolCalls: [
            { id: 'call-A', name: 'Bash', input: { command: 'echo a' }, isTask: false },
            { id: 'call-B', name: 'Read', input: { path: '/x' }, isTask: false },
          ],
          toolResults: [],
        },
        {
          uuid: 'tr1',
          parentUuid: 'a1',
          type: 'user',
          timestamp: new Date('2026-02-25T10:00:02Z'),
          isSidechain: false,
          isMeta: true,
          sourceToolUseID: 'call-B',
          content: [],
          toolCalls: [],
          // toolResults[0] belongs to call-A, but sourceToolUseID points to call-B
          toolResults: [
            { toolUseId: 'call-A', content: 'output-a', isError: false },
            { toolUseId: 'call-B', content: 'output-b', isError: false },
          ],
        },
      ] as ParsedMessage[];

      const executions = buildToolExecutions(messages);
      const execB = executions.find((e) => e.toolCallId === 'call-B');
      expect(execB).toBeDefined();
      expect(execB!.isOrphaned).toBe(false);
      expect(execB!.result?.content).toBe('output-b');
    });

    it('results are sorted by start time', () => {
      const messages: ParsedMessage[] = [
        {
          uuid: 'a1',
          parentUuid: 'u1',
          type: 'assistant',
          timestamp: new Date('2026-02-25T10:00:05Z'), // later
          isSidechain: false,
          isMeta: false,
          content: [],
          toolCalls: [{ id: 'toolu_b', name: 'Read', input: {}, isTask: false }],
          toolResults: [],
        },
        {
          uuid: 'a2',
          parentUuid: 'u1',
          type: 'assistant',
          timestamp: new Date('2026-02-25T10:00:01Z'), // earlier
          isSidechain: false,
          isMeta: false,
          content: [],
          toolCalls: [{ id: 'toolu_a', name: 'Bash', input: {}, isTask: false }],
          toolResults: [],
        },
      ] as ParsedMessage[];

      const executions = buildToolExecutions(messages);
      expect(executions).toHaveLength(2);
      expect(executions[0].toolCallId).toBe('toolu_a'); // earlier start time
      expect(executions[1].toolCallId).toBe('toolu_b'); // later start time
    });
  });
});
