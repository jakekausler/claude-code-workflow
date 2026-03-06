import type { CodeHostAdapter, MrCommentTrackingRow, PRStatus, StageRow } from 'kanban-cli';
import type { FrontmatterData } from './locking.js';
import type { ExitGateRunner } from './exit-gates.js';
import type { WorkerInfo } from './types.js';

export type { MrCommentTrackingRow };

/**
 * Result of polling a single stage's PR status.
 */
export interface MRPollResult {
  stageId: string;
  prUrl: string;
  action: 'new_comments' | 'merged' | 'no_change' | 'error' | 'first_poll';
  newUnresolvedCount?: number;
  previousUnresolvedCount?: number;
}

/**
 * Injectable dependencies for the MR Comment Poller.
 * All I/O is injectable for testing.
 */
export interface MRCommentPollerDeps {
  /** Query stages in PR Created state that are eligible for polling */
  queryStagesInPRCreated: (repoPath: string, limit: number) => Promise<StageRow[]>;
  /** Get comment tracking data for a stage */
  getCommentTracking: (stageId: string) => MrCommentTrackingRow | null;
  /** Upsert comment tracking data for a stage */
  upsertCommentTracking: (data: { stageId: string; timestamp: string; count: number; repoId: number }) => void;
  /** Code host adapter (nullable -- some repos may not have GitHub/GitLab) */
  codeHost: CodeHostAdapter | null;
  /** Exit gate runner for propagating status transitions */
  exitGateRunner: ExitGateRunner;
  /** Read frontmatter from a stage file */
  readFrontmatter: (filePath: string) => Promise<FrontmatterData>;
  /** Write frontmatter to a stage file */
  writeFrontmatter: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>;
  /** Logger */
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
  /** Current time function (injectable for testing) */
  now: () => number;
  /** Maximum stages to check per poll cycle */
  maxStagesPerCycle: number;
}

/**
 * MR Comment Poller interface.
 */
export interface MRCommentPoller {
  poll(repoPath: string): Promise<MRPollResult[]>;
}

/** Extract a human-readable message from an unknown thrown value. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Build a WorkerInfo for cron-driven transitions (no worktree). */
function buildWorkerInfo(stage: StageRow, statusBefore: string, now: () => number): WorkerInfo {
  return {
    stageId: stage.id,
    stageFilePath: stage.file_path,
    worktreePath: '',
    worktreeIndex: -1,
    statusBefore,
    startTime: now(),
  };
}

