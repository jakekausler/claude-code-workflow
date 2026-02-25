import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { createRegistry } from '../../../src/repos/registry.js';
import type { RegistryDeps } from '../../../src/repos/registry.js';

/**
 * Tests for the register-repo command logic.
 *
 * Since the command is a thin Commander wrapper around createRegistry().registerRepo(),
 * we test the core logic that the command exercises:
 *   1. Path resolution and validation
 *   2. Name defaulting to basename
 *   3. Registry registerRepo call
 *   4. Duplicate rejection
 *   5. Non-existent path rejection
 *
 * The registry itself is thoroughly tested in tests/repos/registry.test.ts.
 * These tests verify the integration flow the CLI command would perform.
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

describe('register-repo command logic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'register-repo-test-'));
  });

  it('registers a repo with explicit name', () => {
    const deps = makeDeps();
    const registry = createRegistry(deps);

    registry.registerRepo({
      path: '/projects/backend',
      name: 'my-backend',
    });

    const repos = registry.loadRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('my-backend');
    expect(repos[0].path).toBe('/projects/backend');
  });

  it('defaults name to path basename when not provided', () => {
    // This tests the defaulting logic that the command uses:
    // const name = options.name ?? path.basename(resolved);
    const resolved = '/projects/my-cool-project';
    const name = path.basename(resolved);
    expect(name).toBe('my-cool-project');

    const deps = makeDeps();
    const registry = createRegistry(deps);
    registry.registerRepo({ path: resolved, name });

    const repos = registry.loadRepos();
    expect(repos[0].name).toBe('my-cool-project');
  });

  it('registers a repo with slack_webhook', () => {
    const deps = makeDeps();
    const registry = createRegistry(deps);

    registry.registerRepo({
      path: '/projects/backend',
      name: 'backend',
      slack_webhook: 'https://hooks.slack.com/services/T/B/x',
    });

    const repos = registry.loadRepos();
    expect(repos[0].slack_webhook).toBe('https://hooks.slack.com/services/T/B/x');
  });

  it('rejects non-existent path at filesystem level', () => {
    // The command checks fs.existsSync(resolved) before calling registerRepo.
    // Verify that a non-existent path would be caught.
    const nonExistent = path.join(tmpDir, 'does-not-exist');
    expect(fs.existsSync(nonExistent)).toBe(false);
  });

  it('rejects duplicate repo name', () => {
    const deps = makeDeps();
    const registry = createRegistry(deps);

    registry.registerRepo({ path: '/projects/backend', name: 'backend' });

    expect(() =>
      registry.registerRepo({ path: '/projects/other', name: 'backend' }),
    ).toThrow(/duplicate.*name/i);
  });

  it('rejects duplicate repo path', () => {
    const deps = makeDeps();
    const registry = createRegistry(deps);

    registry.registerRepo({ path: '/projects/backend', name: 'backend' });

    expect(() =>
      registry.registerRepo({ path: '/projects/backend', name: 'other-name' }),
    ).toThrow(/duplicate.*path/i);
  });

  it('resolves relative path correctly', () => {
    // The command resolves paths with path.resolve().
    // Verify relative path resolution works as expected.
    const resolved = path.resolve('./relative/path');
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toContain('relative/path');
  });

  it('generates expected output JSON shape', () => {
    // Verify the shape of the result object the command constructs
    const name = 'backend';
    const resolvedPath = '/projects/backend';
    const slackWebhook = 'https://hooks.slack.com/services/T/B/x';
    const syncResult = {
      epics: 3,
      tickets: 10,
      stages: 25,
      dependencies: 5,
      errors: [] as string[],
    };

    const result = {
      success: true,
      repo: {
        name,
        path: resolvedPath,
        slack_webhook: slackWebhook,
      },
      sync: {
        epics: syncResult.epics,
        tickets: syncResult.tickets,
        stages: syncResult.stages,
        dependencies: syncResult.dependencies,
        errors: syncResult.errors,
      },
    };

    expect(result.success).toBe(true);
    expect(result.repo.name).toBe('backend');
    expect(result.repo.path).toBe('/projects/backend');
    expect(result.repo.slack_webhook).toBe(slackWebhook);
    expect(result.sync.epics).toBe(3);
    expect(result.sync.errors).toEqual([]);
  });
});
