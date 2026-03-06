#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/tmp/kanban-old-format-repo"

echo "=== Kanban CLI Old-Format Test Repo Seeder ==="
echo ""

# Clean up any previous test repo
if [ -d "$REPO_DIR" ]; then
  echo "Removing existing test repo at $REPO_DIR..."
  rm -rf "$REPO_DIR"
fi

mkdir -p "$REPO_DIR"

# Initialize git repo (needed for worktree features later)
cd "$REPO_DIR"
git init -q
git commit -q --allow-empty -m "Initial commit"

echo "Initialized git repo at $REPO_DIR"

# Create directory structure (old format: stages directly in epic dirs, no tickets)
mkdir -p epics/EPIC-001
mkdir -p epics/EPIC-002

###############################################################################
# EPIC-001: User Authentication (with epic-level file)
###############################################################################

cat > epics/EPIC-001/EPIC-001.md << 'ENDOFFILE'
# User Authentication

Epic for handling all auth-related features.

This epic covers login, registration, password reset, and session management
for the application. All authentication flows should use secure token-based
approaches and follow OWASP best practices.
ENDOFFILE

# --- STAGE-001-001: Login Form ---

cat > epics/EPIC-001/STAGE-001-001.md << 'ENDOFFILE'
# Login Form

Build a responsive login form using React components. The form should include
email and password fields with client-side validation, a "Remember Me"
checkbox, and a link to the password reset flow.

## Status
Done

## Notes
- Used React Hook Form for form state management
- Added Zod schema for validation
- Tested across mobile, tablet, and desktop breakpoints
- Accessibility audit passed with no issues
ENDOFFILE

# --- STAGE-001-002: Registration Page ---

cat > epics/EPIC-001/STAGE-001-002.md << 'ENDOFFILE'
# Registration Page

Create a user registration page with form validation for all required fields.
The form collects name, email, password, and password confirmation. Includes
real-time field validation with helpful error messages.

## Status
Done

## Notes
- Password strength meter integrated from zxcvbn library
- Email uniqueness check fires on blur via debounced API call
- Terms of service checkbox required before submission
- Form state persists across page refreshes via localStorage
ENDOFFILE

# --- STAGE-001-003: Password Reset ---

cat > epics/EPIC-001/STAGE-001-003.md << 'ENDOFFILE'
# Password Reset

Implement the complete password reset flow: request form where the user enters
their email, backend sends a time-limited reset token via email, and a reset
form where the user sets a new password.

## Status
In Progress

## Notes
- Reset tokens expire after 1 hour
- Rate limited to 3 requests per hour per email
- Still need to implement the actual reset form page
ENDOFFILE

# --- STAGE-001-004: Session Management ---

cat > epics/EPIC-001/STAGE-001-004.md << 'ENDOFFILE'
# Session Management

Implement server-side session tracking with JWT tokens. Handle token refresh,
session expiry, and concurrent session limits per user.

## Status
todo
ENDOFFILE

###############################################################################
# EPIC-002: Dashboard (no epic-level file)
###############################################################################

# --- STAGE-002-001: Dashboard Layout ---

cat > epics/EPIC-002/STAGE-002-001.md << 'ENDOFFILE'
# Dashboard Layout

Build the main dashboard layout using CSS Grid. The layout should include a
fixed sidebar navigation, a top header bar with user info, and a flexible
main content area that adjusts to different screen sizes.

## Status
Complete

## Notes
- CSS Grid with named template areas for clarity
- Sidebar collapses to hamburger menu on mobile
- Dark mode support via CSS custom properties
- Skeleton loading states implemented for all panels
ENDOFFILE

# --- STAGE-002-002: Widget System ---

cat > epics/EPIC-002/STAGE-002-002.md << 'ENDOFFILE'
# Widget System

Create a configurable widget system for the dashboard. Users should be able
to add, remove, resize, and rearrange widgets via drag-and-drop. Widgets
load their data independently and show loading/error states.

## Status
todo
ENDOFFILE

# --- STAGE-002-003: Data Visualization ---

cat > epics/EPIC-002/STAGE-002-003.md << 'ENDOFFILE'
# Data Visualization

Add chart and graph widgets to the dashboard using a charting library.
Support line charts, bar charts, and pie charts with real-time data updates
and configurable time ranges.

## Status
Not Started
ENDOFFILE

###############################################################################
# Summary
###############################################################################

# Count what we created
EPIC_COUNT=$(find epics -maxdepth 1 -name 'EPIC-*' -type d | wc -l)
STAGE_COUNT=$(find epics -name 'STAGE-*.md' | wc -l)
EPIC_FILE_COUNT=$(find epics -name 'EPIC-*.md' | wc -l)

echo ""
echo "=== Old-Format Test Repo Created Successfully ==="
echo ""
echo "Location: $REPO_DIR"
echo ""
echo "Created:"
echo "  Epic directories: $EPIC_COUNT"
echo "  Epic files:       $EPIC_FILE_COUNT (only EPIC-001 has an epic file)"
echo "  Stage files:      $STAGE_COUNT"
echo ""
echo "--- Epic 1: User Authentication (EPIC-001) ---"
echo "  Has epic-level file: YES"
echo "  STAGE-001-001: Login Form            [Done]"
echo "  STAGE-001-002: Registration Page     [Done]"
echo "  STAGE-001-003: Password Reset        [In Progress]"
echo "  STAGE-001-004: Session Management    [todo]"
echo ""
echo "--- Epic 2: Dashboard (EPIC-002) ---"
echo "  Has epic-level file: NO"
echo "  STAGE-002-001: Dashboard Layout      [Complete]"
echo "  STAGE-002-002: Widget System         [todo]"
echo "  STAGE-002-003: Data Visualization    [Not Started]"
echo ""
echo "=== Test Migration Commands ==="
echo ""
echo "To test migration (dry-run):"
echo "  cd tools/kanban-cli"
echo "  npx tsx src/cli/index.ts migrate --repo $REPO_DIR --dry-run --pretty"
echo ""
echo "To run actual migration:"
echo "  npx tsx src/cli/index.ts migrate --repo $REPO_DIR --pretty"
echo ""
echo "To verify after migration:"
echo "  npx tsx src/cli/index.ts validate --repo $REPO_DIR --pretty"
echo "  npx tsx src/cli/index.ts board --repo $REPO_DIR --pretty"
echo "  npx tsx src/cli/index.ts summary EPIC-001 --repo $REPO_DIR --pretty"
echo ""
