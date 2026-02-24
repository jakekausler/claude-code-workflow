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

  it('repo jira overrides global jira entirely', () => {
    const globalWithJira = {
      ...globalConfig,
      jira: {
        reading_script: './global-read.sh',
        writing_script: './global-write.sh',
        project: 'GLOBAL',
        assignee: 'global@example.com',
        status_map: {
          first_stage_design: 'Global Design',
          stage_pr_created: 'Global PR',
          all_stages_done: 'Global Done',
        },
      },
    };
    const repoConfig = {
      jira: {
        reading_script: './repo-read.sh',
        project: 'REPO',
      },
    };
    const result = mergeConfigs(globalWithJira, repoConfig);
    // Repo jira replaces global jira entirely — no merge of individual fields
    expect(result.jira).toEqual({
      reading_script: './repo-read.sh',
      project: 'REPO',
    });
    // writing_script, assignee, status_map are NOT inherited from global
    expect(result.jira?.writing_script).toBeUndefined();
    expect(result.jira?.assignee).toBeUndefined();
    expect(result.jira?.status_map).toBeUndefined();
  });

  it('preserves global jira when repo does not define jira', () => {
    const globalWithJira = {
      ...globalConfig,
      jira: {
        reading_script: './global-read.sh',
        project: 'GLOBAL',
      },
    };
    const repoConfig = {
      workflow: {
        defaults: {
          WORKFLOW_REMOTE_MODE: true,
        },
      },
    };
    const result = mergeConfigs(globalWithJira, repoConfig);
    expect(result.jira).toEqual({
      reading_script: './global-read.sh',
      project: 'GLOBAL',
    });
  });

  it('repo jira: null disables global jira', () => {
    const globalWithJira = {
      ...globalConfig,
      jira: {
        reading_script: './global-read.sh',
        project: 'GLOBAL',
      },
    };
    const repoConfig = {
      jira: null,
    };
    const result = mergeConfigs(globalWithJira, repoConfig);
    expect(result.jira).toBeNull();
  });

  it('merged config without jira section has undefined jira', () => {
    const result = mergeConfigs(globalConfig, null);
    expect(result.jira).toBeUndefined();
  });

  it('repo cron overrides global cron entirely', () => {
    const globalWithCron = {
      ...globalConfig,
      cron: {
        mr_comment_poll: { enabled: true, interval_seconds: 300 },
        insights_threshold: { enabled: false, interval_seconds: 600 },
      },
    };
    const repoConfig = {
      cron: {
        mr_comment_poll: { enabled: false, interval_seconds: 60 },
      },
    };
    const result = mergeConfigs(globalWithCron, repoConfig);
    // Repo cron replaces global cron entirely — no merge of individual jobs
    expect(result.cron).toEqual({
      mr_comment_poll: { enabled: false, interval_seconds: 60 },
    });
    // insights_threshold is NOT inherited from global
    expect(result.cron?.insights_threshold).toBeUndefined();
  });

  it('preserves global cron when repo does not define cron', () => {
    const globalWithCron = {
      ...globalConfig,
      cron: {
        mr_comment_poll: { enabled: true, interval_seconds: 300 },
      },
    };
    const repoConfig = {
      workflow: {
        defaults: {
          WORKFLOW_REMOTE_MODE: true,
        },
      },
    };
    const result = mergeConfigs(globalWithCron, repoConfig);
    expect(result.cron).toEqual({
      mr_comment_poll: { enabled: true, interval_seconds: 300 },
    });
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
