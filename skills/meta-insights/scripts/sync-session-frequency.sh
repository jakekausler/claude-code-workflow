#!/bin/bash
# Recalculate session frequency metric
DAYS=14
TOTAL_ENTRIES=$(find ~/docs/claude-learnings ~/docs/claude-journal -name "*.md" -type f -mtime -$DAYS 2>/dev/null | wc -l)
SESSION_FREQ=$(echo "scale=1; $TOTAL_ENTRIES / $DAYS" | bc)

TRENDS_FILE=~/docs/claude-meta-insights/trends.json
jq ".metadata.session_frequency = $SESSION_FREQ" "$TRENDS_FILE" > "${TRENDS_FILE}.tmp" && mv "${TRENDS_FILE}.tmp" "$TRENDS_FILE"
echo "Updated session frequency: $SESSION_FREQ entries/day"
