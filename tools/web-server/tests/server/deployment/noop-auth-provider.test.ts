import { describe, it, expect, beforeEach } from 'vitest';
import { NoopAuthProvider } from '../../../src/server/deployment/local/noop-auth-provider.js';

describe('NoopAuthProvider', () => {
  let provider: NoopAuthProvider;

  beforeEach(() => {
    provider = new NoopAuthProvider();
  });

  it('getAuthenticatedUser returns null', async () => {
    const result = await provider.getAuthenticatedUser({} as any);
    expect(result).toBeNull();
  });

  it('getUserIdFromRequest returns "local-user"', async () => {
    const result = await provider.getUserIdFromRequest({} as any);
    expect(result).toBe('local-user');
  });

  it('requireAuth returns a plugin function', () => {
    const plugin = provider.requireAuth();
    expect(typeof plugin).toBe('function');
  });

  it('requireAuth plugin registers a pass-through preHandler', async () => {
    const plugin = provider.requireAuth();

    const handlers: { name: string; handler: any }[] = [];
    const mockApp = {
      addHook: (name: string, handler: any) => {
        handlers.push({ name, handler });
      },
    };
    const mockDone = () => {};

    plugin(mockApp as any, {}, mockDone);

    expect(handlers).toHaveLength(1);
    expect(handlers[0].name).toBe('preHandler');

    // Verify the preHandler calls done() without error
    let doneCalled = false;
    await handlers[0].handler({}, {}, () => { doneCalled = true; });
    expect(doneCalled).toBe(true);
  });
});
