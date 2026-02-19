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
