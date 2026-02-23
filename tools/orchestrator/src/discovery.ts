import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Function signature for executing a command and returning stdout.
 */
export type ExecFn = (command: string, args: string[]) => Promise<string>;

/**
 * A stage that is ready for work.
 */
export interface ReadyStage {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  worktreeBranch: string;
  priorityScore: number;
  priorityReason: string;
  needsHuman: boolean;
}

/**
 * Result of discovering workable stages.
 */
export interface DiscoveryResult {
  readyStages: ReadyStage[];
  blockedCount: number;
  inProgressCount: number;
  toConvertCount: number;
}

/**
 * Discovery service interface.
 */
export interface Discovery {
  discover(repoPath: string, max: number): Promise<DiscoveryResult>;
}

/**
 * Dependencies for creating a Discovery instance.
 */
export interface DiscoveryDeps {
  execFn: ExecFn;
  cliPath: string;
}

/**
 * Raw JSON shape returned by `kanban-cli next` (snake_case).
 */
interface RawNextOutput {
  ready_stages: Array<{
    id: string;
    ticket: string;
    epic: string;
    title: string;
    worktree_branch: string;
    refinement_type: string[];
    priority_score: number;
    priority_reason: string;
    needs_human: boolean;
  }>;
  blocked_count: number;
  in_progress_count: number;
  to_convert_count: number;
}

function defaultExec(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf-8', timeout: 30000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Resolve the path to the kanban-cli CLI entry point.
 * Uses createRequire to find the kanban-cli package, then navigates to src/cli/index.ts.
 */
function resolveCliPath(): string {
  const require = createRequire(import.meta.url);
  const kanbanPkgPath = require.resolve('kanban-cli/package.json');
  const kanbanRoot = path.dirname(kanbanPkgPath);
  return path.join(kanbanRoot, 'src', 'cli', 'index.ts');
}

/**
 * Map a raw snake_case stage from kanban-cli to a camelCase ReadyStage.
 * Note: refinement_type is intentionally omitted — the orchestrator does not
 * use it; stage routing is based on priority and needs_human only.
 */
function mapStage(raw: RawNextOutput['ready_stages'][number]): ReadyStage {
  return {
    id: raw.id,
    ticket: raw.ticket,
    epic: raw.epic,
    title: raw.title,
    worktreeBranch: raw.worktree_branch,
    priorityScore: raw.priority_score,
    priorityReason: raw.priority_reason,
    needsHuman: raw.needs_human,
  };
}

/**
 * Create a Discovery instance that calls `kanban-cli next` as a subprocess
 * and parses its JSON output.
 */
export function createDiscovery(deps: Partial<DiscoveryDeps> = {}): Discovery {
  const exec = deps.execFn ?? defaultExec;
  const cliPath = deps.cliPath ?? resolveCliPath();

  return {
    async discover(repoPath: string, max: number): Promise<DiscoveryResult> {
      // Request extra stages to compensate for needsHuman filtering.
      // The orchestrator's loop maxParallel guard handles the actual spawn limit.
      const requestMax = Math.max(max * 3, max + 10);
      const args = ['tsx', cliPath, 'next', '--repo', repoPath, '--max', String(requestMax)];

      const stdout = await exec('npx', args);
      const raw = JSON.parse(stdout);
      if (!raw || !Array.isArray(raw.ready_stages)) {
        throw new Error('Unexpected kanban-cli next output format');
      }
      const typed: RawNextOutput = raw;

      const allStages = typed.ready_stages.map(mapStage);
      const readyStages = allStages.filter((stage) => !stage.needsHuman);

      return {
        readyStages,
        blockedCount: typed.blocked_count,
        inProgressCount: typed.in_progress_count,
        toConvertCount: typed.to_convert_count,
      };
    },
  };
}
