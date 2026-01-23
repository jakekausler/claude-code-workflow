#!/usr/bin/env bash
# Bulk add dismiss actions to trends

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while IFS='|' read -r uuid reason; do
    uuid=$(echo "$uuid" | xargs)  # trim whitespace
    reason=$(echo "$reason" | xargs)  # trim whitespace

    if [[ -z "$uuid" || -z "$reason" ]]; then
        echo "Skipping invalid line" >&2
        continue
    fi

    "$SCRIPT_DIR/add-trend-action.sh" "$uuid" dismiss "$reason"
done