const defaultDeps: Pick<MRCommentPollerDeps, 'now' | 'maxStagesPerCycle' | 'logger'> = {
  now: () => Date.now(),
  maxStagesPerCycle: 20,
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

/**
 * Create an MR Comment Poller instance.
 *
 * The poller queries SQLite for stages in 'PR Created' state,
 * checks their PR status via the code host adapter, and transitions
 * stages when new comments are detected or when a PR is merged.
 */
export function createMRCommentPoller(
  deps: Partial<MRCommentPollerDeps> & Pick<MRCommentPollerDeps, 'queryStagesInPRCreated' | 'getCommentTracking' | 'upsertCommentTracking' | 'exitGateRunner' | 'readFrontmatter' | 'writeFrontmatter'>,
): MRCommentPoller {
  const merged: MRCommentPollerDeps = { ...defaultDeps, codeHost: null, ...deps };
  const {
    queryStagesInPRCreated,
    getCommentTracking,
    upsertCommentTracking,
    codeHost,
    exitGateRunner,
    readFrontmatter,
    writeFrontmatter,
    logger,
    now,
    maxStagesPerCycle,
  } = merged;

  return {
    async poll(repoPath: string): Promise<MRPollResult[]> {
      const results: MRPollResult[] = [];

      // Handle null code host adapter gracefully
      if (codeHost === null) {
        logger.warn('No code host adapter available, skipping MR comment poll');
        return results;
      }

      // Query stages eligible for polling
      let stages: StageRow[];
      try {
        stages = await queryStagesInPRCreated(repoPath, maxStagesPerCycle);
      } catch (err) {
        const msg = errMsg(err);
        logger.error('Failed to query stages in PR Created', { repoPath, error: msg });
        return results;
      }

      for (const stage of stages) {
        const stageId = stage.id;

        if (!stage.pr_url) {
          logger.warn('Stage in PR Created missing pr_url', { stageId });
          continue;
        }
        const prUrl = stage.pr_url;

        // Fetch PR status from code host
        let prStatus: PRStatus;
        try {
          prStatus = codeHost.getPRStatus(prUrl);
        } catch (err) {
          const msg = errMsg(err);
          logger.error('Failed to fetch PR status', { stageId, prUrl, error: msg });
          results.push({ stageId, prUrl, action: 'error' });
          continue;
        }

        // Check for merge
        if (prStatus.merged) {
          logger.info('PR merged detected', { stageId, prUrl });

          // Update frontmatter status
          try {
            const fm = await readFrontmatter(stage.file_path);
            fm.data.status = 'Done';
            await writeFrontmatter(stage.file_path, fm.data, fm.content);
          } catch (err) {
            const msg = errMsg(err);
            logger.error('Failed to update stage frontmatter for merge', { stageId, error: msg });
            results.push({ stageId, prUrl, action: 'error' });
            continue;
          }

          // Build WorkerInfo for cron-driven transition (no worktree)
          const workerInfo = buildWorkerInfo(stage, 'PR Created', now);

          try {
            await exitGateRunner.run(workerInfo, repoPath, 'Done');
          } catch (err) {
            const msg = errMsg(err);
            logger.error('Exit gate failed for merge transition', { stageId, error: msg });
          }

          // Update tracking
          try {
            upsertCommentTracking({
              stageId,
              timestamp: new Date(now()).toISOString(),
              count: prStatus.unresolvedThreadCount,
              repoId: stage.repo_id,
            });
          } catch (err) {
            const msg = errMsg(err);
            logger.error('Failed to update comment tracking after merge', { stageId, error: msg });
          }

          results.push({ stageId, prUrl, action: 'merged' });
          continue;
        }

        // Not merged -- check comment changes
        const tracking = getCommentTracking(stageId);
        const currentCount = prStatus.unresolvedThreadCount;

        if (tracking === null) {
          // First poll for this stage: record baseline, do NOT trigger transition
          logger.info('First poll for stage, recording baseline', {
            stageId,
            prUrl,
            unresolvedThreadCount: currentCount,
          });

          try {
            upsertCommentTracking({
              stageId,
              timestamp: new Date(now()).toISOString(),
              count: currentCount,
              repoId: stage.repo_id,
            });
          } catch (err) {
            const msg = errMsg(err);
            logger.error('Failed to create comment tracking', { stageId, error: msg });
          }

          results.push({
            stageId,
            prUrl,
            action: 'first_poll',
            newUnresolvedCount: currentCount,
          });
          continue;
        }

        const previousCount = tracking.last_known_unresolved_count;

        if (currentCount > previousCount) {
          // Unresolved count increased -- new comments detected
          logger.info('New unresolved comments detected', {
            stageId,
            prUrl,
            previousCount,
            currentCount,
          });

          // Update frontmatter status
          try {
            const fm = await readFrontmatter(stage.file_path);
            fm.data.status = 'Addressing Comments';
            await writeFrontmatter(stage.file_path, fm.data, fm.content);
          } catch (err) {
            const msg = errMsg(err);
            logger.error('Failed to update stage frontmatter for comments', { stageId, error: msg });
            results.push({ stageId, prUrl, action: 'error' });
            continue;
          }

          // Build WorkerInfo for cron-driven transition
          const workerInfo = buildWorkerInfo(stage, 'PR Created', now);

          try {
            await exitGateRunner.run(workerInfo, repoPath, 'Addressing Comments');
          } catch (err) {
            const msg = errMsg(err);
            logger.error('Exit gate failed for comment transition', { stageId, error: msg });
          }

          // Update tracking with new count
          try {
            upsertCommentTracking({
              stageId,
              timestamp: new Date(now()).toISOString(),
              count: currentCount,
              repoId: stage.repo_id,
            });
          } catch (err) {
            const msg = errMsg(err);
            logger.error('Failed to update comment tracking after comment transition', { stageId, error: msg });
          }

          results.push({
            stageId,
            prUrl,
            action: 'new_comments',
            newUnresolvedCount: currentCount,
            previousUnresolvedCount: previousCount,
          });
          continue;
        }

        // Count same or decreased -- no transition, just update tracking
        try {
          upsertCommentTracking({
            stageId,
            timestamp: new Date(now()).toISOString(),
            count: currentCount,
            repoId: stage.repo_id,
          });
        } catch (err) {
          const msg = errMsg(err);
          logger.error('Failed to update comment tracking', { stageId, error: msg });
        }

        results.push({
          stageId,
          prUrl,
          action: 'no_change',
          newUnresolvedCount: currentCount,
          previousUnresolvedCount: previousCount,
        });
      }

      return results;
    },
  };
}
