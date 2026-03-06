import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkItemType } from '../types/work-items.js';

/**
 * A discovered file with its absolute path and inferred work item type.
 */
export interface DiscoveredFile {
  filePath: string;
  type: WorkItemType;
}

/**
 * File name patterns for each work item type.
 */
const FILE_PATTERNS: Array<{ prefix: string; type: WorkItemType }> = [
  { prefix: 'EPIC-', type: 'epic' },
  { prefix: 'TICKET-', type: 'ticket' },
  { prefix: 'STAGE-', type: 'stage' },
];

/**
 * Recursively walk a directory and collect all files.
 */
function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Discover all epic, ticket, and stage markdown files in the repo's `epics/` directory.
 *
 * File naming convention:
 * - Epics: `EPIC-*.md`
 * - Tickets: `TICKET-*.md`
 * - Stages: `STAGE-*.md`
 *
 * @param repoPath - Root path of the repository
 * @returns Array of discovered files with their types
 */
export function discoverWorkItems(repoPath: string): DiscoveredFile[] {
  const epicsDir = path.join(repoPath, 'epics');
  if (!fs.existsSync(epicsDir)) return [];

  const allFiles = walkDir(epicsDir);
  const discovered: DiscoveredFile[] = [];

  for (const filePath of allFiles) {
    const basename = path.basename(filePath);
    if (!basename.endsWith('.md')) continue;

    for (const pattern of FILE_PATTERNS) {
      if (basename.startsWith(pattern.prefix)) {
        discovered.push({
          filePath,
          type: pattern.type,
        });
        break;
      }
    }
  }

  return discovered;
}
