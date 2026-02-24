import { execFile } from 'node:child_process';
import * as path from 'node:path';
import type { FrontmatterData } from './locking.js';
import { defaultReadFrontmatter, defaultWriteFrontmatter } from './locking.js';
import type { WorkerInfo } from './types.js';

/**
 * Injectable dependencies for the ExitGateRunner.
 * Defaults to real implementations; tests can override.
 */
export interface ExitGateDeps {
  readFrontmatter: (filePath: string) => Promise<FrontmatterData>;
  writeFrontmatter: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>;
  runSync: (repoPath: string) => Promise<{ success: boolean; error?: string }>;
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
}

/**
 * Result of running the exit gate after a Claude session completes.
 */
export interface ExitGateResult {
  statusChanged: boolean;
  statusBefore: string;
  statusAfter: string;
  ticketUpdated: boolean;
  ticketCompleted: boolean;
  epicUpdated: boolean;
  epicCompleted: boolean;
  syncResult: { success: boolean; error?: string };
}

/**
 * Exit gate runner interface.
 * After a session exits, propagates status changes through the file hierarchy.
 */
export interface ExitGateRunner {
  run(workerInfo: WorkerInfo, repoPath: string, statusAfter: string): Promise<ExitGateResult>;
}

/**
 * Default sync implementation: shells out to `kanban-cli sync` as a subprocess.
 * This avoids requiring a KanbanDatabase instance and PipelineConfig.
 */
function defaultRunSync(repoPath: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile('npx', ['kanban-cli', 'sync', '--repo', repoPath], { timeout: 30_000 }, (err, _stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: stderr || err.message });
      } else {
        resolve({ success: true });
      }
    });
  });
}

/**
 * Derive an overall ticket status from its stage_statuses map.
 *
 * Rules:
 * - Empty map -> null (don't change ticket status)
 * - All values are "Complete" -> "Complete"
 * - All values are "Not Started" -> "Not Started"
 * - Any value is a pipeline phase (not "Not Started" and not "Complete") -> "In Progress"
 */
export function deriveTicketStatus(stageStatuses: Record<string, string>): string | null {
  const values = Object.values(stageStatuses);
  if (values.length === 0) return null;

  const allComplete = values.every((v) => v === 'Complete');
  if (allComplete) return 'Complete';

  const allNotStarted = values.every((v) => v === 'Not Started');
  if (allNotStarted) return 'Not Started';

  return 'In Progress';
}

/**
 * Derive an overall epic status from its ticket_statuses map.
 *
 * Rules:
 * - Empty map -> null (don't change epic status)
 * - All values are "Complete" -> "Complete"
 * - All values are "Not Started" -> "Not Started"
 * - Otherwise -> "In Progress"
 */
export function deriveEpicStatus(ticketStatuses: Record<string, string>): string | null {
  const values = Object.values(ticketStatuses);
  if (values.length === 0) return null;
  if (values.every((v) => v === 'Complete')) return 'Complete';
  if (values.every((v) => v === 'Not Started')) return 'Not Started';
  return 'In Progress';
}

