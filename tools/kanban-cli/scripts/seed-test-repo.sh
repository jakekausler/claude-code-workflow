#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="node $SCRIPT_DIR/dist/cli/index.js"

REPO_DIR="/tmp/kanban-test-repo"

# Parse command line arguments
NOT_STARTED_MODE=false
if [ "${1:-}" = "--not-started" ]; then
  NOT_STARTED_MODE=true
fi

echo "=== Kanban CLI Test Repo Seeder ==="
if [ "$NOT_STARTED_MODE" = true ]; then
  echo "(--not-started mode: all statuses will be 'Not Started')"
fi
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

# Create CLAUDE.md with worktree isolation strategy
cat > CLAUDE.md << 'CLAUDE_ENDOFFILE'
# Test Repo

Demo project for kanban workflow testing.

## Worktree Isolation Strategy

### Service Ports
- Dev server: PORT=3000 + $WORKTREE_INDEX
- API server: PORT=4000 + $WORKTREE_INDEX

### Database
- Each worktree uses SQLite file: data/dev_$WORKTREE_INDEX.db

### Environment
- .env.worktree template with $WORKTREE_INDEX substitutions
- Each worktree gets isolated tmp directory

### Verification Command
- `npm test` (must pass in isolated worktree)
CLAUDE_ENDOFFILE

git add CLAUDE.md
git commit -q -m "Add CLAUDE.md with worktree isolation strategy"

# Create .kanban.yml pipeline configuration
cat > .kanban.yml << 'KANBAN_ENDOFFILE'
workflow:
  entry_phase: Design

  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Build, Refinement]

    - name: Refinement
      skill: refinement
      status: Refinement
      transitions_to: [Build]

    - name: Build
      skill: phase-build
      status: Build
      transitions_to: [Manual Testing]

    - name: Manual Testing
      skill: manual-testing
      status: Manual Testing
      transitions_to: [Finalize]

    - name: Finalize
      skill: phase-finalize
      status: Finalize
      transitions_to: [Done]

  defaults:
    WORKFLOW_REMOTE_MODE: false
    WORKFLOW_AUTO_DESIGN: false
    WORKFLOW_MAX_PARALLEL: 1
    WORKFLOW_GIT_PLATFORM: auto
    WORKFLOW_LEARNINGS_THRESHOLD: 10

cron:
  mr_comment_poll:
    enabled: true
    interval_seconds: 300
  insights_threshold:
    enabled: true
    interval_seconds: 600
KANBAN_ENDOFFILE

git add .kanban.yml
git commit -q -m "Add .kanban.yml pipeline configuration"

# Define status variables based on mode
if [ "$NOT_STARTED_MODE" = true ]; then
  # All statuses are "Not Started" in this mode
  EPIC_001_STATUS="Not Started"
  EPIC_002_STATUS="Not Started"
  EPIC_003_STATUS="Not Started"
  EPIC_004_STATUS="Not Started"

  TICKET_001_001_STATUS="Not Started"
  TICKET_001_002_STATUS="Not Started"
  TICKET_002_001_STATUS="Not Started"
  TICKET_002_002_STATUS="Not Started"
  TICKET_003_001_STATUS="Not Started"
  TICKET_003_002_STATUS="Not Started"
  TICKET_003_003_STATUS="Not Started"
  TICKET_004_001_STATUS="Not Started"

  STAGE_001_001_001_STATUS="Not Started"
  STAGE_001_001_002_STATUS="Not Started"
  STAGE_001_001_003_STATUS="Not Started"
  STAGE_001_002_001_STATUS="Not Started"
  STAGE_001_002_002_STATUS="Not Started"
  STAGE_001_002_003_STATUS="Not Started"
  STAGE_002_001_001_STATUS="Not Started"
  STAGE_002_001_002_STATUS="Not Started"
  STAGE_002_001_003_STATUS="Not Started"
  STAGE_002_001_004_STATUS="Not Started"
  STAGE_002_001_005_STATUS="Not Started"
  STAGE_002_001_006_STATUS="Not Started"
  STAGE_002_002_001_STATUS="Not Started"
  STAGE_002_002_002_STATUS="Not Started"
  STAGE_002_002_003_STATUS="Not Started"
  STAGE_002_002_004_STATUS="Not Started"
  STAGE_002_002_005_STATUS="Not Started"
  STAGE_002_002_006_STATUS="Not Started"
  STAGE_003_001_001_STATUS="Not Started"
  STAGE_003_001_002_STATUS="Not Started"
  STAGE_003_001_003_STATUS="Not Started"
  STAGE_003_001_004_STATUS="Not Started"
  STAGE_003_001_005_STATUS="Not Started"
  STAGE_003_001_006_STATUS="Not Started"
  STAGE_003_002_001_STATUS="Not Started"
  STAGE_003_002_002_STATUS="Not Started"
  STAGE_003_002_003_STATUS="Not Started"
  STAGE_003_002_004_STATUS="Not Started"
  STAGE_003_002_005_STATUS="Not Started"
  STAGE_003_002_006_STATUS="Not Started"
  STAGE_004_001_001_STATUS="Not Started"
  STAGE_004_001_002_STATUS="Not Started"
  STAGE_004_001_003_STATUS="Not Started"

  SESSION_ACTIVE="false"
