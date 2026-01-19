#!/bin/bash
# List trends with optional filtering
STATUS=""
REPO=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --status) STATUS="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

TRENDS_FILE=~/docs/claude-meta-insights/trends.json

if [ ! -f "$TRENDS_FILE" ]; then
  echo "Trends file not found: $TRENDS_FILE"
  exit 1
fi

JQ_FILTER='.trends[]'
[ -n "$STATUS" ] && JQ_FILTER="$JQ_FILTER | select(.status == \"$STATUS\")"
[ -n "$REPO" ] && JQ_FILTER="$JQ_FILTER | select(.repositories[] == \"$REPO\")"
JQ_FILTER="$JQ_FILTER | \"\(.id) | \(.status) | \(.title) | \(.repositories[0])\""

jq -r "$JQ_FILTER" "$TRENDS_FILE"
