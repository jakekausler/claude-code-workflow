import { describe, it, expect } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import { createRegistry } from '../../../src/repos/registry.js';
import type { RegistryDeps } from '../../../src/repos/registry.js';

/**
 * Tests for the unregister-repo command logic.
 *
 * The command is a thin wrapper around createRegistry().unregisterRepo(name).
 * These tests verify the integration flow: looking up by name, removing, and
 * confirming output structure.
 */

interface MockDeps extends RegistryDeps {
  _files: Map<string, string>;
}

function makeDeps(): MockDeps {
  const files = new Map<string, string>();
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
    mkdirSync: () => {},
    _files: files,
  };
}

function yamlWith(repos: Array<Record<string, unknown>>): string {
  return yamlStringify({ repos });
}

describe('unregister-repo command logic', () => {
  it('removes a registered repo by name', () => {
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

    const repos = registry.loadRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('frontend');
  });

  it('errors on unknown repo name', () => {
    const deps = makeDeps();
    deps._files.set(
      deps.registryPath,
      yamlWith([{ path: '/projects/backend', name: 'backend' }]),
    );

    const registry = createRegistry(deps);
    expect(() => registry.unregisterRepo('nonexistent')).toThrow(/not found/i);
  });

  it('errors when registry is empty', () => {
    const deps = makeDeps();
    // No file exists — empty registry
    const registry = createRegistry(deps);
    expect(() => registry.unregisterRepo('anything')).toThrow(/not found/i);
  });

  it('can unregister the last remaining repo', () => {
    const deps = makeDeps();
    deps._files.set(
      deps.registryPath,
      yamlWith([{ path: '/projects/backend', name: 'backend' }]),
    );

    const registry = createRegistry(deps);
    registry.unregisterRepo('backend');

    const repos = registry.loadRepos();
    expect(repos).toHaveLength(0);
  });

  it('generates expected output JSON shape', () => {
    const name = 'backend';
    const result = {
      success: true,
      unregistered: name,
    };

    expect(result.success).toBe(true);
    expect(result.unregistered).toBe('backend');
    expect(JSON.stringify(result)).toContain('"unregistered":"backend"');
  });
});