else
  # Mixed statuses (original behavior)
  EPIC_001_STATUS="Not Started"
  EPIC_002_STATUS="In Progress"
  EPIC_003_STATUS="In Progress"
  EPIC_004_STATUS="Not Started"

  TICKET_001_001_STATUS="Not Started"
  TICKET_001_002_STATUS="Not Started"
  TICKET_002_001_STATUS="In Progress"
  TICKET_002_002_STATUS="In Progress"
  TICKET_003_001_STATUS="In Progress"
  TICKET_003_002_STATUS="In Progress"
  TICKET_003_003_STATUS="Not Started"
  TICKET_004_001_STATUS="Not Started"

  STAGE_001_001_001_STATUS="Not Started"
  STAGE_001_001_002_STATUS="Not Started"
  STAGE_001_001_003_STATUS="Not Started"
  STAGE_001_002_001_STATUS="Not Started"
  STAGE_001_002_002_STATUS="Not Started"
  STAGE_001_002_003_STATUS="Not Started"
  STAGE_002_001_001_STATUS="Complete"
  STAGE_002_001_002_STATUS="Manual Testing"
  STAGE_002_001_003_STATUS="Not Started"
  STAGE_002_001_004_STATUS="Not Started"
  STAGE_002_001_005_STATUS="Not Started"
  STAGE_002_001_006_STATUS="Not Started"
  STAGE_002_002_001_STATUS="Finalize"
  STAGE_002_002_002_STATUS="Build"
  STAGE_002_002_003_STATUS="Not Started"
  STAGE_002_002_004_STATUS="Not Started"
  STAGE_002_002_005_STATUS="Not Started"
  STAGE_002_002_006_STATUS="Not Started"
  STAGE_003_001_001_STATUS="Complete"
  STAGE_003_001_002_STATUS="Manual Testing"
  STAGE_003_001_003_STATUS="Not Started"
  STAGE_003_001_004_STATUS="Not Started"
  STAGE_003_001_005_STATUS="Not Started"
  STAGE_003_001_006_STATUS="Not Started"
  STAGE_003_002_001_STATUS="Finalize"
  STAGE_003_002_002_STATUS="Build"
  STAGE_003_002_003_STATUS="Not Started"
  STAGE_003_002_004_STATUS="Not Started"
  STAGE_003_002_005_STATUS="Not Started"
  STAGE_003_002_006_STATUS="Not Started"
  STAGE_004_001_001_STATUS="Not Started"
  STAGE_004_001_002_STATUS="Not Started"
  STAGE_004_001_003_STATUS="Not Started"

  SESSION_ACTIVE_001_001_003="true"
  SESSION_ACTIVE_002_002_002="true"
  SESSION_ACTIVE_OTHERS="false"
  SESSION_ACTIVE="$SESSION_ACTIVE_OTHERS"
fi

# Create directory structure
mkdir -p epics/EPIC-001/TICKET-001-001
mkdir -p epics/EPIC-001/TICKET-001-002
mkdir -p epics/EPIC-002/TICKET-002-001
mkdir -p epics/EPIC-002/TICKET-002-002
mkdir -p epics/EPIC-003/TICKET-003-001
mkdir -p epics/EPIC-003/TICKET-003-002
mkdir -p epics/EPIC-003/TICKET-003-003
mkdir -p epics/EPIC-004/TICKET-004-001

###############################################################################
# EPIC-001: Repository Bootstrap
###############################################################################

cat > epics/EPIC-001/EPIC-001.md << ENDOFFILE
---
id: EPIC-001
title: Repository Bootstrap
status: $EPIC_001_STATUS
tickets:
  - TICKET-001-001
  - TICKET-001-002
ticket_statuses:
  TICKET-001-001: $TICKET_001_001_STATUS
  TICKET-001-002: $TICKET_001_002_STATUS
depends_on: []
---

## Overview

Set up the foundational repository infrastructure including project scaffolding,
build tools configuration, CI/CD pipeline, and development environment setup.
This epic ensures all developers have a consistent local setup and automated
quality checks are in place.
ENDOFFILE

# --- TICKET-001-001: Project Scaffolding ---

cat > epics/EPIC-001/TICKET-001-001/TICKET-001-001.md << ENDOFFILE
---
id: TICKET-001-001
epic: EPIC-001
title: Project Scaffolding
status: $TICKET_001_001_STATUS
source: local
stages:
  - STAGE-001-001-001
  - STAGE-001-001-002
  - STAGE-001-001-003
stage_statuses:
  STAGE-001-001-001: $STAGE_001_001_001_STATUS
  STAGE-001-001-002: $STAGE_001_001_002_STATUS
  STAGE-001-001-003: $STAGE_001_001_003_STATUS
depends_on: []
---

## Overview

Initialize the project directory structure, set up npm workspaces, configure
build tools, and establish code organization patterns.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md << ENDOFFILE
---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Initialize project structure
status: $STAGE_001_001_001_STATUS
worktree_branch: stage/STAGE-001-001-001
session_active: $SESSION_ACTIVE
refinement_type:
  - backend
  - infrastructure
depends_on: []
priority: 0
---

## Overview

Create the monorepo layout with subdirectories for frontend, backend,
shared utilities, and configuration. Set up package.json at root level
with workspace configuration.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md << ENDOFFILE
---
id: STAGE-001-001-002
ticket: TICKET-001-001
epic: EPIC-001
title: Configure build tools and linting
status: $STAGE_001_001_002_STATUS
worktree_branch: stage/STAGE-001-001-002
session_active: $SESSION_ACTIVE
refinement_type:
  - backend
depends_on:
  - STAGE-001-001-001
priority: 0
---

## Overview

