# Stage 2B: Migrate Command

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `kanban-cli migrate` command for non-interactive migration of old-format repos to the new format. Old-format repos have stage files directly inside epic directories with no YAML frontmatter and no ticket subdirectories. The migrate command detects this, creates one ticket per epic, restructures files, adds YAML frontmatter, and infers sequential dependencies.

**Status:** Not Started

**Prerequisites:** Stage 1 complete (all 290 tests passing). The existing codebase provides: Commander.js CLI framework, `writeOutput` utility, `gray-matter` for frontmatter, `node:fs` for filesystem operations, and the new-format type definitions (`Epic`, `Ticket`, `Stage` in `src/types/work-items.ts`).

**Architecture:** The migration logic lives in `src/migration/` as four focused modules (detector, parser, id-mapper, frontmatter-generator) plus the orchestrating engine in `src/cli/logic/migrate.ts`. The thin CLI wrapper is `src/cli/commands/migrate.ts`. Tests exercise the logic modules directly with mock data and a small filesystem fixture. This follows the same two-file pattern (logic + command) used by all other CLI commands.

**Tech Stack:** TypeScript, Commander.js, gray-matter, node:fs, Vitest

---

### Task 1: Define Migration Types

**Files:**
- Create: `tools/kanban-cli/src/migration/types.ts`

**Step 1: Write the types file**

Create `tools/kanban-cli/src/migration/types.ts`:

```typescript
/**
 * Types for the old-format-to-new-format migration.
 */

/**
 * An old-format stage file parsed from a legacy repo.
 * Old format has no YAML frontmatter; data is extracted from markdown structure.
 */
export interface OldFormatStage {
  /** Original filename, e.g. "STAGE-001-003.md" */
  filename: string;
  /** Absolute path to the file */
  filePath: string;
  /** Old two-level ID, e.g. "STAGE-001-003" */
  oldId: string;
  /** Epic number extracted from ID, e.g. "001" */
  epicNum: string;
  /** Stage number extracted from ID, e.g. "003" */
  stageNum: string;
  /** Title extracted from first `# ` header, or filename if none */
  title: string;
  /** Status extracted from `## Status` section, or "Not Started" */
  status: string;
  /** Raw markdown body (everything after the title header) */
  body: string;
}

/**
 * An old-format epic directory detected in the repo.
 */
export interface OldFormatEpic {
  /** Epic ID, e.g. "EPIC-001" */
  id: string;
  /** Epic number, e.g. "001" */
  epicNum: string;
  /** Absolute path to the epic directory */
  dirPath: string;
  /** Title extracted from epic markdown (if exists) or derived from dir name */
  title: string;
  /** Status of the epic, inferred or parsed */
  status: string;
  /** All stage files found directly in the epic directory */
  stages: OldFormatStage[];
  /** Whether an epic markdown file already existed */
  hadEpicFile: boolean;
}

/**
 * ID mapping from old two-level IDs to new three-level IDs.
 */
export interface IdMapping {
  oldStageId: string;
  newStageId: string;
  ticketId: string;
  epicId: string;
}

/**
 * Result of migrating a single epic.
 */
export interface EpicMigrationResult {
  id: string;
  title: string;
  tickets_created: number;
  stages_migrated: number;
  dependencies_inferred: number;
}

/**
 * Full migration result, serialized as JSON output.
 */
export interface MigrationResult {
  migrated: boolean;
  dry_run: boolean;
  epics: EpicMigrationResult[];
  total_stages_migrated: number;
  total_tickets_created: number;
  total_dependencies_inferred: number;
  warnings: string[];
}

/**
 * Input to the migration engine.
 */
export interface MigrateInput {
  repoPath: string;
  dryRun: boolean;
}
```

No tests needed for a pure types file.

---

### Task 2: Write Old-Format Detector

**Files:**
- Create: `tools/kanban-cli/src/migration/detector.ts`
- Create: `tools/kanban-cli/tests/migration/detector.test.ts`

**Step 1: Write the failing tests**

Create `tools/kanban-cli/tests/migration/detector.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectOldFormatEpics, isOldFormatRepo } from '../../../src/migration/detector.js';

const TEST_DIR = '/tmp/kanban-migrate-detector-test';

