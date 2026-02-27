import * as path from 'node:path';
import type { PipelineConfig, PipelineState, ResolverContext } from 'kanban-cli';
import type { Discovery, ReadyStage } from './discovery.js';
import type { Locker, FrontmatterData } from './locking.js';
import { defaultReadFrontmatter, defaultWriteFrontmatter } from './locking.js';
import type { WorktreeManager } from './worktree.js';
import type { SessionExecutor } from './session.js';
import type { Logger, SessionLogger } from './logger.js';
import type { OrchestratorConfig, WorkerInfo } from './types.js';
import type { ExitGateRunner } from './exit-gates.js';
import { createExitGateRunner } from './exit-gates.js';
import type { ResolverRunner } from './resolvers.js';
import { createResolverRunner } from './resolvers.js';
import { ResolverRegistry, registerBuiltinResolvers } from 'kanban-cli';
import type { CronScheduler, CronJob } from './cron.js';
import { createCronScheduler } from './cron.js';
import type { MRCommentPoller } from './mr-comment-poller.js';
import { createMRCommentPoller } from './mr-comment-poller.js';
import type { MRChainManager } from './mr-chain-manager.js';
import { createMRChainManager } from './mr-chain-manager.js';
import { execFile } from 'node:child_process';
import { createInsightsThresholdChecker } from './insights-threshold.js';
import type { LearningsResult } from './insights-threshold.js';
import { SessionRegistry } from './session-registry.js';
import { createWsServer } from './ws-server.js';
import type { WsServerHandle } from './ws-server.js';

export interface Orchestrator {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getActiveWorkers(): ReadonlyMap<number, WorkerInfo>;
  getRegistry(): SessionRegistry;
}

export interface OrchestratorDeps {
  discovery: Discovery;
  locker: Locker;
  worktreeManager: WorktreeManager;
  sessionExecutor: SessionExecutor;
  logger: Logger;
  now?: () => number;  // default: Date.now
  exitGateRunner?: ExitGateRunner;
  resolverRunner?: ResolverRunner;
  readFrontmatter?: (filePath: string) => Promise<FrontmatterData>;
  writeFrontmatter?: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>;

