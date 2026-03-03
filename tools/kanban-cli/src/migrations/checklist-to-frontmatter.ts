#!/usr/bin/env node
/**
 * Migration: convert markdown body checklist lines to structured frontmatter checklists.
 *
 * For each .md file in the target path, this script:
 *   1. Parses YAML frontmatter (via gray-matter).
 *   2. Scans the body for markdown checklist lines (`- [ ] text` / `- [x] text`).
 *   3. Groups contiguous checklist items under the nearest preceding heading.
 *   4. Removes the checklist lines from the body.
 *   5. Merges the discovered checklists into `frontmatter.checklists`
 *      (preserving any existing structured checklists already present).
 *   6. Writes the updated file back to disk.
 *
 * Usage:
 *   npx tsx src/migrations/checklist-to-frontmatter.ts --path ./stages
 *   npx tsx src/migrations/checklist-to-frontmatter.ts --path ./stages --dry-run
 *   npx tsx src/migrations/checklist-to-frontmatter.ts --path ./stages --pretty
 *
 * The checklist format written to frontmatter matches the schema already consumed
 * by the web server (stages.ts) and kanban-cli parser (frontmatter.ts):
 *
 *   checklists:
 *     - title: "Heading text"
 *       items:
 *         - text: "Do the thing"
 *           checked: false
 *         - text: "Done task"
 *           checked: true
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChecklistItem {
  text: string;
  checked: boolean;
}

interface Checklist {
  title: string;
  items: ChecklistItem[];
}

interface FileMigrationResult {
  file_path: string;
  checklists_found: number;
  items_found: number;
  skipped: boolean;
  reason?: string;
}

interface MigrationResult {
  dry_run: boolean;
  files_scanned: number;
  files_modified: number;
  files_skipped: number;
  results: FileMigrationResult[];
}

// ─── Checklist extraction ─────────────────────────────────────────────────────

/** Regex matching markdown checklist lines: `- [ ] text` or `- [x] text` (case-insensitive x). */
const CHECKLIST_LINE_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/;

/** Regex matching ATX-style headings: `## Heading text`. */
const HEADING_RE = /^#{1,6}\s+(.+)$/;

/**
 * Scan a markdown body string, extract checklist groups, and return:
 *   - `checklists`: array of discovered checklist objects
 *   - `cleanedBody`: the body with checklist lines removed (empty heading-only
 *     sections that result are left intact to avoid altering document structure)
 */
function extractChecklists(body: string): {
  checklists: Checklist[];
  cleanedBody: string;
} {
  const lines = body.split('\n');
  const checklistLines = new Set<number>();

  // Track the current heading for grouping.
  // Checklist items without a heading get grouped under "Checklist".
  let currentHeading = 'Checklist';
  const groups: Map<string, { heading: string; indices: number[]; items: ChecklistItem[] }> = new Map();
  // Preserve insertion order by tracking heading sequence separately.
  const headingOrder: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
      continue;
    }

    const checklistMatch = CHECKLIST_LINE_RE.exec(line);
    if (checklistMatch) {
      const checked = checklistMatch[2].toLowerCase() === 'x';
      const text = checklistMatch[3].trim();

      checklistLines.add(i);

      if (!groups.has(currentHeading)) {
        groups.set(currentHeading, { heading: currentHeading, indices: [], items: [] });
        headingOrder.push(currentHeading);
      }
      const group = groups.get(currentHeading)!;
      group.indices.push(i);
      group.items.push({ text, checked });
    }
  }

  // Build structured checklists in heading-encounter order.
  const checklists: Checklist[] = headingOrder
    .map((heading) => {
      const group = groups.get(heading)!;
      return { title: group.heading, items: group.items };
    })
    .filter((c) => c.items.length > 0);

  // Remove checklist lines from body.
  const cleanedLines = lines.filter((_, i) => !checklistLines.has(i));
  const cleanedBody = cleanedLines.join('\n');

  return { checklists, cleanedBody };
}

// ─── File migration ───────────────────────────────────────────────────────────

