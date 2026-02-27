// Project test conventions discovered:
// - Framework: Vitest with describe/it/expect from 'vitest'
// - Imports use .js extensions (ESM)
// - Temp dirs created with mkdtempSync, cleaned in afterEach with rmSync
// - Inline JSONL fixtures (JSON.stringify) rather than fixture files for incremental tests
// - No mocking — uses real SessionPipeline class

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, truncateSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionPipeline } from '../../../src/server/services/session-pipeline.js';
import { parseSessionFile } from '../../../src/server/services/session-parser.js';
import type { EnhancedAIChunk } from '../../../src/server/types/jsonl.js';

// ─── JSONL line builders ───────────────────────────────────────────────────────

function makeUserLine(uuid: string, parentUuid: string | null, content: string, timestamp: string): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 'test-session',
    version: '2.1.56',
    gitBranch: 'main',
    message: { role: 'user', content },
    timestamp,
  });
}

function makeAssistantLine(
  uuid: string,
  parentUuid: string | null,
  timestamp: string,
  inputTokens = 100,
  outputTokens = 50,
): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 'test-session',
    version: '2.1.56',
    gitBranch: 'main',
    message: {
      model: 'claude-sonnet-4-6',
      id: `msg_${uuid}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: `Response from ${uuid}` }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
    requestId: `req_${uuid}`,
    timestamp,
  });
}

function makeAssistantWithToolLine(
  uuid: string,
  parentUuid: string | null,
  toolId: string,
  toolName: string,
  timestamp: string,
): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd: '/project',
    sessionId: 'test-session',
    version: '2.1.56',
    gitBranch: 'main',
    message: {
      model: 'claude-sonnet-4-6',
      id: `msg_${uuid}`,
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Running tool' },
        { type: 'tool_use', id: toolId, name: toolName, input: { command: 'ls' } },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 120, output_tokens: 60 },
    },
    requestId: `req_${uuid}`,
    timestamp,
  });
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe('SessionPipeline.parseIncremental', () => {
  let tmpDir: string;
  let pipeline: SessionPipeline;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-pipeline-incremental-'));
    pipeline = new SessionPipeline({ cacheSizeMB: 1 });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('returns empty update when file does not exist', async () => {
    const result = await pipeline.parseIncremental('/nonexistent-dir-xyz', 'missing-session', 0);

    expect(result.newMessages).toEqual([]);
    expect(result.newChunks).toEqual([]);
    expect(result.newOffset).toBe(0);
    expect(result.requiresFullRefresh).toBe(false);
    expect(result.isOngoing).toBe(false);
    expect(result.metrics.totalTokens).toBe(0);
    expect(result.metrics.inputTokens).toBe(0);
    expect(result.metrics.outputTokens).toBe(0);
    expect(result.metrics.turnCount).toBe(0);
    expect(result.metrics.toolCallCount).toBe(0);
    expect(result.metrics.duration).toBe(0);
    expect(result.metrics.totalCost).toBe(0);
  });

  it('returns requiresFullRefresh when file has shrunk', async () => {
    // Write a file with two lines
    const initialContent =
      makeUserLine('u1', null, 'Hello', '2025-01-01T10:00:00.000Z') +
      '\n' +
      makeAssistantLine('a1', 'u1', '2025-01-01T10:00:01.000Z') +
      '\n';
    const filePath = join(tmpDir, 'shrink-test.jsonl');
    writeFileSync(filePath, initialContent);

    // Record the full size as the "last known offset"
    const lastOffset = Buffer.byteLength(initialContent, 'utf8');

    // Truncate the file to simulate session reset
    truncateSync(filePath, 10);

    const result = await pipeline.parseIncremental(tmpDir, 'shrink-test', lastOffset);

    expect(result.requiresFullRefresh).toBe(true);
    expect(result.newOffset).toBe(10);
    expect(result.newMessages).toEqual([]);
    expect(result.newChunks).toEqual([]);
  });

  it('returns empty update when file has not grown', async () => {
    const content =
      makeUserLine('u1', null, 'Hello', '2025-01-01T10:00:00.000Z') +
      '\n' +
      makeAssistantLine('a1', 'u1', '2025-01-01T10:00:01.000Z') +
      '\n';
    writeFileSync(join(tmpDir, 'no-change.jsonl'), content);

    // Parse the full file to get its actual byte count
    const filePath = join(tmpDir, 'no-change.jsonl');
    const { bytesRead } = await parseSessionFile(filePath);
    const fileOffset = bytesRead;

    // Call parseIncremental with offset at end of file
    const result = await pipeline.parseIncremental(tmpDir, 'no-change', fileOffset);

    expect(result.newMessages).toEqual([]);
    expect(result.newChunks).toEqual([]);
    expect(result.requiresFullRefresh).toBe(false);
    expect(result.newOffset).toBe(fileOffset);
    expect(result.metrics.totalTokens).toBe(0);
  });

  it('returns new messages and chunks when file has grown', async () => {
    // Write initial content: user + assistant
    const initialLines =
      makeUserLine('u1', null, 'Hello', '2025-01-01T10:00:00.000Z') +
      '\n' +
      makeAssistantLine('a1', 'u1', '2025-01-01T10:00:01.000Z', 100, 50) +
      '\n';
    const filePath = join(tmpDir, 'growing.jsonl');
    writeFileSync(filePath, initialLines);

    // Parse initial content to record the offset
    const { bytesRead: initialOffset } = await parseSessionFile(filePath);

    // Append new messages to simulate file growth
    const newLines =
      makeUserLine('u2', 'a1', 'Follow-up question', '2025-01-01T10:00:05.000Z') +
      '\n' +
      makeAssistantLine('a2', 'u2', '2025-01-01T10:00:10.000Z', 150, 75) +
      '\n';
    writeFileSync(filePath, initialLines + newLines);

    const result = await pipeline.parseIncremental(tmpDir, 'growing', initialOffset);

    // Should have 2 new messages
    expect(result.newMessages).toHaveLength(2);
    expect(result.newMessages[0].uuid).toBe('u2');
    expect(result.newMessages[0].type).toBe('user');
    expect(result.newMessages[1].uuid).toBe('a2');
    expect(result.newMessages[1].type).toBe('assistant');

    // Should have 2 new chunks (user + ai)
    expect(result.newChunks).toHaveLength(2);
    expect(result.newChunks[0].type).toBe('user');
    expect(result.newChunks[1].type).toBe('ai');

    // Offset advanced beyond initial
    expect(result.newOffset).toBeGreaterThan(initialOffset);

    // No full refresh needed
    expect(result.requiresFullRefresh).toBe(false);

    // Metrics reflect only the new messages (1 assistant turn)
    expect(result.metrics.inputTokens).toBe(150);
    expect(result.metrics.outputTokens).toBe(75);
    expect(result.metrics.turnCount).toBe(1);

    // Not ongoing — last message is assistant
    expect(result.isOngoing).toBe(false);
  });

  it('produces enhanced AI chunks with semanticSteps', async () => {
    // Write initial content: user + assistant-with-tool + tool-result
    const toolAssistantLine = makeAssistantWithToolLine(
      'a1',
      'u1',
      'toolu_bash1',
      'Bash',
      '2025-01-01T10:00:01.000Z',
    );
    const toolResultLine = JSON.stringify({
      type: 'user',
      uuid: 'tr1',
      parentUuid: 'a1',
      isSidechain: false,
      userType: 'external',
      cwd: '/project',
      sessionId: 'test-session',
      version: '2.1.56',
      gitBranch: 'main',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_bash1',
            content: 'file1.txt\nfile2.txt',
            is_error: false,
          },
        ],
      },
      isMeta: true,
      sourceToolUseID: 'toolu_bash1',
      sourceToolAssistantUUID: 'a1',
      timestamp: '2025-01-01T10:00:02.000Z',
    });

    const filePath = join(tmpDir, 'with-tool.jsonl');
    const initialContent =
      makeUserLine('u1', null, 'Run a command', '2025-01-01T10:00:00.000Z') + '\n';
    writeFileSync(filePath, initialContent);

    const { bytesRead: initialOffset } = await parseSessionFile(filePath);

    // Append the assistant + tool result
    const newContent = toolAssistantLine + '\n' + toolResultLine + '\n';
    writeFileSync(filePath, initialContent + newContent);

    const result = await pipeline.parseIncremental(tmpDir, 'with-tool', initialOffset);

    // Find the AI chunk
    const aiChunks = result.newChunks.filter((c) => c.type === 'ai');
    expect(aiChunks.length).toBeGreaterThan(0);

    // Enhanced AI chunk should have semanticSteps
    const aiChunk = aiChunks[0] as EnhancedAIChunk;
    expect(aiChunk).toHaveProperty('semanticSteps');
    expect(Array.isArray(aiChunk.semanticSteps)).toBe(true);
    expect(aiChunk.semanticSteps.length).toBeGreaterThan(0);
  });

  it('detects ongoing session when last message is from user', async () => {
    // Write a file ending with a user message (no assistant response yet)
    const content =
      makeUserLine('u1', null, 'Hello', '2025-01-01T10:00:00.000Z') +
      '\n' +
      makeAssistantLine('a1', 'u1', '2025-01-01T10:00:01.000Z') +
      '\n';
    const filePath = join(tmpDir, 'ongoing.jsonl');
    writeFileSync(filePath, content);

    const { bytesRead: initialOffset } = await parseSessionFile(filePath);

    // Append a user message with no following assistant response
    const pendingUserLine =
      makeUserLine('u2', 'a1', 'Follow-up pending...', '2025-01-01T10:00:10.000Z') + '\n';
    writeFileSync(filePath, content + pendingUserLine);

    const result = await pipeline.parseIncremental(tmpDir, 'ongoing', initialOffset);

    expect(result.newMessages).toHaveLength(1);
    expect(result.newMessages[0].type).toBe('user');
    expect(result.isOngoing).toBe(true);
  });

  it('handles sequential incremental appends correctly', async () => {
    // Write initial content
    const initialContent = makeUserLine('u1', null, 'Hello', '2025-01-01T10:00:00.000Z') + '\n';
    const filePath = join(tmpDir, 'sequential.jsonl');
    writeFileSync(filePath, initialContent);

    // Parse to get offset1
    const { bytesRead: offset1 } = await parseSessionFile(filePath);

    // Append more content
    const secondAppend =
      makeAssistantLine('a1', 'u1', '2025-01-01T10:00:01.000Z') +
      '\n' +
      makeUserLine('u2', 'a1', 'Follow-up', '2025-01-01T10:00:05.000Z') +
      '\n';
    writeFileSync(filePath, initialContent + secondAppend);

    // Parse incremental from offset1 to get offset2
    const result1 = await pipeline.parseIncremental(tmpDir, 'sequential', offset1);
    const offset2 = result1.newOffset;

    expect(result1.newMessages).toHaveLength(2);

    // Append more content
    const thirdAppend =
      makeAssistantLine('a2', 'u2', '2025-01-01T10:00:10.000Z') + '\n';
    writeFileSync(filePath, initialContent + secondAppend + thirdAppend);

    // Parse incremental from offset2
    const result2 = await pipeline.parseIncremental(tmpDir, 'sequential', offset2);

    // Verify second incremental only returns the latest append
    expect(result2.newMessages).toHaveLength(1);
    expect(result2.newMessages[0].uuid).toBe('a2');
    expect(result2.newMessages[0].type).toBe('assistant');
  });

  it('detects subagent from session ID prefix', async () => {
    // Write a simple session file under an agent-* sessionId
    const content = makeUserLine('u1', null, 'Task', '2025-01-01T10:00:00.000Z') + '\n';
    writeFileSync(join(tmpDir, 'agent-sub42.jsonl'), content);

    const result = await pipeline.parseIncremental(tmpDir, 'agent-sub42', 0);

    expect(result.isSubagent).toBe(true);
  });

  it('returns isSubagent=false for non-agent session IDs', async () => {
    const content = makeUserLine('u1', null, 'Hello', '2025-01-01T10:00:00.000Z') + '\n';
    writeFileSync(join(tmpDir, 'regular-session.jsonl'), content);

    // Use offset 0 so it will find and parse the file
    const result = await pipeline.parseIncremental(tmpDir, 'regular-session', 0);

    expect(result.isSubagent).toBe(false);
  });

  it('returns correct newOffset based on bytes read', async () => {
    // Write initial content
    const initialContent = makeUserLine('u1', null, 'Hello', '2025-01-01T10:00:00.000Z') + '\n';
    const filePath = join(tmpDir, 'offset-check.jsonl');
    writeFileSync(filePath, initialContent);

    const { bytesRead: initialOffset } = await parseSessionFile(filePath);

    // Append new content
    const newLine = makeAssistantLine('a1', 'u1', '2025-01-01T10:00:01.000Z') + '\n';
    const newContent = initialContent + newLine;
    writeFileSync(filePath, newContent);

    const totalBytes = Buffer.byteLength(newContent, 'utf8');

    const result = await pipeline.parseIncremental(tmpDir, 'offset-check', initialOffset);

    // newOffset should equal total file size (startOffset + bytesRead of new content)
    expect(result.newOffset).toBe(totalBytes);
    expect(result.newOffset).toBeGreaterThan(initialOffset);
  });
});