function setupDir(structure: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = path.join(TEST_DIR, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe('isOldFormatRepo', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns true when stage files exist directly in epic directory without ticket subdirs', () => {
    setupDir({
      'epics/EPIC-001/STAGE-001-001.md': '# Some Stage\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Another Stage\n',
    });
    expect(isOldFormatRepo(TEST_DIR)).toBe(true);
  });

  it('returns false when repo uses new format with ticket subdirectories', () => {
    setupDir({
      'epics/EPIC-001/EPIC-001.md': '---\nid: EPIC-001\ntitle: Test\nstatus: Not Started\n---\n',
      'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md': '---\nid: TICKET-001-001\n---\n',
      'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': '---\nid: STAGE-001-001-001\n---\n',
    });
    expect(isOldFormatRepo(TEST_DIR)).toBe(false);
  });

  it('returns false when epics directory does not exist', () => {
    expect(isOldFormatRepo(TEST_DIR)).toBe(false);
  });

  it('returns false for empty epics directory', () => {
    fs.mkdirSync(path.join(TEST_DIR, 'epics'), { recursive: true });
    expect(isOldFormatRepo(TEST_DIR)).toBe(false);
  });
});

describe('detectOldFormatEpics', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('detects epic directories containing old-format stage files', () => {
    setupDir({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Auth API\n\n## Status\nNot Started\n',
      'epics/EPIC-002/STAGE-002-001.md': '# Cart UI\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics).toHaveLength(2);
    expect(epics[0].id).toBe('EPIC-001');
    expect(epics[0].stages).toHaveLength(2);
    expect(epics[1].id).toBe('EPIC-002');
    expect(epics[1].stages).toHaveLength(1);
  });

  it('sorts epics by ID', () => {
    setupDir({
      'epics/EPIC-003/STAGE-003-001.md': '# Stage\n',
      'epics/EPIC-001/STAGE-001-001.md': '# Stage\n',
      'epics/EPIC-002/STAGE-002-001.md': '# Stage\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics.map((e) => e.id)).toEqual(['EPIC-001', 'EPIC-002', 'EPIC-003']);
  });

  it('sorts stages within an epic by stage number', () => {
    setupDir({
      'epics/EPIC-001/STAGE-001-003.md': '# Third\n',
      'epics/EPIC-001/STAGE-001-001.md': '# First\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Second\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics[0].stages.map((s) => s.oldId)).toEqual([
      'STAGE-001-001',
      'STAGE-001-002',
      'STAGE-001-003',
    ]);
  });

  it('picks up title from existing epic markdown if present', () => {
    setupDir({
      'epics/EPIC-001/EPIC-001.md': '# User Authentication\n\nSome description.\n',
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics[0].title).toBe('User Authentication');
    expect(epics[0].hadEpicFile).toBe(true);
  });

  it('derives title from directory name when no epic file exists', () => {
    setupDir({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics[0].title).toBe('EPIC-001');
    expect(epics[0].hadEpicFile).toBe(false);
  });

  it('ignores directories that are not EPIC-* format', () => {
    setupDir({
      'epics/random-dir/some-file.md': '# Not an epic\n',
      'epics/EPIC-001/STAGE-001-001.md': '# Stage\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics).toHaveLength(1);
    expect(epics[0].id).toBe('EPIC-001');
  });

  it('skips epic directories that already have ticket subdirectories (new format)', () => {
    setupDir({
      'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md': '---\nid: STAGE-001-001-001\n---\n',
      'epics/EPIC-001/EPIC-001.md': '---\nid: EPIC-001\ntitle: Auth\nstatus: Not Started\n---\n',
      'epics/EPIC-002/STAGE-002-001.md': '# Old format stage\n',
    });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics).toHaveLength(1);
    expect(epics[0].id).toBe('EPIC-002');
  });

  it('returns empty array when no old-format epics found', () => {
    fs.mkdirSync(path.join(TEST_DIR, 'epics'), { recursive: true });
    const epics = detectOldFormatEpics(TEST_DIR);
    expect(epics).toHaveLength(0);
  });
});
```

**Step 2: Write the detector implementation**

Create `tools/kanban-cli/src/migration/detector.ts`:

```typescript
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
```

---

### Task 3: Write ID Mapper

**Files:**
- Create: `tools/kanban-cli/src/migration/id-mapper.ts`
- Create: `tools/kanban-cli/tests/migration/id-mapper.test.ts`

**Step 1: Write the failing tests**

Create `tools/kanban-cli/tests/migration/id-mapper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapIds, mapStageId, buildTicketId } from '../../../src/migration/id-mapper.js';
import type { OldFormatEpic, OldFormatStage } from '../../../src/migration/types.js';

function makeStage(overrides: Partial<OldFormatStage> = {}): OldFormatStage {
  return {
    filename: 'STAGE-001-001.md',
    filePath: '/tmp/epics/EPIC-001/STAGE-001-001.md',
    oldId: 'STAGE-001-001',
    epicNum: '001',
    stageNum: '001',
    title: 'Test Stage',
    status: 'Not Started',
    body: '',
    ...overrides,
  };
}

describe('buildTicketId', () => {
  it('builds ticket ID with epic number and ticket number 001', () => {
    expect(buildTicketId('001')).toBe('TICKET-001-001');
  });

  it('builds ticket ID for different epic number', () => {
    expect(buildTicketId('003')).toBe('TICKET-003-001');
  });
});

describe('mapStageId', () => {
  it('converts old two-level ID to new three-level ID with ticket 001', () => {
    expect(mapStageId('STAGE-001-003')).toBe('STAGE-001-001-003');
  });

  it('preserves the epic number and stage number', () => {
    expect(mapStageId('STAGE-002-005')).toBe('STAGE-002-001-005');
  });

  it('handles single digit stage numbers', () => {
    expect(mapStageId('STAGE-001-001')).toBe('STAGE-001-001-001');
  });
});

describe('mapIds', () => {
  it('maps all stages in an epic to new IDs', () => {
    const epic: OldFormatEpic = {
      id: 'EPIC-001',
      epicNum: '001',
      dirPath: '/tmp/epics/EPIC-001',
      title: 'Auth',
      status: 'Not Started',
      hadEpicFile: false,
      stages: [
        makeStage({ oldId: 'STAGE-001-001', epicNum: '001', stageNum: '001' }),
        makeStage({ oldId: 'STAGE-001-002', epicNum: '001', stageNum: '002' }),
        makeStage({ oldId: 'STAGE-001-003', epicNum: '001', stageNum: '003' }),
      ],
    };

    const mappings = mapIds(epic);
    expect(mappings).toHaveLength(3);
    expect(mappings[0]).toEqual({
      oldStageId: 'STAGE-001-001',
      newStageId: 'STAGE-001-001-001',
      ticketId: 'TICKET-001-001',
      epicId: 'EPIC-001',
    });
    expect(mappings[1].newStageId).toBe('STAGE-001-001-002');
    expect(mappings[2].newStageId).toBe('STAGE-001-001-003');
  });

  it('uses the same ticket ID for all stages in an epic', () => {
    const epic: OldFormatEpic = {
      id: 'EPIC-002',
      epicNum: '002',
      dirPath: '/tmp/epics/EPIC-002',
      title: 'Payments',
      status: 'Not Started',
      hadEpicFile: false,
      stages: [
        makeStage({ oldId: 'STAGE-002-001', epicNum: '002', stageNum: '001' }),
        makeStage({ oldId: 'STAGE-002-002', epicNum: '002', stageNum: '002' }),
      ],
    };

    const mappings = mapIds(epic);
    expect(mappings[0].ticketId).toBe('TICKET-002-001');
    expect(mappings[1].ticketId).toBe('TICKET-002-001');
  });
});
```

**Step 2: Write the implementation**

Create `tools/kanban-cli/src/migration/id-mapper.ts`:

```typescript
import type { OldFormatEpic, IdMapping } from './types.js';

/**
 * Build the default ticket ID for an epic.
 * In the simple migration, each epic gets one ticket: TICKET-{epicNum}-001.
 */
export function buildTicketId(epicNum: string): string {
  return `TICKET-${epicNum}-001`;
}

/**
 * Convert an old two-level stage ID (STAGE-XXX-YYY) to
 * a new three-level stage ID (STAGE-XXX-001-YYY).
 * The "001" is the default ticket number.
 */
export function mapStageId(oldId: string): string {
  const match = /^STAGE-(\d{3})-(\d{3})$/.exec(oldId);
  if (!match) {
    throw new Error(`Invalid old-format stage ID: ${oldId}`);
  }
  return `STAGE-${match[1]}-001-${match[2]}`;
}

/**
 * Generate ID mappings for all stages in an old-format epic.
 * Each epic gets one ticket (TICKET-{epicNum}-001) and all stages
 * are mapped from STAGE-XXX-YYY to STAGE-XXX-001-YYY.
 */
export function mapIds(epic: OldFormatEpic): IdMapping[] {
  const ticketId = buildTicketId(epic.epicNum);

  return epic.stages.map((stage) => ({
    oldStageId: stage.oldId,
    newStageId: mapStageId(stage.oldId),
    ticketId,
    epicId: epic.id,
  }));
}
```

---

### Task 4: Write Frontmatter Generator

**Files:**
- Create: `tools/kanban-cli/src/migration/frontmatter-generator.ts`
- Create: `tools/kanban-cli/tests/migration/frontmatter-generator.test.ts`

**Step 1: Write the failing tests**

Create `tools/kanban-cli/tests/migration/frontmatter-generator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import matter from 'gray-matter';
import {
  generateEpicMarkdown,
  generateTicketMarkdown,
  generateStageMarkdown,
} from '../../../src/migration/frontmatter-generator.js';

describe('generateEpicMarkdown', () => {
  it('produces valid YAML frontmatter with required fields', () => {
    const md = generateEpicMarkdown({
      id: 'EPIC-001',
      title: 'User Authentication',
      status: 'Not Started',
      tickets: ['TICKET-001-001'],
      dependsOn: [],
    });

    const { data, content } = matter(md);
    expect(data.id).toBe('EPIC-001');
    expect(data.title).toBe('User Authentication');
    expect(data.status).toBe('Not Started');
    expect(data.tickets).toEqual(['TICKET-001-001']);
    expect(data.depends_on).toEqual([]);
    expect(content.trim()).toContain('## Overview');
  });

  it('preserves existing body content', () => {
    const md = generateEpicMarkdown({
      id: 'EPIC-001',
      title: 'Auth',
      status: 'In Progress',
      tickets: ['TICKET-001-001'],
      dependsOn: [],
      body: 'Some existing description.',
    });

    const { content } = matter(md);
    expect(content).toContain('Some existing description.');
  });
});

describe('generateTicketMarkdown', () => {
  it('produces valid YAML frontmatter with required fields', () => {
    const md = generateTicketMarkdown({
      id: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Flow',
      status: 'Not Started',
      stages: ['STAGE-001-001-001', 'STAGE-001-001-002'],
      dependsOn: [],
    });

    const { data, content } = matter(md);
    expect(data.id).toBe('TICKET-001-001');
    expect(data.epic).toBe('EPIC-001');
    expect(data.title).toBe('Login Flow');
    expect(data.status).toBe('Not Started');
    expect(data.source).toBe('local');
    expect(data.stages).toEqual(['STAGE-001-001-001', 'STAGE-001-001-002']);
    expect(data.depends_on).toEqual([]);
    expect(content.trim()).toContain('## Overview');
  });
});

describe('generateStageMarkdown', () => {
  it('produces valid YAML frontmatter with required fields', () => {
    const md = generateStageMarkdown({
      id: 'STAGE-001-001-001',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Form UI',
      status: 'Not Started',
      dependsOn: [],
    });

    const { data, content } = matter(md);
    expect(data.id).toBe('STAGE-001-001-001');
    expect(data.ticket).toBe('TICKET-001-001');
    expect(data.epic).toBe('EPIC-001');
    expect(data.title).toBe('Login Form UI');
    expect(data.status).toBe('Not Started');
    expect(data.session_active).toBe(false);
    expect(data.refinement_type).toEqual([]);
    expect(data.depends_on).toEqual([]);
    expect(data.priority).toBe(0);
  });

  it('includes depends_on when provided', () => {
    const md = generateStageMarkdown({
      id: 'STAGE-001-001-002',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Auth API',
      status: 'Not Started',
      dependsOn: ['STAGE-001-001-001'],
    });

    const { data } = matter(md);
    expect(data.depends_on).toEqual(['STAGE-001-001-001']);
  });

  it('preserves body content from old stage', () => {
    const md = generateStageMarkdown({
      id: 'STAGE-001-001-001',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Form',
      status: 'Complete',
      dependsOn: [],
      body: '## Overview\n\nBuild the login form.',
    });

    const { content } = matter(md);
    expect(content).toContain('Build the login form.');
  });

  it('normalizes status values to valid config statuses', () => {
    const md = generateStageMarkdown({
      id: 'STAGE-001-001-001',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Stage',
      status: 'Done',
      dependsOn: [],
    });

    const { data } = matter(md);
    // "Done" should be normalized to "Complete"
    expect(data.status).toBe('Complete');
  });
});
```

**Step 2: Write the implementation**

Create `tools/kanban-cli/src/migration/frontmatter-generator.ts`:

```typescript
import matter from 'gray-matter';

/**
 * Status normalization map.
 * Old repos may use different status strings; map them to config-compatible values.
 */
const STATUS_NORMALIZATION: Record<string, string> = {
  'done': 'Complete',
  'completed': 'Complete',
  'complete': 'Complete',
  'in progress': 'In Progress',
  'in-progress': 'In Progress',
  'not started': 'Not Started',
  'not-started': 'Not Started',
  'todo': 'Not Started',
  'to do': 'Not Started',
  'blocked': 'Not Started',
  'skipped': 'Skipped',
};

/**
 * Normalize a status string to a config-compatible value.
 * If the status is already valid (case-sensitive match), return it as-is.
 * Otherwise, look up in normalization map using lowercase.
 */
function normalizeStatus(status: string): string {
  // Check normalization map (case-insensitive)
  const normalized = STATUS_NORMALIZATION[status.toLowerCase()];
  if (normalized) return normalized;
  // Return as-is if not in the map (could be a valid pipeline status like "Design", "Build")
  return status;
}

export interface EpicMarkdownInput {
  id: string;
  title: string;
  status: string;
  tickets: string[];
  dependsOn: string[];
  body?: string;
}

export interface TicketMarkdownInput {
  id: string;
  epic: string;
  title: string;
  status: string;
  stages: string[];
  dependsOn: string[];
  body?: string;
}

export interface StageMarkdownInput {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  status: string;
  dependsOn: string[];
  body?: string;
}

/**
 * Generate a new-format epic markdown file with YAML frontmatter.
 */
export function generateEpicMarkdown(input: EpicMarkdownInput): string {
  const frontmatter: Record<string, unknown> = {
    id: input.id,
    title: input.title,
    status: normalizeStatus(input.status),
    tickets: input.tickets,
    depends_on: input.dependsOn,
  };

  const body = input.body || `## Overview\n\n${input.title}`;

  return matter.stringify(`\n${body}\n`, frontmatter);
}

/**
 * Generate a new-format ticket markdown file with YAML frontmatter.
 */
export function generateTicketMarkdown(input: TicketMarkdownInput): string {
  const frontmatter: Record<string, unknown> = {
    id: input.id,
    epic: input.epic,
    title: input.title,
    status: normalizeStatus(input.status),
    source: 'local',
    stages: input.stages,
    depends_on: input.dependsOn,
  };

  const body = input.body || `## Overview\n\n${input.title}`;

  return matter.stringify(`\n${body}\n`, frontmatter);
}

/**
 * Generate a new-format stage markdown file with YAML frontmatter.
 */
export function generateStageMarkdown(input: StageMarkdownInput): string {
  const frontmatter: Record<string, unknown> = {
    id: input.id,
    ticket: input.ticket,
    epic: input.epic,
    title: input.title,
    status: normalizeStatus(input.status),
    session_active: false,
    refinement_type: [],
    depends_on: input.dependsOn,
    priority: 0,
  };

  const body = input.body || `## Overview\n\n${input.title}`;

  return matter.stringify(`\n${body}\n`, frontmatter);
}
```

---

### Task 5: Write Migration Engine (Logic Module)

**Files:**
- Create: `tools/kanban-cli/src/cli/logic/migrate.ts`
- Create: `tools/kanban-cli/tests/cli/logic/migrate.test.ts`

**Step 1: Write the failing tests**

Create `tools/kanban-cli/tests/cli/logic/migrate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { runMigration } from '../../../src/cli/logic/migrate.js';

const TEST_DIR = '/tmp/kanban-migrate-engine-test';

function setupOldFormatRepo(structure: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = path.join(TEST_DIR, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe('runMigration', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('migrates a simple old-format repo with one epic and two stages', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n\n## Overview\n\nBuild the login form.\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Auth API\n\n## Status\nNot Started\n\n## Overview\n\nBuild the auth API.\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });

    expect(result.migrated).toBe(true);
    expect(result.dry_run).toBe(false);
    expect(result.epics).toHaveLength(1);
    expect(result.epics[0].id).toBe('EPIC-001');
    expect(result.epics[0].tickets_created).toBe(1);
    expect(result.epics[0].stages_migrated).toBe(2);
    expect(result.total_stages_migrated).toBe(2);
    expect(result.total_tickets_created).toBe(1);
  });

  it('creates ticket subdirectory with correct structure', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    // Ticket directory should exist
    const ticketDir = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001');
    expect(fs.existsSync(ticketDir)).toBe(true);

    // Ticket file should exist with frontmatter
    const ticketFile = path.join(ticketDir, 'TICKET-001-001.md');
    expect(fs.existsSync(ticketFile)).toBe(true);
    const ticketContent = fs.readFileSync(ticketFile, 'utf-8');
    const { data: ticketData } = matter(ticketContent);
    expect(ticketData.id).toBe('TICKET-001-001');
    expect(ticketData.epic).toBe('EPIC-001');
    expect(ticketData.stages).toContain('STAGE-001-001-001');
  });

  it('moves and renames stage files to new three-level IDs', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Auth API\n\n## Status\nNot Started\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    // Old files should be gone
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-001.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-002.md'))).toBe(false);

    // New files should exist in ticket directory
    const stageFile1 = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md');
    const stageFile2 = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md');
    expect(fs.existsSync(stageFile1)).toBe(true);
    expect(fs.existsSync(stageFile2)).toBe(true);

    // Verify frontmatter on stage files
    const { data: stage1 } = matter(fs.readFileSync(stageFile1, 'utf-8'));
    expect(stage1.id).toBe('STAGE-001-001-001');
    expect(stage1.ticket).toBe('TICKET-001-001');
    expect(stage1.epic).toBe('EPIC-001');
    expect(stage1.title).toBe('Login Form');
    expect(stage1.status).toBe('Complete');
    expect(stage1.session_active).toBe(false);
  });

  it('creates or updates epic file with YAML frontmatter', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const epicFile = path.join(TEST_DIR, 'epics/EPIC-001/EPIC-001.md');
    expect(fs.existsSync(epicFile)).toBe(true);
    const { data } = matter(fs.readFileSync(epicFile, 'utf-8'));
    expect(data.id).toBe('EPIC-001');
    expect(data.tickets).toContain('TICKET-001-001');
    expect(data.depends_on).toEqual([]);
  });

  it('infers sequential dependencies between stages (order-based)', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# First\n\n## Status\nComplete\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Second\n\n## Status\nNot Started\n',
      'epics/EPIC-001/STAGE-001-003.md': '# Third\n\n## Status\nNot Started\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });

    expect(result.epics[0].dependencies_inferred).toBe(2);
    expect(result.total_dependencies_inferred).toBe(2);

    // Verify stage 2 depends on stage 1
    const stage2File = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md');
    const { data: stage2 } = matter(fs.readFileSync(stage2File, 'utf-8'));
    expect(stage2.depends_on).toEqual(['STAGE-001-001-001']);

    // Verify stage 3 depends on stage 2
    const stage3File = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-003.md');
    const { data: stage3 } = matter(fs.readFileSync(stage3File, 'utf-8'));
    expect(stage3.depends_on).toEqual(['STAGE-001-001-002']);
  });

  it('first stage has empty depends_on', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# First\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const stageFile = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md');
    const { data } = matter(fs.readFileSync(stageFile, 'utf-8'));
    expect(data.depends_on).toEqual([]);
  });

  it('dry run does not modify files', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Auth API\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: true });

    expect(result.migrated).toBe(true);
    expect(result.dry_run).toBe(true);
    expect(result.total_stages_migrated).toBe(2);

    // Old files should still exist
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-002.md'))).toBe(true);

    // Ticket directory should NOT exist
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001'))).toBe(false);
  });

  it('migrates multiple epics', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Register\n',
      'epics/EPIC-002/STAGE-002-001.md': '# Cart\n',
      'epics/EPIC-002/STAGE-002-002.md': '# Checkout\n',
      'epics/EPIC-002/STAGE-002-003.md': '# Payment\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });

    expect(result.epics).toHaveLength(2);
    expect(result.total_stages_migrated).toBe(5);
    expect(result.total_tickets_created).toBe(2);
    // EPIC-001: 1 dep (002 -> 001), EPIC-002: 2 deps (002 -> 001, 003 -> 002)
    expect(result.total_dependencies_inferred).toBe(3);
  });

  it('preserves body content from old stage files', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Overview\n\nBuild the login form with validation.\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const stageFile = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md');
    const content = fs.readFileSync(stageFile, 'utf-8');
    expect(content).toContain('Build the login form with validation.');
  });

  it('preserves existing epic file body when updating', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/EPIC-001.md': '# User Authentication\n\nImplement a complete auth system.\n',
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const epicFile = path.join(TEST_DIR, 'epics/EPIC-001/EPIC-001.md');
    const { data, content } = matter(fs.readFileSync(epicFile, 'utf-8'));
    expect(data.id).toBe('EPIC-001');
    expect(data.title).toBe('User Authentication');
    expect(content).toContain('Implement a complete auth system.');
  });

  it('returns migrated: false when no old-format epics found', () => {
    fs.mkdirSync(path.join(TEST_DIR, 'epics'), { recursive: true });
    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });
    expect(result.migrated).toBe(false);
    expect(result.epics).toHaveLength(0);
  });

  it('returns migrated: false when epics dir does not exist', () => {
    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });
    expect(result.migrated).toBe(false);
  });

  it('adds warning when a stage has unknown status value', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Stage\n\n## Status\nWeirdStatus\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });
    expect(result.warnings.some((w) => w.includes('WeirdStatus'))).toBe(true);
  });
});
```

**Step 2: Write the migration engine implementation**

Create `tools/kanban-cli/src/cli/logic/migrate.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectOldFormatEpics } from '../../migration/detector.js';
import { mapIds, mapStageId, buildTicketId } from '../../migration/id-mapper.js';
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
```

---

### Task 6: Write Migrate CLI Command

**Files:**
- Create: `tools/kanban-cli/src/cli/commands/migrate.ts`

**Step 1: Write the command wrapper**

Create `tools/kanban-cli/src/cli/commands/migrate.ts`:

```typescript
import { Command } from 'commander';
import * as path from 'node:path';
import { runMigration } from '../logic/migrate.js';
import { writeOutput } from '../utils/output.js';

