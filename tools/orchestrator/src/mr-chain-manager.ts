import type { CodeHostAdapter, PRStatus } from 'kanban-cli';

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
  event: 'parent_merged' | 'parent_updated' | 'no_change';
  // rebaseSpawned, retargeted, promotedToReady will be added in 6D-7/6D-8
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
}

/**
 * MR chain manager interface.
 * Detects parent branch merges and HEAD changes for MR chains.
 */
export interface MRChainManager {
  checkParentChains(repoPath: string): Promise<ChainCheckResult[]>;
}

const defaultDeps: Pick<MRChainManagerDeps, 'logger'> = {
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

/**
 * Create an MRChainManager instance.
 *
 * Queries the parent_branch_tracking table for unmerged rows whose child stage
 * is in a reviewable state (PR Created / Addressing Comments), then checks each
 * parent's merge status and HEAD via the code host adapter.
 *
 * Returns structured results indicating what changed. Rebase spawning (6D-7) and
 * retargeting (6D-8) are NOT handled here — they will extend this module later.
 */
export function createMRChainManager(
  deps: Partial<MRChainManagerDeps> & Pick<MRChainManagerDeps, 'getActiveTrackingRows' | 'updateTrackingRow'>,
): MRChainManager {
  const { getActiveTrackingRows, updateTrackingRow, codeHost = null, logger } = { ...defaultDeps, ...deps };

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
          const result = await checkSingleParent(row, codeHost);
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

  async function checkSingleParent(row: ParentBranchTrackingRow, host: CodeHostAdapter): Promise<ChainCheckResult> {
    const now = new Date().toISOString();

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
          last_checked: now,
        });
        return {
          childStageId: row.child_stage_id,
          parentStageId: row.parent_stage_id,
          event: 'parent_merged',
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
        last_checked: now,
      });
      return {
        childStageId: row.child_stage_id,
        parentStageId: row.parent_stage_id,
        event: 'parent_updated',
      };
    }

    // If we got a head but didn't have one before, record it (first-time seed)
    if (currentHead !== '' && row.last_known_head === null) {
      await updateTrackingRow(row.id, {
        last_known_head: currentHead,
        last_checked: now,
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
    };
  }
}
