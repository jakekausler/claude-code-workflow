#!/usr/bin/env npx tsx
/**
 * Migration script: moves markdown checkbox lists from stage file bodies to YAML frontmatter.
 *
 * Usage:
 *   npx tsx scripts/migrate-checklists.ts <repo-path> [--dry-run]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';

interface ChecklistItem {
  text: string;
  checked: boolean;
}

interface Checklist {
  title: string;
  items: ChecklistItem[];
}

/**
 * Parse a line as a markdown checkbox item.
 * Returns null if the line is not a checkbox.
 */
function parseCheckboxLine(line: string): ChecklistItem | null {
  const match = line.match(/^\s*-\s+\[([ xX])\]\s+(.+)$/);
  if (!match) return null;
  return {
    text: match[2].trim(),
    checked: match[1] !== ' ',
  };
}

/**
 * Extract checklists from the markdown body.
 * A checklist is a heading (##, ###, etc.) followed by one or more checkbox lines.
 * Standalone checkbox groups (without a heading) use "Checklist" as the default title.
 *
 * Returns the extracted checklists and the cleaned body with checklist content removed.
 */
function extractChecklists(body: string): { checklists: Checklist[]; cleanedBody: string } {
  const lines = body.split('\n');
  const checklists: Checklist[] = [];
  const cleanedLines: string[] = [];

  let currentTitle: string | null = null;
  let currentItems: ChecklistItem[] = [];
  let headingLineIndex = -1;

  function flushChecklist() {
    if (currentItems.length > 0) {
      checklists.push({
        title: currentTitle ?? 'Checklist',
        items: [...currentItems],
      });
      // Remove the heading line if we captured one
      if (headingLineIndex >= 0 && cleanedLines.length > headingLineIndex) {
        cleanedLines.splice(headingLineIndex, cleanedLines.length - headingLineIndex);
      }
    } else if (headingLineIndex >= 0) {
      // Heading had no checklist items — keep it
    }
    currentTitle = null;
    currentItems = [];
    headingLineIndex = -1;
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,6})\s+(.+)$/);
    const checkboxItem = parseCheckboxLine(line);

    if (headingMatch) {
      flushChecklist();
      currentTitle = headingMatch[2].trim();
      cleanedLines.push(line);
      headingLineIndex = cleanedLines.length - 1;
    } else if (checkboxItem) {
      currentItems.push(checkboxItem);
      // Don't add checkbox lines to cleanedLines — they'll go into frontmatter
    } else {
      // Non-checkbox, non-heading line — flush any pending checklist
      if (currentItems.length > 0) {
        flushChecklist();
      } else {
        // Reset heading tracking if the line after a heading isn't a checkbox
        if (headingLineIndex >= 0) {
          headingLineIndex = -1;
          currentTitle = null;
        }
      }
      cleanedLines.push(line);
    }
  }

  // Flush any remaining checklist
  flushChecklist();

  // Clean up trailing blank lines from removed sections
  let cleaned = cleanedLines.join('\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

  return { checklists, cleanedBody: cleaned };
}

function discoverStageFiles(repoPath: string): string[] {
  const epicsDir = path.join(repoPath, 'epics');
  if (!fs.existsSync(epicsDir)) return [];

  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.startsWith('STAGE-') && entry.name.endsWith('.md')) {
        files.push(full);
      }
    }
  }
  walk(epicsDir);
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const repoPath = args.find((a) => !a.startsWith('--'));

  if (!repoPath) {
    console.error('Usage: npx tsx scripts/migrate-checklists.ts <repo-path> [--dry-run]');
    process.exit(1);
  }

  const resolvedPath = path.resolve(repoPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Repository path not found: ${resolvedPath}`);
    process.exit(1);
  }

  const stageFiles = discoverStageFiles(resolvedPath);
  console.log(`Found ${stageFiles.length} stage files in ${resolvedPath}`);

  let migratedCount = 0;

  for (const filePath of stageFiles) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);

    // Skip files that already have checklists in frontmatter
    if (Array.isArray(data.checklists) && data.checklists.length > 0) {
      console.log(`  SKIP (already has frontmatter checklists): ${path.relative(resolvedPath, filePath)}`);
      continue;
    }

    const { checklists, cleanedBody } = extractChecklists(content);

    if (checklists.length === 0) {
      continue;
    }

    data.checklists = checklists;

    const output = matter.stringify(cleanedBody, data);

    if (dryRun) {
      console.log(`  DRY-RUN: ${path.relative(resolvedPath, filePath)} — ${checklists.length} checklist(s) found`);
      for (const cl of checklists) {
        console.log(`    "${cl.title}" (${cl.items.length} items)`);
      }
    } else {
      fs.writeFileSync(filePath, output, 'utf-8');
      console.log(`  MIGRATED: ${path.relative(resolvedPath, filePath)} — ${checklists.length} checklist(s)`);
    }

    migratedCount++;
  }

  console.log(`\nDone. ${migratedCount} file(s) ${dryRun ? 'would be ' : ''}migrated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
