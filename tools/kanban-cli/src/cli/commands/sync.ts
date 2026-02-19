import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { KanbanDatabase } from '../../db/database.js';
import { syncRepo } from '../../sync/sync.js';
import { writeOutput } from '../utils/output.js';

export const syncCommand = new Command('sync')
  .description('Force re-parse of files into SQLite')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--stage <id>', 'Sync a single stage by ID (placeholder for future optimization)')
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const config = loadConfig({ repoPath });
      const db = new KanbanDatabase();

      const startTime = Date.now();

      // Full sync (single-stage sync is an optimization for later)
      const syncResult = syncRepo({ repoPath, db, config });

      const elapsed = Date.now() - startTime;

      const result = {
        success: true,
        repo: repoPath,
        mode: options.stage ? 'stage' : 'full',
        stage_id: options.stage || null,
        elapsed_ms: elapsed,
        epics: syncResult.epics,
        tickets: syncResult.tickets,
        stages: syncResult.stages,
        dependencies: syncResult.dependencies,
        errors: syncResult.errors,
      };

      const indent = options.pretty ? 2 : undefined;
      const output = JSON.stringify(result, null, indent) + '\n';
      writeOutput(output, options.output);
      db.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