const defaultDeps: ExitGateDeps = {
  readFrontmatter: defaultReadFrontmatter,
  writeFrontmatter: defaultWriteFrontmatter,
  runSync: defaultRunSync,
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

/**
 * Create an ExitGateRunner instance.
 *
 * The runner propagates status changes through the file hierarchy:
 * 1. Update the ticket's stage_statuses frontmatter field
 * 2. Derive and update the epic's ticket_statuses field
 * 3. Call syncRepo (via subprocess)
 */
export function createExitGateRunner(deps: Partial<ExitGateDeps> = {}): ExitGateRunner {
  const { readFrontmatter, writeFrontmatter, runSync, logger } = { ...defaultDeps, ...deps };

  return {
    async run(workerInfo: WorkerInfo, repoPath: string, statusAfter: string): Promise<ExitGateResult> {
      const result: ExitGateResult = {
        statusChanged: false,
        statusBefore: workerInfo.statusBefore,
        statusAfter,
        ticketUpdated: false,
        ticketCompleted: false,
        epicUpdated: false,
        epicCompleted: false,
        syncResult: { success: false },
      };

      // 1. Compare statusBefore vs statusAfter. If same, return early.
      if (workerInfo.statusBefore === statusAfter) {
        result.syncResult = { success: true };
        return result;
      }

      result.statusChanged = true;

      // 2. Read the stage file frontmatter to get ticket and epic IDs.
      let ticketId: string;
      let epicId: string;
      try {
        const stageFm = await readFrontmatter(workerInfo.stageFilePath);
        ticketId = stageFm.data.ticket as string;
        epicId = stageFm.data.epic as string;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to read stage frontmatter', { stageFilePath: workerInfo.stageFilePath, error: msg });
        // Can't proceed without ticket/epic IDs, run sync and return
        result.syncResult = await runSyncWithRetry(repoPath);
        return result;
      }

      if (!ticketId || !epicId) {
        logger.warn('Stage file missing ticket or epic ID', {
          stageFilePath: workerInfo.stageFilePath,
          ticketId,
          epicId,
        });
        result.syncResult = await runSyncWithRetry(repoPath);
        return result;
      }

      // 3. Resolve ticket file path and update ticket frontmatter
      const ticketFilePath = path.join(repoPath, 'epics', epicId, ticketId, `${ticketId}.md`);
      let derivedStatus: string | null = null;
      try {
        const ticketFm = await readFrontmatter(ticketFilePath);
        const stageStatuses = (ticketFm.data.stage_statuses as Record<string, string>) ?? {};
        stageStatuses[workerInfo.stageId] = statusAfter;
        ticketFm.data.stage_statuses = stageStatuses;

        // 4. Derive ticket status from its stage_statuses map
        derivedStatus = deriveTicketStatus(stageStatuses);
        if (derivedStatus !== null) {
          ticketFm.data.status = derivedStatus;
        }

        await writeFrontmatter(ticketFilePath, ticketFm.data, ticketFm.content);
        result.ticketUpdated = true;
        result.ticketCompleted = derivedStatus === 'Complete';
        logger.info('Updated ticket frontmatter', {
          ticketId,
          stageId: workerInfo.stageId,
          statusAfter,
          derivedTicketStatus: derivedStatus,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Failed to update ticket frontmatter', { ticketFilePath, error: msg });
      }

      // 5. Resolve epic file path and update epic frontmatter (only if we derived a status)
      if (derivedStatus !== null) {
        const epicFilePath = path.join(repoPath, 'epics', epicId, `${epicId}.md`);
        try {
          const epicFm = await readFrontmatter(epicFilePath);
          const ticketStatuses = (epicFm.data.ticket_statuses as Record<string, string>) ?? {};
          ticketStatuses[ticketId] = derivedStatus;
          epicFm.data.ticket_statuses = ticketStatuses;

          await writeFrontmatter(epicFilePath, epicFm.data, epicFm.content);
          result.epicUpdated = true;
          logger.info('Updated epic frontmatter', {
            epicId,
            ticketId,
            derivedTicketStatus: derivedStatus,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('Failed to update epic frontmatter', { epicFilePath, error: msg });
        }
      }

      // 6. Call syncRepo with retry
      result.syncResult = await runSyncWithRetry(repoPath);

      return result;
    },
  };

  async function runSyncWithRetry(repoPath: string): Promise<{ success: boolean; error?: string }> {
    const firstAttempt = await runSync(repoPath);
    if (firstAttempt.success) return firstAttempt;

    logger.warn('Sync failed, retrying once', { error: firstAttempt.error });
    const secondAttempt = await runSync(repoPath);
    if (secondAttempt.success) return secondAttempt;

    logger.warn('Sync failed on retry', { error: secondAttempt.error });
    return secondAttempt;
  }
}