/**
 * Process a single markdown file.
 * Returns a result record; writes to disk unless dryRun is true.
 */
function migrateFile(filePath: string, dryRun: boolean): FileMigrationResult {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return {
      file_path: filePath,
      checklists_found: 0,
      items_found: 0,
      skipped: true,
      reason: `read error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsed = matter(raw);
  const { checklists, cleanedBody } = extractChecklists(parsed.content);

  if (checklists.length === 0) {
    return {
      file_path: filePath,
      checklists_found: 0,
      items_found: 0,
      skipped: true,
      reason: 'no checklist lines found in body',
    };
  }

  const totalItems = checklists.reduce((sum, c) => sum + c.items.length, 0);

  // Merge with any existing structured checklists already in frontmatter.
  const existingChecklists: Checklist[] = Array.isArray(parsed.data.checklists)
    ? (parsed.data.checklists as Checklist[])
    : [];

  // Avoid duplicating checklists that were already migrated (match by title).
  const existingTitles = new Set(existingChecklists.map((c) => c.title));
  const newChecklists = checklists.filter((c) => !existingTitles.has(c.title));
  const mergedChecklists = [...existingChecklists, ...newChecklists];

  if (newChecklists.length === 0) {
    return {
      file_path: filePath,
      checklists_found: 0,
      items_found: 0,
      skipped: true,
      reason: 'all discovered checklists already present in frontmatter',
    };
  }

  if (!dryRun) {
    // Rebuild frontmatter data with updated checklists.
    const updatedData = { ...parsed.data, checklists: mergedChecklists };
    // Stringify using gray-matter, which will produce a clean YAML block.
    const updated = matter.stringify(cleanedBody, updatedData);
    try {
      fs.writeFileSync(filePath, updated, 'utf-8');
    } catch (err) {
      return {
        file_path: filePath,
        checklists_found: newChecklists.length,
        items_found: totalItems,
        skipped: true,
        reason: `write error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    file_path: filePath,
    checklists_found: newChecklists.length,
    items_found: totalItems,
    skipped: false,
  };
}

// ─── Directory traversal ──────────────────────────────────────────────────────

/**
 * Recursively collect all .md files under a directory (or return the path
 * itself if it points directly to a file).
 */
function collectMarkdownFiles(targetPath: string): string[] {
  const resolved = path.resolve(targetPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    if (resolved.endsWith('.md')) return [resolved];
    throw new Error(`Not a markdown file: ${resolved}`);
  }

  const results: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  }

  walk(resolved);
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(): { targetPath: string; dryRun: boolean; pretty: boolean } {
  const args = process.argv.slice(2);
  let targetPath = '.';
  let dryRun = false;
  let pretty = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path' && args[i + 1]) {
      targetPath = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--pretty') {
      pretty = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      process.stdout.write(
        [
          'Usage: npx tsx src/migrations/checklist-to-frontmatter.ts [options]',
          '',
          'Options:',
          '  --path <path>   Directory or file to migrate (default: current directory)',
          '  --dry-run       Show what would change without writing files',
          '  --pretty        Pretty-print JSON output',
          '  --help          Show this help',
          '',
        ].join('\n'),
      );
      process.exit(0);
    }
  }

  return { targetPath, dryRun, pretty };
}

function main(): void {
  const { targetPath, dryRun, pretty } = parseArgs();

  let files: string[];
  try {
    files = collectMarkdownFiles(targetPath);
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const results: FileMigrationResult[] = [];
  for (const file of files) {
    results.push(migrateFile(file, dryRun));
  }

  const filesModified = results.filter((r) => !r.skipped).length;
  const filesSkipped = results.filter((r) => r.skipped).length;

  const summary: MigrationResult = {
    dry_run: dryRun,
    files_scanned: files.length,
    files_modified: filesModified,
    files_skipped: filesSkipped,
    results,
  };

  const indent = pretty ? 2 : undefined;
  process.stdout.write(JSON.stringify(summary, null, indent) + '\n');
}

main();
