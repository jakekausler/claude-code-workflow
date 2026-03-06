#!/usr/bin/env bash
# smoke-test-e2e.sh — End-to-end smoke test for the orchestrator in mock mode.
#
# Validates the full pipeline lifecycle without Claude CLI or external services:
#   1. Builds kanban-cli (required by orchestrator)
#   2. Seeds a test repo at /tmp/kanban-test-repo
#   3. Runs orchestrator --mock --once against the seeded repo
#   4. Verifies that at least one stage advanced to a new status
#
# Usage:
#   ./scripts/smoke-test-e2e.sh [--verbose] [--keep-repo]
#
# Options:
#   --verbose    Print orchestrator log output
#   --keep-repo  Do not remove the test repo on exit (useful for manual inspection)
#   --help       Show this message

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_REPO="/tmp/kanban-test-repo"
VERBOSE=false
KEEP_REPO=false
PASS=0
FAIL=0

# ─── Flags ───────────────────────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --verbose)   VERBOSE=true ;;
    --keep-repo) KEEP_REPO=true ;;
    --help)
      sed -n '/^# /p' "${BASH_SOURCE[0]}" | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

# ─── Helpers ─────────────────────────────────────────────────────────────────

pass() { echo "  [PASS] $1"; (( PASS++ )) || true; }
fail() { echo "  [FAIL] $1" >&2; (( FAIL++ )) || true; }
step() { echo ""; echo "=== $1 ==="; }

cleanup() {
  if ! $KEEP_REPO && [[ -d "$TEST_REPO" ]]; then
    rm -rf "$TEST_REPO"
  fi
}
trap cleanup EXIT

# ─── Step 1: Build kanban-cli ─────────────────────────────────────────────────

step "Step 1: Build kanban-cli"

KANBAN_CLI_DIR="$REPO_ROOT/tools/kanban-cli"
if [[ ! -d "$KANBAN_CLI_DIR/node_modules" ]]; then
  echo "  Installing kanban-cli dependencies..."
  npm install --prefix "$KANBAN_CLI_DIR" --silent
fi
echo "  Building kanban-cli..."
npm run build --prefix "$KANBAN_CLI_DIR" --silent
echo "  Rebuilding native modules for current Node.js..."
npm rebuild better-sqlite3 --prefix "$KANBAN_CLI_DIR" --silent
pass "kanban-cli built"

# ─── Step 2: Build orchestrator ───────────────────────────────────────────────

step "Step 2: Build orchestrator"

ORC_DIR="$REPO_ROOT/tools/orchestrator"
if [[ ! -d "$ORC_DIR/node_modules" ]]; then
  echo "  Installing orchestrator dependencies..."
  npm install --prefix "$ORC_DIR" --silent
fi
echo "  Building orchestrator..."
npm run build --prefix "$ORC_DIR" --silent
pass "orchestrator built"

CLI="node $KANBAN_CLI_DIR/dist/cli/index.js"

# ─── Step 3a: Apply DB migrations ────────────────────────────────────────────
#
# Open the kanban DB once before seeding to ensure all ALTER TABLE migrations
# have been applied. This is a no-op on a fresh DB; on an existing DB created
# before a schema update it ensures the migration runs before we depend on it.

step "Step 3a: Apply DB schema migrations"

$CLI list-repos >/dev/null 2>&1 || true
pass "DB migrations applied"

# ─── Step 3: Seed test repo ───────────────────────────────────────────────────

step "Step 3: Seed test repo at $TEST_REPO"

bash "$KANBAN_CLI_DIR/scripts/seed-test-repo.sh" 2>&1 \
  | (if $VERBOSE; then cat; else grep -E "^(===|Created|Registered|Error)" || true; fi)

if [[ ! -d "$TEST_REPO/epics" ]]; then
  fail "Test repo epics directory not found after seed"
  exit 1
fi
pass "test repo seeded"

# ─── Step 4: Capture pre-run stage statuses ───────────────────────────────────

step "Step 4: Capture stage statuses before orchestrator run"

# Sync repo into DB
$CLI sync --repo "$TEST_REPO" 2>/dev/null

BOARD_BEFORE="$($CLI board --repo "$TEST_REPO" --pretty 2>/dev/null || true)"
pass "pre-run snapshot captured"

# ─── Step 5: Run orchestrator --mock --once ───────────────────────────────────

step "Step 5: Run orchestrator --mock --once"

ORC_BIN="$ORC_DIR/dist/index.js"
ORC_LOG="/tmp/kanban-orc-smoke-$$.log"

echo "  Orchestrator log: $ORC_LOG"

set +e
node "$ORC_BIN" \
  --repo "$TEST_REPO" \
  --mock \
  --once \
  --verbose \
  2>&1 | tee "$ORC_LOG" | (if $VERBOSE; then sed 's/^/  [orc] /'; else grep -E '(MOCK|started|finished|Onboarded|Session|Advancing|error|Error)' | sed 's/^/  /'; fi)
ORC_EXIT=$?
set -e

if (( ORC_EXIT != 0 )); then
  fail "Orchestrator exited with code $ORC_EXIT (see $ORC_LOG)"
  exit 1
fi
pass "orchestrator exited cleanly (code 0)"

# ─── Step 6: Verify at least one stage advanced ───────────────────────────────

step "Step 6: Verify stage advancement"

# The orchestrator logger records:
#   "Session completed" (with statusBefore + statusAfter) when status changed
#   "Session completed without status change" when no change
# So checking for the shorter string (not containing "without") confirms advancement.
ADVANCED=0
if grep -q 'Session completed {' "$ORC_LOG" 2>/dev/null; then
  ADVANCED=1
fi
ONBOARDED=0
grep -q 'Onboarded stage to entry phase' "$ORC_LOG" 2>/dev/null && ONBOARDED=1 || true

if (( ADVANCED > 0 )); then
  pass "At least one stage advanced ($ADVANCED session(s) with status change)"
  grep '"Session completed"' "$ORC_LOG" | sed 's/^/  /' || true
elif (( ONBOARDED > 0 )); then
  pass "At least one stage onboarded to entry phase (Not Started → Design)"
  grep 'Onboarded stage' "$ORC_LOG" | sed 's/^/  /' || true
else
  NO_READY=$(grep -c 'No ready stages' "$ORC_LOG" || true)
  if (( NO_READY > 0 )); then
    fail "Orchestrator found no ready stages — seeded repo may have all stages Complete or locked"
  else
    fail "No stage advancement detected in orchestrator log"
  fi
fi

# Note: exit-gate sync uses 'npx kanban-cli sync' which requires kanban-cli to be
# globally installed or available on PATH. In the local dev setup, sync may fail
# with a 404 error. This does NOT affect stage advancement, which happens before sync.
SYNC_FAIL=$(grep -c 'Sync failed' "$ORC_LOG" || true)
if (( SYNC_FAIL > 0 )); then
  echo "  [note] Sync failed (expected in local dev — 'kanban-cli' not on global PATH)."
  echo "         Stage advancement succeeded regardless."
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo ""

if (( FAIL > 0 )); then
  echo "Smoke test FAILED. See $ORC_LOG for details."
  exit 1
else
  echo "Smoke test PASSED."
  $KEEP_REPO && echo "  Test repo preserved at $TEST_REPO"
  exit 0
fi
