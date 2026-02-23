import * as path from 'node:path';
import type { PipelineConfig, PipelineState } from 'kanban-cli';
import type { Discovery, ReadyStage } from './discovery.js';
import type { Locker } from './locking.js';
import type { WorktreeManager } from './worktree.js';
import type { SessionExecutor } from './session.js';
import type { Logger, SessionLogger } from './logger.js';
import type { OrchestratorConfig, WorkerInfo } from './types.js';

export interface Orchestrator {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getActiveWorkers(): ReadonlyMap<number, WorkerInfo>;
}

export interface OrchestratorDeps {
  discovery: Discovery;
  locker: Locker;
  worktreeManager: WorktreeManager;
  sessionExecutor: SessionExecutor;
  logger: Logger;
  now?: () => number;  // default: Date.now
}

/**
 * Look up the skill name for a given stage status from pipeline config.
 * Returns null if the phase is a resolver (no skill field) or if no phase matches.
 */
export function lookupSkillName(config: PipelineConfig, status: string): string | null {
  const phases: PipelineState[] = config.workflow.phases;
  const phase = phases.find((p) => p.status === status);
  if (!phase || !phase.skill) return null;
  return phase.skill;
}

/**
 * Build the absolute path to a stage markdown file from discovery data.
 */
export function resolveStageFilePath(repoPath: string, stage: ReadyStage): string {
  return path.join(repoPath, 'epics', stage.epic, stage.ticket, `${stage.id}.md`);
}

/**
 * Create a cancellable sleep promise.
 * Returns an object with the promise and a cancel function.
 */
function cancellableSleep(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelFn: () => void;

  const promise = new Promise<void>((resolve) => {
    cancelFn = resolve;
    timer = setTimeout(resolve, ms);
  });

  return {
    promise,
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      cancelFn();
    },
  };
}

