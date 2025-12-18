---
name: epic-stage-workflow
description: Bootstrap epic/stage/phase workflow structure into a new project. Creates epics/ directory and adds comprehensive documentation to project CLAUDE.md.
---

# Epic/Stage/Phase Workflow Setup

Use this skill to bootstrap structured development workflow into a new project.

## When to Use

- Starting a new project that will benefit from phased development
- Converting an existing project to use epic/stage tracking
- User explicitly asks for "epic workflow", "stage tracking", or "phased development"

## What This Skill Does

1. **Creates directory structure**:

   ```
   epics/                    # Root directory for all epics
   docs/REGRESSION-CHECKLIST.md  # Responsive testing checklist
   ```

2. **Adds workflow documentation** to project CLAUDE.md (from TEMPLATES.md)

3. **Does NOT create example epics** — user creates first epic when ready

## How to Use

When invoked, this skill:

1. Check if `epics/` directory already exists
   - If yes: Ask user if they want to update CLAUDE.md documentation only
   - If no: Proceed with full setup

2. Create `epics/` directory

3. Create `docs/REGRESSION-CHECKLIST.md` with header template

4. Read TEMPLATES.md and inject sections into project CLAUDE.md:
   - If project has no CLAUDE.md, create one with all template sections
   - If project has CLAUDE.md, append workflow sections (avoid duplicates)

5. Confirm completion with summary of what was created

## After Setup

Tell the user:

- Use `/next_task` to check current work status
- Use `/finish_phase` to advance through phases
- Use `/epic-stats` to see progress across epics
- Create first epic with: `epics/EPIC-001-name/EPIC-001.md`

## Creating Epics

When user wants to create a new epic, use the creating-epics-and-stages patterns:

### Epic File Template (EPIC-XXX.md)

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

### Stage File Template (STAGE-XXX-YYY.md)

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

## Important

- Always use 3-digit padding: EPIC-001, STAGE-001-001
- Status values must be exact: "Not Started", "Design", "Build", "Refinement", "Finalize", "Complete", "Skipped"
- All four phase sections required in every stage file
