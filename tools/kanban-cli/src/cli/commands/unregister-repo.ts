import { Command } from 'commander';
import { createRegistry } from '../../repos/registry.js';
import { writeOutput } from '../utils/output.js';

export const unregisterRepoCommand = new Command('unregister-repo')
  .description('Unregister a repository from multi-repo tracking')
  .argument('<name>', 'Name of the repo to unregister')
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (name: string, options) => {
    try {
      const registry = createRegistry();
      registry.unregisterRepo(name);

      const result = {
        success: true,
        unregistered: name,
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
