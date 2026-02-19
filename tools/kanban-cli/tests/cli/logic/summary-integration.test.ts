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
