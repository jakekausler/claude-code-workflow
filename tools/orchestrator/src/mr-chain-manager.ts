import type { CodeHostAdapter, PRStatus } from 'kanban-cli';
import type { Locker, FrontmatterData } from './locking.js';
import type { SessionExecutor, SpawnOptions, SessionLoggerLike } from './session.js';

/**
 * A row from the parent_branch_tracking table.
 */
export interface ParentBranchTrackingRow {
  id: number;
  child_stage_id: string;
  parent_stage_id: string;
  parent_branch: string;
  parent_pr_url: string | null;
  last_known_head: string | null;
  is_merged: boolean | number; // SQLite stores as 0/1
  repo_id: number;
  last_checked: string;
}

/**
 * Result of checking a single parent in the chain.
 */
export interface ChainCheckResult {
  childStageId: string;
  parentStageId: string;
  event: 'parent_merged' | 'parent_updated' | 'no_change' | 'skipped_conflict' | 'skipped_locked' | 'skipped_no_file';
  rebaseSpawned: boolean;
  retargeted: boolean;
  promotedToReady: boolean;
}

/**
 * Injectable dependencies for the MR chain manager.
 * `getActiveTrackingRows` and `updateTrackingRow` are required — callers must
 * provide real or mock implementations.  `logger` and `codeHost` have defaults.
 */
export interface MRChainManagerDeps {
  /**
   * Query all parent_branch_tracking rows that have not yet merged.
   * Filters to rows whose child stage is in 'PR Created' or 'Addressing Comments'.
   */
  getActiveTrackingRows: (repoPath: string) => Promise<ParentBranchTrackingRow[]>;

  /**
   * Update a parent_branch_tracking row by id.
   * Only updates the fields present in `updates`.
   */
  updateTrackingRow: (
    id: number,
    updates: Partial<Pick<ParentBranchTrackingRow, 'is_merged' | 'last_known_head' | 'last_checked'>>,
  ) => Promise<void>;

  /** Code host adapter (nullable — when null, all checks are skipped). */
  codeHost: CodeHostAdapter | null;

  /** Logger. */
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };

  /** Locker for session_active locking (nullable — when null, rebase spawning is skipped). */
  locker: Locker | null;

  /** Session executor for spawning rebase sessions (nullable — when null, rebase spawning is skipped). */
  sessionExecutor: SessionExecutor | null;

  /** Read frontmatter from a stage file (for checking rebase_conflict). */
  readFrontmatter: ((filePath: string) => Promise<FrontmatterData>) | null;

  /**
   * Resolve a child stage ID to its absolute file path.
   * Returns null if the stage file cannot be resolved (e.g., stage not found).
   */
  resolveStageFilePath: ((childStageId: string, repoPath: string) => Promise<string | null>) | null;

  /** Create a session logger for rebase session output. */
  createSessionLogger: ((stageId: string) => SessionLoggerLike) | null;

  /** Model name for spawning Claude sessions. */
  model: string;

  /** Workflow environment variables for spawned sessions. */
  workflowEnv: Record<string, string>;

  /**
   * Query ALL parent_branch_tracking rows for a given child stage (both merged and unmerged).
   * Used to determine how many unmerged parents remain after one merges.
   * When null, retargeting/promotion is skipped.
   */
  getTrackingRowsForChild: ((childStageId: string, repoPath: string) => Promise<ParentBranchTrackingRow[]>) | null;

  /**
   * Write frontmatter data + content back to a stage file.
   * Used to update `is_draft` and `pending_merge_parents` on promotion.
   * When null, frontmatter promotion updates are skipped.
   */
  writeFrontmatter: ((filePath: string, data: Record<string, unknown>, content: string) => Promise<void>) | null;

  /** Default branch name for retargeting when all parents have merged. Defaults to 'main'. */
  defaultBranch: string;

  /** Clock function for generating timestamps. Defaults to `() => Date.now()`. */
  now: () => number;
}

/**
 * MR chain manager interface.
 * Detects parent branch merges and HEAD changes for MR chains.
 */
