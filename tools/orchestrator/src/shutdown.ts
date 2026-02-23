import type { Orchestrator } from './loop.js';
import type { WorktreeManager } from './worktree.js';
import type { Locker } from './locking.js';
import type { SessionExecutor } from './session.js';
import type { Logger } from './logger.js';

export interface ShutdownDeps {
  onSignal: (signal: string, handler: () => void) => void;
  exit: (code: number) => void;
}

export interface ShutdownOptions {
  orchestrator: Orchestrator;
  worktreeManager: WorktreeManager;
  locker: Locker;
  sessionExecutor: SessionExecutor;
  logger: Logger;
  drainTimeoutMs?: number;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 60000;
const DRAIN_POLL_INTERVAL_MS = 500;
const GRACEFUL_KILL_TIMEOUT_MS = 5000;

const defaultDeps: ShutdownDeps = {
  onSignal: (signal, handler) => process.on(signal, handler),
  exit: (code) => process.exit(code),
};

/**
 * Register SIGINT and SIGTERM handlers that perform graceful shutdown.
 *
 * On signal:
 * 1. Stop the orchestrator (no new work accepted).
 * 2. Wait for active workers to drain within the timeout.
 * 3. If workers remain after timeout, kill sessions (SIGTERM then SIGKILL).
 * 4. Release locks and remove worktrees for any remaining workers.
 * 5. Release all index pool state and exit.
 */
export function setupShutdownHandlers(
  options: ShutdownOptions,
  deps: Partial<ShutdownDeps> = {},
): void {
  const resolved: ShutdownDeps = { ...defaultDeps, ...deps };
  const {
    orchestrator,
    worktreeManager,
    locker,
    sessionExecutor,
    logger,
    drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
  } = options;

  let shutdownInProgress = false;

  async function performShutdown(signal: string): Promise<void> {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    logger.info('Received shutdown signal, draining active sessions...', { signal });
    try {
      await orchestrator.stop();
    } catch (err) {
      logger.error('Error stopping orchestrator', { error: err instanceof Error ? err.message : String(err) });
    }

    // Wait for active workers to drain
    const drainDeadline = Date.now() + drainTimeoutMs;
    while (orchestrator.getActiveWorkers().size > 0 && Date.now() < drainDeadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, DRAIN_POLL_INTERVAL_MS));
    }

    // If workers still active after timeout, escalate
    if (orchestrator.getActiveWorkers().size > 0) {
      logger.warn('Drain timeout reached, killing active sessions...');
      sessionExecutor.killAll('SIGTERM');

      // Wait for graceful kill
      const killDeadline = Date.now() + GRACEFUL_KILL_TIMEOUT_MS;
      while (orchestrator.getActiveWorkers().size > 0 && Date.now() < killDeadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, DRAIN_POLL_INTERVAL_MS));
      }

      // Escalate to SIGKILL if still active
      if (orchestrator.getActiveWorkers().size > 0) {
        sessionExecutor.killAll('SIGKILL');
      }
    }

    // Cleanup remaining workers
    const remainingWorkers = orchestrator.getActiveWorkers();
    for (const [, worker] of remainingWorkers) {
      try {
        await locker.releaseLock(worker.stageFilePath);
      } catch (err) {
        logger.error('Failed to release lock during shutdown', {
          stageFilePath: worker.stageFilePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        await worktreeManager.remove(worker.worktreePath);
      } catch (err) {
        logger.error('Failed to remove worktree during shutdown', {
          worktreePath: worker.worktreePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    worktreeManager.releaseAll();
    logger.info('Shutdown complete');
    resolved.exit(0);
  }

  resolved.onSignal('SIGINT', () => {
    void performShutdown('SIGINT');
  });
  resolved.onSignal('SIGTERM', () => {
    void performShutdown('SIGTERM');
  });
}
