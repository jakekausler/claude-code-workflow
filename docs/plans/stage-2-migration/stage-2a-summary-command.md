# Stage 2A: Summary Command

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `kanban-cli summary` command that extracts human-readable summaries from stage tracking files.

**Status:** Not Started

**Prerequisites:** Stage 1 complete (all 290 tests passing)

**Architecture:** The summary command follows the existing two-file pattern (command + logic) used by `board`, `next`, and `validate`. The command file (`src/cli/commands/summary.ts`) handles CLI parsing, DB sync, and data mapping. The logic file (`src/cli/logic/summary.ts`) is a pure function that takes structured input and returns structured output, making it easy to test in isolation. Unlike `board`/`next` which only read from SQLite, the summary command reads the *markdown body* of stage files (via `gray-matter`) to extract section content like design decisions, build notes, and commit hashes. New types are defined in the logic file following the established pattern where each logic file defines its own input/output interfaces.

**Tech Stack:** TypeScript, Commander.js, gray-matter, Vitest

---

### Task 1: Write the summary logic with markdown body parser

**Files:**
- Create: `tools/kanban-cli/src/cli/logic/summary.ts`
- Test: `tools/kanban-cli/tests/cli/logic/summary.test.ts`

**Step 1: Write the failing test**

Create `tools/kanban-cli/tests/cli/logic/summary.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSummary, parseStageBody } from '../../../src/cli/logic/summary.js';
import type { SummaryStageInput } from '../../../src/cli/logic/summary.js';

// ---------- parseStageBody tests ----------

describe('parseStageBody', () => {
  it('extracts design_decision from Design Phase section', () => {
    const body = `## Overview
Some overview text.

## Design Phase
- **Approaches Presented**: React Hook Form vs Formik
- **User Choice**: React Hook Form with Zod validation
- **Seed Data Agreed**: Yes
- **Session Notes**: Discussed tradeoffs
**Status**: [x] Complete

## Build Phase
- **Components Created**: LoginModal, LoginForm
**Status**: [ ] Complete
`;
    const result = parseStageBody(body);
    expect(result.design_decision).toBe('React Hook Form with Zod validation');
  });

  it('extracts what_was_built from Build Phase section', () => {
    const body = `## Overview
Some overview text.

## Build Phase
- **Components Created**: LoginModal, LoginForm, AuthContext
- **API Endpoints Added**: /api/auth/login, /api/auth/logout
- **Placeholders Added**: None
- **Session Notes**: Implemented form with validation
**Status**: [x] Complete
`;
    const result = parseStageBody(body);
    expect(result.what_was_built).toContain('LoginModal');
    expect(result.what_was_built).toContain('/api/auth/login');
  });

  it('extracts commit_hash from Finalize Phase section', () => {
    const body = `## Finalize Phase
- [x] Code Review (pre-tests)
- [x] Tests Written (unit, integration, e2e)
- [x] Committed
**Commit Hash**: abc1234
**MR/PR URL**: https://github.com/org/repo/pull/42
**Status**: [x] Complete
`;
    const result = parseStageBody(body);
    expect(result.commit_hash).toBe('abc1234');
    expect(result.mr_pr_url).toBe('https://github.com/org/repo/pull/42');
  });

  it('extracts issues_encountered from Session Notes', () => {
    const body = `## Build Phase
- **Components Created**: LoginModal
- **Session Notes**: Encountered a session token refresh race condition in concurrent requests. Fixed by adding mutex lock.
**Status**: [x] Complete
`;
    const result = parseStageBody(body);
    expect(result.issues_encountered).toContain('session token refresh race condition');
  });

  it('returns null fields when sections are missing', () => {
    const body = `## Overview
Just an overview, no phase sections filled in yet.
`;
    const result = parseStageBody(body);
    expect(result.design_decision).toBeNull();
    expect(result.what_was_built).toBeNull();
    expect(result.issues_encountered).toBeNull();
    expect(result.commit_hash).toBeNull();
    expect(result.mr_pr_url).toBeNull();
  });

  it('returns null for empty field values', () => {
    const body = `## Design Phase
