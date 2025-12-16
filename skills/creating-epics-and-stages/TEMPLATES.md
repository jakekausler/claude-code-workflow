# Epic and Stage Templates

## Epic File Template

```markdown
# EPIC-NNN: [Epic Title]

## Status: Not Started

## Overview

[1-3 sentences describing what this epic accomplishes and why it matters]

## Stages

| Stage         | Name                    | Status      |
| ------------- | ----------------------- | ----------- |
| STAGE-NNN-001 | [Stage 1 name]          | Not Started |
| STAGE-NNN-002 | [Stage 2 name]          | Not Started |
| STAGE-NNN-003 | [Stage 3 name]          | Not Started |

## Current Stage

STAGE-NNN-001

## Notes

- [Key design decisions]
- [Dependencies on other epics]
- [Important context]
```

## Stage File Template

```markdown
# STAGE-NNN-XXX: [Stage Name]

## Status: Not Started

## Overview

[1-2 sentences describing what this stage accomplishes]

## Reference Implementation

- [Links to similar patterns in codebase]
- [Design document references]

## Integration Notes

- Integrates with EPIC-XXX (if applicable)
- Depends on STAGE-NNN-YYY (if applicable)

## Stage Flags

- **Has Input Forms**: [ ] Yes

## Design Phase

- **UI Options Presented**:
  - Option 1:
    - Desktop:
    - Mobile:
  - Option 2:
    - Desktop:
    - Mobile:
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

- **Desktop Approved**: [ ]
- **Mobile Approved**: [ ]
- **Feedback History**:
  - Round 1 (Desktop):
  - Round 1 (Mobile):
- **Regression Items Added**: [ ]

**Status**: [ ] Complete

## Finalize Phase

- [ ] Code Review (pre-tests)
- [ ] Tests Written (unit, integration, e2e)
  - [ ] Desktop viewport passing
  - [ ] Mobile viewport passing
  - [ ] Mobile-keyboard viewport passing (if forms)
- [ ] Code Review (post-tests)
- [ ] Documentation Updated
- [ ] Committed

**Commit Hash**:
**CHANGELOG Entry**: [ ] Added

**Status**: [ ] Complete
```

## Stage File Template (Minimal - No Forms)

Use when stage has no input forms:

```markdown
# STAGE-NNN-XXX: [Stage Name]

## Status: Not Started

## Overview

[1-2 sentences describing what this stage accomplishes]

## Reference Implementation

- [Links to similar patterns in codebase]

## Stage Flags

- **Has Input Forms**: [ ] Yes

## Design Phase

- **UI Options Presented**:
  - Option 1:
    - Desktop:
    - Mobile:
  - Option 2:
    - Desktop:
    - Mobile:
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

- **Desktop Approved**: [ ]
- **Mobile Approved**: [ ]
- **Feedback History**:
  - Round 1 (Desktop):
  - Round 1 (Mobile):
- **Regression Items Added**: [ ]

**Status**: [ ] Complete

## Finalize Phase

- [ ] Code Review (pre-tests)
- [ ] Tests Written (unit, integration, e2e)
  - [ ] Desktop viewport passing
  - [ ] Mobile viewport passing
- [ ] Code Review (post-tests)
- [ ] Documentation Updated
- [ ] Committed

**Commit Hash**:
**CHANGELOG Entry**: [ ] Added

**Status**: [ ] Complete
```

## Example: Filled Epic

```markdown
# EPIC-015: Map Discovery & Sync

## Status: Not Started

## Overview

Map search, filtering, and cross-view synchronization features. Enables users to quickly find entities on the map through search and filters, and provides automatic highlighting and navigation when entities are selected in other views (Timeline, Flow).

## Stages

| Stage         | Name                        | Status      |
| ------------- | --------------------------- | ----------- |
| STAGE-015-001 | Map entity search           | Not Started |
| STAGE-015-002 | Entity type filter          | Not Started |
| STAGE-015-003 | Entity attribute filter     | Not Started |
| STAGE-015-004 | Selection sync (map side)   | Not Started |
| STAGE-015-005 | Pan-to-selection            | Not Started |
| STAGE-015-006 | Multi-map entity navigation | Not Started |

## Current Stage

STAGE-015-001

## Notes

- Search and filtering help users navigate large, complex maps
- Cross-view synchronization (EPIC-017 Timeline, EPIC-018 Flow) creates cohesive experience
- Pan-to-selection provides smooth automatic navigation
- Multi-map navigation enables quick context switching for entities on different maps
```

## Example: Filled Stage

```markdown
# STAGE-015-001: Map entity search

## Status: Not Started

## Overview

Search by name, highlight matches. Provides a search input that filters map entities by name and highlights matching results on the map, making it easy to locate specific entities quickly.

## Reference Implementation

- Entity search/filtering patterns

## Stage Flags

- **Has Input Forms**: [x] Yes

## Design Phase

- **UI Options Presented**:
  - Option 1:
    - Desktop:
    - Mobile:
  - Option 2:
    - Desktop:
    - Mobile:
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

- **Desktop Approved**: [ ]
- **Mobile Approved**: [ ]
- **Feedback History**:
  - Round 1 (Desktop):
  - Round 1 (Mobile):
- **Regression Items Added**: [ ]

**Status**: [ ] Complete

## Finalize Phase

- [ ] Code Review (pre-tests)
- [ ] Tests Written (unit, integration, e2e)
  - [ ] Desktop viewport passing
  - [ ] Mobile viewport passing
  - [ ] Mobile-keyboard viewport passing (if forms)
- [ ] Code Review (post-tests)
- [ ] Documentation Updated
- [ ] Committed

**Commit Hash**:
**CHANGELOG Entry**: [ ] Added

**Status**: [ ] Complete
```

## Checklist for Creating Epics

- [ ] Determined next epic number (3-digit padded)
- [ ] Created epics/EPIC-NNN/ directory
- [ ] Created EPIC-NNN.md with all sections
- [ ] Created STAGE-NNN-XXX.md for each stage
- [ ] All stages have correct numbering (epic-number + stage-number)
- [ ] All stages have Stage Flags section
- [ ] All stages have all 4 phase sections
- [ ] Epic stages table matches created stage files
- [ ] Current Stage points to first stage
