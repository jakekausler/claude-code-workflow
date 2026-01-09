---
name: epic-stage-workflow
description: Use when implementing or working on existing epics and stages, after running /next_task, during Design/Build/Refinement/Finalize phases, or when session protocols apply.
---

# Epic/Stage Workflow - Implementation Protocol

This skill defines HOW to work through the epic/stage/phase workflow. For CREATING new projects, epics, or stages, see the `epic-stage-setup` skill.

## When to Use

- After running `/next_task` to work on an existing stage
- During any of the four phases: Design, Build, Refinement, Finalize
- When session protocols need to be followed
- When implementing features within the epic/stage structure
- User asks "what's next", "continue", or references an existing epic/stage

## When NOT to Use

- Creating a NEW project structure - use `epic-stage-setup` instead
- Creating NEW epics or stages - use `epic-stage-setup` instead
- Projects without epic/stage tracking

---

## Communication Policy (CRITICAL)

**This is a core requirement of the workflow. After EVERY subagent or tool call, you MUST explain to the user what happened.**

### The Three Things to Explain

After every subagent call or tool operation, explain:

1. **What was found** (for exploration tasks) - Key discoveries, patterns identified, relevant files found
2. **What was done** (for implementation tasks) - Files created/modified, specific changes made, why those choices
3. **The outcome** - Success/failure, verification results, any issues encountered

### Format Requirements

| Format               | When to Use                                                        |
| -------------------- | ------------------------------------------------------------------ |
| **Tables**           | Structured data (files modified, test results, options comparison) |
| **Code blocks**      | Specific changes, file snippets, commands run                      |
| **Insight callouts** | Educational context about WHY a choice was made                    |

### Example Communication

> "The subagent modified 3 files:
> | File | Change |
> |------|--------|
> | schema.prisma | Added UserPreferences model with 5 fields |
> | user.resolver.ts | Added getPreferences query |
> | user.service.ts | Added preferences CRUD methods |
>
> All type-checks pass. The model follows the existing pattern of..."

### What NOT to Do

**NEVER** respond with just:

- "Done"
- "Task completed"
- "Fixed"
- "Updated"

These responses provide no value. Always explain what was accomplished and the outcome.

---

## Phase-Specific Behavior

### Design Phase

**Goal**: Present options with mobile/desktop descriptions, get user choice, confirm seed data

| Step | Action                 | Details                                         |
| ---- | ---------------------- | ----------------------------------------------- |
| 1    | Read stage file        | Understand component/interaction scope          |
| 2    | Present 2-3 UI options | Include Desktop AND Mobile descriptions         |
| 3    | Get user choice        | Wait for explicit selection                     |
| 4    | Confirm seed data      | If needed, describe what will be added          |
| 5    | Set input form flag    | Check: `Has Input Forms: [x] Yes` if applicable |
| 6    | Record decisions       | Use doc-updater subagent                        |
| 7    | Complete               | Run `/finish_phase`                             |

**Option Presentation Format:**

```
Option N: [Name]
- Desktop: [layout/behavior]
- Mobile: [layout/behavior]
```

### Build Phase

**Goal**: Implement the chosen approach

| Step | Action                 | Details                     |
| ---- | ---------------------- | --------------------------- |
| 1    | Read design choice     | From stage file             |
| 2    | Implement UI + backend | Follow chosen approach      |
| 3    | Add seed data          | If agreed in Design phase   |
| 4    | Add placeholder stubs  | For related future features |
| 5    | Verify dev server      | Feature must be working     |
| 6    | Update tracking        | Use doc-updater subagent    |
| 7    | Complete               | Run `/finish_phase`         |

### Refinement Phase

**Goal**: Dual sign-off - iterate until BOTH desktop and mobile are approved

```
┌─────────────────────────────────────────────────────────────┐
│                    REFINEMENT FLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Desktop    │───>│    Mobile    │───>│  Regression  │  │
│  │   Testing    │    │   Testing    │    │   Checklist  │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                   │           │
│         v                   v                   v           │
│  [x] Desktop         [x] Mobile          [x] Regression    │
│      Approved            Approved            Items Added   │
│                                                             │
│  IMPORTANT: Any code change resets the OTHER view's        │
│  approval checkbox!                                         │
└─────────────────────────────────────────────────────────────┘
```