- **User Choice**:
**Status**: [ ] Complete

## Finalize Phase
**Commit Hash**:
**MR/PR URL**:
**Status**: [ ] Complete
`;
    const result = parseStageBody(body);
    expect(result.design_decision).toBeNull();
    expect(result.commit_hash).toBeNull();
    expect(result.mr_pr_url).toBeNull();
  });
});

// ---------- buildSummary tests ----------

function makeStageInput(overrides: Partial<SummaryStageInput> = {}): SummaryStageInput {
  return {
    id: 'STAGE-001-001-001',
    title: 'Login Form UI',
    status: 'Complete',
    file_content: `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form UI
status: Complete
session_active: false
refinement_type:
  - frontend
depends_on: []
priority: 0
---
## Overview
Create the login form.

## Design Phase
- **User Choice**: React Hook Form with Zod validation
**Status**: [x] Complete

## Build Phase
- **Components Created**: LoginModal, LoginForm
- **API Endpoints Added**: /api/auth/login
- **Session Notes**: Built form with validation
**Status**: [x] Complete

## Finalize Phase
- [x] Committed
**Commit Hash**: abc1234
**MR/PR URL**:
**Status**: [x] Complete
`,
    ...overrides,
  };
}

describe('buildSummary', () => {
  it('returns a SummaryOutput with items for each stage', () => {
    const result = buildSummary({
      stages: [makeStageInput()],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('STAGE-001-001-001');
    expect(result.items[0].title).toBe('Login Form UI');
    expect(result.items[0].status).toBe('Complete');
    expect(result.items[0].design_decision).toBe('React Hook Form with Zod validation');
    expect(result.items[0].what_was_built).toContain('LoginModal');
    expect(result.items[0].commit_hash).toBe('abc1234');
    expect(result.items[0].mr_pr_url).toBeNull();
  });

  it('handles multiple stages', () => {
    const result = buildSummary({
      stages: [
        makeStageInput({ id: 'STAGE-001-001-001', title: 'Stage A' }),
        makeStageInput({ id: 'STAGE-001-001-002', title: 'Stage B' }),
      ],
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('STAGE-001-001-001');
    expect(result.items[1].id).toBe('STAGE-001-001-002');
  });

  it('handles empty stages array', () => {
    const result = buildSummary({ stages: [] });
    expect(result.items).toHaveLength(0);
  });

  it('handles stage with no markdown body (frontmatter only)', () => {
    const result = buildSummary({
      stages: [
        makeStageInput({
          file_content: `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form UI
status: Not Started
session_active: false
refinement_type: []
depends_on: []
priority: 0
---
`,
        }),
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].design_decision).toBeNull();
    expect(result.items[0].what_was_built).toBeNull();
    expect(result.items[0].commit_hash).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx vitest run tests/cli/logic/summary.test.ts`

Expected: FAIL because `src/cli/logic/summary.ts` does not exist yet.

**Step 3: Write minimal implementation**

Create `tools/kanban-cli/src/cli/logic/summary.ts`:

