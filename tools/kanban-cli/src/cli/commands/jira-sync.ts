import { Command } from 'commander';
import * as path from 'node:path';
import { jiraSync } from '../logic/jira-sync.js';
import type { JiraSyncResult } from '../logic/jira-sync.js';
import { writeOutput } from '../utils/output.js';

export const jiraSyncCommand = new Command('jira-sync')
  .description('Compute expected Jira state from workflow state and sync status/assignee')
  .argument('<ticket-id>', 'Ticket ID (e.g. TICKET-001-001)')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--dry-run', 'Show what would change without executing', false)
  .option('--pretty', 'Human-readable output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (ticketId: string, options) => {
    try {
      const repoPath = path.resolve(options.repo);

      const result: JiraSyncResult = await jiraSync({
        ticketId,
        repoPath,
        dryRun: options.dryRun,
      });

      let output: string;
      if (options.pretty) {
        output = formatPretty(result);
      } else {
        output = JSON.stringify(result) + '\n';
      }

      writeOutput(output, options.output);

      // Exit with code 2 when confirmation is needed
      if (result.confirmation_needed) {
        process.exit(2);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(1);
    }
  });

function formatPretty(result: JiraSyncResult): string {
  const lines: string[] = [];

  const header = result.dry_run
    ? `Jira Sync (dry run): ${result.ticket_id} → ${result.jira_key}`
    : `Jira Sync: ${result.ticket_id} → ${result.jira_key}`;
  lines.push(header);

  if (result.event) {
    lines.push(`  Event: ${result.event}`);
  } else {
    lines.push('  Event: none (no transition needed)');
  }

  if (result.actions.length === 0) {
    lines.push('  No actions needed.');
  } else if (result.dry_run) {
    lines.push('  Planned actions:');
    for (const action of result.actions) {
      if (action.error) {
        lines.push(`    ⚠ ${action.description}`);
      } else {
        lines.push(`    → ${action.description}`);
      }
    }
  } else if (result.confirmation_needed) {
    lines.push('  Actions pending confirmation:');
    for (const action of result.actions) {
      if (action.error) {
        lines.push(`    ⚠ ${action.description}`);
      } else {
        lines.push(`    ? ${action.description}`);
      }
    }
  } else {
    lines.push('  Actions:');
    for (const action of result.actions) {
      if (action.error) {
        lines.push(`    ✗ ${action.description} — ${action.error}`);
      } else if (action.executed) {
        lines.push(`    ✓ ${action.description}`);
      } else {
        lines.push(`    ○ ${action.description} (skipped)`);
      }
    }
  }

  return lines.join('\n') + '\n';
}
