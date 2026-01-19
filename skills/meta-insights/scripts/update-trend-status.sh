#!/bin/bash
# Update trend status
if [ $# -ne 2 ]; then
  echo "Usage: update-trend-status.sh <trend-id> <new-status>"
  echo "Valid statuses: NEW, ACTIVE, RECURRING, MONITORING, RESOLVED"
  exit 1
fi

TREND_ID="$1"
NEW_STATUS="$2"
TRENDS_FILE=~/docs/claude-meta-insights/trends.json

# Validate status
case "$NEW_STATUS" in
  NEW|ACTIVE|RECURRING|MONITORING|RESOLVED) ;;
  *) echo "Invalid status: $NEW_STATUS"; exit 1 ;;
esac

# Update using jq
jq "(.trends[] | select(.id == \"$TREND_ID\") | .status) = \"$NEW_STATUS\"" "$TRENDS_FILE" > "${TRENDS_FILE}.tmp" && mv "${TRENDS_FILE}.tmp" "$TRENDS_FILE"
echo "Updated trend $TREND_ID to status $NEW_STATUS"
