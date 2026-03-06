import { Command } from 'commander';
import { createRegistry } from '../../repos/registry.js';
import { writeOutput } from '../utils/output.js';

export const listReposCommand = new Command('list-repos')
  .description('List all registered repositories')
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (options) => {
    try {
      const registry = createRegistry();
      const repos = registry.loadRepos();

      const result = {
        repos: repos.map((r) => ({
          name: r.name,
          path: r.path,
          ...(r.slack_webhook ? { slack_webhook: r.slack_webhook } : {}),
        })),
        count: repos.length,
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
