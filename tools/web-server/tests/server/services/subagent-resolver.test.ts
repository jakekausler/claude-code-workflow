import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveSubagents } from '../../../src/server/services/subagent-resolver.js';
import type { ParsedMessage } from '../../../src/server/types/jsonl.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures');

describe('SubagentResolver', () => {
  const tmpDirs: string[] = [];

  function createTempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    tmpDirs.length = 0;
  });

  describe('resolveSubagents', () => {
    it('returns empty array when no subagent files exist', async () => {
      const tmpDir = createTempProject();
      const result = await resolveSubagents([], { projectDir: tmpDir, sessionId: 'nonexistent' });
      expect(result).toEqual([]);
    });

    it('discovers subagent files in new directory structure', async () => {
      const tmpDir = createTempProject();
      const sessionId = 'test-session';
      const subagentDir = join(tmpDir, sessionId, 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      cpSync(
        join(fixturesDir, 'subagents', 'agent-abc123.jsonl'),
        join(subagentDir, 'agent-abc123.jsonl'),
      );

      const parentMessages = createParentWithTaskCall('toolu_task1', 'abc123');
      const result = await resolveSubagents(parentMessages, { projectDir: tmpDir, sessionId });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abc123');
    });

    it('discovers subagent files in legacy directory structure', async () => {
      const tmpDir = createTempProject();
      cpSync(
        join(fixturesDir, 'subagents', 'agent-abc123.jsonl'),
        join(tmpDir, 'agent-abc123.jsonl'),
      );

      const parentMessages = createParentWithTaskCall('toolu_task1', 'abc123');
      const result = await resolveSubagents(parentMessages, {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abc123');
    });

    it('filters out warmup agents', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      // Warmup agent: first message content is "Warmup"
      writeFileSync(
        join(subagentDir, 'agent-warmup1.jsonl'),
        JSON.stringify({
          type: 'user',
          uuid: 'w1',
          parentUuid: null,
          isSidechain: true,
          userType: 'external',
          cwd: '/p',
          sessionId: 's1',
          version: '2.1.56',
          gitBranch: 'main',
          message: { role: 'user', content: 'Warmup' },
          timestamp: '2026-02-25T10:00:00.000Z',
        }) + '\n',
      );
      const result = await resolveSubagents([], {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result).toEqual([]);
    });

    it('filters out compact files', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      cpSync(
        join(fixturesDir, 'subagents', 'agent-abc123.jsonl'),
        join(subagentDir, 'agent-acompact123.jsonl'),
      );
      const result = await resolveSubagents([], {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result).toEqual([]);
    });

    it('filters out empty files', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      writeFileSync(join(subagentDir, 'agent-empty1.jsonl'), '');
      const result = await resolveSubagents([], {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result).toEqual([]);
    });

    it('links via result-based matching (toolUseResult.agentId)', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      cpSync(
        join(fixturesDir, 'subagents', 'agent-abc123.jsonl'),
        join(subagentDir, 'agent-abc123.jsonl'),
      );

      const parentMessages = createParentWithTaskCall('toolu_task1', 'abc123');
      const result = await resolveSubagents(parentMessages, {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result).toHaveLength(1);
      expect(result[0].parentTaskId).toBe('toolu_task1');
      expect(result[0].description).toBe('Search files');
    });

    it('uses positional fallback for unmatched agents', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      cpSync(
        join(fixturesDir, 'subagents', 'agent-abc123.jsonl'),
        join(subagentDir, 'agent-abc123.jsonl'),
      );

      // Parent has a task call but NO toolUseResult linking
      const parentMessages: ParsedMessage[] = [
        {
          uuid: 'a1',
          parentUuid: null,
          type: 'assistant',
          timestamp: new Date('2026-02-25T10:00:01Z'),
          isSidechain: false,
          isMeta: false,
          content: [],
          toolCalls: [
            {
              id: 'toolu_unlinked',
              name: 'Task',
              input: { description: 'Do something' },
              isTask: true,
              taskDescription: 'Do something',
            },
          ],
          toolResults: [],
        },
      ] as ParsedMessage[];

      const result = await resolveSubagents(parentMessages, {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result).toHaveLength(1);
      expect(result[0].parentTaskId).toBe('toolu_unlinked');
    });

    it('detects parallel subagents (start times within 100ms)', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      // Both fixtures have start times within 100ms (10:00:02.000 and 10:00:02.050)
      cpSync(
        join(fixturesDir, 'subagents', 'agent-abc123.jsonl'),
        join(subagentDir, 'agent-abc123.jsonl'),
      );
      cpSync(
        join(fixturesDir, 'subagents', 'agent-def456.jsonl'),
        join(subagentDir, 'agent-def456.jsonl'),
      );

      const parentMessages = createParentWithTwoTaskCalls();
      const result = await resolveSubagents(parentMessages, {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result).toHaveLength(2);
      expect(result[0].isParallel).toBe(true);
      expect(result[1].isParallel).toBe(true);
    });

    it('calculates metrics per subagent', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      cpSync(
        join(fixturesDir, 'subagents', 'agent-abc123.jsonl'),
        join(subagentDir, 'agent-abc123.jsonl'),
      );

      const parentMessages = createParentWithTaskCall('toolu_task1', 'abc123');
      const result = await resolveSubagents(parentMessages, {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result[0].metrics.inputTokens).toBe(50);
      expect(result[0].metrics.outputTokens).toBe(15);
      expect(result[0].metrics.totalTokens).toBe(65);
      expect(result[0].metrics.turnCount).toBe(1);
    });

    it('links via description-based matching (teammate-message summary)', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });

      // Create a subagent file whose first user message contains <teammate-message summary="...">
      const teammateAgent = [
        JSON.stringify({
          type: 'user',
          uuid: 'tu1',
          parentUuid: null,
          isSidechain: true,
          userType: 'external',
          cwd: '/project',
          sessionId: 's1',
          version: '2.1.56',
          gitBranch: 'main',
          message: {
            role: 'user',
            content:
              '<teammate-message summary="Implement authentication">Please implement the auth module.</teammate-message>',
          },
          timestamp: '2026-02-25T10:00:03.000Z',
          agentId: 'team1',
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'ta1',
          parentUuid: 'tu1',
          isSidechain: true,
          userType: 'external',
          cwd: '/project',
          sessionId: 's1',
          version: '2.1.56',
          gitBranch: 'main',
          message: {
            model: 'claude-sonnet-4-6',
            id: 'msg_t1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Auth module implemented.' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 60, output_tokens: 10 },
          },
          requestId: 'req_t1',
          timestamp: '2026-02-25T10:00:05.000Z',
          agentId: 'team1',
        }),
      ]
        .join('\n')
        .concat('\n');
      writeFileSync(join(subagentDir, 'agent-team1.jsonl'), teammateAgent);

      // Parent has a Task call with description matching the summary, but NO toolUseResult.agentId
      const parentMessages: ParsedMessage[] = [
        {
          uuid: 'a1',
          parentUuid: null,
          type: 'assistant',
          timestamp: new Date('2026-02-25T10:00:01Z'),
          isSidechain: false,
          isMeta: false,
          content: [],
          toolCalls: [
            {
              id: 'toolu_team',
              name: 'Task',
              input: { description: 'Implement authentication' },
              isTask: true,
              taskDescription: 'Implement authentication',
            },
          ],
          toolResults: [],
        },
      ] as ParsedMessage[];

      const result = await resolveSubagents(parentMessages, {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result).toHaveLength(1);
      expect(result[0].parentTaskId).toBe('toolu_team');
      expect(result[0].description).toBe('Implement authentication');
    });

    it('detects ongoing subagent (last message has unresolved tool_use)', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });

      // Create a subagent that ends with a tool_use (no result followed)
      const ongoingAgent = [
        JSON.stringify({
          type: 'user',
          uuid: 'ou1',
          parentUuid: null,
          isSidechain: true,
          userType: 'external',
          cwd: '/project',
          sessionId: 's1',
          version: '2.1.56',
          gitBranch: 'main',
          message: { role: 'user', content: 'Read file' },
          timestamp: '2026-02-25T10:00:00.000Z',
          agentId: 'ongoing1',
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'oa1',
          parentUuid: 'ou1',
          isSidechain: true,
          userType: 'external',
          cwd: '/project',
          sessionId: 's1',
          version: '2.1.56',
          gitBranch: 'main',
          message: {
            model: 'claude-sonnet-4-6',
            id: 'msg_o1',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_ongoing',
                name: 'Read',
                input: { file_path: '/test.txt' },
              },
            ],
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: { input_tokens: 30, output_tokens: 15 },
          },
          requestId: 'req_o1',
          timestamp: '2026-02-25T10:00:01.000Z',
          agentId: 'ongoing1',
        }),
      ]
        .join('\n')
        .concat('\n');
      writeFileSync(join(subagentDir, 'agent-ongoing1.jsonl'), ongoingAgent);

      const result = await resolveSubagents([], {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result).toHaveLength(1);
      expect(result[0].isOngoing).toBe(true);
    });

    it('marks completed subagent as not ongoing', async () => {
      const tmpDir = createTempProject();
      const subagentDir = join(tmpDir, 'test-session', 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      cpSync(
        join(fixturesDir, 'subagents', 'agent-abc123.jsonl'),
        join(subagentDir, 'agent-abc123.jsonl'),
      );

      const parentMessages = createParentWithTaskCall('toolu_task1', 'abc123');
      const result = await resolveSubagents(parentMessages, {
        projectDir: tmpDir,
        sessionId: 'test-session',
      });
      expect(result[0].isOngoing).toBe(false);
    });
  });
});

