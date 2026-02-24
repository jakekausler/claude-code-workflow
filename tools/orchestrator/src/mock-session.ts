import type { SessionExecutor, SpawnOptions, SessionResult, ActiveSession, SessionLoggerLike } from './session.js';
import type { LockerDeps } from './locking.js';
import type { PipelineConfig } from 'kanban-cli';
import { DONE_TARGET, COMPLETE_STATUS } from 'kanban-cli';

/**
 * Injectable dependencies for the mock session executor.
 */
export interface MockSessionDeps {
  readFrontmatter: LockerDeps['readFrontmatter'];
  writeFrontmatter: LockerDeps['writeFrontmatter'];
  pipelineConfig: PipelineConfig;
  delayMs?: number;  // default: 500
}

/**
 * Delay helper that returns a promise resolving after `ms` milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock SessionExecutor that auto-advances stage status
 * based on pipeline config transitions instead of spawning real CLI sessions.
 */
export function createMockSessionExecutor(deps: MockSessionDeps): SessionExecutor {
  const delayMs = deps.delayMs ?? 500;

  return {
    async spawn(options: SpawnOptions, sessionLogger: SessionLoggerLike): Promise<SessionResult> {
      // 1. Read frontmatter from the stage file
      const { data, content } = await deps.readFrontmatter(options.stageFilePath);

      const currentStatus = data.status as string | undefined;

      if (currentStatus === undefined) {
        sessionLogger.write(`[MOCK] Stage ${options.stageId} has no status field\n`);
        await delay(delayMs);
        return { exitCode: 0, durationMs: delayMs };
      }

      // 2. Find the matching phase in pipeline config
      const phase = deps.pipelineConfig.workflow.phases.find((p) => p.status === currentStatus);

      if (!phase) {
        sessionLogger.write(`[MOCK] No phase found for status "${currentStatus}" on stage ${options.stageId}\n`);
        await delay(delayMs);
        return { exitCode: 0, durationMs: delayMs };
      }

      // 3. If phase has transitions_to, pick the first one
      //    Map the reserved "Done" target to the canonical "Complete" frontmatter status,
      //    matching the behavior of the real transition engine.
      if (phase.transitions_to.length > 0) {
        const rawTarget = phase.transitions_to[0];
        const newStatus = rawTarget === DONE_TARGET ? COMPLETE_STATUS : rawTarget;
        data.status = newStatus;
        await deps.writeFrontmatter(options.stageFilePath, data, content);
        sessionLogger.write(`[MOCK] Advancing stage ${options.stageId} from ${currentStatus} to ${newStatus}\n`);
      } else {
        sessionLogger.write(`[MOCK] Stage ${options.stageId} has no transitions from ${currentStatus}\n`);
      }

      // 4. Wait delayMs milliseconds
      await delay(delayMs);

      // 5. Return mock result
      return { exitCode: 0, durationMs: delayMs };
    },

    getActiveSessions(): ActiveSession[] {
      return [];
    },

    killAll(): void {
      // no-op
    },
  };
}
