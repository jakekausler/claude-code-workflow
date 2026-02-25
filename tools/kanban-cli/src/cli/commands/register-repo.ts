import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { KanbanDatabase } from '../../db/database.js';
import { syncRepo } from '../../sync/sync.js';
import { createRegistry } from '../../repos/registry.js';
import { writeOutput } from '../utils/output.js';

export const registerRepoCommand = new Command('register-repo')
  .description('Register a repository for multi-repo tracking')
  .argument('<path>', 'Path to repository')
  .option('--name <name>', 'Display name (defaults to directory basename)')
  .option('--slack-webhook <url>', 'Slack webhook URL for this repo')
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (repoPath: string, options) => {
    try {
      const resolved = path.resolve(repoPath);

      if (!fs.existsSync(resolved)) {
        throw new Error(`Path does not exist: ${resolved}`);
      }

      const name = options.name ?? path.basename(resolved);

      const registry = createRegistry();
      registry.registerRepo({
        path: resolved,
        name,
        ...(options.slackWebhook ? { slack_webhook: options.slackWebhook } : {}),
      });

      // Sync the newly registered repo into the database
      const config = loadConfig({ repoPath: resolved });
      const db = new KanbanDatabase();
      const syncResult = syncRepo({ repoPath: resolved, db, config });
      db.close();

      const result = {
        success: true,
        repo: {
          name,
          path: resolved,
          ...(options.slackWebhook ? { slack_webhook: options.slackWebhook } : {}),
        },
        sync: {
          epics: syncResult.epics,
          tickets: syncResult.tickets,
          stages: syncResult.stages,
          dependencies: syncResult.dependencies,
          errors: syncResult.errors,
        },
      };

      const indent = options.pretty ? 2 : undefined;
      const output = JSON.stringify(result, null, indent) + '\n';
      writeOutput(output, options.output);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
