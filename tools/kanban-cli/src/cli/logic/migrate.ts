import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectOldFormatEpics } from '../../migration/detector.js';
import { mapIds, buildTicketId } from '../../migration/id-mapper.js';
import {
  generateEpicMarkdown,
  generateTicketMarkdown,
  generateStageMarkdown,
} from '../../migration/frontmatter-generator.js';
import type {
  MigrateInput,
  MigrationResult,
  EpicMigrationResult,
  OldFormatEpic,
} from '../../migration/types.js';

/**
 * Known valid status values (from pipeline config defaults + system statuses).
 * Used for warning when old stages have unrecognized statuses.
 */
const KNOWN_STATUSES = new Set([
  'Not Started',
  'In Progress',
  'Complete',
  'Skipped',
  'Design',
  'Build',
  'Automatic Testing',
  'Manual Testing',
  'Finalize',
  'PR Created',
  'Addressing Comments',
  'User Design Feedback',
]);

/**
 * Check if a status is known. Case-insensitive for common variants.
 */
function isKnownStatus(status: string): boolean {
  if (KNOWN_STATUSES.has(status)) return true;
  // Check lowercase normalization
  const lower = status.toLowerCase();
  const commonVariants = ['done', 'completed', 'in-progress', 'not-started', 'todo', 'to do', 'blocked', 'skipped'];
  return commonVariants.includes(lower);
}

/**
 * Parse the body of an existing epic file (content below the first `# ` header).
 */
function parseEpicBody(content: string): string {
  const lines = content.split('\n');
  let foundTitle = false;
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (!foundTitle) {
      if (line.trim().startsWith('# ')) {
        foundTitle = true;
      }
      continue;
    }
    bodyLines.push(line);
  }
  return bodyLines.join('\n').trim();
}

/**
 * Migrate a single epic: create ticket dir, move+rename stage files,
 * add frontmatter to everything, infer sequential deps.
 */
function migrateEpic(epic: OldFormatEpic, dryRun: boolean, warnings: string[]): EpicMigrationResult {
  const mappings = mapIds(epic);
  const ticketId = buildTicketId(epic.epicNum);
  const ticketDir = path.join(epic.dirPath, ticketId);

  // Build new stage IDs list (sorted by stage number, same order as mappings)
  const newStageIds = mappings.map((m) => m.newStageId);

  // Infer sequential dependencies: each stage depends on the previous one
  const dependencyMap = new Map<string, string[]>();
  for (let i = 0; i < newStageIds.length; i++) {
    if (i === 0) {
      dependencyMap.set(newStageIds[i], []);
    } else {
      dependencyMap.set(newStageIds[i], [newStageIds[i - 1]]);
    }
  }
  const depsInferred = Math.max(0, newStageIds.length - 1);

  // Check for unknown statuses
  for (const stage of epic.stages) {
    if (!isKnownStatus(stage.status)) {
      warnings.push(
        `EPIC ${epic.id}, stage ${stage.oldId}: unknown status "${stage.status}" — preserved as-is`,
      );
    }
  }

  if (!dryRun) {
    // Create ticket directory
    fs.mkdirSync(ticketDir, { recursive: true });

    // Write stage files into ticket directory with new names and frontmatter
    for (let i = 0; i < epic.stages.length; i++) {
      const stage = epic.stages[i];
      const mapping = mappings[i];
      const deps = dependencyMap.get(mapping.newStageId) || [];

      const stageMarkdown = generateStageMarkdown({
        id: mapping.newStageId,
        ticket: ticketId,
        epic: epic.id,
        title: stage.title,
        status: stage.status,
        dependsOn: deps,
        body: stage.body || undefined,
      });

      const newStageFilePath = path.join(ticketDir, `${mapping.newStageId}.md`);
      fs.writeFileSync(newStageFilePath, stageMarkdown);

      // Remove old stage file
      fs.unlinkSync(stage.filePath);
    }

    // Write ticket file
    const ticketMarkdown = generateTicketMarkdown({
      id: ticketId,
      epic: epic.id,
      title: epic.title,
      status: 'Not Started',
      stages: newStageIds,
      dependsOn: [],
    });
    fs.writeFileSync(path.join(ticketDir, `${ticketId}.md`), ticketMarkdown);

    // Write/update epic file
    const epicFilePath = path.join(epic.dirPath, `${epic.id}.md`);
    let epicBody: string | undefined;
    if (epic.hadEpicFile) {
      const existingContent = fs.readFileSync(epicFilePath, 'utf-8');
      epicBody = parseEpicBody(existingContent);
    }

    const epicMarkdown = generateEpicMarkdown({
      id: epic.id,
      title: epic.title,
      status: 'Not Started',
      tickets: [ticketId],
      dependsOn: [],
      body: epicBody,
    });
    fs.writeFileSync(epicFilePath, epicMarkdown);
  }

  return {
    id: epic.id,
    title: epic.title,
    tickets_created: 1,
    stages_migrated: epic.stages.length,
    dependencies_inferred: depsInferred,
  };
}

/**
 * Run the full migration: detect old-format epics, migrate each one.
 *
 * This is a pure logic function (no CLI concerns).
 * The CLI wrapper handles option parsing and output formatting.
 */
export function runMigration(input: MigrateInput): MigrationResult {
  const { repoPath, dryRun } = input;

  const oldEpics = detectOldFormatEpics(repoPath);

  if (oldEpics.length === 0) {
    return {
      migrated: false,
      dry_run: dryRun,
      epics: [],
      total_stages_migrated: 0,
      total_tickets_created: 0,
      total_dependencies_inferred: 0,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const epicResults: EpicMigrationResult[] = [];

  for (const epic of oldEpics) {
    const result = migrateEpic(epic, dryRun, warnings);
    epicResults.push(result);
  }

  return {
    migrated: true,
    dry_run: dryRun,
    epics: epicResults,
    total_stages_migrated: epicResults.reduce((sum, e) => sum + e.stages_migrated, 0),
    total_tickets_created: epicResults.reduce((sum, e) => sum + e.tickets_created, 0),
    total_dependencies_inferred: epicResults.reduce((sum, e) => sum + e.dependencies_inferred, 0),
    warnings,
  };
}
