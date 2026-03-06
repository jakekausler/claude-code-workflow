import { describe, it, expect } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import { createRegistry } from '../../../src/repos/registry.js';
import { makeDeps } from './__helpers/mock-registry.js';

/**
 * Tests for the list-repos command logic.
 *
 * The command is a thin wrapper around createRegistry().loadRepos().
 * These tests verify: listing all repos, empty registry handling, and
 * output structure.
 */

function yamlWith(repos: Array<Record<string, unknown>>): string {
  return yamlStringify({ repos });
}

describe('list-repos command logic', () => {
  it('lists all registered repos', () => {
    const deps = makeDeps();
    deps._files.set(
      deps.registryPath,
      yamlWith([
        { path: '/projects/backend', name: 'backend' },
        { path: '/projects/frontend', name: 'frontend' },
        {
          path: '/projects/infra',
          name: 'infra',
          slack_webhook: 'https://hooks.slack.com/services/T/B/x',
        },
      ]),
    );

    const registry = createRegistry(deps);
    const repos = registry.loadRepos();

    expect(repos).toHaveLength(3);
    expect(repos[0].name).toBe('backend');
    expect(repos[1].name).toBe('frontend');
    expect(repos[2].name).toBe('infra');
    expect(repos[2].slack_webhook).toBe('https://hooks.slack.com/services/T/B/x');
  });

  it('handles empty registry (no file)', () => {
    const deps = makeDeps();
    const registry = createRegistry(deps);

    const repos = registry.loadRepos();
    expect(repos).toEqual([]);
  });

  it('handles empty registry (empty file)', () => {
    const deps = makeDeps();
    deps._files.set(deps.registryPath, '');

    const registry = createRegistry(deps);
    const repos = registry.loadRepos();
    expect(repos).toEqual([]);
  });

  it('generates expected output JSON shape', () => {
    const deps = makeDeps();
    deps._files.set(
      deps.registryPath,
      yamlWith([
        { path: '/projects/backend', name: 'backend' },
        {
          path: '/projects/frontend',
          name: 'frontend',
          slack_webhook: 'https://hooks.slack.com/services/T/B/x',
        },
      ]),
    );

    const registry = createRegistry(deps);
    const repos = registry.loadRepos();

    // Replicate the command's output construction
    const result = {
      repos: repos.map((r) => ({
        name: r.name,
        path: r.path,
        ...(r.slack_webhook ? { slack_webhook: r.slack_webhook } : {}),
      })),
      count: repos.length,
    };

    expect(result.count).toBe(2);
    expect(result.repos[0]).toEqual({
      name: 'backend',
      path: '/projects/backend',
    });
    expect(result.repos[1]).toEqual({
      name: 'frontend',
      path: '/projects/frontend',
      slack_webhook: 'https://hooks.slack.com/services/T/B/x',
    });

    // Verify JSON serialization round-trips correctly
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.count).toBe(2);
    expect(parsed.repos).toHaveLength(2);
  });

  it('handles single repo', () => {
    const deps = makeDeps();
    deps._files.set(
      deps.registryPath,
      yamlWith([{ path: '/projects/solo', name: 'solo' }]),
    );

    const registry = createRegistry(deps);
    const repos = registry.loadRepos();

    const result = {
      repos: repos.map((r) => ({
        name: r.name,
        path: r.path,
        ...(r.slack_webhook ? { slack_webhook: r.slack_webhook } : {}),
      })),
      count: repos.length,
    };

    expect(result.count).toBe(1);
    expect(result.repos[0].name).toBe('solo');
  });
});