Set up Webpack/Vite for bundling, configure TypeScript compilation,
install and configure ESLint and Prettier for code quality.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-001/STAGE-001-001-003.md << ENDOFFILE
---
id: STAGE-001-001-003
ticket: TICKET-001-001
epic: EPIC-001
title: Set up CI/CD pipeline
status: $STAGE_001_001_003_STATUS
worktree_branch: stage/STAGE-001-001-003
session_active: $SESSION_ACTIVE
refinement_type:
  - infrastructure
depends_on:
  - STAGE-001-001-002
priority: 0
---

## Overview

Create GitHub Actions workflows for running tests, linting, and building
on every commit. Configure branch protection rules and automated deployments.
ENDOFFILE

# --- TICKET-001-002: Development Environment ---

cat > epics/EPIC-001/TICKET-001-002/TICKET-001-002.md << ENDOFFILE
---
id: TICKET-001-002
epic: EPIC-001
title: Development Environment
status: $TICKET_001_002_STATUS
source: local
stages:
  - STAGE-001-002-001
  - STAGE-001-002-002
  - STAGE-001-002-003
stage_statuses:
  STAGE-001-002-001: $STAGE_001_002_001_STATUS
  STAGE-001-002-002: $STAGE_001_002_002_STATUS
  STAGE-001-002-003: $STAGE_001_002_003_STATUS
depends_on:
  - TICKET-001-001
---

## Overview

Set up local development tools and documentation to ensure developers
can quickly get the project running on their machines.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-002/STAGE-001-002-001.md << ENDOFFILE
---
id: STAGE-001-002-001
ticket: TICKET-001-002
epic: EPIC-001
title: Docker development setup
status: $STAGE_001_002_001_STATUS
worktree_branch: stage/STAGE-001-002-001
session_active: $SESSION_ACTIVE
refinement_type:
  - infrastructure
depends_on:
  - STAGE-001-001-001
priority: 0
---

## Overview

Create Dockerfile and docker-compose.yml for development environment including
database, cache, and message queue services. Enable hot-reloading for rapid iteration.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-002/STAGE-001-002-002.md << ENDOFFILE
---
id: STAGE-001-002-002
ticket: TICKET-001-002
epic: EPIC-001
title: Local testing configuration
status: $STAGE_001_002_002_STATUS
worktree_branch: stage/STAGE-001-002-002
session_active: $SESSION_ACTIVE
refinement_type:
  - backend
depends_on:
  - STAGE-001-002-001
priority: 0
---

## Overview

Configure test runners (Jest, Mocha), database seeds for testing, and
test data generation utilities. Ensure tests run quickly in isolation.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-002/STAGE-001-002-003.md << ENDOFFILE
---
id: STAGE-001-002-003
ticket: TICKET-001-002
epic: EPIC-001
title: Developer documentation
status: $STAGE_001_002_003_STATUS
worktree_branch: stage/STAGE-001-002-003
session_active: $SESSION_ACTIVE
refinement_type:
  - documentation
depends_on:
  - STAGE-001-002-001
  - STAGE-001-002-002
priority: 0
---

## Overview

Write comprehensive README with setup instructions, architecture overview,
common development tasks, troubleshooting guide, and contribution guidelines.
ENDOFFILE

###############################################################################
# EPIC-002: User Authentication
###############################################################################

cat > epics/EPIC-002/EPIC-002.md << ENDOFFILE
---
id: EPIC-002
title: User Authentication
status: $EPIC_002_STATUS
tickets:
  - TICKET-002-001
  - TICKET-002-002
ticket_statuses:
  TICKET-002-001: $TICKET_002_001_STATUS
  TICKET-002-002: $TICKET_002_002_STATUS
depends_on:
  - EPIC-001
---

## Overview

Implement a complete user authentication system including login, registration,
password reset, and session management. This epic covers both frontend UI
components and backend API endpoints.
ENDOFFILE

# --- TICKET-002-001: Login Flow ---

cat > epics/EPIC-002/TICKET-002-001/TICKET-002-001.md << ENDOFFILE
---
id: TICKET-002-001
epic: EPIC-002
title: Login Flow
status: $TICKET_002_001_STATUS
source: local
stages:
  - STAGE-002-001-001
  - STAGE-002-001-002
  - STAGE-002-001-003
  - STAGE-002-001-004
  - STAGE-002-001-005
  - STAGE-002-001-006
stage_statuses:
  STAGE-002-001-001: $STAGE_002_001_001_STATUS
  STAGE-002-001-002: $STAGE_002_001_002_STATUS
  STAGE-002-001-003: $STAGE_002_001_003_STATUS
  STAGE-002-001-004: $STAGE_002_001_004_STATUS
  STAGE-002-001-005: $STAGE_002_001_005_STATUS
  STAGE-002-001-006: $STAGE_002_001_006_STATUS
depends_on: []
---

## Overview

Build the complete login flow including form UI, authentication API endpoints,
session management, password reset functionality, error handling, and logging.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-001.md << ENDOFFILE
---
id: STAGE-002-001-001
ticket: TICKET-002-001
epic: EPIC-002
title: Login Form UI
status: $STAGE_002_001_001_STATUS
worktree_branch: stage/STAGE-002-001-001
session_active: false
refinement_type:
  - frontend
depends_on: []
priority: 0
---

## Overview

Create the login form component with email/password fields, validation,
remember-me checkbox, and responsive layout.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-002.md << ENDOFFILE
---
id: STAGE-002-001-002
ticket: TICKET-002-001
epic: EPIC-002
title: Auth API Endpoints
status: $STAGE_002_001_002_STATUS
worktree_branch: stage/STAGE-002-001-002
session_active: false
refinement_type:
  - backend
depends_on: []
priority: 0
---