| Step | Action           | Details                                               |
| ---- | ---------------- | ----------------------------------------------------- |
| 1    | Test Desktop     | Prompt user to test on dev site                       |
| 2    | Iterate Desktop  | Collect feedback, implement changes                   |
| 3    | Mark Desktop     | `[x] Desktop Approved` when explicitly approved       |
| 4    | Test Mobile      | Prompt user to test on dev site                       |
| 5    | Iterate Mobile   | Collect feedback, implement changes                   |
| 6    | Mark Mobile      | `[x] Mobile Approved` when explicitly approved        |
| 7    | Regression items | Prompt for checklist items after both approved        |
| 8    | Add to checklist | Update `docs/REGRESSION-CHECKLIST.md` via doc-updater |
| 9    | Mark complete    | `[x] Regression Items Added`                          |
| 10   | Complete         | Run `/finish_phase` when all three checkboxes done    |

### Finalize Phase

**Goal**: Tests, review, docs, commit (ALL via subagents)

#### Subagent Execution Sequence

```
┌────────────────────────────────────────────────────────────────────┐
│                    FINALIZE PHASE SEQUENCE                         │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. code-reviewer ──────> Review code BEFORE tests                 │
│         │                                                          │
│         v                                                          │
│  2. typescript-tester ──> Write unit/integration/e2e tests         │
│         │                                                          │
│         v                                                          │
│  3. code-reviewer ──────> Review code AFTER tests                  │
│         │                                                          │
│         v                                                          │
│  4. doc-updater ────────> Update README, feature docs, CLAUDE.md   │
│         │                                                          │
│         v                                                          │
│  5. [COMMIT] ───────────> Create conventional commit               │
│         │                                                          │
│         v                                                          │
│  6. doc-updater ────────> Add CHANGELOG entry with commit hash     │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

| Step | Subagent          | Task                | Notes                                               |
| ---- | ----------------- | ------------------- | --------------------------------------------------- |
| 1    | code-reviewer     | Pre-test review     | Implement ALL suggestions                           |
| 2    | typescript-tester | Write tests         | Desktop + Mobile viewports; mobileKeyboard if forms |
| 3    | code-reviewer     | Post-test review    | Implement ALL new suggestions                       |
| 4    | doc-updater       | Update docs         | README, features, CLAUDE.md if new patterns         |
| 5    | (commit)          | Conventional commit | Detailed message                                    |
| 6    | doc-updater       | CHANGELOG entry     | Include commit hash                                 |

#### Test Requirements

- E2E tests must run at desktop + mobile viewports
- If stage has `Has Input Forms: [x] Yes`, also test mobileKeyboard viewport
- Use project's viewport definitions for consistency
- **Check existing tests for updates**: Search for references to modified components, types, or APIs
- Report and fix tests needing updates before proceeding

#### Required Document Updates at Stage Completion

| Document                                           | Required Updates                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| **STAGE file** (`epics/EPIC-XXX/STAGE-XXX-YYY.md`) | Status: "Complete", all criteria [x], all phases complete, session notes       |
| **EPIC file** (`epics/EPIC-XXX/EPIC-XXX.md`)       | Epic status updated, current stage advanced, criteria [x], stage table updated |
| **CHANGELOG.md**                                   | Entry added with commit hash after main implementation commit                  |

#### Commit Workflow

```
1. Update STAGE and EPIC files (status, criteria, notes)
        │
        v
2. Create main implementation commit
        │
        v
3. Get commit hash from main commit
        │
        v
4. Update STAGE file with hash, update CHANGELOG
        │
        v
5. Create SEPARATE tracking commit: "docs: update tracking for STAGE-XXX-YYY"
        │
        v
NOTE: Tracking commit does NOT need its own CHANGELOG entry
      NEVER amend main commit just to add changelog - use separate commit
```

---

## Code Review Policy

**ALL code review suggestions must be implemented, regardless of severity.**

| Suggestion Type                                           | Action                                             |
| --------------------------------------------------------- | -------------------------------------------------- |
| Critical issues                                           | **MUST implement**                                 |
| Minor suggestions (naming, consistency, type specificity) | **MUST implement**                                 |
| "Nice to have"                                            | **MUST implement** (= "Must have" in this project) |
| Would break functionality                                 | Skip, but document WHY in stage file               |

This policy applies to BOTH pre-test and post-test code reviews.

---

## Session Protocols

### Session Start Protocol

Every session MUST begin with:

```
1. Run /next_task
        │
        v