```typescript
import matter from 'gray-matter';

// ---------- Input data shapes ----------

export interface SummaryStageInput {
  id: string;
  title: string;
  status: string;
  file_content: string;
}

export interface BuildSummaryInput {
  stages: SummaryStageInput[];
}

// ---------- Output types ----------

export interface SummaryItem {
  id: string;
  title: string;
  status: string;
  design_decision: string | null;
  what_was_built: string | null;
  issues_encountered: string | null;
  commit_hash: string | null;
  mr_pr_url: string | null;
}

export interface SummaryOutput {
  items: SummaryItem[];
}

// ---------- Markdown body parser ----------

export interface ParsedStageBody {
  design_decision: string | null;
  what_was_built: string | null;
  issues_encountered: string | null;
  commit_hash: string | null;
  mr_pr_url: string | null;
}

/**
 * Split markdown body into sections by ## headings.
 * Returns a map of section name (lowercase) -> section content.
 */
function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split('\n');
  let currentSection = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = line.match(/^## (.+)/);
    if (match) {
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n').trim());
      }
      currentSection = match[1].trim().toLowerCase();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n').trim());
  }

  return sections;
}

/**
 * Extract a field value from a markdown section.
 * Looks for patterns like "- **Field Name**: value" or "**Field Name**: value".
 * Returns null if not found or if value is empty.
 */
function extractField(sectionContent: string, fieldName: string): string | null {
  const patterns = [
    new RegExp(`^-?\\s*\\*\\*${fieldName}\\*\\*:\\s*(.+)$`, 'mi'),
    new RegExp(`^\\*\\*${fieldName}\\*\\*:\\s*(.+)$`, 'mi'),
  ];

  for (const pattern of patterns) {
    const match = sectionContent.match(pattern);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract a multi-line value by collecting labeled bullet points from a section.
 * Collects content from fields like "Components Created", "API Endpoints Added", etc.
 */
function extractBuildSummary(sectionContent: string): string | null {
  const fields = ['Components Created', 'API Endpoints Added'];
  const parts: string[] = [];

  for (const field of fields) {
    const value = extractField(sectionContent, field);
    if (value) {
      parts.push(value);
    }
  }

  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * Parse the markdown body of a stage file to extract summary fields.
 */
export function parseStageBody(body: string): ParsedStageBody {
  const sections = splitSections(body);

  // Design decision from "User Choice" in Design Phase
  const designSection = sections.get('design phase') ?? '';
  const designDecision = extractField(designSection, 'User Choice');

  // What was built from Build Phase
  const buildSection = sections.get('build phase') ?? '';
  const whatWasBuilt = extractBuildSummary(buildSection);

  // Issues encountered from Session Notes in Build Phase
  const issuesEncountered = extractField(buildSection, 'Session Notes');

  // Commit hash and MR/PR URL from Finalize Phase
  const finalizeSection = sections.get('finalize phase') ?? '';
  const commitHash = extractField(finalizeSection, 'Commit Hash');
  const mrPrUrl = extractField(finalizeSection, 'MR/PR URL');

  return {
    design_decision: designDecision,
    what_was_built: whatWasBuilt,
    issues_encountered: issuesEncountered,
    commit_hash: commitHash,
    mr_pr_url: mrPrUrl,
  };
}

// ---------- Core logic ----------

export function buildSummary(input: BuildSummaryInput): SummaryOutput {
  const items: SummaryItem[] = input.stages.map((stage) => {
    const { content: body } = matter(stage.file_content);
    const parsed = parseStageBody(body);

    return {
      id: stage.id,
      title: stage.title,
      status: stage.status,
      design_decision: parsed.design_decision,
      what_was_built: parsed.what_was_built,
      issues_encountered: parsed.issues_encountered,
      commit_hash: parsed.commit_hash,
      mr_pr_url: parsed.mr_pr_url,
    };
  });

  return { items };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx vitest run tests/cli/logic/summary.test.ts`

Expected: PASS - all tests green.

**Step 5: Commit**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/cli/logic/summary.ts tests/cli/logic/summary.test.ts
git commit -m "feat(kanban-cli): add summary logic with markdown body parser

Implements buildSummary() and parseStageBody() for extracting
human-readable summaries from stage tracking file markdown bodies.
Parses Design Phase, Build Phase, and Finalize Phase sections.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Write the summary command

**Files:**
- Create: `tools/kanban-cli/src/cli/commands/summary.ts`

**Step 1: Write the failing test**

No separate test for the command file. The command file is a thin CLI wrapper; logic is tested in Task 1. Integration is tested in Task 4.

**Step 2: (Skip - no test for this file)**

**Step 3: Write minimal implementation**

Create `tools/kanban-cli/src/cli/commands/summary.ts`:

