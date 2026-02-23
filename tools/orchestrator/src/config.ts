import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadConfig } from 'kanban-cli';
import type { PipelineConfig } from 'kanban-cli';
import type { OrchestratorConfig } from './types.js';

/**
 * CLI options as received from commander (all strings/booleans).
 */
export interface CliOptions {
  repo: string;
  once: boolean;
  idleSeconds: string;
  logDir?: string;
  model: string;
  verbose: boolean;
  mock?: boolean;
}

/**
 * Injectable dependencies for loadOrchestratorConfig.
 * Defaults to real implementations; tests can override.
 */
export interface ConfigDeps {
  loadPipelineConfig: (repoPath: string) => PipelineConfig;
  env: Record<string, string | undefined>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
}

const defaultDeps: ConfigDeps = {
  loadPipelineConfig: (repoPath: string) => loadConfig({ repoPath }),
  env: process.env,
  mkdir: async (dirPath: string, options: { recursive: boolean }) => {
    await fs.mkdir(dirPath, options);
  },
};

/**
 * Load orchestrator configuration from pipeline config, environment variables,
 * and CLI flags.
 *
 * Priority: CLI flags > env vars > pipeline config defaults > hardcoded defaults.
 */
export async function loadOrchestratorConfig(
  cliOptions: CliOptions,
  deps: Partial<ConfigDeps> = {},
): Promise<OrchestratorConfig> {
  const { loadPipelineConfig, env, mkdir } = { ...defaultDeps, ...deps };

  // Resolve repo path to absolute
  const repoPath = path.resolve(cliOptions.repo);

  // Load pipeline config
  const pipelineConfig = loadPipelineConfig(repoPath);

  // Extract WORKFLOW_MAX_PARALLEL from config defaults (default: 1)
  let maxParallel = pipelineConfig.workflow.defaults?.WORKFLOW_MAX_PARALLEL ?? 1;

  // Override with env var if set
  const envMaxParallel = env['WORKFLOW_MAX_PARALLEL'];
  if (envMaxParallel !== undefined) {
    const parsed = parseInt(envMaxParallel, 10);
    if (!Number.isNaN(parsed)) {
      maxParallel = parsed;
    }
  }

  // Build workflowEnv from all WORKFLOW_* env vars
  const workflowEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('WORKFLOW_') && value !== undefined) {
      workflowEnv[key] = value;
    }
  }

  // Parse CLI flags, validate idleSeconds
  const idleSeconds = Number(cliOptions.idleSeconds);
  if (Number.isNaN(idleSeconds) || idleSeconds < 0) {
    throw new Error(`Invalid idle-seconds value: "${cliOptions.idleSeconds}"`);
  }

  // Default logDir to <repoPath>/.kanban-logs/
  const logDir = path.resolve(cliOptions.logDir ?? path.join(repoPath, '.kanban-logs'));

  // Create log directory if it doesn't exist
  await mkdir(logDir, { recursive: true });

  // Return fully populated config
  return {
    repoPath,
    once: cliOptions.once,
    idleSeconds,
    logDir,
    model: cliOptions.model,
    verbose: cliOptions.verbose,
    maxParallel,
    pipelineConfig,
    workflowEnv,
    mock: cliOptions.mock === true,
  };
}
