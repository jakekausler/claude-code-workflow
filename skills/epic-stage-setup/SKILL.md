---
name: epic-stage-setup
description: Use when creating new projects requiring structured phased development, bootstrapping epic/stage hierarchy, creating new epics, or creating new stages.
---

# Epic/Stage Setup - Bootstrapping Guide

This skill handles the CREATION of epic/stage/phase workflow structure. For WORKING ON existing epics and stages, see the `epic-stage-workflow` skill.

## When to Use

- Starting a new project that will benefit from phased development with quality gates
- Converting an existing project to use epic/stage tracking
- User explicitly requests "epic workflow", "stage tracking", or "phased development"
- Creating a NEW epic or stage within an existing project
- User asks to "create an epic" or "add a stage"

## When NOT to Use

- Single-file scripts or throwaway prototypes
- Projects with fewer than 3 distinct features
- Projects where user explicitly wants ad-hoc development without tracking
- Projects already using a different structured workflow (e.g., GitHub Projects, Jira)
- **WORKING ON existing stages** - use `epic-stage-workflow` skill instead

---

## Workflow Structure Overview

```
Epic (Feature)
  └── Stage (Component/Interaction)
        └── Phase: Design → Build → Refinement → Finalize
```

### Hierarchy

- **Epic** = Feature (Dashboard, Map, Timeline, etc.)
- **Stage** = Single component or interaction within that feature
- **Phase** = Design | Build | Refinement | Finalize

---

## What This Skill Sets Up

When invoked for a new project:

1. Creates `epics/` directory for epic/stage tracking documents
2. Creates `docs/REGRESSION-CHECKLIST.md` for responsive testing checklist
3. Creates `.fpf/` directory structure for First Principles Framework decisions
4. Adds workflow documentation to project CLAUDE.md (from TEMPLATES.md)
5. Creates `.fpf/context.md` with FPF-specific fields (scale, SLAs, constraints)

---

## After Setup

Tell user:

- Use `/next_task` to check current work
- Use `/finish_phase` to advance phases
- Use `/epic-stats` to see overall progress
- Create first epic: `epics/EPIC-001-name/EPIC-001.md`

---

## Creating Epics/Stages

All templates are embedded below in this skill file.

### Key Rules

- Use 3-digit padding: EPIC-001, STAGE-001-001
- Status values: "Not Started", "Design", "Build", "Refinement", "Finalize", "Complete", "Skipped"
- All four phase sections required in every stage file
- Epic directory name format: `epics/EPIC-XXX-kebab-case-name/`

---

## Epic File Template (EPIC-XXX.md)

```markdown
# EPIC-XXX: [Name]

## Status: Not Started

## Overview

[Description of the feature/capability this epic delivers]

## Stages

| Stage         | Name                | Status      |
| ------------- | ------------------- | ----------- |
| STAGE-XXX-001 | [First stage name]  | Not Started |
| STAGE-XXX-002 | [Second stage name] | Not Started |

## Current Stage: STAGE-XXX-001

## Notes

- [Any relevant notes]
```

---

## Stage File Template (STAGE-XXX-YYY.md)

```markdown
# STAGE-XXX-YYY: [Name]

## Status: Not Started

## Overview

[What this stage implements]

## Stage Flags

- Has Input Forms: [ ] Yes

## Design Phase

- **UI Options Presented**:
- **User Choice**:
- **Seed Data Agreed**:
- **Session Notes**:

**Status**: [ ] Complete

## Build Phase

- **Components Created**:
- **API Endpoints Added**:
- **Placeholders Added**:
- **Session Notes**:

**Status**: [ ] Complete

## Refinement Phase

- [ ] Desktop Approved
- [ ] Mobile Approved
- [ ] Regression Items Added

- **Feedback Round 1**:
- **Feedback Round 2**:

**Status**: [ ] Complete

## Finalize Phase

- [ ] Code Review (pre-tests)
- [ ] Tests Written (unit, integration, e2e)
- [ ] Code Review (post-tests)
- [ ] Documentation Updated
- [ ] Committed

**Commit Hash**:
**CHANGELOG Entry**: [ ] Added

**Status**: [ ] Complete
```

---

## CLAUDE.md Sections Template

Add these sections to a project's CLAUDE.md when bootstrapping:

### Development Workflow Section

```markdown
## Development Workflow

### Hierarchy

- **Epic** = Feature (Dashboard, Map, Timeline, etc.)
- **Stage** = Single component or interaction within that feature
- **Phase** = Design | Build | Refinement | Finalize

### Phase Cycle Per Stage

Each stage goes through 4 phases, typically each in a separate session:

1. DESIGN PHASE → Present options, user picks, confirm seed data
2. BUILD PHASE → Implement, add seed data, add placeholders
3. REFINEMENT PHASE → Dual sign-off (Desktop AND Mobile approval)
4. FINALIZE PHASE → Tests, review, docs, commit (all via subagents)
```

### Commands Section

```markdown
## Commands

| Command         | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `/next_task`    | Find next work by scanning epic/stage hierarchy |
| `/finish_phase` | Mark current phase complete and advance         |
| `/epic-stats`   | Calculate progress across epics                 |
```

### Stage Tracking Section

```markdown
## Stage Tracking Documents

### Location
```

epics/EPIC-XXX-name/STAGE-XXX-YYY.md

```

### Status Values

- `Not Started` - Work not yet begun
- `Design` - In design phase
- `Build` - In build phase
- `Refinement` - In refinement phase
- `Finalize` - In finalize phase
- `Complete` - All phases done
- `Skipped` - Intentionally skipped
```

---

## Regression Checklist Template

Create at `docs/REGRESSION-CHECKLIST.md`:

```markdown
# Regression Checklist

Items to verify after each deployment. Format: `[D]` = desktop, `[M]` = mobile, `[D][M]` = both.

## EPIC-001: [Name]

- [ ] [EPIC-001] [D][M] Description (STAGE-001-001)
```

---

## FPF Directory Structure

Create `.fpf/` directory with:

```
.fpf/
  context.md          # Project context for FPF decisions
  decisions/          # DRR (Decision Record with Rationale) files
```

### context.md Template

```markdown
# FPF Context

## Project Scale

- Expected users:
- Data volume:
- Performance SLAs:

## Technical Constraints

- [List constraints]

## Non-Negotiables

- [List requirements that cannot be compromised]
```

---

## CHANGELOG Format

```
YYYY-MM-DD HH:MM [commit-hash] Epic/Stage: brief description
```

Examples:

```
2025-01-15 14:32 [abc1234] EPIC-001/STAGE-001-002: Campaign selector - chose modal over dropdown
2025-01-15 15:45 [def5678] EPIC-001/STAGE-001-002: User requested larger cards
2025-01-15 16:20 [ghi9012] EPIC-001/STAGE-001-002: Finalize - tests passing, docs updated
```

---

## FPF Decision Summary Format

When an FPF (First Principles Framework) cycle completes, add this summary to the stage doc:

```markdown
### Architectural Decision: [Topic]

- **FPF Cycle**: [DRR-YYYY-MM-DD-topic](.fpf/decisions/DRR-YYYY-MM-DD-topic.md)
- **Decision**: [Brief description]
- **Weakest Link**: [Factor] ([score])
- **Bounded Validity**: Re-evaluate if [triggers]
- **Rejected**: [List of rejected approaches with brief reasons]
```