## Overview

Implement /api/auth/login and /api/auth/logout REST endpoints with JWT token
generation, rate limiting, and proper HTTP status codes.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-003.md << ENDOFFILE
---
id: STAGE-002-001-003
ticket: TICKET-002-001
epic: EPIC-002
title: Session Management
status: $STAGE_002_001_003_STATUS
worktree_branch: stage/STAGE-002-001-003
session_active: $([ "$NOT_STARTED_MODE" = false ] && echo "true" || echo "false")
refinement_type:
  - backend
depends_on:
  - STAGE-002-001-002
priority: 0
checklists:
  - title: "Pre-flight checks"
    items:
      - text: "Review PR"
        checked: false
      - text: "Run tests"
        checked: true
  - title: "Deployment steps"
    items:
      - text: "Update environment variables"
        checked: false
      - text: "Run database migration"
        checked: false
      - text: "Verify health endpoint"
        checked: false
---

## Overview

Implement server-side session storage with Redis, automatic token refresh,
session invalidation on logout, and concurrent session limits.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-004.md << ENDOFFILE
---
id: STAGE-002-001-004
ticket: TICKET-002-001
epic: EPIC-002
title: Password Reset
status: $STAGE_002_001_004_STATUS
worktree_branch: stage/STAGE-002-001-004
session_active: false
refinement_type:
  - frontend
  - backend
depends_on:
  - STAGE-002-001-002
priority: 0
---

## Overview

Build the forgot-password flow: request form, email with reset token,
reset-password form, and backend token validation with expiry.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-005.md << ENDOFFILE
---
id: STAGE-002-001-005
ticket: TICKET-002-001
epic: EPIC-002
title: Login Error Handling
status: $STAGE_002_001_005_STATUS
worktree_branch: stage/STAGE-002-001-005
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-002-001-001
priority: 0
---

## Overview

Design and implement user-friendly error messages for login failures including
invalid credentials, locked accounts, network errors, and rate limit exceeded.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-006.md << ENDOFFILE
---
id: STAGE-002-001-006
ticket: TICKET-002-001
epic: EPIC-002
title: Auth Logging
status: $STAGE_002_001_006_STATUS
worktree_branch: stage/STAGE-002-001-006
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-002-001-003
priority: 0
---

## Overview

Add structured logging for all authentication events: successful logins,
failed attempts, password resets, session timeouts. Include IP address,
user agent, and timestamp metadata.
ENDOFFILE

# --- TICKET-002-002: Registration Flow ---

cat > epics/EPIC-002/TICKET-002-002/TICKET-002-002.md << ENDOFFILE
---
id: TICKET-002-002
epic: EPIC-002
title: Registration Flow
status: $TICKET_002_002_STATUS
source: local
stages:
  - STAGE-002-002-001
  - STAGE-002-002-002
  - STAGE-002-002-003
  - STAGE-002-002-004
  - STAGE-002-002-005
  - STAGE-002-002-006
stage_statuses:
  STAGE-002-002-001: $STAGE_002_002_001_STATUS
  STAGE-002-002-002: $STAGE_002_002_002_STATUS
  STAGE-002-002-003: $STAGE_002_002_003_STATUS
  STAGE-002-002-004: $STAGE_002_002_004_STATUS
  STAGE-002-002-005: $STAGE_002_002_005_STATUS
  STAGE-002-002-006: $STAGE_002_002_006_STATUS
depends_on: []
---

## Overview

Build the complete user registration flow including signup form, validation,
email verification, welcome emails, analytics tracking, and GDPR consent.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-001.md << ENDOFFILE
---
id: STAGE-002-002-001
ticket: TICKET-002-002
epic: EPIC-002
title: Signup Form UI
status: $STAGE_002_002_001_STATUS
worktree_branch: stage/STAGE-002-002-001
session_active: false
refinement_type:
  - frontend
depends_on: []
priority: 0
---

## Overview

Create the registration form with fields for name, email, password,
password confirmation, and terms acceptance. Include client-side validation
and accessibility attributes.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-002.md << ENDOFFILE
---
id: STAGE-002-002-002
ticket: TICKET-002-002
epic: EPIC-002
title: User Validation API
status: $STAGE_002_002_002_STATUS
worktree_branch: stage/STAGE-002-002-002
session_active: false
refinement_type:
  - backend
depends_on: []
priority: 0
---

## Overview

Implement /api/auth/register endpoint with email uniqueness check, password
strength validation, input sanitization, and proper error responses.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-003.md << ENDOFFILE
---
id: STAGE-002-002-003
ticket: TICKET-002-002
epic: EPIC-002
title: Email Verification
status: $STAGE_002_002_003_STATUS
worktree_branch: stage/STAGE-002-002-003
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-002-002-002
  - STAGE-002-001-002
priority: 0
---

## Overview

Send verification email on registration with a time-limited token. Implement
the verification endpoint and resend functionality. Block login until verified.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-004.md << ENDOFFILE
---
id: STAGE-002-002-004
ticket: TICKET-002-002
epic: EPIC-002
title: Welcome Email
status: $STAGE_002_002_004_STATUS
worktree_branch: stage/STAGE-002-002-004
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-002-002-003
priority: 0
---

## Overview

Send a branded welcome email after successful verification. Include getting
started tips, support contact information, and account settings link.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-005.md << ENDOFFILE
---
id: STAGE-002-002-005
ticket: TICKET-002-002
epic: EPIC-002
title: Registration Analytics
status: $STAGE_002_002_005_STATUS
worktree_branch: stage/STAGE-002-002-005
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-002-002-002
priority: 0
---

