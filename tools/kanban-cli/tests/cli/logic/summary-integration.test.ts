import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_DIR = '/tmp/kanban-summary-test-repo';
const PROJECT_DIR = path.resolve(__dirname, '../../..');
const HARNESS_PATH = path.join(PROJECT_DIR, '_summary-test-harness.ts');

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

/**
 * Create a test harness script that uses the summary command with a mock executor.
 * Placed inside the project directory so node_modules can be resolved.
 */
function createTestHarness(): void {
  fs.writeFileSync(
    HARNESS_PATH,
    `import { Command } from 'commander';
import { createSummaryCommand } from './src/cli/commands/summary.js';
import type { ClaudeExecutor } from './src/utils/claude-executor.js';

const mockExecutor: ClaudeExecutor = {
  execute(prompt: string, model: string): string {
    if (prompt.includes('STAGE-')) return 'Mock stage summary for ' + model;
    if (prompt.includes('Ticket:')) return 'Mock ticket summary for ' + model;
    if (prompt.includes('Epic:')) return 'Mock epic summary for ' + model;
    return 'Mock summary for ' + model;
  },
};

const program = new Command();
program.addCommand(
  createSummaryCommand({ executorFactory: () => mockExecutor })
);
program.parse();
`,
  );
}

describe('summary command integration', () => {
  beforeAll(() => {
    seedTestRepo();
    createTestHarness();
  });

  afterAll(() => {
    if (fs.existsSync(REPO_DIR)) {
      fs.rmSync(REPO_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(HARNESS_PATH)) {
      fs.unlinkSync(HARNESS_PATH);
    }
  });

  function runSummaryCommand(args: string): string {
    return execSync(
      `npx tsx ${HARNESS_PATH} summary ${args}`,
      { encoding: 'utf-8', cwd: PROJECT_DIR },
    );
  }

  it('summarizes a single stage by ID', () => {
    const output = runSummaryCommand(`STAGE-001-001-001 --repo ${REPO_DIR}`);
    const result = JSON.parse(output);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('STAGE-001-001-001');
    expect(result.items[0].type).toBe('stage');
    expect(result.items[0].title).toBe('Login Form UI');
    expect(result.items[0].summary).toContain('Mock stage summary');
    expect(result.items[0]).toHaveProperty('cached');
  });

  it('summarizes a ticket with its stages', () => {
    const output = runSummaryCommand(`TICKET-001-001 --repo ${REPO_DIR}`);
    const result = JSON.parse(output);
    // 2 stages + 1 ticket = 3 items
    expect(result.items).toHaveLength(3);
    const types = result.items.map((i: any) => i.type);
    expect(types.filter((t: string) => t === 'stage')).toHaveLength(2);
    expect(types.filter((t: string) => t === 'ticket')).toHaveLength(1);
  });

  it('summarizes an entire epic hierarchy', () => {
    const output = runSummaryCommand(`EPIC-001 --repo ${REPO_DIR}`);
    const result = JSON.parse(output);
    // 3 stages + 2 tickets + 1 epic = 6 items
    expect(result.items).toHaveLength(6);
    const types = result.items.map((i: any) => i.type);
    expect(types.filter((t: string) => t === 'stage')).toHaveLength(3);
    expect(types.filter((t: string) => t === 'ticket')).toHaveLength(2);
    expect(types.filter((t: string) => t === 'epic')).toHaveLength(1);
  });

  it('summarizes multiple IDs in one call', () => {
    const output = runSummaryCommand(`STAGE-001-001-001 STAGE-001-002-001 --repo ${REPO_DIR}`);
    const result = JSON.parse(output);
    expect(result.items).toHaveLength(2);
    const ids = result.items.map((i: any) => i.id);
    expect(ids).toContain('STAGE-001-001-001');
    expect(ids).toContain('STAGE-001-002-001');
  });

  it('supports --pretty flag', () => {
    const output = runSummaryCommand(`STAGE-001-001-001 --repo ${REPO_DIR} --pretty`);
    // Pretty output has newlines and indentation
    expect(output).toContain('\n  ');
    const result = JSON.parse(output);
    expect(result.items).toHaveLength(1);
  });

  it('supports -o/--output flag', () => {
    const outputFile = '/tmp/kanban-summary-test-output.json';
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

    runSummaryCommand(`STAGE-001-001-001 --repo ${REPO_DIR} -o ${outputFile}`);
    expect(fs.existsSync(outputFile)).toBe(true);
    const content = fs.readFileSync(outputFile, 'utf-8');
    const result = JSON.parse(content);
    expect(result.items).toHaveLength(1);

    fs.unlinkSync(outputFile);
  });

  it('supports --model flag', () => {
    const output = runSummaryCommand(`STAGE-001-001-001 --repo ${REPO_DIR} --model sonnet`);
    const result = JSON.parse(output);
    expect(result.items[0].summary).toContain('sonnet');
  });

  it('output uses new format with summary and type fields', () => {
    const output = runSummaryCommand(`STAGE-001-001-001 --repo ${REPO_DIR}`);
    const result = JSON.parse(output);
    const item = result.items[0];

    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('type');
    expect(item).toHaveProperty('title');
    expect(item).toHaveProperty('summary');
    expect(item).toHaveProperty('cached');

    // Old format fields should NOT be present
    expect(item).not.toHaveProperty('design_decision');
    expect(item).not.toHaveProperty('what_was_built');
    expect(item).not.toHaveProperty('issues_encountered');
    expect(item).not.toHaveProperty('commit_hash');
    expect(item).not.toHaveProperty('mr_pr_url');
    expect(item).not.toHaveProperty('status');
  });
});
