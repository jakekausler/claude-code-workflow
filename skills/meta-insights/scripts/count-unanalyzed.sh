#!/bin/bash
# Count all entries with analyzed: false (no cap)
# Unlike find-unanalyzed.sh which caps at 25, this returns ALL matches
# for accurate counting by kanban-cli learnings-count command.
grep -l "analyzed: false" ~/docs/claude-learnings/*.md ~/docs/claude-journal/*.md 2>/dev/null