/**
 * Create a deferred promise that can be resolved externally.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolveFn: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn! };
}

export function createOrchestrator(config: OrchestratorConfig, deps: OrchestratorDeps): Orchestrator {
  const { discovery, locker, worktreeManager, sessionExecutor, logger } = deps;
  const activeWorkers = new Map<number, WorkerInfo>();

  let running = false;
  let pendingSleep: { cancel: () => void } | undefined;
  let workerWaiter: { promise: Promise<void>; resolve: () => void } | undefined;

  // Cache for isolation strategy validation per start() call
  let isolationValidated: boolean | undefined;

  function notifyWorkerExit(): void {
    if (workerWaiter) {
      const waiter = workerWaiter;
      workerWaiter = undefined;
      waiter.resolve();
    }
  }

  function waitForAnyWorkerExit(): Promise<void> {
    if (workerWaiter) return workerWaiter.promise;
    const d = deferred();
    workerWaiter = d;
    return d.promise;
  }

  async function handleSessionExit(
    stageId: string,
    workerInfo: WorkerInfo,
    result: { exitCode: number; durationMs: number },
    sessionLogger: SessionLogger,
  ): Promise<void> {
    const statusAfter = await locker.readStatus(workerInfo.stageFilePath);

    if (workerInfo.statusBefore === statusAfter && result.exitCode !== 0) {
      logger.warn('Session crashed', {
        stageId,
        exitCode: result.exitCode,
        statusBefore: workerInfo.statusBefore,
      });
    } else if (workerInfo.statusBefore === statusAfter && result.exitCode === 0) {
      logger.info('Session completed without status change', {
        stageId,
        statusBefore: workerInfo.statusBefore,
      });
    } else {
      logger.info('Session completed', {
        stageId,
        exitCode: result.exitCode,
        statusBefore: workerInfo.statusBefore,
        statusAfter,
        durationMs: result.durationMs,
      });
    }

    await locker.releaseLock(workerInfo.stageFilePath);
    await worktreeManager.remove(workerInfo.worktreePath);
    await sessionLogger.close();
    activeWorkers.delete(workerInfo.worktreeIndex);
    notifyWorkerExit();
  }

  async function handleSessionError(
    stageId: string,
    workerInfo: WorkerInfo,
    error: Error,
    sessionLogger: SessionLogger,
  ): Promise<void> {
    logger.error('Session error', { stageId, error: error.message });
    await locker.releaseLock(workerInfo.stageFilePath);
    await worktreeManager.remove(workerInfo.worktreePath);
    await sessionLogger.close();
    activeWorkers.delete(workerInfo.worktreeIndex);
    notifyWorkerExit();
  }

  return {
    async start(): Promise<void> {
      if (running) throw new Error('Orchestrator already running');
      running = true;
      isolationValidated = undefined;

      while (running) {
        const availableSlots = config.maxParallel - activeWorkers.size;

        if (availableSlots <= 0) {
          await waitForAnyWorkerExit();
          continue;
        }

        const result = await discovery.discover(config.repoPath, availableSlots);
        let spawnedCount = 0;

        for (const stage of result.readyStages) {
          if (!running) break;
          if (activeWorkers.size >= config.maxParallel) break;

          const stageFilePath = resolveStageFilePath(config.repoPath, stage);

          await locker.acquireLock(stageFilePath);
          const statusBefore = await locker.readStatus(stageFilePath);

          const skillName = lookupSkillName(config.pipelineConfig, statusBefore);
          if (skillName === null) {
            // Resolver state, skip
            await locker.releaseLock(stageFilePath);
            continue;
          }

          // Validate isolation strategy once per start() call
          if (isolationValidated === undefined) {
            const ok = await worktreeManager.validateIsolationStrategy(config.repoPath);
            isolationValidated = ok;
            if (!ok) {
              logger.warn('Isolation strategy validation failed; skipping stage', { stageId: stage.id });
              await locker.releaseLock(stageFilePath);
              continue;
            }
          } else if (!isolationValidated) {
            logger.warn('Isolation strategy validation failed; skipping stage', { stageId: stage.id });
            await locker.releaseLock(stageFilePath);
            continue;
          }

          const worktreeInfo = await worktreeManager.create(stage.worktreeBranch, config.repoPath);
          const sessionLogger = logger.createSessionLogger(stage.id, config.logDir);

          const workerInfo: WorkerInfo = {
            stageId: stage.id,
            stageFilePath,
            worktreePath: worktreeInfo.path,
            worktreeIndex: worktreeInfo.index,
            statusBefore,
            startTime: (deps.now ?? Date.now)(),
          };

          activeWorkers.set(worktreeInfo.index, workerInfo);
          spawnedCount++;

          const sessionPromise = sessionExecutor.spawn(
            {
              stageId: stage.id,
              stageFilePath,
              skillName,
              worktreePath: worktreeInfo.path,
              worktreeIndex: worktreeInfo.index,
              model: config.model,
              workflowEnv: config.workflowEnv,
            },
            sessionLogger,
          );

          sessionPromise
            .then((sessionResult) => handleSessionExit(stage.id, workerInfo, sessionResult, sessionLogger))
            .catch((err: unknown) => {
              const error = err instanceof Error ? err : new Error(String(err));
              return handleSessionError(stage.id, workerInfo, error, sessionLogger);
            });
        }

        if (spawnedCount === 0 && activeWorkers.size === 0) {
          if (config.once) {
            break;
          }
          const sleepObj = cancellableSleep(config.idleSeconds * 1000);
          pendingSleep = sleepObj;
          await sleepObj.promise;
          pendingSleep = undefined;
          continue;
        }

        if (config.once) {
          // Wait for all active workers to finish
          while (activeWorkers.size > 0) {
            await waitForAnyWorkerExit();
          }
          break;
        }

        if (spawnedCount === 0 && activeWorkers.size > 0) {
          await waitForAnyWorkerExit();
          continue;
        }
      }
    },

    async stop(): Promise<void> {
      running = false;
      if (pendingSleep) {
        pendingSleep.cancel();
        pendingSleep = undefined;
      }
      notifyWorkerExit();
    },

    isRunning(): boolean {
      return running;
    },

    getActiveWorkers(): ReadonlyMap<number, WorkerInfo> {
      return new Map(activeWorkers);
    },
  };
}
