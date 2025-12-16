---
name: creating-epics-and-stages
description: Use when creating new epics or stages for phased project work, or when the user asks to plan/structure a feature into trackable phases - creates properly formatted tracking documents in the project's epics directory with all required sections for Design, Build, Refinement, and Finalize phases.
---

# Creating Epics and Stages

## Overview

Creates structured tracking documents for phased project work. Epics contain multiple stages, each with Design → Build → Refinement → Finalize workflow phases.

**Core Principle:** Consistent structure enables task-navigator and doc-updater subagents to work correctly.

## When to Use

**Use this skill when:**
- User wants to plan a new feature or project
- User asks to "create an epic" or "break this down into stages"
- Starting a new body of work that spans multiple sessions
- Converting a design document into trackable work items

**Don't use when:**
- Work is simple enough for a single task (no phases needed)
- Project already has tracking documents for this work
- User just wants to check status (use `/next_task` instead)

## Directory Structure

```
project-root/
  epics/
    EPIC-NNN/
      EPIC-NNN.md           # Epic overview with stage table
      STAGE-NNN-001.md      # First stage
      STAGE-NNN-002.md      # Second stage
      ...
```

**Naming Convention:**
- Epic numbers: 3-digit padded (EPIC-001, EPIC-015, etc.)
- Stage numbers: Epic number + 3-digit stage (STAGE-015-001, STAGE-015-002)

## Quick Reference

| Document | Purpose | Key Sections |
|----------|---------|--------------|
| EPIC-NNN.md | Overview, stage tracking | Status, Overview, Stages table, Current Stage, Notes |
| STAGE-NNN-XXX.md | Individual stage tracking | Status, Overview, Reference, Stage Flags, 4 Phase sections |

## Creating an Epic

### Step 1: Determine Next Epic Number

```bash
# Find highest existing epic number
ls epics/ | grep EPIC | sort | tail -1
```

If no epics exist, start with EPIC-001.

### Step 2: Create Epic Directory and File

Use templates from [TEMPLATES.md](TEMPLATES.md).

**Epic file required fields:**
- Status: `Not Started`
- Overview: What this epic accomplishes
- Stages table: All stages with status
- Current Stage: First stage identifier
- Notes: Key context, dependencies, design decisions

### Step 3: Create Stage Files

Each stage needs its own file with all four phase sections:

1. **Design Phase** - UI options, user choice, seed data, session notes
2. **Build Phase** - Components created, APIs added, placeholders, notes
3. **Refinement Phase** - Desktop/mobile approval, feedback history, regression items
4. **Finalize Phase** - Code review, tests, documentation, commit

**Stage Flags:**
- `Has Input Forms: [x] Yes` - Requires mobile-keyboard viewport testing

## Integration with Subagents

### task-navigator Subagent

Reads these documents to find next work:
- Scans epic status
- Finds first incomplete stage
- Determines current phase from checkboxes
- Returns structured instructions

**Critical:** Status fields and checkboxes must follow exact format for parsing.

### doc-updater Subagent

Updates these documents as work progresses:
- Marks phases complete
- Records design decisions
- Updates status fields
- Adds session notes

**Critical:** Only modify specified fields, preserve all other content.

## Workflow Commands

After creating epics/stages:

| Command | Purpose |
|---------|---------|
| `/next_task` | Find next work item, get phase instructions |
| `/finish_phase` | Mark current phase complete, advance |

## Status Values

| Value | Meaning |
|-------|---------|
| `Not Started` | Work hasn't begun |
| `In Progress` | Currently being worked on |
| `Review` | Awaiting approval |
| `Complete` | Finished |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Missing phase sections | Always include all 4 phases, even if empty |
| Inconsistent numbering | Use 3-digit padding (001, not 1) |
| No stage flags | Always include `Has Input Forms` flag |
| Missing checkboxes | Use `[ ]` for incomplete, `[x]` for complete |
| Wrong status format | Use exact values: `Not Started`, `In Progress`, `Review`, `Complete` |

## Example Invocation

```
User: "Let's plan the map discovery feature into stages"

Claude:
1. Read existing epics to find next number
2. Ask clarifying questions about scope
3. Create EPIC-NNN directory
4. Create EPIC-NNN.md with overview
5. Create STAGE-NNN-XXX.md for each stage
6. Report what was created
7. Suggest running /next_task to begin
```

## Templates

See [TEMPLATES.md](TEMPLATES.md) for:
- Epic file template
- Stage file template
- Example filled-in documents