```typescript
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../../config/loader.js';
import { KanbanDatabase } from '../../db/database.js';
import { RepoRepository } from '../../db/repositories/repo-repository.js';
import { EpicRepository } from '../../db/repositories/epic-repository.js';
import { TicketRepository } from '../../db/repositories/ticket-repository.js';
import { StageRepository } from '../../db/repositories/stage-repository.js';
import { syncRepo } from '../../sync/sync.js';
import { buildSummary } from '../logic/summary.js';
import type { SummaryStageInput } from '../logic/summary.js';
import { writeOutput } from '../utils/output.js';

/**
 * Determine the type of a work item ID by its prefix.
 */
function getIdType(id: string): 'epic' | 'ticket' | 'stage' | 'unknown' {
  if (id.startsWith('STAGE-')) return 'stage';
  if (id.startsWith('TICKET-')) return 'ticket';
  if (id.startsWith('EPIC-')) return 'epic';
  return 'unknown';
}

export const summaryCommand = new Command('summary')
  .description('Summarize what happened for stages, tickets, or epics')
  .argument('<ids...>', 'One or more IDs (STAGE-*, TICKET-*, EPIC-*)')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (ids: string[], options) => {
    try {
      const repoPath = path.resolve(options.repo);
      const config = loadConfig({ repoPath });
      const db = new KanbanDatabase();

      // Ensure data is fresh
      syncRepo({ repoPath, db, config });

      // Get the repo ID
      const repoRepo = new RepoRepository(db);
      const repo = repoRepo.findByPath(repoPath);
      if (!repo) {
        process.stderr.write('Error: Repository not found after sync\n');
        process.exit(2);
        return;
      }
      const repoId = repo.id;

      const epicRepo = new EpicRepository(db);
      const ticketRepo = new TicketRepository(db);
      const stageRepo = new StageRepository(db);

      // Resolve all IDs to stage rows
      const stageIds = new Set<string>();

      for (const id of ids) {
        const idType = getIdType(id);

        switch (idType) {
          case 'stage': {
            stageIds.add(id);
            break;
          }
          case 'ticket': {
            // Get all stages for this ticket
            const ticketStages = stageRepo.listByTicket(id);
            for (const s of ticketStages) {
              stageIds.add(s.id);
            }
            break;
          }
          case 'epic': {
            // Get all tickets for this epic, then all stages for each ticket
            const epicTickets = ticketRepo.listByEpic(id);
            for (const t of epicTickets) {
              const ticketStages = stageRepo.listByTicket(t.id);
              for (const s of ticketStages) {
                stageIds.add(s.id);
              }
            }
            break;
          }
          default: {
            process.stderr.write(`Warning: Unknown ID format "${id}" — skipping\n`);
          }
        }
      }

      // Build stage inputs by reading file content
      const stages: SummaryStageInput[] = [];

      for (const stageId of stageIds) {
        const stageRow = stageRepo.findById(stageId);
        if (!stageRow) {
          process.stderr.write(`Warning: Stage ${stageId} not found in database — skipping\n`);
          continue;
        }

        // Read the actual file content for markdown body parsing
        const filePath = path.isAbsolute(stageRow.file_path)
          ? stageRow.file_path
          : path.join(repoPath, stageRow.file_path);

        let fileContent: string;
        try {
          fileContent = fs.readFileSync(filePath, 'utf-8');
        } catch {
          process.stderr.write(`Warning: Cannot read file ${filePath} for ${stageId} — skipping\n`);
          continue;
        }

        stages.push({
          id: stageRow.id,
          title: stageRow.title ?? '',
          status: stageRow.status ?? 'Not Started',
          file_content: fileContent,
        });
      }

      const result = buildSummary({ stages });

      const indent = options.pretty ? 2 : undefined;
      const output = JSON.stringify(result, null, indent) + '\n';
      writeOutput(output, options.output);
      db.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(2);
    }
  });
```

