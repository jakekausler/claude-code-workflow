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

**File pattern**: `changelog/<YYYY-MM-DD>.changelog.md`

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