  // Cron-related deps (injectable for testing; omit to use defaults/no-ops)
  cronScheduler?: CronScheduler;
  mrCommentPoller?: MRCommentPoller;
  mrChainManager?: MRChainManager;
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

/**
 * Build a CronScheduler from pipeline config cron section.
 * Returns null if cron config is undefined (cron disabled).
 */
function buildCronScheduler(
  config: OrchestratorConfig,
  deps: OrchestratorDeps,
  shared: {
    exitGateRunner: ExitGateRunner;
    readFrontmatter: (filePath: string) => Promise<FrontmatterData>;
    writeFrontmatter: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>;
    logger: Logger;
  },
): CronScheduler | null {
  const cronConfig = config.pipelineConfig.cron;
  if (!cronConfig) return null;

  const { exitGateRunner, readFrontmatter, writeFrontmatter, logger } = shared;

  // Build MR comment poller (injectable or default no-op deps)
  if (!deps.mrCommentPoller) {
    logger.info('MR comment poller using no-op defaults — wire real DB queries for production use');
  }
  const poller: MRCommentPoller = deps.mrCommentPoller ?? createMRCommentPoller({
    queryStagesInPRCreated: async () => [],
    getCommentTracking: () => null,
    upsertCommentTracking: () => {},
    exitGateRunner,
    readFrontmatter,
    writeFrontmatter,
    codeHost: null,
    logger,
  });

  // Build MR chain manager (injectable or default no-op deps)
  if (!deps.mrChainManager) {
    logger.info('MR chain manager using no-op defaults — wire real DB queries for production use');
  }
  const chainManager: MRChainManager = deps.mrChainManager ?? createMRChainManager({
    getActiveTrackingRows: async () => [],
    updateTrackingRow: async () => {},
    codeHost: null,
    logger,
    locker: deps.locker,
    sessionExecutor: deps.sessionExecutor,
    readFrontmatter,
    writeFrontmatter,
    resolveStageFilePath: null,
    createSessionLogger: (stageId: string) => logger.createSessionLogger(stageId, config.logDir),
    model: config.model,
    workflowEnv: config.workflowEnv,
  });

  const jobs: CronJob[] = [];

  // MR comment poll job
  if (cronConfig.mr_comment_poll) {
    const pollConfig = cronConfig.mr_comment_poll;
    jobs.push({
      name: 'mr-comment-poll',
      enabled: pollConfig.enabled,
      intervalMs: pollConfig.interval_seconds * 1000,
      async execute(): Promise<void> {
        await poller.poll(config.repoPath);
        await chainManager.checkParentChains(config.repoPath);
      },
    });
  }

  // Insights threshold job
  if (cronConfig.insights_threshold) {
    const insightsConfig = cronConfig.insights_threshold;
    const threshold = config.pipelineConfig.workflow.defaults?.WORKFLOW_LEARNINGS_THRESHOLD ?? 10;
    const scriptPath = path.join(config.repoPath, 'skills', 'meta-insights', 'scripts', 'count-unanalyzed.sh');
    const sessionLogger = logger.createSessionLogger('insights-threshold', config.logDir);

    const checker = createInsightsThresholdChecker({
      countLearnings: (_repoPath: string): Promise<LearningsResult> => {
        return new Promise((resolve) => {
          execFile('bash', [scriptPath], { encoding: 'utf-8', timeout: 30_000, cwd: config.repoPath }, (err, stdout) => {
            if (err) {
              logger.warn('count-unanalyzed.sh failed', { error: err.message ?? String(err) });
              resolve({ count: 0, threshold, exceeded: false });
              return;
            }
            const lines = stdout.trim().split('\n').filter((line) => line.trim().length > 0);
            const count = lines.length;
            resolve({ count, threshold, exceeded: count > threshold });
          });
        });
      },
      spawnSession: async (repoPath: string): Promise<void> => {
        const spawnOpts = {
          stageId: 'meta-insights',
          stageFilePath: '', // meta-insights has no stage file — operates on ~/docs/ learnings
          skillName: 'meta-insights',
          worktreePath: repoPath,
          worktreeIndex: -1,
          model: config.model,
          workflowEnv: config.workflowEnv,
        };
        deps.sessionExecutor.spawn(spawnOpts, sessionLogger).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Meta-insights session failed', { error: msg });
        });
      },
      logger,
      now: deps.now ?? (() => Date.now()),
      // Cooldown matches cron interval — defense in depth against overlapping triggers
      intervalMs: insightsConfig.interval_seconds * 1000,
    });

    jobs.push({
      name: 'insights-threshold',
      enabled: insightsConfig.enabled,
      intervalMs: insightsConfig.interval_seconds * 1000,
      async execute(): Promise<void> {
        await checker.check(config.repoPath);
      },
    });
  }

  return createCronScheduler(jobs, { logger });
}