**Step 4: Verify it compiles**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx tsc --noEmit`

Expected: PASS - no type errors.

**Step 5: Commit**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/cli/commands/summary.ts
git commit -m "feat(kanban-cli): add summary CLI command wrapper

Thin Commander.js wrapper that resolves EPIC/TICKET/STAGE IDs
to stage files, reads their markdown bodies, and delegates to
buildSummary() logic. Supports --repo, --pretty, -o/--output.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Register the summary command

**Files:**
- Modify: `tools/kanban-cli/src/cli/index.ts`

**Step 1: Write the failing test**

No separate test needed. Registration correctness is verified by the integration test in Task 4.

**Step 2: (Skip)**

**Step 3: Write minimal implementation**

Modify `tools/kanban-cli/src/cli/index.ts`. Add two lines:

1. Add import after the existing imports:

```typescript
import { summaryCommand } from './commands/summary.js';
```

2. Add registration after the existing `program.addCommand(syncCommand);` line:

```typescript
program.addCommand(summaryCommand);
```

The full file should look like:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { validatePipelineCommand } from './commands/validate-pipeline.js';
import { boardCommand } from './commands/board.js';
import { graphCommand } from './commands/graph.js';
import { nextCommand } from './commands/next.js';
import { validateCommand } from './commands/validate.js';
import { syncCommand } from './commands/sync.js';
import { summaryCommand } from './commands/summary.js';

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

program.parse();
```

**Step 4: Verify it compiles**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx tsc --noEmit`

Expected: PASS - no type errors.

**Step 5: Commit**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add src/cli/index.ts
git commit -m "feat(kanban-cli): register summary command in CLI entrypoint

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Integration test with seed repo

**Files:**
- Test: `tools/kanban-cli/tests/cli/logic/summary-integration.test.ts`

**Step 1: Write the failing test**

Create `tools/kanban-cli/tests/cli/logic/summary-integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_DIR = '/tmp/kanban-summary-test-repo';
const CLI_PATH = path.resolve(__dirname, '../../../src/cli/index.ts');

/**
 * Create a minimal test repo with known stage file content for summary testing.
 */
