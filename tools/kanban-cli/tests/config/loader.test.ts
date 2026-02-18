import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, mergeConfigs } from '../../src/config/loader.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Test mergeConfigs directly (pure function, no I/O)
describe('mergeConfigs', () => {
  const globalConfig = {
    workflow: {
      entry_phase: 'Design',
      phases: [
        {
          name: 'Design',
          skill: 'phase-design',
          status: 'Design',
          transitions_to: ['Build'],
        },
        {
          name: 'Build',
          skill: 'phase-build',
          status: 'Build',
          transitions_to: ['Done'],
        },
      ],
      defaults: {
        WORKFLOW_REMOTE_MODE: false,
        WORKFLOW_MAX_PARALLEL: 1,
      },
    },
  };

  it('returns global config when repo config is null', () => {
    const result = mergeConfigs(globalConfig, null);
    expect(result).toEqual(globalConfig);
  });

  it('replaces phases entirely when repo config defines phases', () => {
    const repoConfig = {
      workflow: {
        entry_phase: 'Spike',
        phases: [
          {
            name: 'Spike',
            skill: 'my-spike',
            status: 'Spike',
            transitions_to: ['Done'],
          },
        ],
      },
    };
    const result = mergeConfigs(globalConfig, repoConfig);
    expect(result.workflow.phases).toHaveLength(1);
    expect(result.workflow.phases[0].name).toBe('Spike');
    expect(result.workflow.entry_phase).toBe('Spike');
  });

  it('merges defaults when repo config only overrides defaults', () => {
    const repoConfig = {
      workflow: {
        defaults: {
          WORKFLOW_REMOTE_MODE: true,
        },
      },
    };
    const result = mergeConfigs(globalConfig, repoConfig);
    // Phases unchanged from global
    expect(result.workflow.phases).toHaveLength(2);
    expect(result.workflow.entry_phase).toBe('Design');
    // Defaults merged
    expect(result.workflow.defaults?.WORKFLOW_REMOTE_MODE).toBe(true);
    expect(result.workflow.defaults?.WORKFLOW_MAX_PARALLEL).toBe(1);
  });

  it('repo phases replace global phases completely (no merge)', () => {
    const repoConfig = {
      workflow: {
        entry_phase: 'QA',
        phases: [
          {
            name: 'QA',
            skill: 'qa-phase',
            status: 'QA',
            transitions_to: ['Done'],
          },
        ],
        defaults: {
          WORKFLOW_MAX_PARALLEL: 5,
        },
      },
    };
    const result = mergeConfigs(globalConfig, repoConfig);
    expect(result.workflow.phases).toHaveLength(1);
    expect(result.workflow.phases[0].name).toBe('QA');
    expect(result.workflow.entry_phase).toBe('QA');
    // Defaults merged (not replaced)
    expect(result.workflow.defaults?.WORKFLOW_REMOTE_MODE).toBe(false);
    expect(result.workflow.defaults?.WORKFLOW_MAX_PARALLEL).toBe(5);
  });
});

describe('loadConfig', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-cli-test-' + Date.now());
  const globalDir = path.join(tmpDir, '.config', 'kanban-workflow');
  const repoDir = path.join(tmpDir, 'repo');

  beforeEach(() => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads global config when no repo config exists', () => {
    const globalYaml = `
workflow:
  entry_phase: Design
  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Done]
`;
    fs.writeFileSync(path.join(globalDir, 'config.yaml'), globalYaml);

    const result = loadConfig({
      globalConfigPath: path.join(globalDir, 'config.yaml'),
      repoPath: repoDir,
    });
    expect(result.workflow.phases).toHaveLength(1);
    expect(result.workflow.phases[0].name).toBe('Design');
  });

  it('uses default config when no files exist', () => {
    const result = loadConfig({
      globalConfigPath: path.join(globalDir, 'config.yaml'),
      repoPath: repoDir,
    });
    // Should return the embedded default pipeline
    expect(result.workflow.entry_phase).toBe('Design');
    expect(result.workflow.phases.length).toBeGreaterThan(0);
  });

  it('merges repo config over global config', () => {
    const globalYaml = `
workflow:
  entry_phase: Design
  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Done]
  defaults:
    WORKFLOW_REMOTE_MODE: false
`;
    const repoYaml = `
workflow:
  defaults:
    WORKFLOW_REMOTE_MODE: true
`;
    fs.writeFileSync(path.join(globalDir, 'config.yaml'), globalYaml);
    fs.writeFileSync(path.join(repoDir, '.kanban-workflow.yaml'), repoYaml);

    const result = loadConfig({
      globalConfigPath: path.join(globalDir, 'config.yaml'),
      repoPath: repoDir,
    });
    expect(result.workflow.defaults?.WORKFLOW_REMOTE_MODE).toBe(true);
    expect(result.workflow.phases[0].name).toBe('Design');
  });

  it('throws on invalid YAML in global config', () => {
    fs.writeFileSync(path.join(globalDir, 'config.yaml'), '{{invalid yaml');
    expect(() =>
      loadConfig({
        globalConfigPath: path.join(globalDir, 'config.yaml'),
        repoPath: repoDir,
      })
    ).toThrow();
  });

  it('throws on schema-invalid config', () => {
    const badYaml = `
workflow:
  entry_phase: Design
  phases:
    - name: Design
      status: Design
      transitions_to: [Done]
`;
    // Missing skill or resolver
    fs.writeFileSync(path.join(globalDir, 'config.yaml'), badYaml);
    expect(() =>
      loadConfig({
        globalConfigPath: path.join(globalDir, 'config.yaml'),
        repoPath: repoDir,
      })
    ).toThrow();
  });
});
