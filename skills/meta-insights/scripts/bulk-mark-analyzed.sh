#!/bin/bash
# Read paths from stdin and mark all as analyzed
while IFS= read -r path; do
  sed -i 's/analyzed: false/analyzed: true/' "$path"
  echo "Marked: $path"
done