## Overview

Track registration funnel events: form started, form submitted, email sent,
email verified, first login. Emit events to the analytics pipeline for
conversion reporting.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-006.md << ENDOFFILE
---
id: STAGE-002-002-006
ticket: TICKET-002-002
epic: EPIC-002
title: GDPR Consent
status: $STAGE_002_002_006_STATUS
worktree_branch: stage/STAGE-002-002-006
session_active: false
refinement_type:
  - frontend
  - backend
depends_on:
  - STAGE-002-002-001
priority: 2
---

## Overview

Add GDPR consent collection to the registration form. Store consent records
with timestamps, provide consent withdrawal mechanism, and ensure data
processing complies with GDPR requirements.
ENDOFFILE

###############################################################################
# EPIC-003: Payment System
###############################################################################

cat > epics/EPIC-003/EPIC-003.md << ENDOFFILE
---
id: EPIC-003
title: Payment System
status: $EPIC_003_STATUS
tickets:
  - TICKET-003-001
  - TICKET-003-002
  - TICKET-003-003
ticket_statuses:
  TICKET-003-001: $TICKET_003_001_STATUS
  TICKET-003-002: $TICKET_003_002_STATUS
  TICKET-003-003: $TICKET_003_003_STATUS
depends_on:
  - EPIC-001
---

## Overview

Build a complete payment system supporting one-time purchases and recurring
subscriptions. Integrate with Stripe for payment processing, implement
checkout flows, subscription management, and refund handling.
ENDOFFILE

# --- TICKET-003-001: Checkout Flow ---

cat > epics/EPIC-003/TICKET-003-001/TICKET-003-001.md << ENDOFFILE
---
id: TICKET-003-001
epic: EPIC-003
title: Checkout Flow
status: $TICKET_003_001_STATUS
source: local
stages:
  - STAGE-003-001-001
  - STAGE-003-001-002
  - STAGE-003-001-003
  - STAGE-003-001-004
  - STAGE-003-001-005
  - STAGE-003-001-006
stage_statuses:
  STAGE-003-001-001: $STAGE_003_001_001_STATUS
  STAGE-003-001-002: $STAGE_003_001_002_STATUS
  STAGE-003-001-003: $STAGE_003_001_003_STATUS
  STAGE-003-001-004: $STAGE_003_001_004_STATUS
  STAGE-003-001-005: $STAGE_003_001_005_STATUS
  STAGE-003-001-006: $STAGE_003_001_006_STATUS
depends_on: []
---

## Overview

Implement the end-to-end checkout flow from cart summary through payment
processing to order confirmation. Includes Stripe integration, receipt
generation, and webhook handling.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-001/STAGE-003-001-001.md << ENDOFFILE
---
id: STAGE-003-001-001
ticket: TICKET-003-001
epic: EPIC-003
title: Cart Summary UI
status: $STAGE_003_001_001_STATUS
worktree_branch: stage/STAGE-003-001-001
session_active: false
refinement_type:
  - frontend
depends_on: []
priority: 0
---

## Overview

Build the cart summary page showing line items, quantities, unit prices,
subtotal, tax calculation, and total. Include quantity adjustment controls
and remove-item functionality.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-001/STAGE-003-001-002.md << ENDOFFILE
---
id: STAGE-003-001-002
ticket: TICKET-003-001
epic: EPIC-003
title: Payment Form
status: $STAGE_003_001_002_STATUS
worktree_branch: stage/STAGE-003-001-002
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-003-001-001
priority: 0
---

## Overview

Integrate Stripe Elements for secure card input. Build the payment form with
billing address, card details, and order review. Handle form validation and
submission states.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-001/STAGE-003-001-003.md << ENDOFFILE
---
id: STAGE-003-001-003
ticket: TICKET-003-001
epic: EPIC-003
title: Stripe Integration
status: $STAGE_003_001_003_STATUS
worktree_branch: stage/STAGE-003-001-003
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-003-001-002
  - STAGE-002-001-002
priority: 0
---

## Overview

Implement server-side Stripe payment intent creation, confirmation handling,
idempotency keys, and error mapping. Support both card payments and
saved payment methods.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-001/STAGE-003-001-004.md << ENDOFFILE
---
id: STAGE-003-001-004
ticket: TICKET-003-001
epic: EPIC-003
title: Order Confirmation
status: $STAGE_003_001_004_STATUS
worktree_branch: stage/STAGE-003-001-004
session_active: false
refinement_type:
  - frontend
  - backend
depends_on:
  - STAGE-003-001-003
priority: 0
---

## Overview

Show order confirmation page after successful payment. Send confirmation
email with order details, estimated delivery, and order tracking link.
Update inventory and order status in the database.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-001/STAGE-003-001-005.md << ENDOFFILE
---
id: STAGE-003-001-005
ticket: TICKET-003-001
epic: EPIC-003
title: Receipt Generation
status: $STAGE_003_001_005_STATUS
worktree_branch: stage/STAGE-003-001-005
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-003-001-003
priority: 1
---

## Overview

Generate PDF receipts for completed orders. Include itemized charges, tax
breakdown, payment method summary, and company details. Store receipts
and make them downloadable from order history.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-001/STAGE-003-001-006.md << ENDOFFILE
---
id: STAGE-003-001-006
ticket: TICKET-003-001
epic: EPIC-003
title: Payment Webhooks
status: $STAGE_003_001_006_STATUS
worktree_branch: stage/STAGE-003-001-006
session_active: false
refinement_type:
  - infrastructure
