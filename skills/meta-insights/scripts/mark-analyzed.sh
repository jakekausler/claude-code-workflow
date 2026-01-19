#!/bin/bash
# Mark a single entry as analyzed
if [ -z "$1" ]; then
  echo "Usage: mark-analyzed.sh <entry-path>"
  exit 1
fi
sed -i 's/analyzed: false/analyzed: true/' "$1"
echo "Marked as analyzed: $1"
