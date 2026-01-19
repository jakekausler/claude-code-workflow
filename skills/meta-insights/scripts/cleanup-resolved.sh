#!/bin/bash
# Archive trends resolved more than N days ago
DAYS=${1:-30}
CUTOFF_DATE=$(date -d "$DAYS days ago" +%Y-%m-%d)

TRENDS_FILE=~/docs/claude-meta-insights/trends.json
ARCHIVE_FILE=~/docs/claude-meta-insights/archived-trends.json

# Extract resolved trends older than cutoff
ARCHIVED=$(jq "[.trends[] | select(.status == \"RESOLVED\" and .last_seen < \"$CUTOFF_DATE\")]" "$TRENDS_FILE")

# If archive file exists, merge; otherwise create
if [ -f "$ARCHIVE_FILE" ]; then
  jq ".trends += $ARCHIVED" "$ARCHIVE_FILE" > "${ARCHIVE_FILE}.tmp" && mv "${ARCHIVE_FILE}.tmp" "$ARCHIVE_FILE"
else
  echo "{\"trends\": $ARCHIVED}" > "$ARCHIVE_FILE"
fi

# Remove from active trends
jq ".trends = [.trends[] | select(.status != \"RESOLVED\" or .last_seen >= \"$CUTOFF_DATE\")]" "$TRENDS_FILE" > "${TRENDS_FILE}.tmp" && mv "${TRENDS_FILE}.tmp" "$TRENDS_FILE"

COUNT=$(echo "$ARCHIVED" | jq 'length')
echo "Archived $COUNT resolved trends older than $CUTOFF_DATE"
