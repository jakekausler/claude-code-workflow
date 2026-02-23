import { describe, it, expect, vi } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PipelineConfig } from 'kanban-cli';
import { loadOrchestratorConfig, type CliOptions, type ConfigDeps } from '../src/config.js';

/** Minimal valid PipelineConfig for testing. */
function makePipelineConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    workflow: {
      entry_phase: 'Design',
      phases: [
        { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Done'] },
      ],
      defaults: {
        WORKFLOW_MAX_PARALLEL: 2,
        ...overrides?.workflow?.defaults,
      },
      ...overrides?.workflow,
    },
  };
}

/** Default CLI options for testing. */
function makeCliOptions(overrides?: Partial<CliOptions>): CliOptions {
  return {
    repo: '/tmp/test-repo',
    once: false,
    idleSeconds: '30',
    model: 'sonnet',
    verbose: false,
    ...overrides,
  };
}

/** Default test deps (no real file system, no real config). */
function makeDeps(overrides?: Partial<ConfigDeps>): ConfigDeps {
  return {
    loadPipelineConfig: vi.fn(() => makePipelineConfig()),
    env: {},
    mkdir: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('loadOrchestratorConfig', () => {
  it('returns default config values when no overrides', async () => {
    const deps = makeDeps();
    const config = await loadOrchestratorConfig(makeCliOptions(), deps);

    expect(config.repoPath).toBe('/tmp/test-repo');
    expect(config.once).toBe(false);
    expect(config.idleSeconds).toBe(30);
    expect(config.model).toBe('sonnet');
    expect(config.verbose).toBe(false);
    expect(config.maxParallel).toBe(2); // from pipeline config defaults
    expect(config.logDir).toBe('/tmp/test-repo/.kanban-logs');
    expect(config.workflowEnv).toEqual({});
    expect(config.pipelineConfig).toEqual(makePipelineConfig());
  });

  it('overrides WORKFLOW_MAX_PARALLEL from env var', async () => {
    const deps = makeDeps({
      env: { WORKFLOW_MAX_PARALLEL: '4' },
    });
    const config = await loadOrchestratorConfig(makeCliOptions(), deps);

    expect(config.maxParallel).toBe(4);
  });

  it('ignores non-numeric WORKFLOW_MAX_PARALLEL env var', async () => {
    const deps = makeDeps({
      env: { WORKFLOW_MAX_PARALLEL: 'not-a-number' },
    });
    const config = await loadOrchestratorConfig(makeCliOptions(), deps);

    // Falls back to pipeline config default
    expect(config.maxParallel).toBe(2);
  });

  it('defaults maxParallel to 1 when pipeline config has no defaults', async () => {
    const pipelineConfig: PipelineConfig = {
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Done'] },
        ],
        // no defaults
      },
    };
    const deps = makeDeps({
      loadPipelineConfig: vi.fn(() => pipelineConfig),
    });
    const config = await loadOrchestratorConfig(makeCliOptions(), deps);

    expect(config.maxParallel).toBe(1);
  });

  it('parses CLI idle-seconds string to number', async () => {
    const deps = makeDeps();
    const config = await loadOrchestratorConfig(
      makeCliOptions({ idleSeconds: '120' }),
      deps,
    );

    expect(config.idleSeconds).toBe(120);
    expect(typeof config.idleSeconds).toBe('number');
  });

  it('defaults log directory to <repoPath>/.kanban-logs/ when not provided', async () => {
    const deps = makeDeps();
    const config = await loadOrchestratorConfig(
      makeCliOptions({ logDir: undefined }),
      deps,
    );

    expect(config.logDir).toBe('/tmp/test-repo/.kanban-logs');
  });

  it('uses provided logDir when specified', async () => {
    const deps = makeDeps();
    const config = await loadOrchestratorConfig(
      makeCliOptions({ logDir: '/tmp/custom-logs' }),
      deps,
    );

    expect(config.logDir).toBe('/tmp/custom-logs');
  });

  it('creates log directory if missing', async () => {
    const mkdirMock = vi.fn(async () => {});
    const deps = makeDeps({ mkdir: mkdirMock });

    await loadOrchestratorConfig(makeCliOptions(), deps);

    expect(mkdirMock).toHaveBeenCalledWith(
      '/tmp/test-repo/.kanban-logs',
      { recursive: true },
    );
  });

  it('creates log directory with real fs in tmp dir', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-test-'));
    const logDir = path.join(tmpDir, 'nested', 'logs');

    const deps = makeDeps({
      mkdir: async (dirPath: string, options: { recursive: boolean }) => {
        await fs.mkdir(dirPath, options);
      },
    });

    await loadOrchestratorConfig(
      makeCliOptions({ logDir }),
      deps,
    );

    const stat = await fs.stat(logDir);
    expect(stat.isDirectory()).toBe(true);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });

  it('resolves relative repo path to absolute', async () => {
    const deps = makeDeps();
    const config = await loadOrchestratorConfig(
      makeCliOptions({ repo: 'relative/path' }),
      deps,
    );

    expect(path.isAbsolute(config.repoPath)).toBe(true);
    expect(config.repoPath).toBe(path.resolve('relative/path'));
  });

  it('captures all WORKFLOW_* env vars in workflowEnv', async () => {
    const deps = makeDeps({
      env: {
        WORKFLOW_MAX_PARALLEL: '2',
        WORKFLOW_REMOTE_MODE: 'true',
        WORKFLOW_CUSTOM_VAR: 'custom-value',
        HOME: '/home/user',           // should NOT appear
        PATH: '/usr/bin',             // should NOT appear
        OTHER_VAR: 'other',           // should NOT appear
      },
    });

    const config = await loadOrchestratorConfig(makeCliOptions(), deps);

    expect(config.workflowEnv).toEqual({
      WORKFLOW_MAX_PARALLEL: '2',
      WORKFLOW_REMOTE_MODE: 'true',
      WORKFLOW_CUSTOM_VAR: 'custom-value',
    });
    expect(config.workflowEnv).not.toHaveProperty('HOME');
    expect(config.workflowEnv).not.toHaveProperty('PATH');
    expect(config.workflowEnv).not.toHaveProperty('OTHER_VAR');
  });

  it('calls loadPipelineConfig with resolved repo path', async () => {
    const loadMock = vi.fn(() => makePipelineConfig());
    const deps = makeDeps({ loadPipelineConfig: loadMock });

    await loadOrchestratorConfig(
      makeCliOptions({ repo: '/tmp/test-repo' }),
      deps,
    );

    expect(loadMock).toHaveBeenCalledWith('/tmp/test-repo');
  });

  it('calls loadPipelineConfig with absolute path even from relative input', async () => {
    const loadMock = vi.fn(() => makePipelineConfig());
    const deps = makeDeps({ loadPipelineConfig: loadMock });

    await loadOrchestratorConfig(
      makeCliOptions({ repo: 'relative/repo' }),
      deps,
    );

    expect(loadMock).toHaveBeenCalledWith(path.resolve('relative/repo'));
  });

  it('resolves relative logDir to absolute', async () => {
    const deps = makeDeps();
    const config = await loadOrchestratorConfig(
      makeCliOptions({ logDir: 'relative/logs' }),
      deps,
    );

    expect(path.isAbsolute(config.logDir)).toBe(true);
    expect(config.logDir).toBe(path.resolve('relative/logs'));
  });

  it('passes through once flag from CLI', async () => {
    const deps = makeDeps();
    const config = await loadOrchestratorConfig(
      makeCliOptions({ once: true }),
      deps,
    );

    expect(config.once).toBe(true);
  });

  it('passes through verbose flag from CLI', async () => {
    const deps = makeDeps();
    const config = await loadOrchestratorConfig(
      makeCliOptions({ verbose: true }),
      deps,
    );

    expect(config.verbose).toBe(true);
  });

  it('throws on non-numeric idleSeconds value', async () => {
    const deps = makeDeps();
    await expect(
      loadOrchestratorConfig(makeCliOptions({ idleSeconds: 'not-a-number' }), deps),
    ).rejects.toThrow('Invalid idle-seconds value: "not-a-number"');
  });

  it('throws on negative idleSeconds value', async () => {
    const deps = makeDeps();
    await expect(
      loadOrchestratorConfig(makeCliOptions({ idleSeconds: '-5' }), deps),
    ).rejects.toThrow('Invalid idle-seconds value: "-5"');
  });

  it('env var WORKFLOW_MAX_PARALLEL overrides pipeline config when both are set', async () => {
    const pipelineConfig = makePipelineConfig({
      workflow: {
        entry_phase: 'Design',
        phases: [
          { name: 'Design', skill: 'phase-design', status: 'Design', transitions_to: ['Done'] },
        ],
        defaults: { WORKFLOW_MAX_PARALLEL: 2 },
      },
    });
    const deps = makeDeps({
      loadPipelineConfig: vi.fn(() => pipelineConfig),
      env: { WORKFLOW_MAX_PARALLEL: '8' },
    });

    const config = await loadOrchestratorConfig(makeCliOptions(), deps);

    // env var (8) should override pipeline config (2)
    expect(config.maxParallel).toBe(8);
  });

  it('propagates error when loadPipelineConfig throws', async () => {
    const deps = makeDeps({
      loadPipelineConfig: vi.fn(() => {
        throw new Error('Config file not found');
      }),
    });

    await expect(
      loadOrchestratorConfig(makeCliOptions(), deps),
    ).rejects.toThrow('Config file not found');
  });

  describe('mock mode parsing', () => {
    it('--mock (no value) sets mockMode to full', async () => {
      const deps = makeDeps();
      const config = await loadOrchestratorConfig(
        makeCliOptions({ mock: true }),
        deps,
      );

      expect(config.mockMode).toBe('full');
      expect(config.mockServices).toEqual([]);
    });

    it('--mock all sets mockMode to full', async () => {
      const deps = makeDeps();
      const config = await loadOrchestratorConfig(
        makeCliOptions({ mock: 'all' }),
        deps,
      );

      expect(config.mockMode).toBe('full');
      expect(config.mockServices).toEqual([]);
    });

    it('--mock jira,github sets mockMode to selective with services', async () => {
      const deps = makeDeps();
      const config = await loadOrchestratorConfig(
        makeCliOptions({ mock: 'jira,github' }),
        deps,
      );

      expect(config.mockMode).toBe('selective');
      expect(config.mockServices).toEqual(['jira', 'github']);
    });

    it('selective mock adds MOCK_<SERVICE>=true to workflowEnv', async () => {
      const deps = makeDeps();
      const config = await loadOrchestratorConfig(
        makeCliOptions({ mock: 'jira,github' }),
        deps,
      );

      expect(config.workflowEnv['MOCK_JIRA']).toBe('true');
      expect(config.workflowEnv['MOCK_GITHUB']).toBe('true');
    });

    it('no --mock sets mockMode to none', async () => {
      const deps = makeDeps();
      const config = await loadOrchestratorConfig(
        makeCliOptions(),
        deps,
      );

      expect(config.mockMode).toBe('none');
      expect(config.mockServices).toEqual([]);
    });

    it('throws on invalid service name', async () => {
      const deps = makeDeps();

      await expect(
        loadOrchestratorConfig(makeCliOptions({ mock: 'jira,invalid' }), deps),
      ).rejects.toThrow('Invalid mock service "invalid"');
    });

    it('trims and lowercases service names', async () => {
      const deps = makeDeps();
      const config = await loadOrchestratorConfig(
        makeCliOptions({ mock: ' Jira , GitHub ' }),
        deps,
      );

      expect(config.mockServices).toEqual(['jira', 'github']);
      expect(config.workflowEnv['MOCK_JIRA']).toBe('true');
      expect(config.workflowEnv['MOCK_GITHUB']).toBe('true');
    });

    it('accepts all valid services', async () => {
      const deps = makeDeps();
      const config = await loadOrchestratorConfig(
        makeCliOptions({ mock: 'jira,github,gitlab,slack' }),
        deps,
      );

      expect(config.mockMode).toBe('selective');
      expect(config.mockServices).toEqual(['jira', 'github', 'gitlab', 'slack']);
    });
  });
});