export function createOrchestrator(config: OrchestratorConfig, deps: OrchestratorDeps): Orchestrator {
  const { discovery, locker, worktreeManager, sessionExecutor, logger } = deps;
  const activeWorkers = new Map<number, WorkerInfo>();

  // Frontmatter I/O (injectable for testing)
  const readFrontmatter = deps.readFrontmatter ?? defaultReadFrontmatter;
  const writeFrontmatter = deps.writeFrontmatter ?? defaultWriteFrontmatter;

  // Create exit gate runner (if not injected)
  const exitGateRunner = deps.exitGateRunner ?? createExitGateRunner({ logger });

  // Create resolver runner (if not injected)
  const resolverRunner: ResolverRunner = deps.resolverRunner ?? (() => {
    const resolverRegistry = new ResolverRegistry();
    registerBuiltinResolvers(resolverRegistry);
    return createResolverRunner(config.pipelineConfig, {
      registry: resolverRegistry,
      exitGateRunner,
      logger,
    });
  })();

  // Build cron scheduler (if cron config is present)
  const cronScheduler: CronScheduler | null = deps.cronScheduler ?? buildCronScheduler(config, deps, {
    exitGateRunner,
    readFrontmatter,
    writeFrontmatter,
    logger,
  });

  // Session registry for tracking active sessions
  const registry = new SessionRegistry();

  // WebSocket server for real-time session broadcasting (optional — only when wsPort is set)
  const wsServer: WsServerHandle | null = config.wsPort != null
    ? createWsServer({ port: config.wsPort, registry })
    : null;

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

    // Exit gate — propagate status change
    if (workerInfo.statusBefore !== statusAfter) {
      try {
        const gateResult = await exitGateRunner.run(workerInfo, config.repoPath, statusAfter);
        logger.info('Exit gate completed', {
          stageId,
          ticketUpdated: gateResult.ticketUpdated,
          epicUpdated: gateResult.epicUpdated,
          ticketCompleted: gateResult.ticketCompleted,
          epicCompleted: gateResult.epicCompleted,
          syncSuccess: gateResult.syncResult.success,
        });
        if (gateResult.ticketCompleted) {
          logger.info('Ticket completed — all stages done', { stageId });
        }
        if (gateResult.epicCompleted) {
          logger.info('Epic completed — all tickets done', { stageId });
        }
      } catch (err) {
        logger.error('Exit gate failed', { stageId, error: (err as Error).message });
      }
    }

    await locker.releaseLock(workerInfo.stageFilePath);
    await worktreeManager.remove(workerInfo.worktreePath);
    await sessionLogger.close();
    registry.end(stageId);
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
    registry.end(stageId);
    activeWorkers.delete(workerInfo.worktreeIndex);
    notifyWorkerExit();
  }

  return {
    async start(): Promise<void> {
      if (running) throw new Error('Orchestrator already running');
      running = true;
      isolationValidated = undefined;

      // Start cron scheduler if configured
      if (cronScheduler) {
        cronScheduler.start();
      }

      // Start WebSocket server if configured
      if (wsServer) {
        const wsInfo = await wsServer.start();
        logger.info('WebSocket server started', { port: wsInfo.port });
      }

      while (running) {
        // Run resolver checks at top of each tick
        {
          const resolverContext: ResolverContext = {
            env: config.workflowEnv,
          };
          const resolverResults = await resolverRunner.checkAll(config.repoPath, resolverContext);
          for (const r of resolverResults) {
            if (r.newStatus) {
              logger.info('Resolver transition', {
                stageId: r.stageId,
                resolver: r.resolverName,
                from: r.previousStatus,
                to: r.newStatus,
              });
            }
          }
        }

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
          let statusBefore = await locker.readStatus(stageFilePath);

          // Onboard "Not Started" stages to entry phase
          if (statusBefore === 'Not Started') {
            const entryPhase = config.pipelineConfig.workflow.entry_phase;
            const entryState = config.pipelineConfig.workflow.phases.find(
              (p: PipelineState) => p.name === entryPhase,
            );
            if (entryState) {
              const { data, content } = await readFrontmatter(stageFilePath);
              data.status = entryState.status;
              await writeFrontmatter(stageFilePath, data, content);
              statusBefore = entryState.status;
              logger.info('Onboarded stage to entry phase', { stageId: stage.id, status: entryState.status });
            }
          }

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

          const now = (deps.now ?? Date.now)();

          const workerInfo: WorkerInfo = {
            stageId: stage.id,
            stageFilePath,
            worktreePath: worktreeInfo.path,
            worktreeIndex: worktreeInfo.index,
            statusBefore,
            startTime: now,
          };

          activeWorkers.set(worktreeInfo.index, workerInfo);
          spawnedCount++;

          // Register session in the registry for real-time tracking
          registry.register({
            stageId: stage.id,
            sessionId: '',
            processId: 0, // TODO: SessionExecutor.spawn() does not expose child PID; wire when available
            worktreePath: worktreeInfo.path,
            spawnedAt: now,
          });

          const sessionPromise = sessionExecutor.spawn(
            {
              stageId: stage.id,
              stageFilePath,
              skillName,
              worktreePath: worktreeInfo.path,
              worktreeIndex: worktreeInfo.index,
              model: config.model,
              workflowEnv: config.workflowEnv,
              // TODO: Persist session_id to DB via stages.updateSessionId(stageId, sessionId)
              // Deferred: OrchestratorDeps does not have a stages repository dependency yet.
              // The web server reads session_id from the registry via WebSocket for now.
              onSessionId: (sessionId: string) => {
                registry.activate(stage.id, sessionId);
              },
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

      // Stop cron scheduler if running
      if (cronScheduler) {
        cronScheduler.stop();
      }

      // Stop WebSocket server if running
      if (wsServer) {
        await wsServer.stop();
      }

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

    getRegistry(): SessionRegistry {
      return registry;
    },
  };
}
