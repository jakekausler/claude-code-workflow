#!/bin/bash
# Fetch full trend object by ID
if [ -z "$1" ]; then
  echo "Usage: get-trend.sh <trend-id>"
  exit 1
fi

TRENDS_FILE=~/docs/claude-meta-insights/trends.json
jq ".trends[] | select(.id == \"$1\")" "$TRENDS_FILE"
