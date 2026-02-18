import { describe, it, expect } from 'vitest';
import { ResolverRegistry } from '../../src/resolvers/registry.js';
import type { ResolverFn, ResolverContext } from '../../src/resolvers/types.js';

describe('ResolverRegistry', () => {
  it('registers and retrieves a resolver', () => {
    const registry = new ResolverRegistry();
    const fn: ResolverFn = () => null;
    registry.register('test-resolver', fn);
    expect(registry.get('test-resolver')).toBe(fn);
  });

  it('returns null for unregistered resolver', () => {
    const registry = new ResolverRegistry();
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('checks if a resolver is registered', () => {
    const registry = new ResolverRegistry();
    const fn: ResolverFn = () => null;
    registry.register('test-resolver', fn);
    expect(registry.has('test-resolver')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('lists all registered resolver names', () => {
    const registry = new ResolverRegistry();
    registry.register('resolver-a', () => null);
    registry.register('resolver-b', () => null);
    const names = registry.listNames();
    expect(names).toContain('resolver-a');
    expect(names).toContain('resolver-b');
    expect(names).toHaveLength(2);
  });

  it('throws when registering duplicate name', () => {
    const registry = new ResolverRegistry();
    registry.register('test-resolver', () => null);
    expect(() => registry.register('test-resolver', () => null)).toThrow('already registered');
  });

  it('executes a resolver and returns its result', async () => {
    const registry = new ResolverRegistry();
    const fn: ResolverFn = (_stage, _ctx) => 'Done';
    registry.register('always-done', fn);

    const result = await registry.execute('always-done', { id: 'STAGE-001' } as any, {} as any);
    expect(result).toBe('Done');
  });

  it('execute returns null for unregistered resolver', async () => {
    const registry = new ResolverRegistry();
    const result = await registry.execute('nonexistent', {} as any, {} as any);
    expect(result).toBeNull();
  });
});
