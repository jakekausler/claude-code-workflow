import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server/app.js';
import { OrchestratorClient } from '../../src/server/services/orchestrator-client.js';
import * as eventsModule from '../../src/server/routes/events.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('session-status SSE broadcasts', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let mockClient: OrchestratorClient;
  let broadcastSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-status-sse-'));
    mockClient = new OrchestratorClient('ws://localhost:0');
    broadcastSpy = vi.spyOn(eventsModule, 'broadcastEvent');
    app = await createServer({
      logger: false,
      claudeProjectsDir: tempDir,
      orchestratorClient: mockClient,
    });
    await app.ready();
  });

  afterEach(async () => {
    broadcastSpy.mockRestore();
    await app?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('emits session-status with starting on session-registered', () => {
    const now = Date.now();
    const entry = {
      stageId: 'stage-1',
      sessionId: 'sess-abc',
      processId: 1234,
      worktreePath: '/tmp/wt',
      status: 'starting' as const,
      spawnedAt: now,
      lastActivity: now,
    };

    mockClient.emit('session-registered', entry);

    expect(broadcastSpy).toHaveBeenCalledWith('session-status', {
      stageId: 'stage-1',
      sessionId: 'sess-abc',
      status: 'starting',
      waitingType: null,
      spawnedAt: now,
    });
  });

  it('emits session-status with computed waitingType on session-status', () => {
    const entry = {
      stageId: 'stage-2',
      sessionId: 'sess-def',
      processId: 5678,
      worktreePath: '/tmp/wt2',
      status: 'active' as const,
      spawnedAt: Date.now(),
      lastActivity: Date.now(),
    };

    // The OrchestratorClient.getPendingForStage returns pending items.
    // Since we're using a real OrchestratorClient with no pending data,
    // getPendingForStage will return an empty array, so waitingType = null.
    mockClient.emit('session-status', entry);

    expect(broadcastSpy).toHaveBeenCalledWith('session-status', {
      stageId: 'stage-2',
      status: 'active',
      waitingType: null,
    });
  });

  it('emits session-status with ended on session-ended', () => {
    const entry = {
      stageId: 'stage-3',
      sessionId: 'sess-ghi',
      processId: 9012,
      worktreePath: '/tmp/wt3',
      status: 'ended' as const,
      spawnedAt: Date.now(),
      lastActivity: Date.now(),
    };

    mockClient.emit('session-ended', entry);

    expect(broadcastSpy).toHaveBeenCalledWith('session-status', {
      stageId: 'stage-3',
      status: 'ended',
      waitingType: null,
    });
  });

  it('emits session-status with waitingType permission on approval-requested', () => {
    const data = {
      type: 'approval' as const,
      requestId: 'req-1',
      stageId: 'stage-4',
      toolName: 'Bash',
      input: { command: 'ls' },
      createdAt: Date.now(),
    };

    mockClient.emit('approval-requested', data);

    // Should still broadcast the original approval-requested event
    expect(broadcastSpy).toHaveBeenCalledWith('approval-requested', data);
    // And also broadcast session-status
    expect(broadcastSpy).toHaveBeenCalledWith('session-status', {
      stageId: 'stage-4',
      status: 'active',
      waitingType: 'permission',
    });
  });

  it('emits session-status with waitingType user_input on question-requested', () => {
    const data = {
      type: 'question' as const,
      requestId: 'req-2',
      stageId: 'stage-5',
      questions: [{ question: 'Which option?' }],
      input: {},
      createdAt: Date.now(),
    };

    mockClient.emit('question-requested', data);

    // Should still broadcast the original question-requested event
    expect(broadcastSpy).toHaveBeenCalledWith('question-requested', data);
    // And also broadcast session-status
    expect(broadcastSpy).toHaveBeenCalledWith('session-status', {
      stageId: 'stage-5',
      status: 'active',
      waitingType: 'user_input',
    });
  });

  it('emits session-status with recomputed waitingType on approval-cancelled', () => {
    // First, emit approval-requested so the requestStageMap is populated
    const approvalData = {
      type: 'approval' as const,
      requestId: 'req-cancel-1',
      stageId: 'stage-6',
      toolName: 'Bash',
      input: { command: 'rm -rf /' },
      createdAt: Date.now(),
    };
    mockClient.emit('approval-requested', approvalData);
    broadcastSpy.mockClear();

    // Now emit approval-cancelled
    mockClient.emit('approval-cancelled', { requestId: 'req-cancel-1' });

    // Should still broadcast the original approval-cancelled event
    expect(broadcastSpy).toHaveBeenCalledWith('approval-cancelled', { requestId: 'req-cancel-1' });
    // And broadcast session-status with recomputed waitingType (null since no more pending)
    expect(broadcastSpy).toHaveBeenCalledWith('session-status', {
      stageId: 'stage-6',
      status: 'active',
      waitingType: null,
    });
  });

  it('does not emit session-status on approval-cancelled for unknown requestId', () => {
    mockClient.emit('approval-cancelled', { requestId: 'unknown-req' });

    // Should still broadcast the original approval-cancelled event
    expect(broadcastSpy).toHaveBeenCalledWith('approval-cancelled', { requestId: 'unknown-req' });
    // But should NOT broadcast session-status since stageId is unknown
    expect(broadcastSpy).not.toHaveBeenCalledWith('session-status', expect.anything());
  });

  it('preserves existing broadcast channels alongside session-status', () => {
    const entry = {
      stageId: 'stage-pres',
      sessionId: 'sess-pres',
      processId: 1,
      worktreePath: '/tmp/wt',
      status: 'starting' as const,
      spawnedAt: Date.now(),
      lastActivity: Date.now(),
    };

    mockClient.emit('session-registered', entry);

    // Both stage-transition (existing) and session-status (new) should fire
    const channels = broadcastSpy.mock.calls.map((call) => call[0]);
    expect(channels).toContain('stage-transition');
    expect(channels).toContain('session-status');
  });

  it('emits session-status with permission waitingType when pending items exist', () => {
    const stageId = 'stage-pending';

    // Mock getPendingForStage to return a pending approval
    vi.spyOn(mockClient, 'getPendingForStage').mockReturnValue([
      {
        type: 'approval',
        requestId: 'req-pending-1',
        stageId,
        toolName: 'Bash',
        input: { command: 'ls' },
        createdAt: Date.now(),
      } as any,
    ]);

    // Now emit session-status event
    const entry = {
      stageId,
      sessionId: 'sess-pending',
      processId: 1234,
      worktreePath: '/tmp/wt',
      status: 'active' as const,
      spawnedAt: Date.now(),
      lastActivity: Date.now(),
    };
    mockClient.emit('session-status', entry);

    // Should broadcast session-status with waitingType: 'permission' (not null)
    expect(broadcastSpy).toHaveBeenCalledWith('session-status', {
      stageId,
      status: 'active',
      waitingType: 'permission',
    });
  });
});
