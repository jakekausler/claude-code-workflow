import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OldFormatEpic, OldFormatStage } from './types.js';

/** Regex for old two-level stage ID: STAGE-XXX-YYY */
const OLD_STAGE_PATTERN = /^STAGE-(\d{3})-(\d{3})\.md$/;

/** Regex for epic directory names: EPIC-XXX */
const EPIC_DIR_PATTERN = /^EPIC-(\d{3})$/;

/** Regex for ticket directory names (new format): TICKET-XXX-YYY */
const TICKET_DIR_PATTERN = /^TICKET-\d{3}-\d{3}$/;

/**
 * Check whether a repo has old-format epics (stage files directly in epic dirs,
 * no ticket subdirectories).
 */
export function isOldFormatRepo(repoPath: string): boolean {
  const epicsDir = path.join(repoPath, 'epics');
  if (!fs.existsSync(epicsDir)) return false;

  const entries = fs.readdirSync(epicsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!EPIC_DIR_PATTERN.test(entry.name)) continue;

    const epicDir = path.join(epicsDir, entry.name);
    const epicEntries = fs.readdirSync(epicDir, { withFileTypes: true });

    // Check for ticket subdirectories (new format indicator)
    const hasTicketDirs = epicEntries.some(
      (e) => e.isDirectory() && TICKET_DIR_PATTERN.test(e.name),
    );
    if (hasTicketDirs) continue;

    // Check for old-format stage files directly in the epic directory
    const hasOldStageFiles = epicEntries.some(
      (e) => e.isFile() && OLD_STAGE_PATTERN.test(e.name),
    );
    if (hasOldStageFiles) return true;
  }

  return false;
}

/**
 * Parse the title from an old-format markdown file.
 * Looks for the first `# ` header line.
 */
function parseTitleFromMarkdown(content: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.slice(2).trim();
    }
  }
  return null;
}

/**
 * Parse the status from an old-format markdown file.
 * Looks for a `## Status` section and reads the next non-empty line.
 */
function parseStatusFromMarkdown(content: string): string {
  const lines = content.split('\n');
  let inStatusSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === '## status') {
      inStatusSection = true;
      continue;
    }
    if (inStatusSection) {
      if (trimmed === '') continue;
      if (trimmed.startsWith('##')) break; // next section
      return trimmed;
    }
  }
  return 'Not Started';
}

/**
 * Extract the body content after the first `# ` header.
 */
function parseBodyFromMarkdown(content: string): string {
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
 * Detect all old-format epic directories in a repo.
 *
 * An old-format epic directory:
 * - Matches EPIC-XXX naming
 * - Contains STAGE-XXX-YYY.md files directly (not in ticket subdirectories)
 * - Does NOT contain TICKET-XXX-YYY subdirectories
 *
 * Returns epics sorted by ID, with stages sorted by stage number within each epic.
 */
export function detectOldFormatEpics(repoPath: string): OldFormatEpic[] {
  const epicsDir = path.join(repoPath, 'epics');
  if (!fs.existsSync(epicsDir)) return [];

  const entries = fs.readdirSync(epicsDir, { withFileTypes: true });
  const epics: OldFormatEpic[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const epicMatch = EPIC_DIR_PATTERN.exec(entry.name);
    if (!epicMatch) continue;

    const epicNum = epicMatch[1];
    const epicId = `EPIC-${epicNum}`;
    const epicDir = path.join(epicsDir, entry.name);
    const epicEntries = fs.readdirSync(epicDir, { withFileTypes: true });

    // Skip if it has ticket subdirectories (already new format)
    const hasTicketDirs = epicEntries.some(
      (e) => e.isDirectory() && TICKET_DIR_PATTERN.test(e.name),
    );
    if (hasTicketDirs) continue;

    // Collect old-format stage files
    const stages: OldFormatStage[] = [];
    for (const stageEntry of epicEntries) {
      if (!stageEntry.isFile()) continue;
      const stageMatch = OLD_STAGE_PATTERN.exec(stageEntry.name);
      if (!stageMatch) continue;

      const stageFilePath = path.join(epicDir, stageEntry.name);
      const content = fs.readFileSync(stageFilePath, 'utf-8');
      const oldId = `STAGE-${stageMatch[1]}-${stageMatch[2]}`;

      stages.push({
        filename: stageEntry.name,
        filePath: stageFilePath,
        oldId,
        epicNum: stageMatch[1],
        stageNum: stageMatch[2],
        title: parseTitleFromMarkdown(content) || oldId,
        status: parseStatusFromMarkdown(content),
        body: parseBodyFromMarkdown(content),
      });
    }

    // Only include if there are old-format stage files
    if (stages.length === 0) continue;

    // Sort stages by stage number
    stages.sort((a, b) => a.stageNum.localeCompare(b.stageNum));

    // Check for existing epic file
    let epicTitle = epicId;
    let hadEpicFile = false;
    const epicFilePath = path.join(epicDir, `${epicId}.md`);
    if (fs.existsSync(epicFilePath)) {
      hadEpicFile = true;
      const epicContent = fs.readFileSync(epicFilePath, 'utf-8');
      const parsedTitle = parseTitleFromMarkdown(epicContent);
      if (parsedTitle) {
        epicTitle = parsedTitle;
      }
    }

    epics.push({
      id: epicId,
      epicNum,
      dirPath: epicDir,
      title: epicTitle,
      status: 'Not Started',
      stages,
      hadEpicFile,
    });
  }

  // Sort epics by ID
  epics.sort((a, b) => a.id.localeCompare(b.id));

  return epics;
}