export interface MRChainManager {
  checkParentChains(repoPath: string): Promise<ChainCheckResult[]>;
}

const defaultDeps: Pick<MRChainManagerDeps, 'logger' | 'locker' | 'sessionExecutor' | 'readFrontmatter' | 'resolveStageFilePath' | 'createSessionLogger' | 'model' | 'workflowEnv' | 'getTrackingRowsForChild' | 'writeFrontmatter' | 'defaultBranch' | 'now'> = {
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  locker: null,
  sessionExecutor: null,
  readFrontmatter: null,
  resolveStageFilePath: null,
  createSessionLogger: null,
  model: 'sonnet',
  workflowEnv: {},
  getTrackingRowsForChild: null,
  writeFrontmatter: null,
  defaultBranch: 'main',
  now: () => Date.now(),
};

/**
 * Create an MRChainManager instance.
 *
 * Queries the parent_branch_tracking table for unmerged rows whose child stage
 * is in a reviewable state (PR Created / Addressing Comments), then checks each
 * parent's merge status and HEAD via the code host adapter.
 *
 * When a parent merge or HEAD update is detected, the manager will attempt to
 * spawn a `rebase-child-mr` session — provided the child stage is not locked
 * and has no `rebase_conflict` flag in frontmatter.
 */
export function createMRChainManager(
  deps: Partial<MRChainManagerDeps> & Pick<MRChainManagerDeps, 'getActiveTrackingRows' | 'updateTrackingRow'>,
): MRChainManager {
  const {
    getActiveTrackingRows,
    updateTrackingRow,
    codeHost = null,
    logger,
    locker,
    sessionExecutor,
    readFrontmatter,
    resolveStageFilePath,
    createSessionLogger,
    model,
    workflowEnv,
    getTrackingRowsForChild,
    writeFrontmatter,
    defaultBranch,
    now,
  } = { ...defaultDeps, ...deps };

  return {
    async checkParentChains(repoPath: string): Promise<ChainCheckResult[]> {
      if (codeHost === null) {
        logger.warn('No code host adapter configured, skipping parent chain checks');
        return [];
      }

      const rows = await getActiveTrackingRows(repoPath);
      if (rows.length === 0) {
        logger.info('No active parent tracking rows found', { repoPath });
        return [];
      }

      const results: ChainCheckResult[] = [];

      for (const row of rows) {
        try {
          const result = await checkSingleParent(row, codeHost, repoPath);
          results.push(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to check parent chain entry', {
            id: row.id,
            childStageId: row.child_stage_id,
            parentStageId: row.parent_stage_id,
            error: msg,
          });
        }
      }

      return results;
    },
  };

  /**
   * Whether all spawn dependencies are configured.
   */
  function canSpawn(): boolean {
    return !!(locker && sessionExecutor && readFrontmatter && resolveStageFilePath && createSessionLogger);
  }

  /**
   * Check whether rebase spawning prerequisites are met.
   * Only call when canSpawn() is true.
   * Returns the blocking reason if a precondition blocks spawning, or the resolved stageFilePath if clear to proceed.
   */
  async function checkRebasePreconditions(
    childStageId: string,
    repoPath: string,
  ): Promise<{ blocked: true; event: 'skipped_conflict' | 'skipped_locked' | 'skipped_no_file' } | { blocked: false; stageFilePath: string }> {
    const stageFilePath = await resolveStageFilePath!(childStageId, repoPath);
    if (!stageFilePath) {
      logger.warn('Cannot resolve stage file path for rebase spawn', { childStageId });
      return { blocked: true, event: 'skipped_no_file' };
    }

    // Check rebase_conflict in frontmatter
    const fm = await readFrontmatter!(stageFilePath);
    if (fm.data.rebase_conflict === true) {
      logger.info('Skipping rebase spawn: rebase_conflict flagged', { childStageId, stageFilePath });
      return { blocked: true, event: 'skipped_conflict' };
    }

    // Check session_active lock
    const locked = await locker!.isLocked(stageFilePath);
    if (locked) {
      logger.info('Skipping rebase spawn: stage already locked', { childStageId, stageFilePath });
      return { blocked: true, event: 'skipped_locked' };
    }

    return { blocked: false, stageFilePath };
  }

  /**
   * Attempt to spawn a rebase-child-mr session for the given child stage.
   * Acquires lock before spawning; releases lock on failure.
   * On success the lock is released by the normal session exit flow (not here).
   */
  async function spawnRebaseSession(childStageId: string, stageFilePath: string, repoPath: string): Promise<boolean> {
    // These are guaranteed non-null by checkRebasePreconditions succeeding
    const lck = locker!;
    const executor = sessionExecutor!;
    const makeLogger = createSessionLogger!;

    try {
      await lck.acquireLock(stageFilePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to acquire lock for rebase spawn', { childStageId, stageFilePath, error: msg });
      return false;
    }

    try {
      const sessionLogger = makeLogger(childStageId);
      const spawnOpts: SpawnOptions = {
        stageId: childStageId,
        stageFilePath,
        skillName: 'rebase-child-mr',
        worktreePath: repoPath, // TODO: Rebase sessions need worktree allocation. Currently passing repo root as placeholder — resolve when rebase-child-mr skill is fully implemented.
        worktreeIndex: -1, // -1 = no worktree slot assigned (convention shared with resolvers.ts and mr-comment-poller.ts)
        model,
        workflowEnv,
      };

      logger.info('Spawning rebase-child-mr session', { childStageId, stageFilePath });

      // Fire-and-forget: the session runs in the background.
      // We only need to catch immediate spawn errors (e.g., process failed to start).
      // The lock is released by the session's normal exit flow.
      executor.spawn(spawnOpts, sessionLogger).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Rebase session failed', { childStageId, stageFilePath, error: msg });
        // Release lock on session failure
        lck.releaseLock(stageFilePath).catch((releaseErr: unknown) => {
          const releaseMsg = releaseErr instanceof Error ? releaseErr.message : String(releaseErr);
          logger.error('Failed to release lock after rebase session failure', { childStageId, stageFilePath, error: releaseMsg });
        });
      });

      return true;
    } catch (err) {
      // Synchronous error during spawn setup — release lock
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to spawn rebase session', { childStageId, stageFilePath, error: msg });
      await lck.releaseLock(stageFilePath);
      return false;
    }
  }

  /**
   * Attempt to spawn a rebase session after a parent event.
   * Returns `{ event, rebaseSpawned }` — the caller fills in childStageId/parentStageId.
   *
   * If spawn deps are not configured, returns the original event with rebaseSpawned: false.
   * If preconditions block spawning, returns skipped_conflict or skipped_locked.
   * Otherwise, spawns the session and returns the original event with rebaseSpawned reflecting success.
   */
  async function attemptRebaseSpawn(
    childStageId: string,
    repoPath: string,
    originalEvent: 'parent_merged' | 'parent_updated',
  ): Promise<{ event: ChainCheckResult['event']; rebaseSpawned: boolean }> {
    // If spawn deps are not configured, preserve the original event
    if (!canSpawn()) {
      return { event: originalEvent, rebaseSpawned: false };
    }

    const precondition = await checkRebasePreconditions(childStageId, repoPath);
    if (precondition.blocked) {
      return { event: precondition.event, rebaseSpawned: false };
    }

    const spawned = await spawnRebaseSession(childStageId, precondition.stageFilePath, repoPath);
    return { event: originalEvent, rebaseSpawned: spawned };
  }

  /**
   * Whether retargeting/promotion dependencies are configured.
   */
  function canRetarget(): boolean {
    return !!(codeHost && getTrackingRowsForChild);
  }

  /**
   * Evaluate the retargeting matrix and optionally promote a draft MR to ready.
   *
   * Called after a parent_merged event. Queries all tracking rows for the child
   * to count unmerged parents (NOTE: the just-merged row has already been updated
   * to is_merged=1 at this point).
   *
   * Retargeting matrix:
   *   - Multi-parent, >1 remain unmerged → no retarget, stay draft
   *   - Multi-parent, exactly 1 remains unmerged → retarget to remaining parent branch
   *   - Single-parent merged (0 unmerged) → retarget to defaultBranch + promote
   *   - All parents merged (0 unmerged) → retarget to defaultBranch + promote
   */
  // Note: CodeHostAdapter methods (editPRBase, markPRReady) are synchronous
  // (execFileSync). If made async, these calls and their try/catch blocks
  // will need await.
  async function evaluateRetargeting(
    childStageId: string,
    childPrNumber: number | null,
    repoPath: string,
    stageFilePath: string | null,
  ): Promise<{ retargeted: boolean; promotedToReady: boolean }> {
    if (!canRetarget() || childPrNumber === null) {
      return { retargeted: false, promotedToReady: false };
    }

    const host = codeHost!;
    const allRows = await getTrackingRowsForChild!(childStageId, repoPath);
    // is_merged can be boolean true or number 1 (SQLite stores booleans as 0/1)
    const unmergedRows = allRows.filter(r => !r.is_merged);

    const totalParents = allRows.length;
    const unmergedCount = unmergedRows.length;

    logger.info('Evaluating retargeting matrix', {
      childStageId,
      totalParents,
      unmergedCount,
    });

    if (unmergedCount > 1) {
      // Multi-parent, >1 remain → no retarget, stay draft
      logger.info('Multiple unmerged parents remain, no retarget', { childStageId, unmergedCount });
      return { retargeted: false, promotedToReady: false };
    }

    if (unmergedCount === 1) {
      // Multi-parent, exactly 1 remains → retarget to remaining parent branch
      const remainingParent = unmergedRows[0];
      logger.info('Retargeting to remaining parent branch', {
        childStageId,
        newBase: remainingParent.parent_branch,
      });
      try {
        host.editPRBase(childPrNumber, remainingParent.parent_branch);
        return { retargeted: true, promotedToReady: false };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to retarget PR', { childStageId, prNumber: childPrNumber, error: msg });
        return { retargeted: false, promotedToReady: false };
      }
    }

    // unmergedCount === 0 → all parents merged → retarget to defaultBranch + promote
    logger.info('All parents merged, retargeting to default branch and promoting', {
      childStageId,
      defaultBranch,
    });

    let retargeted = false;
    let promotedToReady = false;

    try {
      host.editPRBase(childPrNumber, defaultBranch);
      retargeted = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to retarget PR to default branch', { childStageId, prNumber: childPrNumber, error: msg });
      // Don't promote if retargeting failed
      return { retargeted: false, promotedToReady: false };
    }

    try {
      host.markPRReady(childPrNumber);
      promotedToReady = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to promote PR to ready', { childStageId, prNumber: childPrNumber, error: msg });
    }

    // Update frontmatter if we promoted and have the necessary deps
    if (promotedToReady && stageFilePath && readFrontmatter && writeFrontmatter) {
      try {
        const fm = await readFrontmatter(stageFilePath);
        fm.data.is_draft = false;
        fm.data.pending_merge_parents = [];
        await writeFrontmatter(stageFilePath, fm.data, fm.content);
        logger.info('Updated frontmatter after promotion', { childStageId, stageFilePath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to update frontmatter after promotion', { childStageId, stageFilePath, error: msg });
      }
    }

    return { retargeted, promotedToReady };
  }

  /**
   * Resolve the child stage's PR number from frontmatter.
   * Returns null if the file can't be resolved or frontmatter doesn't contain pr_number.
   */
  async function resolveChildPrNumber(childStageId: string, repoPath: string): Promise<{ prNumber: number | null; stageFilePath: string | null }> {
    if (!resolveStageFilePath || !readFrontmatter) {
      return { prNumber: null, stageFilePath: null };
    }

    const filePath = await resolveStageFilePath(childStageId, repoPath);
    if (!filePath) {
      return { prNumber: null, stageFilePath: null };
    }

    try {
      const fm = await readFrontmatter(filePath);
      const prNumber = typeof fm.data.pr_number === 'number' ? fm.data.pr_number : null;
      return { prNumber, stageFilePath: filePath };
    } catch {
      return { prNumber: null, stageFilePath: filePath };
    }
  }

  async function checkSingleParent(row: ParentBranchTrackingRow, host: CodeHostAdapter, repoPath: string): Promise<ChainCheckResult> {
    const timestamp = new Date(now()).toISOString();

    // Check if parent PR is merged
    if (row.parent_pr_url) {
      let prStatus: PRStatus;
      try {
        prStatus = host.getPRStatus(row.parent_pr_url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Failed to get PR status for parent', {
          parentStageId: row.parent_stage_id,
          prUrl: row.parent_pr_url,
          error: msg,
        });
        // Cannot determine status, treat as no change
        return {
          childStageId: row.child_stage_id,
          parentStageId: row.parent_stage_id,
          event: 'no_change',
          rebaseSpawned: false,
          retargeted: false,
          promotedToReady: false,
        };
      }

      if (prStatus.merged) {
        logger.info('Parent PR merged', {
          childStageId: row.child_stage_id,
          parentStageId: row.parent_stage_id,
          prUrl: row.parent_pr_url,
        });
        await updateTrackingRow(row.id, {
          is_merged: 1,
          last_checked: timestamp,
        });

        // Attempt to spawn rebase session (only if spawn deps are configured)
        const { event, rebaseSpawned } = await attemptRebaseSpawn(row.child_stage_id, repoPath, 'parent_merged');

        // Evaluate retargeting matrix after parent merge
        let retargeted = false;
        let promotedToReady = false;
        if (canRetarget()) {
          const { prNumber: childPrNumber, stageFilePath: childFilePath } = await resolveChildPrNumber(row.child_stage_id, repoPath);
          ({ retargeted, promotedToReady } = await evaluateRetargeting(row.child_stage_id, childPrNumber, repoPath, childFilePath));
        }

        return {
          childStageId: row.child_stage_id,
          parentStageId: row.parent_stage_id,
          event,
          rebaseSpawned,
          retargeted,
          promotedToReady,
        };
      }
    }

    // Check if parent branch HEAD has changed
    let currentHead: string;
    try {
      currentHead = host.getBranchHead(row.parent_branch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to get branch HEAD for parent', {
        parentStageId: row.parent_stage_id,
        branch: row.parent_branch,
        error: msg,
      });
      return {
        childStageId: row.child_stage_id,
        parentStageId: row.parent_stage_id,
        event: 'no_change',
        rebaseSpawned: false,
        retargeted: false,
        promotedToReady: false,
      };
    }

    if (currentHead !== '' && row.last_known_head !== null && currentHead !== row.last_known_head) {
      logger.info('Parent branch HEAD changed', {
        childStageId: row.child_stage_id,
        parentStageId: row.parent_stage_id,
        branch: row.parent_branch,
        previousHead: row.last_known_head,
        currentHead,
      });
      await updateTrackingRow(row.id, {
        last_known_head: currentHead,
        last_checked: timestamp,
      });

      // Attempt to spawn rebase session (only if spawn deps are configured)
      const { event, rebaseSpawned } = await attemptRebaseSpawn(row.child_stage_id, repoPath, 'parent_updated');
      return {
        childStageId: row.child_stage_id,
        parentStageId: row.parent_stage_id,
        event,
        rebaseSpawned,
        retargeted: false,
        promotedToReady: false,
      };
    }

    // If we got a head but didn't have one before, record it (first-time seed)
    if (currentHead !== '' && row.last_known_head === null) {
      await updateTrackingRow(row.id, {
        last_known_head: currentHead,
        last_checked: timestamp,
      });
    }

    // last_checked is intentionally NOT updated in the no-change path.
    // It represents "last time an actionable event was detected" (merge or HEAD change),
    // not "last time we polled".  This lets callers distinguish stale rows from
    // rows that are actively being monitored but have no new activity.
    return {
      childStageId: row.child_stage_id,
      parentStageId: row.parent_stage_id,
      event: 'no_change',
      rebaseSpawned: false,
      retargeted: false,
      promotedToReady: false,
    };
  }
}
