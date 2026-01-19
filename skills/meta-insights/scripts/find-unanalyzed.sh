#!/bin/bash
# Find all entries with analyzed: false
grep -l "analyzed: false" ~/docs/claude-learnings/*.md ~/docs/claude-journal/*.md 2>/dev/null | sort
