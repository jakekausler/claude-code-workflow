import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { KanbanDatabase } from '../../db/database.js';
import { RepoRepository } from '../../db/repositories/repo-repository.js';
import { syncRepo } from '../../sync/sync.js';
import { buildSummary } from '../logic/summary.js';
import { createClaudeExecutor } from '../../utils/claude-executor.js';
import { writeOutput } from '../utils/output.js';
import type { ClaudeExecutor } from '../../utils/claude-executor.js';
import type { ProgressEvent } from '../logic/summary-engine.js';

// ---------- Progress bar renderer ----------

/**
 * Creates a progress callback that renders a progress bar to stderr.
 * Returns the onProgress callback and a finish function to clean up.
 */
export function createProgressRenderer(): {
  onProgress: (event: ProgressEvent) => void;
  finish: () => void;
} {
  let cachedCount = 0;
  let summarizedCount = 0;
  let total = 0;
  let headerPrinted = false;

  function renderProgress(): void {
    const toSummarize = total - cachedCount;
    if (toSummarize === 0) {
      // All cached, print final status and return
      process.stderr.write(`\r\x1b[K${cachedCount} cached, 0 to summarize\n`);
      return;
    }
    const width = 20;
    const filled = Math.round((summarizedCount / toSummarize) * width);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
    const progress = `Summarizing... [${bar}] ${summarizedCount}/${toSummarize}`;
    process.stderr.write(`\r\x1b[K${progress}`);
  }

  function printHeader(): void {
    const toSummarize = total - cachedCount;
    const parts: string[] = [];
    if (cachedCount > 0) parts.push(`${cachedCount} cached`);
    parts.push(`${toSummarize} to summarize`);
    process.stderr.write(`${parts.join(', ')}\n`);
  }

  function onProgress(event: ProgressEvent): void {
    total = event.total;
    if (event.cached) {
      cachedCount++;
    } else {
      // Print header just before the first non-cached item is reported
      if (!headerPrinted) {
        headerPrinted = true;
        printHeader();
      }
      summarizedCount++;
      renderProgress();
    }
  }

  function finish(): void {
    const toSummarize = total - cachedCount;
    if (toSummarize === 0 && total > 0) {
      // Everything was cached — print the summary line
      process.stderr.write(`${cachedCount} cached, 0 to summarize\n`);
    } else if (toSummarize > 0) {
      // Clear the progress line
      process.stderr.write(`\r\x1b[K`);
    }
  }

  return { onProgress, finish };
}

// ---------- Command ----------

/**
 * Options for creating the summary command.
 * Allows injecting a custom executor for testing.
 */
export interface SummaryCommandOptions {
  executorFactory?: () => ClaudeExecutor;
}

export function createSummaryCommand(options: SummaryCommandOptions = {}): Command {
  return new Command('summary')
    .description('Summarize what happened for stages, tickets, or epics using LLM')
    .argument('<ids...>', 'One or more IDs (STAGE-*, TICKET-*, EPIC-*)')
    .option('--repo <path>', 'Path to repository', process.cwd())
    .option('--pretty', 'Pretty-print JSON output', false)
    .option('-o, --output <file>', 'Write output to file instead of stdout')
    .option('--model <model>', 'Claude model to use for summarization')
    .option('--no-cache', 'Bypass summary cache and re-summarize')
    .option('-q, --quiet', 'Suppress progress output', false)
    .action(async (ids: string[], cmdOptions) => {
      try {
        const repoPath = path.resolve(cmdOptions.repo);
        const config = loadConfig({ repoPath });
        const db = new KanbanDatabase();

        // Ensure data is fresh
        syncRepo({ repoPath, db, config });

        // Get the repo ID
        const repoRepo = new RepoRepository(db);
        const repo = repoRepo.findByPath(repoPath);
        if (!repo) {
          process.stderr.write('Error: Repository not found after sync\n');
          process.exit(2);
          return;
        }

        const executor = options.executorFactory
          ? options.executorFactory()
          : createClaudeExecutor();

        // Set up progress rendering for multi-item summaries
        const showProgress = !cmdOptions.quiet && ids.length > 1;
        const progress = showProgress ? createProgressRenderer() : undefined;

        const result = buildSummary({
          db,
          repoId: repo.id,
          repoPath,
          ids,
          executor,
          model: cmdOptions.model,
          noCache: !cmdOptions.cache, // commander inverts --no-cache to cache=false
          onProgress: progress?.onProgress,
        });

        // Clean up progress display
        progress?.finish();

        const indent = cmdOptions.pretty ? 2 : undefined;
        const output = JSON.stringify(result, null, indent) + '\n';
        writeOutput(output, cmdOptions.output);
        db.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(2);
      }
    });
}

export const summaryCommand = createSummaryCommand();
