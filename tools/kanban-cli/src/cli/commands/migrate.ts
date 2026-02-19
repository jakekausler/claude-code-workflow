import { Command } from 'commander';
import * as path from 'node:path';
import { runMigration } from '../logic/migrate.js';
import { writeOutput } from '../utils/output.js';

export const migrateCommand = new Command('migrate')
  .description('Migrate old-format repos to new format (non-interactive)')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--dry-run', 'Show what would happen without making changes', false)
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);

      const result = runMigration({
        repoPath,
        dryRun: options.dryRun,
      });

      const indent = options.pretty ? 2 : undefined;
      const output = JSON.stringify(result, null, indent) + '\n';
      writeOutput(output, options.output);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