depends_on:
  - STAGE-003-001-003
  - STAGE-002-001-003
priority: 0
---

## Overview

Set up Stripe webhook endpoint to handle payment_intent.succeeded,
payment_intent.failed, charge.refunded, and dispute events. Implement
signature verification, idempotent processing, and dead letter queue
for failed webhook deliveries.
ENDOFFILE

# --- TICKET-003-002: Subscription Management ---

cat > epics/EPIC-003/TICKET-003-002/TICKET-003-002.md << ENDOFFILE
---
id: TICKET-003-002
epic: EPIC-003
title: Subscription Management
status: $TICKET_003_002_STATUS
source: local
stages:
  - STAGE-003-002-001
  - STAGE-003-002-002
  - STAGE-003-002-003
  - STAGE-003-002-004
  - STAGE-003-002-005
  - STAGE-003-002-006
stage_statuses:
  STAGE-003-002-001: $STAGE_003_002_001_STATUS
  STAGE-003-002-002: $STAGE_003_002_002_STATUS
  STAGE-003-002-003: $STAGE_003_002_003_STATUS
  STAGE-003-002-004: $STAGE_003_002_004_STATUS
  STAGE-003-002-005: $STAGE_003_002_005_STATUS
  STAGE-003-002-006: $STAGE_003_002_006_STATUS
depends_on: []
---

## Overview

Build subscription lifecycle management including plan selection, billing,
cancellation, proration, and usage metering. Integrate with Stripe
Subscriptions API.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-002/STAGE-003-002-001.md << ENDOFFILE
---
id: STAGE-003-002-001
ticket: TICKET-003-002
epic: EPIC-003
title: Plan Selection UI
status: $STAGE_003_002_001_STATUS
worktree_branch: stage/STAGE-003-002-001
session_active: false
refinement_type:
  - frontend
depends_on: []
priority: 0
---

## Overview

Build the pricing page with plan comparison table, feature matrix, toggle
between monthly/annual billing, and plan selection with CTA buttons.
Highlight the recommended plan.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-002/STAGE-003-002-002.md << ENDOFFILE
---
id: STAGE-003-002-002
ticket: TICKET-003-002
epic: EPIC-003
title: Subscription API
status: $STAGE_003_002_002_STATUS
worktree_branch: stage/STAGE-003-002-002
session_active: $([ "$NOT_STARTED_MODE" = false ] && echo "true" || echo "false")
refinement_type:
  - backend
depends_on:
  - STAGE-003-001-003
priority: 0
---

## Overview

Implement subscription CRUD endpoints: create subscription, update plan,
cancel subscription, reactivate subscription. Map Stripe subscription
lifecycle events to internal state machine.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-002/STAGE-003-002-003.md << ENDOFFILE
---
id: STAGE-003-002-003
ticket: TICKET-003-002
epic: EPIC-003
title: Billing History
status: $STAGE_003_002_003_STATUS
worktree_branch: stage/STAGE-003-002-003
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-003-002-002
priority: 0
---

## Overview

Display billing history page with invoice list, payment status, downloadable
invoices, and upcoming charge preview. Pull data from Stripe Invoices API
and cache locally.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-002/STAGE-003-002-004.md << ENDOFFILE
---
id: STAGE-003-002-004
ticket: TICKET-003-002
epic: EPIC-003
title: Cancellation Flow
status: $STAGE_003_002_004_STATUS
worktree_branch: stage/STAGE-003-002-004
session_active: false
refinement_type:
  - frontend
  - backend
depends_on:
  - STAGE-003-002-002
priority: 0
---

## Overview

Build the subscription cancellation flow with reason selection, retention
offers, confirmation step, and grace period handling. Cancel at period end
by default with immediate cancellation as an option.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-002/STAGE-003-002-005.md << ENDOFFILE
---
id: STAGE-003-002-005
ticket: TICKET-003-002
epic: EPIC-003
title: Proration Logic
status: $STAGE_003_002_005_STATUS
worktree_branch: stage/STAGE-003-002-005
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-003-002-002
priority: 3
---

## Overview

Implement proration calculations for mid-cycle plan changes. Handle upgrades
(charge difference immediately) and downgrades (credit on next invoice).
Use Stripe's proration behavior configuration.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-002/STAGE-003-002-006.md << ENDOFFILE
---
id: STAGE-003-002-006
ticket: TICKET-003-002
epic: EPIC-003
title: Usage Metering
status: $STAGE_003_002_006_STATUS
worktree_branch: stage/STAGE-003-002-006
session_active: false
refinement_type:
  - database
depends_on:
  - STAGE-003-002-002
priority: 0
---

## Overview

Track API usage per subscription for metered billing. Implement usage record
ingestion, aggregation pipeline, and Stripe usage record reporting. Add
usage dashboards and threshold alerts.
ENDOFFILE

# --- TICKET-003-003: Refund Processing (no stages - "To Convert" ticket) ---

cat > epics/EPIC-003/TICKET-003-003/TICKET-003-003.md << ENDOFFILE
---
id: TICKET-003-003
epic: EPIC-003
title: Refund Processing
status: $TICKET_003_003_STATUS
source: jira
jira_key: PAY-456
stages: []
stage_statuses: {}
depends_on:
  - TICKET-003-001
---

## Overview

Handle refund requests including full refunds, partial refunds, and refund
to store credit. Integrate with Stripe Refunds API and update order status
accordingly. Imported from Jira ticket PAY-456.
ENDOFFILE

###############################################################################
# EPIC-004: Notifications
###############################################################################

