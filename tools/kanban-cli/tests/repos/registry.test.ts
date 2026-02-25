import { describe, it, expect } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import { createRegistry } from '../../src/repos/registry.js';
import type { RegistryDeps } from '../../src/repos/registry.js';

interface MockDeps extends RegistryDeps {
  _files: Map<string, string>;
  _dirCreated: () => boolean;
}

/** Helper: build a mock deps object backed by an in-memory "filesystem". */
function makeDeps(overrides: Partial<RegistryDeps> = {}): MockDeps {
  const files = new Map<string, string>();
  let dirCreated = false;

  return {
    registryPath: '/fake/.config/kanban-workflow/repos.yaml',
    readFile: (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    writeFile: (p: string, data: string) => {
      files.set(p, data);
    },
    existsSync: (p: string) => files.has(p),
    mkdirSync: (_p: string, _opts?: { recursive: boolean }) => {
      dirCreated = true;
    },
    // Expose internals for assertions
    _files: files,
    _dirCreated: () => dirCreated,
    ...overrides,
  };
}

function yamlWith(repos: Array<Record<string, unknown>>): string {
  return yamlStringify({ repos });
}

describe('createRegistry', () => {
  // ── loadRepos ──────────────────────────────────────────────────────

  describe('loadRepos()', () => {
    it('returns empty array when file does not exist', () => {
      const deps = makeDeps();
      const registry = createRegistry(deps);

      const result = registry.loadRepos();
      expect(result).toEqual([]);
    });

    it('parses valid YAML with multiple repos', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([
          { path: '/projects/backend', name: 'backend' },
          { path: '/projects/frontend', name: 'frontend' },
        ]),
      );

      const registry = createRegistry(deps);
      const result = registry.loadRepos();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ path: '/projects/backend', name: 'backend' });
      expect(result[1]).toEqual({ path: '/projects/frontend', name: 'frontend' });
    });

    it('throws on invalid YAML (missing name)', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([{ path: '/projects/backend' }]),
      );

      const registry = createRegistry(deps);
      expect(() => registry.loadRepos()).toThrow();
    });

    it('throws on invalid YAML (missing path)', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([{ name: 'backend' }]),
      );

      const registry = createRegistry(deps);
      expect(() => registry.loadRepos()).toThrow();
    });

    it('parses repos with optional slack_webhook', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([
          {
            path: '/projects/backend',
            name: 'backend',
            slack_webhook: 'https://hooks.slack.com/services/T/B/x',
          },
          { path: '/projects/frontend', name: 'frontend' },
        ]),
      );

      const registry = createRegistry(deps);
      const result = registry.loadRepos();

      expect(result[0].slack_webhook).toBe('https://hooks.slack.com/services/T/B/x');
      expect(result[1].slack_webhook).toBeUndefined();
    });

    it('returns empty array when file exists but is empty', () => {
      const deps = makeDeps();
      deps._files.set(deps.registryPath, '');

      const registry = createRegistry(deps);
      const result = registry.loadRepos();
      expect(result).toEqual([]);
    });

    it('rejects invalid slack_webhook URL', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([
          {
            path: '/projects/backend',
            name: 'backend',
            slack_webhook: 'not-a-url',
          },
        ]),
      );

      const registry = createRegistry(deps);
      expect(() => registry.loadRepos()).toThrow();
    });
  });

  // ── registerRepo ───────────────────────────────────────────────────

  describe('registerRepo()', () => {
    it('adds entry to file and creates dir if needed', () => {
      const deps = makeDeps();
      const registry = createRegistry(deps);

      registry.registerRepo({ path: '/projects/backend', name: 'backend' });

      // File should exist now
      expect(deps.existsSync(deps.registryPath)).toBe(true);
      // Dir should have been created
      expect(deps._dirCreated()).toBe(true);

      const result = registry.loadRepos();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ path: '/projects/backend', name: 'backend' });
    });

    it('appends to existing repos', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([{ path: '/projects/backend', name: 'backend' }]),
      );

      const registry = createRegistry(deps);
      registry.registerRepo({ path: '/projects/frontend', name: 'frontend' });

      const result = registry.loadRepos();
      expect(result).toHaveLength(2);
      expect(result[1].name).toBe('frontend');
    });

    it('rejects duplicate name', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([{ path: '/projects/backend', name: 'backend' }]),
      );

      const registry = createRegistry(deps);
      expect(() =>
        registry.registerRepo({ path: '/projects/other', name: 'backend' }),
      ).toThrow(/duplicate.*name/i);
    });

    it('preserves unknown fields in existing entries during write', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([
          {
            path: '/projects/backend',
            name: 'backend',
            description: 'The backend service',
          },
        ]),
      );

      const registry = createRegistry(deps);
      registry.registerRepo({ path: '/projects/frontend', name: 'frontend' });

      const written = deps._files.get(deps.registryPath)!;
      expect(written).toContain('description: The backend service');
    });

    it('rejects duplicate path', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([{ path: '/projects/backend', name: 'backend' }]),
      );

      const registry = createRegistry(deps);
      expect(() =>
        registry.registerRepo({ path: '/projects/backend', name: 'other' }),
      ).toThrow(/duplicate.*path/i);
    });
  });

  // ── unregisterRepo ─────────────────────────────────────────────────

  describe('unregisterRepo()', () => {
    it('removes entry by name', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([
          { path: '/projects/backend', name: 'backend' },
          { path: '/projects/frontend', name: 'frontend' },
        ]),
      );

      const registry = createRegistry(deps);
      registry.unregisterRepo('backend');

      const result = registry.loadRepos();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('frontend');
    });

    it('throws when name not found', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([{ path: '/projects/backend', name: 'backend' }]),
      );

      const registry = createRegistry(deps);
      expect(() => registry.unregisterRepo('nonexistent')).toThrow(
        /not found/i,
      );
    });
  });

  // ── findByName ─────────────────────────────────────────────────────

  describe('findByName()', () => {
    it('returns matching entry', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([
          { path: '/projects/backend', name: 'backend' },
          { path: '/projects/frontend', name: 'frontend' },
        ]),
      );

      const registry = createRegistry(deps);
      const entry = registry.findByName('frontend');

      expect(entry).toEqual({ path: '/projects/frontend', name: 'frontend' });
    });

    it('returns null when no match', () => {
      const deps = makeDeps();
      deps._files.set(
        deps.registryPath,
        yamlWith([{ path: '/projects/backend', name: 'backend' }]),
      );

      const registry = createRegistry(deps);
      const entry = registry.findByName('nonexistent');

      expect(entry).toBeNull();
    });

    it('returns null when file does not exist', () => {
      const deps = makeDeps();
      const registry = createRegistry(deps);

      const entry = registry.findByName('anything');
      expect(entry).toBeNull();
    });
  });
});
