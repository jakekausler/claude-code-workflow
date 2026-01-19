#!/bin/bash
# Find all entries with analyzed: false
# Returns only the 25 oldest entries if more than 25 are found
grep -l "analyzed: false" ~/docs/claude-learnings/*.md ~/docs/claude-journal/*.md 2>/dev/null | sort | head -25
