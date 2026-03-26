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
2. Creates per-epic `regression.md` files for responsive testing checklists
3. Adds workflow documentation to project CLAUDE.md (from templates below)
4. Creates `changelog/` directory with consolidation script

### Directory Structure

```
epics/
├── EPIC-001-feature-name/
│   ├── EPIC-001.md
│   ├── STAGE-001-001.md
│   ├── STAGE-001-002.md
│   └── regression.md        # Per-epic regression checklist
├── EPIC-002-another-feature/
│   ├── EPIC-002.md
│   └── regression.md
└── ...

changelog/
├── create_changelog.sh     # Script to consolidate entries
└── .gitkeep               # Keeps directory in git
```

---

## After Setup

Tell user:

- Use `/next_task` to check current work
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

### Sequential Dependency Ordering (CRITICAL)

**Core Rule**: Dependencies flow upward numerically. If work X depends on work Y, then Y must have a lower number than X.

```
STAGE-001 → STAGE-002 → STAGE-003
   ↑            ↑
   │            └── Can depend on 001
   └── No dependencies (first)

EPIC-001 → EPIC-002 → EPIC-003
   ↑           ↑
   │           └── Can depend on EPIC-001 work
   └── No cross-epic dependencies
```

**Before creating ANY stage, verify:**

1. **Dependency check**: Does this stage depend on work that doesn't exist yet?
   - If YES: Create the dependency FIRST (lower number) or assign to earlier epic
   - If NO: Proceed with current numbering

2. **Cross-epic check**: Does this stage depend on work in a LATER epic?
   - If YES: **STOP** - This violates sequential ordering
   - Either move the stage to that later epic, or move the dependency to an earlier epic

3. **Insertion check**: Are you inserting a stage mid-sequence (e.g., STAGE-005-003A)?
   - **Never** insert a stage that depends on later-numbered work
   - Insertions must only depend on EARLIER stages in the sequence

**Red Flags - STOP Before Creating Stage:**

| Symptom | Problem | Solution |
|---------|---------|----------|
| "This stage needs EPIC-018's backend work" but you're in EPIC-016 | Cross-epic forward dependency | Move stage to EPIC-018 or later |
| "This stage needs STAGE-005" but you're creating STAGE-003 | Backward dependency | Renumber or reorder stages |
| "Let's add STAGE-004A to keep the feature together" but 004A needs EPIC-020 work | Feature grouping overriding dependencies | Dependency ordering > feature grouping |
| User wants feature "done first" but it needs later API work | User priority ≠ technical feasibility | Explain dependency reality, adjust epic order |

**Common Rationalizations (REJECT ALL):**

| Excuse | Reality |
|--------|---------|
| "Keep frontend features together in one epic" | Architectural layers > feature grouping when dependencies conflict |
| "We'll just mark it blocked until the dependency is ready" | Blocked stages within an epic halt sequential progress |
| "The dependency is small, we can inline it" | If it's a real dependency, it needs proper sequencing |
| "User wants this epic number, so keep it" | Epic numbers reflect execution order, not user preference |
| "User insists on this ordering" | Explain dependency reality, document objection, still fix ordering |
| "We can do them in parallel" | Parallel execution doesn't fix dependency ordering - dependency must be numbered lower |
| "Just this once for the deadline" | Deadline pressure doesn't change technical dependencies |

**Edge Cases:**

**Circular Dependencies**: If EPIC-A needs EPIC-B work AND EPIC-B needs EPIC-A work:
1. This indicates architectural coupling that should be resolved
2. Extract the shared work into an earlier EPIC-C that both depend on
3. Never create circular epic dependencies - one must come first

**STAGE-XXX-XXXA Notation**: Inserting stages mid-sequence (e.g., 002A between 002 and 003) is ONLY valid when:
- The inserted stage depends on EARLIER stages only (001, 002)
- The inserted stage does NOT depend on later stages (003, 004) or later epics
- Using 002A is preferable to renumbering all subsequent stages

**When User Insists After Explanation:**
1. Document in stage file: "Dependency ordering override requested by user - [stage] depends on [future work]"
2. Proceed as directed (user has project authority)
3. Flag in lessons-learned: "Sequential dependency violation - user override"
4. The work may block or fail; user accepts that risk

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

1. DESIGN PHASE - Present options, user picks, confirm seed data
2. BUILD PHASE - Implement, add seed data, add placeholders
3. REFINEMENT PHASE - Dual sign-off (Desktop AND Mobile approval)
4. FINALIZE PHASE - Tests, review, docs, commit (all via subagents)
```

### Commands Section

```markdown
## Commands

| Command       | Purpose                                         |
| ------------- | ----------------------------------------------- |
| `/next_task`  | Find next work by scanning epic/stage hierarchy |
| `/epic-stats` | Calculate progress across epics                 |
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

Create per-epic regression files at `epics/EPIC-XXX-name/regression.md`:

```markdown
# Regression Checklist - EPIC-XXX: [Name]

Items to verify after each deployment. Format: `[D]` = desktop, `[M]` = mobile, `[D][M]` = both.

## STAGE-XXX-001: [Stage Name]

- [ ] [D][M] Description of item to check

## STAGE-XXX-002: [Stage Name]

- [ ] [D][M] Description of item to check
```

---

## Changelog Pattern

Agents write entries to date-based files in `changelog/` directory:

**CRITICAL: Getting the date - NEVER estimate or hardcode dates:**
```bash
# Get today's date for the changelog filename
TODAY=$(date +%Y-%m-%d)
# Example output: 2026-01-14
```

**File pattern**: `changelog/$TODAY.changelog.md`

**Entry format**:

```
## [STAGE-XXX-YYY] Stage Name

- Description of what was done
- Commit: `<hash>`
```

**Rules**:

- Multiple entries on same day - PREPEND to same file (newest at top)
- Always include commit hash after committing
- User runs `./changelog/create_changelog.sh` to consolidate into CHANGELOG.md

### create_changelog.sh Template

```bash
#!/bin/bash
# Consolidates changelog entries into CHANGELOG.md
# Run from project root: ./changelog/create_changelog.sh

set -e

CHANGELOG_DIR="changelog"
OUTPUT_FILE="CHANGELOG.md"

# Create or clear the output file with header
cat > "$OUTPUT_FILE" << 'EOF'
# Changelog

All notable changes to this project are documented here.

EOF

# Process changelog files in reverse chronological order
for file in $(ls -r "$CHANGELOG_DIR"/*.changelog.md 2>/dev/null); do
    if [ -f "$file" ]; then
        date=$(basename "$file" .changelog.md)
        echo "## $date" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        cat "$file" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
    fi
done

echo "CHANGELOG.md updated from $CHANGELOG_DIR entries"
```

---