cat > epics/EPIC-004/EPIC-004.md << ENDOFFILE
---
id: EPIC-004
title: Notifications
status: $EPIC_004_STATUS
tickets:
  - TICKET-004-001
ticket_statuses:
  TICKET-004-001: $TICKET_004_001_STATUS
depends_on:
  - EPIC-001
  - EPIC-002
  - EPIC-003
---

## Overview

Build a notification system for transactional emails including email templates,
a notification dispatch service, and payment-related notifications. Depends on
authentication and payment infrastructure from EPIC-002 and EPIC-003.
ENDOFFILE

# --- TICKET-004-001: Email Notifications ---

cat > epics/EPIC-004/TICKET-004-001/TICKET-004-001.md << ENDOFFILE
---
id: TICKET-004-001
epic: EPIC-004
title: Email Notifications
status: $TICKET_004_001_STATUS
source: local
stages:
  - STAGE-004-001-001
  - STAGE-004-001-002
  - STAGE-004-001-003
stage_statuses:
  STAGE-004-001-001: $STAGE_004_001_001_STATUS
  STAGE-004-001-002: $STAGE_004_001_002_STATUS
  STAGE-004-001-003: $STAGE_004_001_003_STATUS
depends_on:
  - TICKET-002-002
---

## Overview

Implement email notification capabilities including reusable email templates,
a notification dispatch service, and payment-specific notifications. Builds on
the Welcome Email work from registration and integrates with the payment system.
ENDOFFILE

cat > epics/EPIC-004/TICKET-004-001/STAGE-004-001-001.md << ENDOFFILE
---
id: STAGE-004-001-001
ticket: TICKET-004-001
epic: EPIC-004
title: Email Templates
status: $STAGE_004_001_001_STATUS
worktree_branch: stage/STAGE-004-001-001
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-002-002-004
priority: 0
---

## Overview

Create a reusable email template system with base layout, header/footer
components, and responsive design. Build templates for common notification
types. Extends the Welcome Email template patterns from registration.
ENDOFFILE

cat > epics/EPIC-004/TICKET-004-001/STAGE-004-001-002.md << ENDOFFILE
---
id: STAGE-004-001-002
ticket: TICKET-004-001
epic: EPIC-004
title: Notification Service
status: $STAGE_004_001_002_STATUS
worktree_branch: stage/STAGE-004-001-002
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-004-001-001
  - STAGE-002-001-003
priority: 0
---

## Overview

Implement the core notification dispatch service with queue-based delivery,
retry logic, rate limiting, and delivery tracking. Requires session management
from auth to identify notification recipients and their preferences.
ENDOFFILE

cat > epics/EPIC-004/TICKET-004-001/STAGE-004-001-003.md << ENDOFFILE
---
id: STAGE-004-001-003
ticket: TICKET-004-001
epic: EPIC-004
title: Payment Notifications
status: $STAGE_004_001_003_STATUS
worktree_branch: stage/STAGE-004-001-003
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-004-001-002
  - STAGE-003-001-005
priority: 0
---

## Overview

Send email notifications for payment events: successful charges, failed
payments, upcoming subscription renewals, and refund confirmations. Integrates
with receipt generation from the payment system for attachment support.
ENDOFFILE

###############################################################################
# Summary
###############################################################################

# Count what we created
EPIC_COUNT=$(find epics -name 'EPIC-*.md' | wc -l)
TICKET_COUNT=$(find epics -name 'TICKET-*.md' | wc -l)
STAGE_COUNT=$(find epics -name 'STAGE-*.md' | wc -l)

