import { describe, it, expect } from 'vitest';
import { createSessionExecutor } from '../src/session.js';

describe('SessionExecutor protocol integration', () => {
  it('getPeer returns undefined for unknown stages', () => {
    const executor = createSessionExecutor();
    expect(executor.getPeer('STAGE-nonexistent')).toBeUndefined();
  });

  it('getApprovalService returns the shared ApprovalService', () => {
    const executor = createSessionExecutor();
    const service = executor.getApprovalService();
    expect(service).toBeDefined();
    expect(typeof service.getPending).toBe('function');
    expect(typeof service.resolveApproval).toBe('function');
    expect(typeof service.resolveQuestion).toBe('function');
  });

  it('getMessageQueue returns the shared MessageQueue', () => {
    const executor = createSessionExecutor();
    const queue = executor.getMessageQueue();
    expect(queue).toBeDefined();
    expect(typeof queue.queue).toBe('function');
    expect(typeof queue.take).toBe('function');
  });

  it('buildSpawnArgs includes --permission-prompt-tool=stdio', () => {
    const executor = createSessionExecutor();
    const args = executor.buildSpawnArgs({ model: 'sonnet' });
    expect(args).toContain('--permission-prompt-tool=stdio');
    expect(args).toContain('--input-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--output-format');
    expect(args).toContain('--verbose');
    expect(args).toContain('-p');
    expect(args).toContain('sonnet');
  });

  it('buildSpawnArgs includes --resume when resumeSessionId provided', () => {
    const executor = createSessionExecutor();
    const args = executor.buildSpawnArgs({ model: 'sonnet', resumeSessionId: 'sess-123' });
    expect(args).toContain('--resume');
    expect(args).toContain('sess-123');
  });

  it('buildSpawnArgs omits --resume when no resumeSessionId', () => {
    const executor = createSessionExecutor();
    const args = executor.buildSpawnArgs({ model: 'sonnet' });
    expect(args).not.toContain('--resume');
  });
});