export const migrateCommand = new Command('migrate')
  .description('Migrate old-format repos to new format (non-interactive)')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--dry-run', 'Show what would happen without making changes', false)
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (options) => {
    try {
      const repoPath = path.resolve(options.repo);

      const result = runMigration({
        repoPath,
        dryRun: options.dryRun,
      });

      const indent = options.pretty ? 2 : undefined;
      const output = JSON.stringify(result, null, indent) + '\n';
      writeOutput(output, options.output);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
```

No tests needed for the thin CLI wrapper (matches existing pattern -- tests exercise the logic module).

---

### Task 7: Register Migrate Command

**Files:**
- Modify: `tools/kanban-cli/src/cli/index.ts`

**Step 1: Add the import and registration**

Add to the import section of `tools/kanban-cli/src/cli/index.ts` (after the existing imports):

```typescript
import { migrateCommand } from './commands/migrate.js';
```

Add to the command registration section (after the existing `program.addCommand` calls):

```typescript
program.addCommand(migrateCommand);
```

The full file after modification should be:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { validatePipelineCommand } from './commands/validate-pipeline.js';
import { boardCommand } from './commands/board.js';
import { graphCommand } from './commands/graph.js';
import { nextCommand } from './commands/next.js';
import { validateCommand } from './commands/validate.js';
import { syncCommand } from './commands/sync.js';
import { migrateCommand } from './commands/migrate.js';

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
program.addCommand(migrateCommand);

program.parse();
```

---

### Task 8: Integration Test with Old-Format Fixture

**Files:**
- Create: `tools/kanban-cli/tests/migration/integration.test.ts`

**Step 1: Write the integration test**

This test creates a realistic old-format repo fixture and runs the full migration pipeline, then verifies the result can be parsed by the existing `discoverWorkItems` and frontmatter parsers.

Create `tools/kanban-cli/tests/migration/integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { runMigration } from '../../../src/cli/logic/migrate.js';
import { isOldFormatRepo } from '../../../src/migration/detector.js';
import { discoverWorkItems } from '../../../src/parser/discovery.js';
import {
  parseEpicFrontmatter,
  parseTicketFrontmatter,
  parseStageFrontmatter,
} from '../../../src/parser/frontmatter.js';

const TEST_DIR = '/tmp/kanban-migrate-integration-test';

function seedOldFormatRepo(): void {
  const structure: Record<string, string> = {
    // EPIC-001: User Authentication (3 stages)
    'epics/EPIC-001/EPIC-001.md': [
      '# User Authentication',
      '',
      'Implement a complete user authentication system.',
    ].join('\n'),
    'epics/EPIC-001/STAGE-001-001.md': [
      '# Login Form UI',
      '',
      '## Status',
      'Complete',
      '',
      '## Overview',
      '',
      'Create the login form component with email/password fields.',
    ].join('\n'),
    'epics/EPIC-001/STAGE-001-002.md': [
      '# Auth API Endpoints',
      '',
      '## Status',
      'In Progress',
      '',
      '## Overview',
      '',
      'Implement /api/auth/login and /api/auth/logout REST endpoints.',
    ].join('\n'),
    'epics/EPIC-001/STAGE-001-003.md': [
      '# Session Management',
      '',
      '## Status',
      'Not Started',
      '',
      '## Overview',
      '',
      'Implement server-side session storage.',
    ].join('\n'),

    // EPIC-002: Payment System (2 stages, no epic file)
    'epics/EPIC-002/STAGE-002-001.md': [
      '# Cart Summary',
      '',
      '## Status',
      'Complete',
      '',
      '## Overview',
      '',
      'Build the cart summary page.',
    ].join('\n'),
    'epics/EPIC-002/STAGE-002-002.md': [
      '# Checkout Flow',
      '',
      '## Status',
      'Not Started',
      '',
      '## Overview',
      '',
      'Build the checkout flow.',
    ].join('\n'),
  };

  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = path.join(TEST_DIR, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe('migration integration', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('repo is detected as old format before migration', () => {
    seedOldFormatRepo();
    expect(isOldFormatRepo(TEST_DIR)).toBe(true);
  });

  it('repo is no longer detected as old format after migration', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });
    expect(isOldFormatRepo(TEST_DIR)).toBe(false);
  });

  it('migrated files can be discovered by discoverWorkItems', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const discovered = discoverWorkItems(TEST_DIR);
    const epics = discovered.filter((d) => d.type === 'epic');
    const tickets = discovered.filter((d) => d.type === 'ticket');
    const stages = discovered.filter((d) => d.type === 'stage');

    expect(epics.length).toBe(2);
    expect(tickets.length).toBe(2);
    expect(stages.length).toBe(5);
  });

  it('migrated epic files can be parsed by parseEpicFrontmatter', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const epicFile = path.join(TEST_DIR, 'epics/EPIC-001/EPIC-001.md');
    const content = fs.readFileSync(epicFile, 'utf-8');
    const epic = parseEpicFrontmatter(content, epicFile);

    expect(epic.id).toBe('EPIC-001');
    expect(epic.title).toBe('User Authentication');
    expect(epic.tickets).toContain('TICKET-001-001');
    expect(epic.depends_on).toEqual([]);
  });

  it('migrated ticket files can be parsed by parseTicketFrontmatter', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const ticketFile = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md');
    const content = fs.readFileSync(ticketFile, 'utf-8');
    const ticket = parseTicketFrontmatter(content, ticketFile);

    expect(ticket.id).toBe('TICKET-001-001');
    expect(ticket.epic).toBe('EPIC-001');
    expect(ticket.stages).toHaveLength(3);
    expect(ticket.source).toBe('local');
  });

  it('migrated stage files can be parsed by parseStageFrontmatter', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const stageFile = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md');
    const content = fs.readFileSync(stageFile, 'utf-8');
    const stage = parseStageFrontmatter(content, stageFile);

    expect(stage.id).toBe('STAGE-001-001-002');
    expect(stage.ticket).toBe('TICKET-001-001');
    expect(stage.epic).toBe('EPIC-001');
    expect(stage.title).toBe('Auth API Endpoints');
    expect(stage.status).toBe('In Progress');
    expect(stage.session_active).toBe(false);
    expect(stage.depends_on).toEqual(['STAGE-001-001-001']);
  });

  it('full migration produces correct summary', () => {
    seedOldFormatRepo();
    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });

    expect(result.migrated).toBe(true);
    expect(result.dry_run).toBe(false);
    expect(result.epics).toHaveLength(2);
    expect(result.total_epics_migrated).toBeUndefined; // field doesn't exist - just total_stages/tickets
    expect(result.total_stages_migrated).toBe(5);
    expect(result.total_tickets_created).toBe(2);
    // EPIC-001: 2 deps (002->001, 003->002), EPIC-002: 1 dep (002->001)
    expect(result.total_dependencies_inferred).toBe(3);
    expect(result.warnings).toHaveLength(0);
  });

  it('directory structure matches new format convention', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    // EPIC-001
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/EPIC-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-003.md'))).toBe(true);

    // EPIC-002
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/EPIC-002.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/TICKET-002-001/TICKET-002-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/TICKET-002-001/STAGE-002-001-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/TICKET-002-001/STAGE-002-001-002.md'))).toBe(true);

    // Old files should be gone
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-001.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-002.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-003.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/STAGE-002-001.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/STAGE-002-002.md'))).toBe(false);
  });
});
```

---

## Edge Cases to Handle

- **No epics directory**: Return `migrated: false` with empty results
- **Empty epics directory**: Return `migrated: false` with empty results
- **Mixed old and new format**: Only migrate epic directories that are old format (have stage files directly, no ticket subdirs). Skip already-migrated epics.
- **Epic file already exists**: Preserve its body content, update with YAML frontmatter
- **No epic file exists**: Create one with title derived from directory name
- **Stage file with no `# ` header**: Use the old ID as the title
- **Stage file with no `## Status` section**: Default to "Not Started"
- **Unknown status values**: Preserve as-is but add a warning to the output
- **Single stage in an epic**: No dependencies inferred (first stage always has empty depends_on)
- **Dry run mode**: Compute everything but do not write, move, or delete any files

## Verification

- [ ] All existing tests still pass (`npm run test` in `tools/kanban-cli`)
- [ ] Type check passes (`npm run lint` in `tools/kanban-cli`)
- [ ] New tests pass: `detector.test.ts`, `id-mapper.test.ts`, `frontmatter-generator.test.ts`, `migrate.test.ts`, `integration.test.ts`
- [ ] `npx tsx src/cli/index.ts migrate --help` shows the command with all options
- [ ] Dry-run produces correct JSON without modifying files
- [ ] After migration, `discoverWorkItems` finds all new-format files
- [ ] After migration, existing parsers (`parseEpicFrontmatter`, `parseTicketFrontmatter`, `parseStageFrontmatter`) can parse all migrated files

---

## Summary Table

| Task | File(s) | Action | Tests |
|------|---------|--------|-------|
| 1. Migration types | `src/migration/types.ts` | Create | None (types only) |
| 2. Old-format detector | `src/migration/detector.ts` | Create | `tests/migration/detector.test.ts` (8 tests) |
| 3. ID mapper | `src/migration/id-mapper.ts` | Create | `tests/migration/id-mapper.test.ts` (6 tests) |
| 4. Frontmatter generator | `src/migration/frontmatter-generator.ts` | Create | `tests/migration/frontmatter-generator.test.ts` (7 tests) |
| 5. Migration engine | `src/cli/logic/migrate.ts` | Create | `tests/cli/logic/migrate.test.ts` (11 tests) |
| 6. Migrate CLI command | `src/cli/commands/migrate.ts` | Create | None (thin wrapper) |
| 7. Register command | `src/cli/index.ts` | Modify | None |
| 8. Integration test | `tests/migration/integration.test.ts` | Create | (7 tests) |

**Total new files:** 8 source + 5 test = 13 files
**Total modified files:** 1 (`index.ts`)
**Estimated new tests:** ~39 tests