echo ""
echo "=== Test Repo Created Successfully ==="
echo ""
echo "Location: $REPO_DIR"
echo ""
echo "Created:"
echo "  Epics:   $EPIC_COUNT"
echo "  Tickets: $TICKET_COUNT"
echo "  Stages:  $STAGE_COUNT"
echo ""
echo "--- Epic 1: Repository Bootstrap (EPIC-001) ---"
echo "  TICKET-001-001: Project Scaffolding (3 stages)"
echo "    - STAGE-001-001-001: Initialize project structure    [Not Started]"
echo "    - STAGE-001-001-002: Configure build tools & linting [Not Started]"
echo "    - STAGE-001-001-003: Set up CI/CD pipeline           [Not Started]"
echo ""
echo "  TICKET-001-002: Development Environment (3 stages)"
echo "    - STAGE-001-002-001: Docker development setup        [Not Started]"
echo "    - STAGE-001-002-002: Local testing configuration     [Not Started]"
echo "    - STAGE-001-002-003: Developer documentation         [Not Started]"
echo ""
echo "--- Epic 2: User Authentication (EPIC-002) ---"
echo "  TICKET-002-001: Login Flow (6 stages)"
echo "    - STAGE-002-001-001: Login Form UI          [Not Started]"
echo "    - STAGE-002-001-002: Auth API Endpoints      [Not Started]"
echo "    - STAGE-002-001-003: Session Management      [Not Started]"
echo "    - STAGE-002-001-004: Password Reset          [Not Started]"
echo "    - STAGE-002-001-005: Login Error Handling    [Not Started]"
echo "    - STAGE-002-001-006: Auth Logging            [Not Started]"
echo ""
echo "  TICKET-002-002: Registration Flow (6 stages)"
echo "    - STAGE-002-002-001: Signup Form UI          [Not Started]"
echo "    - STAGE-002-002-002: User Validation API     [Not Started]"
echo "    - STAGE-002-002-003: Email Verification      [Not Started]"
echo "    - STAGE-002-002-004: Welcome Email           [Not Started]"
echo "    - STAGE-002-002-005: Registration Analytics  [Not Started]"
echo "    - STAGE-002-002-006: GDPR Consent            [Not Started]"
echo ""
echo "--- Epic 3: Payment System (EPIC-003) ---"
echo "  TICKET-003-001: Checkout Flow (6 stages)"
echo "    - STAGE-003-001-001: Cart Summary UI         [Not Started]"
echo "    - STAGE-003-001-002: Payment Form            [Not Started]"
echo "    - STAGE-003-001-003: Stripe Integration      [Not Started]"
echo "    - STAGE-003-001-004: Order Confirmation      [Not Started]"
echo "    - STAGE-003-001-005: Receipt Generation      [Not Started, priority=1]"
echo "    - STAGE-003-001-006: Payment Webhooks        [Not Started] (also depends: EPIC-002)"
echo ""
echo "  TICKET-003-002: Subscription Management (6 stages)"
echo "    - STAGE-003-002-001: Plan Selection UI       [Not Started]"
echo "    - STAGE-003-002-002: Subscription API        [Not Started]"
echo "    - STAGE-003-002-003: Billing History         [Not Started]"
echo "    - STAGE-003-002-004: Cancellation Flow       [Not Started]"
echo "    - STAGE-003-002-005: Proration Logic         [Not Started, priority=3]"
echo "    - STAGE-003-002-006: Usage Metering          [Not Started]"
echo ""
echo "  TICKET-003-003: Refund Processing (no stages - To Convert)"
echo "    Source: jira, jira_key: PAY-456"
echo "    Depends on: TICKET-003-001 (ticket→ticket)"
echo ""
echo "--- Epic 4: Notifications (EPIC-004, depends: EPIC-002) ---"
echo "  TICKET-004-001: Email Notifications (3 stages)"
echo "    - STAGE-004-001-001: Email Templates           [Not Started] (depends: STAGE-002-002-004 CROSS-EPIC, TICKET-002-002 stage→ticket)"
echo "    - STAGE-004-001-002: Notification Service      [Not Started] (depends: STAGE-004-001-001, STAGE-002-001-003 CROSS-EPIC)"
echo "    - STAGE-004-001-003: Payment Notifications     [Not Started] (depends: STAGE-004-001-002, STAGE-003-001-005 CROSS-EPIC)"
echo ""
echo "--- Cross-boundary Dependencies ---"
echo "  Cross-ticket (same epic, stage→stage):"
echo "    STAGE-002-002-003 (Email Verification) -> STAGE-002-001-002 (Auth API Endpoints)"
echo "    STAGE-002-002-006 (GDPR Consent) -> STAGE-002-002-001 (Signup Form UI)"
echo "  Cross-epic (stage→stage):"
echo "    STAGE-003-001-003 (Stripe Integration) -> STAGE-002-001-002 (Auth API Endpoints)"
echo "    STAGE-003-001-006 (Payment Webhooks) -> STAGE-002-001-003 (Session Management)"
echo "    STAGE-004-001-001 (Email Templates) -> STAGE-002-002-004 (Welcome Email)"
echo "    STAGE-004-001-002 (Notification Service) -> STAGE-002-001-003 (Session Management)"
echo "    STAGE-004-001-003 (Payment Notifications) -> STAGE-003-001-005 (Receipt Generation)"
echo "  Ticket → Ticket (same epic):"
echo "    TICKET-001-002 (Development Environment) -> TICKET-001-001 (Project Scaffolding)"
echo "  Ticket → Ticket (cross-epic):"
echo "    TICKET-004-001 (Email Notifications) -> TICKET-002-002 (Registration Flow)"
echo "  Ticket → Ticket (payment):"
echo "    TICKET-003-003 (Refund Processing) -> TICKET-003-001 (Checkout Flow)"
echo "  Stage → Stage (payment):"
echo "    STAGE-003-002-002 (Subscription API) -> STAGE-003-001-003 (Stripe Integration)"
echo "  Stage → Stage (infrastructure):"
echo "    STAGE-001-002-001 (Docker development setup) -> STAGE-001-001-001 (Project Structure)"
echo "  Epic → Epic:"
echo "    EPIC-002 (User Authentication) -> EPIC-001 (Repository Bootstrap)"
echo "    EPIC-003 (Payment System) -> EPIC-001 (Repository Bootstrap)"
echo "    EPIC-004 (Notifications) -> EPIC-001, EPIC-002, EPIC-003"
echo ""

###############################################################################
# Register repo in kanban database
###############################################################################

echo "--- Registering repo in kanban database ---"
echo ""

# Unregister if already exists (ignore errors)
$CLI unregister-repo test-repo 2>/dev/null || true

# Register fresh
$CLI register-repo "$REPO_DIR" --name test-repo

echo ""
echo "=== Repo registered and synced ==="
echo ""

echo "=== Example CLI Commands ==="
echo ""
echo "  # Sync filesystem into SQLite"
echo "  npx tsx src/cli/index.ts sync --repo $REPO_DIR --pretty"
echo ""
echo "  # View the kanban board"
echo "  npx tsx src/cli/index.ts board --repo $REPO_DIR --pretty"
echo ""
echo "  # Get next workable stages"
echo "  npx tsx src/cli/index.ts next --repo $REPO_DIR --max 5 --pretty"
echo ""
echo "  # View dependency graph"
echo "  npx tsx src/cli/index.ts graph --repo $REPO_DIR --pretty"
echo ""
echo "  # Validate all frontmatter"
echo "  npx tsx src/cli/index.ts validate --repo $REPO_DIR --pretty"
echo ""
