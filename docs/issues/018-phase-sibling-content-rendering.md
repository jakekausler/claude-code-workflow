---
title: "Phase sibling content rendering"
phase: 11
labels: [feature, ui]
depends_on: [016]
---

# Phase Sibling Content Rendering

Render sister markdown files under each phase section on the stage detail view, replacing "Content available in future update" placeholders.

## Background

Each phase produces a sister file alongside the main stage file:
- `STAGE-XXX-YYY-ZZZ-design.md` — Design phase research and findings
- `STAGE-XXX-YYY-ZZZ-user-design-feedback.md` — User design decision rationale
- `STAGE-XXX-YYY-ZZZ-build.md` — Build phase implementation notes
- `STAGE-XXX-YYY-ZZZ-automatic-testing.md` — Automatic testing results
- `STAGE-XXX-YYY-ZZZ-manual-testing.md` — Manual testing results
- `STAGE-XXX-YYY-ZZZ-finalize.md` — Finalization notes

## Requirements

- Auto-discover sister files by globbing `STAGE-XXX-YYY-ZZZ-*.md` in the same ticket directory
- Map each sister file to its corresponding phase section in the UI
- Render markdown content of each sister file under the appropriate phase heading
- If no sister file exists for a phase, show nothing (or a subtle "No content yet" indicator)
- Support rendering as the files are created (new sister files appear on next SSE refresh)

## Discovery Pattern

1. Extract stage ID from main file path (e.g., `STAGE-001-001-001`)
2. Glob for `STAGE-001-001-001-*.md` in the same directory
3. Parse suffix to determine phase: `-design`, `-build`, `-automatic-testing`, `-manual-testing`, `-finalize`, `-user-design-feedback`
4. Render each under the matching phase section