2. Confirm: "We're in [Phase] for [Stage] of [Epic]"
        │
        v
3. State goal: "This session's goal is to [phase-specific goal]"
        │
        v
4. Proceed or ask clarifying questions
```

### Session End Protocol

Before ending any session:

```
1. Update tracking doc (via doc-updater subagent)
        │
        v
2. State progress: "Completed [X], next session will [Y]"
        │
        v
3. If phase complete: Run /finish_phase
```

---

## Key Rules

| Rule | Description                                                             |
| ---- | ----------------------------------------------------------------------- |
| 1    | **Start every session with `/next_task`** to understand current state   |
| 2    | **One phase per session** for full context                              |
| 3    | **Update tracking docs via doc-updater subagent** - never edit directly |
| 4    | **Prompt user before adding seed data**                                 |
| 5    | **Present 2-3 UI options in Design phase**                              |
| 6    | **All Finalize phase tasks use subagents**                              |

---

## Phase Gates (Must Complete All)

### Design Phase

- [ ] Present 2-3 UI options (Desktop + Mobile descriptions for each)
- [ ] User selects one option
- [ ] Confirm seed data requirements
- [ ] Record all decisions in stage doc

### Build Phase

- [ ] Implement chosen UI + backend
- [ ] Add agreed seed data
- [ ] Add placeholders for future features
- [ ] Dev server running for user testing

### Refinement Phase

- [ ] Desktop tested and approved by user
- [ ] Mobile tested and approved by user
- [ ] Regression items added to checklist
- [ ] All three checkboxes checked in stage doc

### Finalize Phase (All via subagents)

- [ ] Code review (pre-tests)
- [ ] Full test coverage written (unit, integration, e2e)
- [ ] Code review (post-tests)
- [ ] Documentation updated
- [ ] Commit with detailed message
- [ ] CHANGELOG entry added

---

## Critical Red Flags

Watch for these signs you're about to skip the workflow:

- Creating implementation files before running `/next_task`
- Skipping Design phase because "it's obvious what to build"
- Starting Build phase without user selecting from 2-3 UI options
- Advancing to Finalize without both Desktop AND Mobile approval
- Committing code before tests are written and passing
- Updating stage docs yourself instead of delegating to doc-updater subagent
- User says "just do it" without confirming which design option they want

---

## Common Rationalizations (Don't Fall For These)

| Excuse                                             | Reality                                                                   | Correct Action                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| "User is the decision-maker, they can skip phases" | User decides WHAT to build, workflow defines HOW quality gates work       | Follow all 4 phases unless user explicitly documents skip reason       |
| "This is simple, doesn't need Design phase"        | Simple tasks become complex; Design phase catches this early              | Present 2-3 options even for "simple" stages                           |
| "User explicitly asked to skip formality"          | Explicit skips must be documented with reason and date                    | Document skip in stage file: "Skipped by user request [reason] [date]" |
| "I should respect their expertise"                 | Expertise doesn't override quality gates (Desktop/Mobile approval, tests) | Gates are non-negotiable unless explicitly overridden                  |
| "They just want to see it working"                 | Build phase already provides working implementation for testing           | Refinement phase is for feedback, not for skipping tests               |
| "Documentation overhead isn't worth it"            | Tracking docs enable session independence and prevent rework              | Update docs via doc-updater subagent after every phase                 |

---

## Task Navigator Output Format

When `/next_task` is run, it returns:

```
═══════════════════════════════════════════════════════════
NEXT TASK
═══════════════════════════════════════════════════════════
Epic:   EPIC-XXX [Name]
Stage:  STAGE-XXX-YYY [Name]
Phase:  [Design | Build | Refinement | Finalize]

Instructions:
[Phase-specific instructions]

Seed data needed: [Yes - describe | No | Already agreed]

When complete, run: /finish_phase
═══════════════════════════════════════════════════════════
```

---

## FPF Integration

At Design and Build phase starts, automatically run `fpf-query` to surface relevant past decisions and rejected approaches. User can skip with "skip FPF".

When FPF cycle completes, add decision summary to stage doc linking to DRR file.
