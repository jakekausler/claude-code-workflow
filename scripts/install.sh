#!/usr/bin/env bash
# install.sh — Install claude-code-workflow agents and skills into ~/.claude/
#
# By default creates symlinks so in-repo changes are immediately live.
# Use --copy to install file copies instead (safer when the repo may move).
#
# Usage:
#   ./scripts/install.sh [options]
#
# Options:
#   --copy      Copy files/dirs instead of creating symlinks
#   --force     Overwrite existing files/symlinks/directories
#   --dry-run   Print what would be done without making any changes
#   --help      Show this message

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_SRC="$REPO_ROOT/agents"
SKILLS_SRC="$REPO_ROOT/skills"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
AGENTS_DEST="$CLAUDE_DIR/agents"
SKILLS_DEST="$CLAUDE_DIR/skills"

# ─── Flags ───────────────────────────────────────────────────────────────────

USE_COPY=false
FORCE=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --copy)    USE_COPY=true ;;
    --force)   FORCE=true ;;
    --dry-run) DRY_RUN=true ;;
    --help)
      sed -n '/^# /p' "${BASH_SOURCE[0]}" | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# ─── Helpers ─────────────────────────────────────────────────────────────────

OK=0
SKIPPED=0
OVERWRITTEN=0
ERRORS=0

log_ok()   { echo "  [ok]   $1"; (( OK++ ))       || true; }
log_skip() { echo "  [skip] $1"; (( SKIPPED++ ))   || true; }
log_over() { echo "  [over] $1"; (( OVERWRITTEN++ )) || true; }
log_err()  { echo "  [ERR]  $1" >&2; (( ERRORS++ )) || true; }

dry() {
  if $DRY_RUN; then
    echo "  [dry]  $1"
    return 0
  fi
  return 1
}

# Install a single item (file or directory) into a destination directory.
#
# $1 — source path (absolute)
# $2 — destination path (absolute)
install_item() {
  local src="$1"
  local dest="$2"
  local name
  name="$(basename "$src")"

  # Already correctly linked / copied?
  if [[ -L "$dest" ]]; then
    local current_target
    current_target="$(readlink "$dest")"
    if [[ "$current_target" == "$src" ]]; then
      # Already pointing at this repo — nothing to do
      log_skip "$name (symlink already up to date)"
      return
    fi
    # Points somewhere else
    if ! $FORCE; then
      log_skip "$name (symlink exists → $current_target; use --force to overwrite)"
      return
    fi
    dry "Would remove existing symlink: $dest" || rm "$dest"
  elif [[ -e "$dest" ]]; then
    if ! $FORCE; then
      log_skip "$name (exists as regular file/dir; use --force to overwrite)"
      return
    fi
    dry "Would remove existing path: $dest" || rm -rf "$dest"
    local was_overwritten=true
  fi

  if $USE_COPY; then
    if dry "Would copy: $src → $dest"; then
      return
    fi
    cp -r "$src" "$dest"
  else
    if dry "Would symlink: $src → $dest"; then
      return
    fi
    ln -s "$src" "$dest"
  fi

  if [[ "${was_overwritten:-false}" == "true" ]]; then
    log_over "$name"
  else
    log_ok "$name"
  fi
}

# ─── Preflight ────────────────────────────────────────────────────────────────

if [[ ! -d "$AGENTS_SRC" ]]; then
  echo "ERROR: agents/ directory not found at $AGENTS_SRC" >&2
  exit 1
fi
if [[ ! -d "$SKILLS_SRC" ]]; then
  echo "ERROR: skills/ directory not found at $SKILLS_SRC" >&2
  exit 1
fi

mode_label="symlinks"
$USE_COPY && mode_label="copies"
$DRY_RUN && mode_label="$mode_label (dry run)"

echo ""
echo "claude-code-workflow install"
echo "  repo:   $REPO_ROOT"
echo "  target: $CLAUDE_DIR"
echo "  mode:   $mode_label"
echo ""

# ─── Create destination dirs ──────────────────────────────────────────────────

if ! $DRY_RUN; then
  mkdir -p "$AGENTS_DEST" "$SKILLS_DEST"
else
  echo "  [dry]  Would create $AGENTS_DEST (if needed)"
  echo "  [dry]  Would create $SKILLS_DEST (if needed)"
fi

# ─── Install agents ───────────────────────────────────────────────────────────

echo "Agents → $AGENTS_DEST"

agent_count=0
for agent_file in "$AGENTS_SRC"/*.md; do
  [[ -e "$agent_file" ]] || continue  # glob found nothing
  dest="$AGENTS_DEST/$(basename "$agent_file")"
  install_item "$agent_file" "$dest"
  (( agent_count++ )) || true
done

if (( agent_count == 0 )); then
  echo "  (no .md files found in $AGENTS_SRC)"
fi

echo ""

# ─── Install skills ───────────────────────────────────────────────────────────

echo "Skills → $SKILLS_DEST"

skill_count=0
for skill_dir in "$SKILLS_SRC"/*/; do
  [[ -d "$skill_dir" ]] || continue
  # Strip trailing slash for basename
  skill_dir="${skill_dir%/}"
  dest="$SKILLS_DEST/$(basename "$skill_dir")"
  install_item "$skill_dir" "$dest"
  (( skill_count++ )) || true
done

if (( skill_count == 0 )); then
  echo "  (no skill directories found in $SKILLS_SRC)"
fi

echo ""

# ─── Set up .mcp.json ─────────────────────────────────────────────────────────

MCP_JSON_EXAMPLE="$REPO_ROOT/.mcp.json.example"
MCP_JSON_DEST="$REPO_ROOT/.mcp.json"

echo ".mcp.json → $MCP_JSON_DEST"

if [[ -e "$MCP_JSON_DEST" ]]; then
  log_skip ".mcp.json (already exists)"
elif [[ ! -f "$MCP_JSON_EXAMPLE" ]]; then
  log_skip ".mcp.json (no .mcp.json.example found at $MCP_JSON_EXAMPLE)"
else
  if dry "Would copy: $MCP_JSON_EXAMPLE → $MCP_JSON_DEST"; then
    : # dry run, nothing to do
  else
    cp "$MCP_JSON_EXAMPLE" "$MCP_JSON_DEST"
    log_ok ".mcp.json (created from .mcp.json.example — customize as needed)"
  fi
fi

echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────

echo "Done."
if $DRY_RUN; then
  echo "  (dry run — no changes made)"
else
  echo "  installed:   $OK"
  echo "  overwritten: $OVERWRITTEN"
  echo "  skipped:     $SKIPPED"
  [[ $ERRORS -gt 0 ]] && echo "  errors:      $ERRORS" >&2
fi
echo ""

if (( ERRORS > 0 )); then
  exit 1
fi