function seedTestRepo(): void {
  if (fs.existsSync(REPO_DIR)) {
    fs.rmSync(REPO_DIR, { recursive: true, force: true });
  }

  fs.mkdirSync(path.join(REPO_DIR, 'epics/EPIC-001/TICKET-001-001'), { recursive: true });
  fs.mkdirSync(path.join(REPO_DIR, 'epics/EPIC-001/TICKET-001-002'), { recursive: true });

  // Initialize git repo
  execSync('git init -q && git commit -q --allow-empty -m "init"', { cwd: REPO_DIR });

  // Epic
  fs.writeFileSync(
    path.join(REPO_DIR, 'epics/EPIC-001/EPIC-001.md'),
    `---
id: EPIC-001
title: User Authentication
status: In Progress
tickets:
  - TICKET-001-001
  - TICKET-001-002
depends_on: []
---
## Overview
Authentication system.
`,
  );

  // Ticket
  fs.writeFileSync(
    path.join(REPO_DIR, 'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'),
    `---
id: TICKET-001-001
epic: EPIC-001
title: Login Flow
status: In Progress
source: local
stages:
  - STAGE-001-001-001
  - STAGE-001-001-002
depends_on: []
---
## Overview
Login flow implementation.
`,
  );

  // Stage with full content
  fs.writeFileSync(
    path.join(REPO_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'),
    `---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form UI
status: Complete
session_active: false
refinement_type:
  - frontend
depends_on: []
priority: 0
---
## Overview
Create the login form.

## Design Phase
- **Approaches Presented**: React Hook Form vs Formik vs plain HTML
- **User Choice**: React Hook Form with Zod validation
- **Seed Data Agreed**: Yes
- **Session Notes**: Discussed tradeoffs between libraries
**Status**: [x] Complete

## Build Phase
- **Components Created**: LoginModal, LoginForm, PasswordInput
- **API Endpoints Added**: /api/auth/login
- **Placeholders Added**: None
- **Session Notes**: Session token refresh race condition in concurrent requests
**Status**: [x] Complete

## Finalize Phase
- [x] Code Review (pre-tests)
- [x] Tests Written (unit, integration, e2e)
- [x] Committed
**Commit Hash**: abc1234
**MR/PR URL**:
**Status**: [x] Complete
`,
  );

  // Stage with minimal content
  fs.writeFileSync(
    path.join(REPO_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md'),
    `---
id: STAGE-001-001-002
ticket: TICKET-001-001
epic: EPIC-001
title: Auth API Endpoints
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on: []
priority: 0
---
## Overview
Implement auth API endpoints.
`,
  );

  // Second ticket with one stage
  fs.writeFileSync(
    path.join(REPO_DIR, 'epics/EPIC-001/TICKET-001-002/TICKET-001-002.md'),
    `---
id: TICKET-001-002
epic: EPIC-001
title: Registration Flow
status: Not Started
source: local
stages:
  - STAGE-001-002-001
depends_on: []
---
## Overview
Registration flow.
`,
  );

  fs.writeFileSync(
    path.join(REPO_DIR, 'epics/EPIC-001/TICKET-001-002/STAGE-001-002-001.md'),
    `---
id: STAGE-001-002-001
ticket: TICKET-001-002
epic: EPIC-001
title: Signup Form
status: Design
session_active: false
refinement_type:
  - frontend
depends_on: []
priority: 0
---
## Overview
Create the signup form.

## Design Phase
- **Approaches Presented**: Modal vs page
- **User Choice**: Full page with stepper
**Status**: [x] Complete
`,
  );
}

describe('summary command integration', () => {
  beforeAll(() => {
    seedTestRepo();
  });

  afterAll(() => {
    if (fs.existsSync(REPO_DIR)) {
      fs.rmSync(REPO_DIR, { recursive: true, force: true });
    }
  });

  it('summarizes a single stage by ID', () => {
    const output = execSync(
      `npx tsx ${CLI_PATH} summary STAGE-001-001-001 --repo ${REPO_DIR}`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../../..') },
    );
    const result = JSON.parse(output);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('STAGE-001-001-001');
    expect(result.items[0].title).toBe('Login Form UI');
    expect(result.items[0].status).toBe('Complete');
    expect(result.items[0].design_decision).toBe('React Hook Form with Zod validation');
    expect(result.items[0].what_was_built).toContain('LoginModal');
    expect(result.items[0].commit_hash).toBe('abc1234');
    expect(result.items[0].mr_pr_url).toBeNull();
  });

  it('summarizes all stages in a ticket', () => {
    const output = execSync(
      `npx tsx ${CLI_PATH} summary TICKET-001-001 --repo ${REPO_DIR}`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../../..') },
    );
    const result = JSON.parse(output);
    expect(result.items).toHaveLength(2);
    const ids = result.items.map((item: any) => item.id);
    expect(ids).toContain('STAGE-001-001-001');
    expect(ids).toContain('STAGE-001-001-002');
  });

  it('summarizes all stages in an epic', () => {
    const output = execSync(
      `npx tsx ${CLI_PATH} summary EPIC-001 --repo ${REPO_DIR}`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../../..') },
    );
    const result = JSON.parse(output);
    expect(result.items).toHaveLength(3);
    const ids = result.items.map((item: any) => item.id);
    expect(ids).toContain('STAGE-001-001-001');
    expect(ids).toContain('STAGE-001-001-002');
    expect(ids).toContain('STAGE-001-002-001');
  });

  it('summarizes multiple IDs in one call', () => {
    const output = execSync(
      `npx tsx ${CLI_PATH} summary STAGE-001-001-001 TICKET-001-002 --repo ${REPO_DIR}`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../../..') },
    );
    const result = JSON.parse(output);
    expect(result.items).toHaveLength(2);
    const ids = result.items.map((item: any) => item.id);
    expect(ids).toContain('STAGE-001-001-001');
    expect(ids).toContain('STAGE-001-002-001');
  });

  it('supports --pretty flag', () => {
    const output = execSync(
      `npx tsx ${CLI_PATH} summary STAGE-001-001-001 --repo ${REPO_DIR} --pretty`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../../..') },
    );
    // Pretty output has newlines and indentation
    expect(output).toContain('\n  ');
    const result = JSON.parse(output);
    expect(result.items).toHaveLength(1);
  });

  it('supports -o/--output flag', () => {
    const outputFile = '/tmp/kanban-summary-test-output.json';
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

    execSync(
      `npx tsx ${CLI_PATH} summary STAGE-001-001-001 --repo ${REPO_DIR} -o ${outputFile}`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../../..') },
    );
    expect(fs.existsSync(outputFile)).toBe(true);
    const content = fs.readFileSync(outputFile, 'utf-8');
    const result = JSON.parse(content);
    expect(result.items).toHaveLength(1);

    fs.unlinkSync(outputFile);
  });

  it('returns null fields for stage with no phase content', () => {
    const output = execSync(
      `npx tsx ${CLI_PATH} summary STAGE-001-001-002 --repo ${REPO_DIR}`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../../..') },
    );
    const result = JSON.parse(output);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('STAGE-001-001-002');
    expect(result.items[0].design_decision).toBeNull();
    expect(result.items[0].what_was_built).toBeNull();
    expect(result.items[0].commit_hash).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx vitest run tests/cli/logic/summary-integration.test.ts`

Expected: FAIL if Tasks 1-3 are not yet implemented. PASS if Tasks 1-3 are complete.

**Step 3: (No additional implementation needed - this test validates Tasks 1-3)**

**Step 4: Run test to verify it passes**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx vitest run tests/cli/logic/summary-integration.test.ts`

Expected: PASS - all integration tests green.

**Step 5: Commit**

```bash
cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli
git add tests/cli/logic/summary-integration.test.ts
git commit -m "test(kanban-cli): add integration tests for summary command

Tests single stage, ticket expansion, epic expansion, multiple IDs,
--pretty, -o/--output, and null fields for empty stages.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Run full test suite

**Files:** None (verification only)

**Step 1: Run full test suite to verify no regressions**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx vitest run`

Expected: All existing tests + new tests PASS. Total should be 290 (existing) + new summary tests.

**Step 2: Run type check**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx tsc --noEmit`

Expected: PASS - no type errors.

---

## Edge Cases to Handle

- **Unknown ID prefix**: The command prints a warning to stderr and skips IDs that don't start with `STAGE-`, `TICKET-`, or `EPIC-`. It does not fail.
- **Missing stage file on disk**: If a stage is in the DB but its file is missing, the command warns to stderr and skips that stage.
- **Empty markdown body**: When a stage file has only frontmatter and no body, all summary fields return `null`.
- **Empty field values**: Lines like `**Commit Hash**:` (with nothing after the colon) return `null`, not empty string.
- **Duplicate stage resolution**: Using a `Set<string>` for stage IDs prevents duplicates when e.g. `summary TICKET-001-001 STAGE-001-001-001` would otherwise include STAGE-001-001-001 twice.
- **File path resolution**: The command handles both absolute and relative `file_path` values from the DB by joining with `repoPath` when not absolute.

## Verification

- [ ] `npx vitest run tests/cli/logic/summary.test.ts` passes (unit tests for logic)
- [ ] `npx vitest run tests/cli/logic/summary-integration.test.ts` passes (integration tests)
- [ ] `npx tsc --noEmit` passes (type check)
- [ ] `npx vitest run` passes (full suite, no regressions)
- [ ] `npx tsx src/cli/index.ts summary --help` shows command help

## Task Summary

| Task | Name | Files | Tests |
|------|------|-------|-------|
| 1 | Summary logic + body parser | Create: `src/cli/logic/summary.ts` | `tests/cli/logic/summary.test.ts` (12 tests) |
| 2 | Summary CLI command | Create: `src/cli/commands/summary.ts` | (tested by Task 4) |
| 3 | Register command | Modify: `src/cli/index.ts` | (tested by Task 4) |
| 4 | Integration tests | - | `tests/cli/logic/summary-integration.test.ts` (7 tests) |
| 5 | Full suite verification | - | All tests pass, no regressions |
