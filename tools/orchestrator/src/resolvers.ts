import * as path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { PipelineConfig, ResolverStageInput, ResolverContext } from 'kanban-cli';
import { isResolverState } from 'kanban-cli';
import { ResolverRegistry } from 'kanban-cli';
import type { FrontmatterData } from './locking.js';
import { defaultReadFrontmatter, defaultWriteFrontmatter } from './locking.js';
import type { ExitGateRunner } from './exit-gates.js';
import type { WorkerInfo } from './types.js';

/**
 * Injectable dependencies for the ResolverRunner.
 * Defaults to real implementations; tests can override.
 */
export interface ResolverRunnerDeps {
  readFrontmatter: (filePath: string) => Promise<FrontmatterData>;
  writeFrontmatter: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>;
  registry: ResolverRegistry;
  exitGateRunner: ExitGateRunner;
  discoverStageFiles: (repoPath: string) => Promise<string[]>;
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
}

/**
 * Result of checking a single stage against its resolver.
 */
export interface ResolverResult {
  stageId: string;
  resolverName: string;
  previousStatus: string;
  newStatus: string | null;
  propagated: boolean;
}

/**
 * Resolver runner interface.
 * On each orchestrator tick, checks all stages in resolver states
 * and executes the appropriate resolver function.
 */
export interface ResolverRunner {
  checkAll(repoPath: string, context: ResolverContext): Promise<ResolverResult[]>;
}

/**
 * Default stage file discovery: recursively walks epics/ for STAGE-*.md files.
 */
async function defaultDiscoverStageFiles(repoPath: string): Promise<string[]> {
  const epicsDir = path.join(repoPath, 'epics');
  try {
    const entries = await readdir(epicsDir, { recursive: true });
    return entries
      .filter((entry) => {
        const basename = path.basename(entry);
        return basename.startsWith('STAGE-') && basename.endsWith('.md');
      })
      .map((entry) => path.join(epicsDir, entry));
  } catch {
    // epics/ directory may not exist
    return [];
  }
}

/**
 * Build a map from status string to resolver name from pipeline config.
 */
function buildResolverStatusMap(pipelineConfig: PipelineConfig): Map<string, string> {
  const map = new Map<string, string>();
  for (const phase of pipelineConfig.workflow.phases) {
    if (isResolverState(phase)) {
      map.set(phase.status, phase.resolver);
    }
  }
  return map;
}

const defaultDeps: Omit<ResolverRunnerDeps, 'registry' | 'exitGateRunner'> = {
  readFrontmatter: defaultReadFrontmatter,
  writeFrontmatter: defaultWriteFrontmatter,
  discoverStageFiles: defaultDiscoverStageFiles,
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

/**
 * Create a ResolverRunner instance.
 *
 * The runner iterates over all stage files, finds those whose current status
 * maps to a resolver state in the pipeline config, executes the resolver,
 * and if it returns a target status, updates the stage frontmatter and
 * propagates via the exit gate runner.
 */
export function createResolverRunner(
  pipelineConfig: PipelineConfig,
  deps: Partial<ResolverRunnerDeps> & Pick<ResolverRunnerDeps, 'registry' | 'exitGateRunner'>,
): ResolverRunner {
  const merged = { ...defaultDeps, ...deps };
  const { readFrontmatter, writeFrontmatter, registry, exitGateRunner, discoverStageFiles, logger } = merged;

  const resolverStatusMap = buildResolverStatusMap(pipelineConfig);

  return {
    async checkAll(repoPath: string, context: ResolverContext): Promise<ResolverResult[]> {
      const results: ResolverResult[] = [];

      // Discover all stage files
      let stageFiles: string[];
      try {
        stageFiles = await discoverStageFiles(repoPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to discover stage files', { repoPath, error: msg });
        return results;
      }

      for (const stageFilePath of stageFiles) {
        // Read frontmatter
        let data: Record<string, unknown>;
        let content: string;
        try {
          const fm = await readFrontmatter(stageFilePath);
          data = fm.data;
          content = fm.content;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('Failed to read stage file', { stageFilePath, error: msg });
          continue;
        }

        const stageId = data.id as string;
        const status = data.status as string;

        if (!stageId || !status) {
          logger.warn('Stage file missing id or status', { stageFilePath });
          continue;
        }

        // Skip if session is active (locked by active session)
        if (data.session_active === true) {
          continue;
        }

        // Look up resolver for this status
        const resolverName = resolverStatusMap.get(status);
        if (!resolverName) {
          continue;
        }

        // Build ResolverStageInput from frontmatter
        const stageInput: ResolverStageInput = {
          id: stageId,
          status,
          ticket_id: data.ticket as string | undefined,
          epic_id: data.epic as string | undefined,
          pr_url: data.pr_url as string | undefined,
          pr_number: data.pr_number as number | undefined,
          worktree_branch: data.worktree_branch as string | undefined,
          refinement_type: data.refinement_type as string[] | undefined,
        };

        // Execute resolver
        let resolverResult: string | null;
        try {
          resolverResult = await registry.execute(resolverName, stageInput, context);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Resolver execution failed', {
            stageId,
            resolverName,
            error: msg,
          });
          continue;
        }

        if (resolverResult === null) {
          results.push({
            stageId,
            resolverName,
            previousStatus: status,
            newStatus: null,
            propagated: false,
          });
          continue;
        }

        // Transition: update stage frontmatter with new status
        data.status = resolverResult;
        try {
          await writeFrontmatter(stageFilePath, data, content);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to write updated status', {
            stageId,
            resolverName,
            newStatus: resolverResult,
            error: msg,
          });
          continue;
        }

        logger.info('Resolver transitioned stage', {
          stageId,
          resolverName,
          previousStatus: status,
          newStatus: resolverResult,
        });

        // Propagate through exit gate
        const workerInfo: WorkerInfo = {
          stageId,
          stageFilePath,
          worktreePath: '',
          worktreeIndex: -1,
          statusBefore: status,
          startTime: Date.now(),
        };

        let propagated = false;
        try {
          await exitGateRunner.run(workerInfo, repoPath, resolverResult);
          propagated = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Exit gate propagation failed', {
            stageId,
            resolverName,
            error: msg,
          });
        }

        results.push({
          stageId,
          resolverName,
          previousStatus: status,
          newStatus: resolverResult,
          propagated,
        });
      }

      return results;
    },
  };
}
