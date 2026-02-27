import { describe, it, expect } from 'vitest';
import { LocalDeploymentContext } from '../../../src/server/deployment/local/local-deployment-context.js';
import { DirectFileSystemProvider } from '../../../src/server/deployment/local/direct-fs-provider.js';
import { NoopAuthProvider } from '../../../src/server/deployment/local/noop-auth-provider.js';
import { BroadcastAllSSE } from '../../../src/server/deployment/local/broadcast-all-sse.js';

describe('LocalDeploymentContext', () => {
  it('has mode "local"', () => {
    const ctx = new LocalDeploymentContext();
    expect(ctx.mode).toBe('local');
  });

  it('getUserId returns "local-user" for any request', async () => {
    const ctx = new LocalDeploymentContext();
    const userId = await ctx.getUserId({} as any);
    expect(userId).toBe('local-user');
  });

  it('getFileAccess returns DirectFileSystemProvider', () => {
    const ctx = new LocalDeploymentContext();
    const fs = ctx.getFileAccess();
    expect(fs).toBeInstanceOf(DirectFileSystemProvider);
    expect(fs.type).toBe('local');
  });

  it('getAuthProvider returns NoopAuthProvider', () => {
    const ctx = new LocalDeploymentContext();
    const auth = ctx.getAuthProvider();
    expect(auth).toBeInstanceOf(NoopAuthProvider);
  });

  it('getEventBroadcaster returns BroadcastAllSSE', () => {
    const ctx = new LocalDeploymentContext();
    const broadcaster = ctx.getEventBroadcaster();
    expect(broadcaster).toBeInstanceOf(BroadcastAllSSE);
  });

  it('getEventBroadcaster returns the SAME instance each call', () => {
    const ctx = new LocalDeploymentContext();
    const b1 = ctx.getEventBroadcaster();
    const b2 = ctx.getEventBroadcaster();
    expect(b1).toBe(b2);
  });

  it('getFileAccess returns the SAME instance each call', () => {
    const ctx = new LocalDeploymentContext();
    const f1 = ctx.getFileAccess();
    const f2 = ctx.getFileAccess();
    expect(f1).toBe(f2);
  });

  it('getAuthProvider returns the SAME instance each call', () => {
    const ctx = new LocalDeploymentContext();
    const a1 = ctx.getAuthProvider();
    const a2 = ctx.getAuthProvider();
    expect(a1).toBe(a2);
  });

  it('getClaudeRoot returns default ~/.claude path', () => {
    const ctx = new LocalDeploymentContext();
    const root = ctx.getClaudeRoot('ignored');
    expect(root).toMatch(/\.claude$/);
  });

  it('getClaudeRoot respects CLAUDE_ROOT env var', () => {
    const original = process.env.CLAUDE_ROOT;
    process.env.CLAUDE_ROOT = '/custom/claude/root';
    try {
      const ctx = new LocalDeploymentContext();
      expect(ctx.getClaudeRoot('ignored')).toBe('/custom/claude/root');
    } finally {
      if (original === undefined) {
        delete process.env.CLAUDE_ROOT;
      } else {
        process.env.CLAUDE_ROOT = original;
      }
    }
  });
});
