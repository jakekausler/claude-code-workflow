import { Command } from 'commander';
import * as path from 'node:path';
import { enrichTicket } from '../logic/enrich-ticket.js';
import type { EnrichResult } from '../logic/enrich-ticket.js';
import { createJiraExecutor } from '../../jira/executor.js';
import { loadConfig } from '../../config/loader.js';
import { writeOutput } from '../utils/output.js';

export const enrichCommand = new Command('enrich')
  .description('Fetch linked content for a Jira-sourced ticket')
  .argument('<ticket-path>', 'Path to ticket markdown file')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--pretty', 'Human-readable output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (ticketPath: string, options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const resolvedTicketPath = path.resolve(ticketPath);

      // Load config for Jira executor
      const config = loadConfig({ repoPath });
      const executor = config.jira ? createJiraExecutor(config.jira, repoPath) : undefined;

      const result: EnrichResult = await enrichTicket({
        ticketPath: resolvedTicketPath,
        executor,
      });

      let output: string;
      if (options.pretty) {
        const lines: string[] = [
          `Enriched ${result.ticketId}`,
        ];

        if (result.enrichmentFilePath) {
          lines.push(`  Output: ${result.enrichmentFilePath}`);
        } else {
          lines.push('  No enrichment needed (no links or Jira key)');
        }
        lines.push(`  Fresh Jira data: ${result.freshJiraData ? 'yes' : 'no'}`);

        if (result.linkResults.length > 0) {
          lines.push(`  Links processed: ${result.linkResults.length}`);
          for (const lr of result.linkResults) {
            const status = lr.success ? 'ok' : `FAILED: ${lr.error}`;
            lines.push(`    - ${lr.link.title}: ${status}`);
          }
        }

        output = lines.join('\n') + '\n';
      } else {
        output = JSON.stringify(result) + '\n';
      }

      writeOutput(output, options.output);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
