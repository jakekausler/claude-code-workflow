#!/bin/bash
# Safer backfill script with backup and better logic

BACKUP_DIR=~/docs/claude-meta-insights-backfill-backup-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

echo "Creating backup in: $BACKUP_DIR"
echo "Backfilling analyzed field to existing entries..."

UPDATED=0
SKIPPED=0

for file in ~/docs/claude-learnings/*.md ~/docs/claude-journal/*.md; do
  if [ ! -f "$file" ]; then
    continue
  fi

  # Skip if already has analyzed field
  if grep -q "^analyzed:" "$file"; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Create backup
  cp "$file" "$BACKUP_DIR/$(basename "$file")"

  # Add analyzed: false before the closing --- of frontmatter
  awk '
    BEGIN { in_frontmatter=0; found_closing=0 }
    /^---$/ {
      if (in_frontmatter == 0) {
        in_frontmatter = 1
        print
        next
      } else if (found_closing == 0) {
        print "analyzed: false"
        found_closing = 1
      }
    }
    { print }
  ' "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"

  echo "Updated: $file"
  UPDATED=$((UPDATED + 1))
done

echo ""
echo "Backfill complete!"
echo "Updated: $UPDATED files"
echo "Skipped (already had field): $SKIPPED files"
echo "Backup location: $BACKUP_DIR"
echo ""
echo "If something went wrong, restore with:"
echo "  cp $BACKUP_DIR/*.md ~/docs/claude-learnings/ ; cp $BACKUP_DIR/*.md ~/docs/claude-journal/"
