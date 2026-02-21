import { Command } from 'commander';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { countUnanalyzedLearnings } from '../logic/learnings-count.js';
import { writeOutput } from '../utils/output.js';

const DEFAULT_THRESHOLD = 10;

export const learningsCountCommand = new Command('learnings-count')
  .description('Count unanalyzed learnings for cron integration')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('--threshold <n>', 'Override threshold (default: from pipeline config or 10)', parseInt)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action((options) => {
    try {
      const repoPath = path.resolve(options.repo);

      // Load config to read WORKFLOW_LEARNINGS_THRESHOLD from defaults
      let configThreshold = DEFAULT_THRESHOLD;
      try {
        const config = loadConfig({ repoPath });
        if (config.workflow.defaults?.WORKFLOW_LEARNINGS_THRESHOLD != null) {
          configThreshold = config.workflow.defaults.WORKFLOW_LEARNINGS_THRESHOLD;
        }
      } catch {
        // Config loading failed — use hardcoded default.
      }

      // CLI flag overrides config value
      const threshold =
        options.threshold != null ? options.threshold : configThreshold;

      const result = countUnanalyzedLearnings({ repoPath, threshold });

      const indent = options.pretty ? 2 : undefined;
      const output = JSON.stringify(result, null, indent) + '\n';
      writeOutput(output, options.output);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
