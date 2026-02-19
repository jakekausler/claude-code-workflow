import { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { validatePipeline } from '../../validators/pipeline-validator.js';
import { ResolverRegistry } from '../../resolvers/registry.js';
import { registerBuiltinResolvers } from '../../resolvers/builtins/index.js';
import { writeOutput } from '../utils/output.js';

export const validatePipelineCommand = new Command('validate-pipeline')
  .description('Validate workflow pipeline config (4-layer audit)')
  .option('--repo <path>', 'Path to repo (default: current directory)')
  .option('--global-config <path>', 'Path to global config file')
  .option('--dry-run', 'Execute resolver dry-runs', false)
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (options) => {
    try {
      const config = loadConfig({
        globalConfigPath: options.globalConfig,
        repoPath: options.repo,
      });

      const registry = new ResolverRegistry();
      registerBuiltinResolvers(registry);

      const result = await validatePipeline(config, {
        registry,
        resolverOptions: { dryRun: options.dryRun },
      });

      const indent = options.pretty ? 2 : undefined;
      const output = JSON.stringify(result, null, indent) + '\n';
      writeOutput(output, options.output);
      process.exit(result.valid ? 0 : 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
