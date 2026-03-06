---
name: analyze_learnings
description: Analyze learnings and journal entries to identify improvement opportunities across epics, tickets, and stages.
---

# Analyze Learnings

Analyze learnings and journal entries to identify improvement opportunities.

Use the `meta-insights` skill to:
1. Find unanalyzed entries in `~/docs/claude-learnings/` and `~/docs/claude-journal/`
2. Detect cross-cutting themes across all repositories
3. Present findings with actionable recommendations
4. Generate implementation prompts for approved actions

Learnings and journal entries include metadata for `epic`, `ticket`, `stage`, and `phase` fields, enabling analysis across the full hierarchy.

Save prompts to `~/docs/claude-meta-insights/actions/<timestamp>/` for execution in fresh sessions.
