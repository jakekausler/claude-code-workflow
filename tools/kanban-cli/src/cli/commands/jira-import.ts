import { Command } from 'commander';
import * as path from 'node:path';
import { jiraImport } from '../logic/jira-import.js';
import type { JiraImportResult } from '../logic/jira-import.js';
import { writeOutput } from '../utils/output.js';

export const jiraImportCommand = new Command('jira-import')
  .description('Import a Jira issue as a local epic or ticket')
  .argument('<key>', 'Jira issue key (e.g. PROJ-1234)')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--epic <id>', 'Parent epic ID override')
  .option('--pretty', 'Human-readable output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (key: string, options) => {
    try {
      const repoPath = path.resolve(options.repo);

      const result: JiraImportResult = await jiraImport({
        key,
        repoPath,
        epicOverride: options.epic,
      });

      let output: string;
      if (options.pretty) {
        const lines: string[] = [
          `Imported ${result.jira_key} as ${result.id}`,
        ];

        if (result.parent_epic) {
          lines.push(`  Epic: ${result.parent_epic}`);
        }
        lines.push(`  Title: ${result.title}`);
        lines.push(`  Column: ${result.column}`);
        lines.push(`  File: ${result.file_path}`);

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