// Helper: create parent messages with a Task tool call that has result linking
function createParentWithTaskCall(callId: string, agentId: string): ParsedMessage[] {
  return [
    {
      uuid: 'a1',
      parentUuid: null,
      type: 'assistant',
      timestamp: new Date('2026-02-25T10:00:01Z'),
      isSidechain: false,
      isMeta: false,
      content: [],
      toolCalls: [
        {
          id: callId,
          name: 'Task',
          input: { description: 'Search files' },
          isTask: true,
          taskDescription: 'Search files',
          taskSubagentType: 'Explore',
        },
      ],
      toolResults: [],
    },
    {
      uuid: 'tr1',
      parentUuid: 'a1',
      type: 'user',
      timestamp: new Date('2026-02-25T10:00:10Z'),
      isSidechain: false,
      isMeta: true,
      content: [
        { type: 'tool_result', tool_use_id: callId, content: 'Found 15 files', is_error: false },
      ],
      toolCalls: [],
      toolResults: [{ toolUseId: callId, content: 'Found 15 files', isError: false }],
      sourceToolUseID: callId,
      sourceToolAssistantUUID: 'a1',
      toolUseResult: { agentId: agentId, result: 'Found 15 files' },
    },
  ] as ParsedMessage[];
}

function createParentWithTwoTaskCalls(): ParsedMessage[] {
  return [
    {
      uuid: 'a1',
      parentUuid: null,
      type: 'assistant',
      timestamp: new Date('2026-02-25T10:00:01Z'),
      isSidechain: false,
      isMeta: false,
      content: [],
      toolCalls: [
        {
          id: 'toolu_t1',
          name: 'Task',
          input: { description: 'Search' },
          isTask: true,
          taskDescription: 'Search',
        },
        {
          id: 'toolu_t2',
          name: 'Task',
          input: { description: 'Read config' },
          isTask: true,
          taskDescription: 'Read config',
        },
      ],
      toolResults: [],
    },
    {
      uuid: 'tr1',
      parentUuid: 'a1',
      type: 'user',
      timestamp: new Date('2026-02-25T10:00:10Z'),
      isSidechain: false,
      isMeta: true,
      content: [],
      toolCalls: [],
      toolResults: [{ toolUseId: 'toolu_t1', content: 'done', isError: false }],
      sourceToolUseID: 'toolu_t1',
      toolUseResult: { agentId: 'abc123' },
    },
    {
      uuid: 'tr2',
      parentUuid: 'a1',
      type: 'user',
      timestamp: new Date('2026-02-25T10:00:11Z'),
      isSidechain: false,
      isMeta: true,
      content: [],
      toolCalls: [],
      toolResults: [{ toolUseId: 'toolu_t2', content: 'done', isError: false }],
      sourceToolUseID: 'toolu_t2',
      toolUseResult: { agentId: 'def456' },
    },
  ] as ParsedMessage[];
}
