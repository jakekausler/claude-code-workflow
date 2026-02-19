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

        const result = buildSummary({
          db,
          repoId: repo.id,
          repoPath,
          ids,
          executor,
          model: cmdOptions.model,
          noCache: !cmdOptions.cache, // commander inverts --no-cache to cache=false
        });

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
