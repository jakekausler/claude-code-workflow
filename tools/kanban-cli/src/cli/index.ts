#!/usr/bin/env node
import { Command } from 'commander';
import { validatePipelineCommand } from './commands/validate-pipeline.js';
import { boardCommand } from './commands/board.js';
import { graphCommand } from './commands/graph.js';
import { nextCommand } from './commands/next.js';
import { validateCommand } from './commands/validate.js';
import { syncCommand } from './commands/sync.js';
import { summaryCommand } from './commands/summary.js';
import { migrateCommand } from './commands/migrate.js';
import { jiraImportCommand } from './commands/jira-import.js';
import { jiraSyncCommand } from './commands/jira-sync.js';
import { learningsCountCommand } from './commands/learnings-count.js';
import { enrichCommand } from './commands/enrich.js';

const program = new Command();

program
  .name('kanban-cli')
  .description('Config-driven kanban workflow CLI for Claude Code')
  .version('0.1.0');

program.addCommand(validatePipelineCommand);
program.addCommand(boardCommand);
program.addCommand(graphCommand);
program.addCommand(nextCommand);
program.addCommand(validateCommand);
program.addCommand(syncCommand);
program.addCommand(summaryCommand);
program.addCommand(migrateCommand);
program.addCommand(jiraImportCommand);
program.addCommand(jiraSyncCommand);
program.addCommand(learningsCountCommand);
program.addCommand(enrichCommand);

program.parse();
