---
name: epic-stats
description: Calculate how many stages remain to be done and how many are skipped or otherwise in other states.
---

# Epic Stats - Stage Status Summary

Calculates statistics about epic stages across the project.

## Arguments

The user may provide an argument to filter which epics to include:

- **No argument**: Include ALL epics
- **`EPIC-XXX`**: Stats for only that epic
- **`EPIC-XXX to EPIC-YYY`** or **`EPIC-XXX - EPIC-YYY`**: Stats for epics in that range (inclusive)
- **`before EPIC-XXX`** or **`< EPIC-XXX`**: Stats for epics before (exclusive)
- **`after EPIC-XXX`** or **`> EPIC-XXX`**: Stats for epics after (exclusive)
- **`from EPIC-XXX`** or **`>= EPIC-XXX`**: Stats for that epic and all after
- **`until EPIC-XXX`** or **`<= EPIC-XXX`**: Stats for that epic and all before

## How to Calculate

1. **Scan the epics directory** (`epics/`) for all `EPIC-*.md` files
2. **Parse epic numbers** from filenames (e.g., `EPIC-001` → 1, `EPIC-017` → 17)
3. **Apply filter** based on user argument
4. **For each epic in range**, read the EPIC-XXX.md file and parse the stages table
5. **Count stages by status**:
   - `Complete` - Finished stages
   - `Not Started` - Work not yet begun
   - `Design` / `Build` / `Refinement` / `Finalize` - In progress (at different phases)
   - `Skipped` - Intentionally skipped stages (counted as complete in progress calculation)
   - Any other status - Categorize as "Other"

## Output Format

```
═══════════════════════════════════════════════════════════════════════
EPIC STATS
═══════════════════════════════════════════════════════════════════════
Range: [All Epics | EPIC-XXX | EPIC-XXX to EPIC-YYY | before EPIC-XXX | after EPIC-XXX]
Epics Scanned: N

STAGE STATUS BREAKDOWN
───────────────────────────────────────────────────────────────────────
  Complete:      XX  ████████████████░░░░  (XX%)
  Not Started:   XX  ████████░░░░░░░░░░░░  (XX%)
  In Progress:   XX  ██░░░░░░░░░░░░░░░░░░  (XX%)
    - Design:     X
    - Build:      X
    - Refinement: X
    - Finalize:   X
  Skipped:        X  ░░░░░░░░░░░░░░░░░░░░  (X%)
  Other:          X
───────────────────────────────────────────────────────────────────────
  TOTAL:        XXX

PROGRESS
───────────────────────────────────────────────────────────────────────
  Done:      XX / XXX stages (XX%)  [Complete + Skipped]
  Remaining: XX stages

Note: Skipped stages are counted as complete for progress tracking.

PER-EPIC BREAKDOWN (optional - show if <= 10 epics in range)
───────────────────────────────────────────────────────────────────────
  EPIC-001 Dashboard:              7/7   Complete ████████████████████
  EPIC-002 Map Foundation:         5/8   In Progress █████████████░░░░░░░
  EPIC-003 Map Background:         0/6   Not Started ░░░░░░░░░░░░░░░░░░░░
  ...
═══════════════════════════════════════════════════════════════════════
```

## Progress Bar Generation

Generate a 20-character progress bar:

- `█` (filled block) for proportion complete
- `░` (light shade) for remaining
- Round to nearest character

Example: 75% = `███████████████░░░░░`

## Implementation Notes

1. Parse the stages table from each EPIC markdown file
2. The table format is:
   ```
   | Stage         | Name                             | Status   |
   | ------------- | -------------------------------- | -------- |
   | STAGE-001-001 | App shell & navigation layout    | Complete |
   ```
3. Extract the Status column value for each row
4. "In Progress" is NOT a status in the table - it's a calculated aggregate of Design, Build, Refinement, and Finalize stages
5. If an epic file has no stages table, note it but don't error
6. **Progress Calculation**:
   - `Done = Complete + Skipped` (skipped stages count as complete)
   - `Remaining = Total - Done`
   - This means skipped stages reduce the remaining work count

## Example Invocations

```
/epic-stats                      → All epics
/epic-stats EPIC-011             → Just EPIC-011
/epic-stats EPIC-001 to EPIC-010 → Epics 1 through 10
/epic-stats after EPIC-020       → Epics 21+
/epic-stats before EPIC-010      → Epics 0-9
/epic-stats >= EPIC-015          → Epics 15+
```
