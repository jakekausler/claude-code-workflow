import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseJsonlLine, parseSessionFile } from '../../../src/server/services/session-parser.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures');

// ─── parseJsonlLine ─────────────────────────────────────────────────────────

describe('SessionParser', () => {
  describe('parseJsonlLine', () => {
    it('parses a user entry into ParsedMessage', () => {
      const line = JSON.stringify({
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        isSidechain: false,
        userType: 'external',
        cwd: '/project',
        sessionId: 's1',
        version: '2.1.56',
        gitBranch: 'main',
        message: { role: 'user', content: 'Hello world' },
        timestamp: '2026-02-25T10:00:00.000Z',
      });

      const msg = parseJsonlLine(line);
      expect(msg).not.toBeNull();
      expect(msg!.uuid).toBe('u1');
      expect(msg!.parentUuid).toBeNull();
      expect(msg!.type).toBe('user');
      expect(msg!.role).toBe('user');
      expect(msg!.content).toBe('Hello world');
      expect(msg!.isSidechain).toBe(false);
      expect(msg!.isMeta).toBe(false);
      expect(msg!.userType).toBe('external');
      expect(msg!.cwd).toBe('/project');
      expect(msg!.gitBranch).toBe('main');
      expect(msg!.timestamp).toEqual(new Date('2026-02-25T10:00:00.000Z'));
      expect(msg!.toolCalls).toEqual([]);
      expect(msg!.toolResults).toEqual([]);
    });

    it('parses an assistant entry with usage and model', () => {
      const line = JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        isSidechain: false,
        userType: 'external',
        cwd: '/project',
        sessionId: 's1',
        version: '2.1.56',
        gitBranch: 'main',
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_01',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 20 },
        },
        requestId: 'req_01',
        timestamp: '2026-02-25T10:00:01.000Z',
      });

      const msg = parseJsonlLine(line);
      expect(msg).not.toBeNull();
      expect(msg!.uuid).toBe('a1');
      expect(msg!.parentUuid).toBe('u1');
      expect(msg!.type).toBe('assistant');
      expect(msg!.role).toBe('assistant');
      expect(msg!.model).toBe('claude-sonnet-4-6');
      expect(msg!.usage).toEqual({ input_tokens: 100, output_tokens: 20 });
      expect(Array.isArray(msg!.content)).toBe(true);
      expect((msg!.content as unknown[])[0]).toEqual({ type: 'text', text: 'Hello!' });
    });

    it('extracts tool calls from assistant content blocks', () => {
      const line = JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        isSidechain: false,
        userType: 'external',
        cwd: '/project',
        sessionId: 's1',
        version: '2.1.56',
        gitBranch: 'main',
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_01',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Running command.' },
            { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ls -la' } },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 40 },
        },
        requestId: 'req_01',
        timestamp: '2026-02-25T10:00:01.000Z',
      });

      const msg = parseJsonlLine(line);
      expect(msg).not.toBeNull();
      expect(msg!.toolCalls).toHaveLength(1);
      expect(msg!.toolCalls[0]).toEqual({
        id: 'toolu_01',
        name: 'Bash',
        input: { command: 'ls -la' },
        isTask: false,
      });
    });

    it('extracts tool results from user content blocks (isMeta entries)', () => {
      const line = JSON.stringify({
        type: 'user',
        uuid: 'tr1',
        parentUuid: 'a1',
        isSidechain: false,
        userType: 'external',
        cwd: '/project',
        sessionId: 's1',
        version: '2.1.56',
        gitBranch: 'main',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01',
              content: 'file1.txt\nfile2.txt',
              is_error: false,
            },
          ],
        },
        isMeta: true,
        sourceToolUseID: 'toolu_01',
        sourceToolAssistantUUID: 'a1',
        timestamp: '2026-02-25T10:00:02.000Z',
      });

      const msg = parseJsonlLine(line);
      expect(msg).not.toBeNull();
      expect(msg!.isMeta).toBe(true);
      expect(msg!.toolResults).toHaveLength(1);
      expect(msg!.toolResults[0]).toEqual({
        toolUseId: 'toolu_01',
        content: 'file1.txt\nfile2.txt',
        isError: false,
      });
    });

    it('captures sourceToolUseID and sourceToolAssistantUUID', () => {
      const line = JSON.stringify({
        type: 'user',
        uuid: 'tr1',
        parentUuid: 'a1',
        isSidechain: false,
        userType: 'external',
        cwd: '/project',
        sessionId: 's1',
        version: '2.1.56',
        gitBranch: 'main',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'ok', is_error: false }],
        },
        isMeta: true,
        sourceToolUseID: 'toolu_01',
        sourceToolAssistantUUID: 'a1',
        timestamp: '2026-02-25T10:00:02.000Z',
      });

      const msg = parseJsonlLine(line);
      expect(msg).not.toBeNull();
      expect(msg!.sourceToolUseID).toBe('toolu_01');
      expect(msg!.sourceToolAssistantUUID).toBe('a1');
    });

    it('captures toolUseResult', () => {
      const line = JSON.stringify({
        type: 'user',
        uuid: 'tr1',
        parentUuid: 'a1',
        isSidechain: false,
        userType: 'external',
        cwd: '/project',
        sessionId: 's1',
        version: '2.1.56',
        gitBranch: 'main',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'output', is_error: false }],
        },
        isMeta: true,
        sourceToolUseID: 'toolu_01',
        sourceToolAssistantUUID: 'a1',
        toolUseResult: { stdout: 'output', stderr: '', interrupted: false },
        timestamp: '2026-02-25T10:00:02.000Z',
      });

      const msg = parseJsonlLine(line);
      expect(msg).not.toBeNull();
      expect(msg!.toolUseResult).toEqual({ stdout: 'output', stderr: '', interrupted: false });
    });

    it('detects Task tool calls (isTask = true)', () => {
      const line = JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        isSidechain: false,
        userType: 'external',
        cwd: '/project',
        sessionId: 's1',
        version: '2.1.56',
        gitBranch: 'main',
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_01',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_task1',
              name: 'Task',
              input: { description: 'Do something', subagent_type: 'Explore', prompt: 'Find files' },
            },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        requestId: 'req_01',
        timestamp: '2026-02-25T10:00:01.000Z',
      });

      const msg = parseJsonlLine(line);
      expect(msg).not.toBeNull();
      expect(msg!.toolCalls).toHaveLength(1);
      expect(msg!.toolCalls[0].isTask).toBe(true);
    });

    it('extracts taskDescription and taskSubagentType from Task input', () => {
      const line = JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        isSidechain: false,
        userType: 'external',
        cwd: '/project',
        sessionId: 's1',
        version: '2.1.56',
        gitBranch: 'main',
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_01',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_task1',
              name: 'Task',
              input: { description: 'Find all test files', subagent_type: 'Explore', prompt: 'Search' },
            },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        requestId: 'req_01',
        timestamp: '2026-02-25T10:00:01.000Z',
      });

      const msg = parseJsonlLine(line);
      expect(msg).not.toBeNull();
      expect(msg!.toolCalls[0].taskDescription).toBe('Find all test files');
      expect(msg!.toolCalls[0].taskSubagentType).toBe('Explore');
    });

    it('detects compact summaries', () => {
      const line = JSON.stringify({
        type: 'summary',
        summary: 'User asked about X and assistant explained Y.',
        leafUuid: 'a5',
        uuid: 'sum1',
        timestamp: '2026-02-25T10:05:00.000Z',
      });

      const msg = parseJsonlLine(line);
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('summary');
      expect(msg!.isCompactSummary).toBe(true);
      expect(msg!.content).toBe('User asked about X and assistant explained Y.');
      expect(msg!.uuid).toBe('sum1');
    });

    it('parses a system entry with isMeta forced to true', () => {
      const line = JSON.stringify({
        type: 'system',
        uuid: 'sys1',
        parentUuid: 'a1',
        isSidechain: false,
        userType: 'external',
        cwd: '/project',
        sessionId: 's1',
        version: '2.1.56',
        gitBranch: 'main',
        subtype: 'turn_duration',
        durationMs: 5000,
        isMeta: false, // intentionally false to verify it gets forced to true
        timestamp: '2026-02-25T10:00:00.000Z',
      });
      const result = parseJsonlLine(line);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('system');
      expect(result!.isMeta).toBe(true); // forced to true for system entries
    });

    it('parses a file-history-snapshot entry', () => {
      const line = JSON.stringify({
        type: 'file-history-snapshot',
        uuid: 'fhs1',
        messageId: 'msg1',
        snapshot: {
          messageId: 'msg1',
          trackedFileBackups: { 'src/index.ts': 'backup-hash-123' },
          timestamp: '2026-02-25T10:00:00.000Z',
        },
        isSnapshotUpdate: false,
        timestamp: '2026-02-25T10:00:00.000Z',
      });
      const result = parseJsonlLine(line);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('file-history-snapshot');
      expect(result!.isMeta).toBe(true);
      expect(result!.toolCalls).toEqual([]);
      expect(result!.toolResults).toEqual([]);
    });

    it('parses a queue-operation entry', () => {
      const line = JSON.stringify({
        type: 'queue-operation',
        uuid: 'qo1',
        operation: 'enqueue',
        sessionId: 's1',
        content: '{"task":"run tests"}',
        timestamp: '2026-02-25T10:00:00.000Z',
      });
      const result = parseJsonlLine(line);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('queue-operation');
      expect(result!.isMeta).toBe(true);
      expect(result!.content).toBe('{"task":"run tests"}');
    });

    it('returns null for unknown entry types', () => {
      const line = JSON.stringify({
        type: 'unknown_future_type',
        uuid: 'unk1',
        timestamp: '2026-02-25T10:00:00.000Z',
      });
      const result = parseJsonlLine(line);
      expect(result).toBeNull();
    });

    it('returns null for non-object JSON values', () => {
      expect(parseJsonlLine('"just a string"')).toBeNull();
      expect(parseJsonlLine('42')).toBeNull();
      expect(parseJsonlLine('true')).toBeNull();
      expect(parseJsonlLine('null')).toBeNull();
      expect(parseJsonlLine('[1, 2, 3]')).toBeNull();
    });

    it('returns null for entries without uuid (progress entries)', () => {
      const line = JSON.stringify({ type: 'progress', percent: 50 });
      expect(parseJsonlLine(line)).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(parseJsonlLine('this is not valid json')).toBeNull();
    });

    it('returns null for empty lines', () => {
      expect(parseJsonlLine('')).toBeNull();
      expect(parseJsonlLine('  ')).toBeNull();
      expect(parseJsonlLine('\t')).toBeNull();
    });
  });

  // ─── parseSessionFile ───────────────────────────────────────────────────────

  describe('parseSessionFile', () => {
    it('parses simple-conversation.jsonl into 4 messages', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'simple-conversation.jsonl'));
      expect(messages).toHaveLength(4);

      expect(messages[0].type).toBe('user');
      expect(messages[0].uuid).toBe('u1');
      expect(messages[0].content).toBe('Hello, what files are in this directory?');

      expect(messages[1].type).toBe('assistant');
      expect(messages[1].uuid).toBe('a1');
      expect(messages[1].model).toBe('claude-sonnet-4-6');

      expect(messages[2].type).toBe('user');
      expect(messages[2].uuid).toBe('u2');
      expect(messages[2].parentUuid).toBe('a1');

      expect(messages[3].type).toBe('assistant');
      expect(messages[3].uuid).toBe('a2');
      expect(messages[3].usage).toEqual({ input_tokens: 150, output_tokens: 30 });
    });

    it('parses tool-calls.jsonl with tool calls and results', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'tool-calls.jsonl'));
      expect(messages).toHaveLength(8);

      // First assistant has Bash tool call
      const assistant1 = messages[1];
      expect(assistant1.toolCalls).toHaveLength(1);
      expect(assistant1.toolCalls[0].name).toBe('Bash');
      expect(assistant1.toolCalls[0].input).toEqual({ command: 'ls -la' });

      // Bash tool result message
      const toolResult1 = messages[2];
      expect(toolResult1.isMeta).toBe(true);
      expect(toolResult1.toolResults).toHaveLength(1);
      expect(toolResult1.toolResults[0].toolUseId).toBe('toolu_01');
      expect(toolResult1.sourceToolUseID).toBe('toolu_01');
      expect(toolResult1.sourceToolAssistantUUID).toBe('a1');
      expect(toolResult1.toolUseResult).toEqual({
        stdout: 'total 32\ndrwxr-xr-x...',
        stderr: '',
        interrupted: false,
      });

      // Second assistant has Read tool call
      const assistant2 = messages[3];
      expect(assistant2.toolCalls).toHaveLength(1);
      expect(assistant2.toolCalls[0].name).toBe('Read');

      // Read tool result
      const toolResult2 = messages[4];
      expect(toolResult2.toolResults).toHaveLength(1);
      expect(toolResult2.toolResults[0].toolUseId).toBe('toolu_02');

      // Third assistant has Edit tool call
      const assistant3 = messages[5];
      expect(assistant3.toolCalls).toHaveLength(1);
      expect(assistant3.toolCalls[0].name).toBe('Edit');
      expect(assistant3.toolCalls[0].input).toEqual({
        file_path: '/project/README.md',
        old_string: 'A sample project.',
        new_string: 'A sample project with utilities and tests.',
      });

      // Edit tool result
      const toolResult3 = messages[6];
      expect(toolResult3.isMeta).toBe(true);
      expect(toolResult3.toolResults).toHaveLength(1);
      expect(toolResult3.toolResults[0].toolUseId).toBe('toolu_03');
      expect(toolResult3.sourceToolUseID).toBe('toolu_03');
      expect(toolResult3.sourceToolAssistantUUID).toBe('a3');

      // Final assistant — no tool calls
      const assistant4 = messages[7];
      expect(assistant4.toolCalls).toHaveLength(0);
      expect(assistant4.uuid).toBe('a4');
    });

    it('parses subagent-session.jsonl with Task tool calls', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'subagent-session.jsonl'));
      expect(messages).toHaveLength(4);

      const taskAssistant = messages[1];
      expect(taskAssistant.toolCalls).toHaveLength(1);
      expect(taskAssistant.toolCalls[0].isTask).toBe(true);
      expect(taskAssistant.toolCalls[0].name).toBe('Task');
      expect(taskAssistant.toolCalls[0].taskDescription).toBe('Find all test files in the project');
      expect(taskAssistant.toolCalls[0].taskSubagentType).toBe('Explore');

      // Task result
      const taskResult = messages[2];
      expect(taskResult.isMeta).toBe(true);
      expect(taskResult.toolUseResult).toEqual({
        agentId: 'abc123',
        result: 'Found 15 test files',
      });
    });

    it('parses compact-summary.jsonl with summary entry', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'compact-summary.jsonl'));
      expect(messages).toHaveLength(5);

      const summary = messages[2];
      expect(summary.type).toBe('summary');
      expect(summary.isCompactSummary).toBe(true);
      expect(summary.content).toBe(
        'The user asked to implement feature X. The assistant began working on it and created initial scaffolding.',
      );
      expect(summary.uuid).toBe('sum1');
    });

    it('handles malformed.jsonl — skips bad lines, filters progress, parses valid entries', async () => {
      const { messages } = await parseSessionFile(join(fixturesDir, 'malformed.jsonl'));
      // Only user (u1) and assistant (a1) should survive:
      // - "this is not valid json" → invalid JSON, skipped
      // - progress entry → no uuid, skipped
      // - empty line → skipped
      expect(messages).toHaveLength(2);
      expect(messages[0].uuid).toBe('u1');
      expect(messages[0].type).toBe('user');
      expect(messages[1].uuid).toBe('a1');
      expect(messages[1].type).toBe('assistant');
    });

    it('handles empty.jsonl — returns empty array', async () => {
      const { messages, bytesRead } = await parseSessionFile(join(fixturesDir, 'empty.jsonl'));
      expect(messages).toHaveLength(0);
      expect(bytesRead).toBe(0);
    });

    it('returns accurate bytesRead count', async () => {
      const { bytesRead } = await parseSessionFile(join(fixturesDir, 'simple-conversation.jsonl'));
      expect(bytesRead).toBeGreaterThan(0);
      expect(typeof bytesRead).toBe('number');
    });

    it('supports incremental parsing with startOffset', async () => {
      // First, parse the full file
      const full = await parseSessionFile(join(fixturesDir, 'simple-conversation.jsonl'));
      expect(full.messages).toHaveLength(4);

      // Parse from a non-zero offset — should get fewer messages or different bytesRead
      const midOffset = Math.floor(full.bytesRead / 2);
      const partial = await parseSessionFile(join(fixturesDir, 'simple-conversation.jsonl'), {
        startOffset: midOffset,
      });

      // The partial parse should have fewer bytes
      expect(partial.bytesRead).toBe(full.bytesRead - midOffset);
      // It should have fewer messages (the first line will likely be corrupted by mid-line split)
      expect(partial.messages.length).toBeLessThan(full.messages.length);
    });

    it('returns empty for non-existent file', async () => {
      const { messages, bytesRead } = await parseSessionFile('/tmp/does-not-exist-12345.jsonl');
      expect(messages).toHaveLength(0);
      expect(bytesRead).toBe(0);
    });
  });
});
