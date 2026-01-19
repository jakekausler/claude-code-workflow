#!/bin/bash
# Record an action for a trend
if [ $# -lt 3 ]; then
  echo "Usage: add-trend-action.sh <trend-id> <action-type> <description> [files...]"
  exit 1
fi

TREND_ID="$1"
ACTION_TYPE="$2"
DESCRIPTION="$3"
shift 3
FILES=("$@")

TRENDS_FILE=~/docs/claude-meta-insights/trends.json
TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S)

# Build action object
FILES_JSON=$(printf '%s\n' "${FILES[@]}" | jq -R . | jq -s .)
ACTION_JSON=$(jq -n \
  --arg date "$TIMESTAMP" \
  --arg type "$ACTION_TYPE" \
  --arg desc "$DESCRIPTION" \
  --argjson files "$FILES_JSON" \
  '{date: $date, action_type: $type, description: $desc, files_modified: $files}')

# Add action to trend
jq "(.trends[] | select(.id == \"$TREND_ID\") | .actions) += [$ACTION_JSON]" "$TRENDS_FILE" > "${TRENDS_FILE}.tmp" && mv "${TRENDS_FILE}.tmp" "$TRENDS_FILE"
echo "Added action to trend $TREND_ID"
