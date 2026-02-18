import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { pipelineConfigSchema } from './schema.js';
import { defaultPipelineConfig } from './defaults.js';
import type { PipelineConfig } from '../types/pipeline.js';

export const CONFIG_PATHS = {
  globalConfig: path.join(
    process.env.HOME || process.env.USERPROFILE || '~',
    '.config',
    'kanban-workflow',
    'config.yaml'
  ),
  repoConfigName: '.kanban-workflow.yaml',
} as const;

export interface LoadConfigOptions {
  globalConfigPath?: string;
  repoPath?: string;
}

/**
 * Merge a repo config over a global config.
 *
 * Rules:
 * - If repo defines `phases`, it REPLACES global phases entirely (no merge).
 * - If repo defines `entry_phase`, it replaces global entry_phase.
 * - `defaults` are MERGED (repo values override global values, but unset keys are preserved).
 */
export function mergeConfigs(
  global: PipelineConfig,
  repo: Partial<PipelineConfig> | null
): PipelineConfig {
  if (!repo || !repo.workflow) {
    return global;
  }

  const merged: PipelineConfig = {
    workflow: {
      entry_phase: repo.workflow.entry_phase ?? global.workflow.entry_phase,
      phases: repo.workflow.phases ?? global.workflow.phases,
      defaults: {
        ...global.workflow.defaults,
        ...repo.workflow.defaults,
      },
    },
  };

  return merged;
}

/**
 * Load and merge pipeline config from global and repo locations.
 *
 * Priority: repo config > global config > embedded default.
 * Validates the final merged result against the Zod schema.
 */
export function loadConfig(options: LoadConfigOptions = {}): PipelineConfig {
  const globalPath = options.globalConfigPath ?? CONFIG_PATHS.globalConfig;
  const repoPath = options.repoPath ?? process.cwd();
  const repoConfigPath = path.join(repoPath, CONFIG_PATHS.repoConfigName);

  // Load global config (or use embedded default)
  let globalConfig: PipelineConfig;
  if (fs.existsSync(globalPath)) {
    const raw = fs.readFileSync(globalPath, 'utf-8');
    const parsed = parseYaml(raw);
    const result = pipelineConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Invalid global config at ${globalPath}: ${result.error.issues.map((i) => i.message).join(', ')}`
      );
    }
    globalConfig = result.data;
  } else {
    globalConfig = defaultPipelineConfig;
  }

  // Load repo config (optional)
  let repoConfig: Partial<PipelineConfig> | null = null;
  if (fs.existsSync(repoConfigPath)) {
    const raw = fs.readFileSync(repoConfigPath, 'utf-8');
    const parsed = parseYaml(raw);
    // Repo config is partial — don't validate against full schema yet
    repoConfig = parsed as Partial<PipelineConfig>;
  }

  // Merge
  const merged = mergeConfigs(globalConfig, repoConfig);

  // Validate final result
  const result = pipelineConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `Invalid merged config: ${result.error.issues.map((i) => i.message).join(', ')}`
    );
  }

  return result.data;
}
