#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="node $SCRIPT_DIR/dist/cli/index.js"

REPO_DIR="/tmp/kanban-test-repo"

echo "=== Kanban CLI Test Repo Seeder ==="
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

# Create directory structure
mkdir -p epics/EPIC-001/TICKET-001-001
mkdir -p epics/EPIC-001/TICKET-001-002
mkdir -p epics/EPIC-002/TICKET-002-001
mkdir -p epics/EPIC-002/TICKET-002-002
mkdir -p epics/EPIC-002/TICKET-002-003
mkdir -p epics/EPIC-003/TICKET-003-001

###############################################################################
# EPIC-001: User Authentication
###############################################################################

cat > epics/EPIC-001/EPIC-001.md << 'ENDOFFILE'
---
id: EPIC-001
title: User Authentication
status: In Progress
tickets:
  - TICKET-001-001
  - TICKET-001-002
ticket_statuses:
  TICKET-001-001: In Progress
  TICKET-001-002: In Progress
depends_on: []
---

## Overview

Implement a complete user authentication system including login, registration,
password reset, and session management. This epic covers both frontend UI
components and backend API endpoints.
ENDOFFILE

# --- TICKET-001-001: Login Flow ---

cat > epics/EPIC-001/TICKET-001-001/TICKET-001-001.md << 'ENDOFFILE'
---
id: TICKET-001-001
epic: EPIC-001
title: Login Flow
status: In Progress
source: local
stages:
  - STAGE-001-001-001
  - STAGE-001-001-002
  - STAGE-001-001-003
  - STAGE-001-001-004
  - STAGE-001-001-005
  - STAGE-001-001-006
stage_statuses:
  STAGE-001-001-001: Complete
  STAGE-001-001-002: Complete
  STAGE-001-001-003: Build
  STAGE-001-001-004: Not Started
  STAGE-001-001-005: Design
  STAGE-001-001-006: Not Started
depends_on: []
---

## Overview

Build the complete login flow including form UI, authentication API endpoints,
session management, password reset functionality, error handling, and logging.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md << 'ENDOFFILE'
---
id: STAGE-001-001-001
ticket: TICKET-001-001
epic: EPIC-001
title: Login Form UI
status: Complete
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

cat > epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md << 'ENDOFFILE'
---
id: STAGE-001-001-002
ticket: TICKET-001-001
epic: EPIC-001
title: Auth API Endpoints
status: Complete
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-001-001-001
priority: 0
---

## Overview

Implement /api/auth/login and /api/auth/logout REST endpoints with JWT token
generation, rate limiting, and proper HTTP status codes.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-001/STAGE-001-001-003.md << 'ENDOFFILE'
---
id: STAGE-001-001-003
ticket: TICKET-001-001
epic: EPIC-001
title: Session Management
status: Build
session_active: true
refinement_type:
  - backend
depends_on:
  - STAGE-001-001-002
priority: 0
---

## Overview

Implement server-side session storage with Redis, automatic token refresh,
session invalidation on logout, and concurrent session limits.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-001/STAGE-001-001-004.md << 'ENDOFFILE'
---
id: STAGE-001-001-004
ticket: TICKET-001-001
epic: EPIC-001
title: Password Reset
status: Not Started
session_active: false
refinement_type:
  - frontend
  - backend
depends_on:
  - STAGE-001-001-002
priority: 0
---

## Overview

Build the forgot-password flow: request form, email with reset token,
reset-password form, and backend token validation with expiry.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-001/STAGE-001-001-005.md << 'ENDOFFILE'
---
id: STAGE-001-001-005
ticket: TICKET-001-001
epic: EPIC-001
title: Login Error Handling
status: Design
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-001-001-001
priority: 0
---

## Overview

Design and implement user-friendly error messages for login failures including
invalid credentials, locked accounts, network errors, and rate limit exceeded.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-001/STAGE-001-001-006.md << 'ENDOFFILE'
---
id: STAGE-001-001-006
ticket: TICKET-001-001
epic: EPIC-001
title: Auth Logging
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-001-001-003
priority: 0
---

## Overview

Add structured logging for all authentication events: successful logins,
failed attempts, password resets, session timeouts. Include IP address,
user agent, and timestamp metadata.
ENDOFFILE

# --- TICKET-001-002: Registration Flow ---

cat > epics/EPIC-001/TICKET-001-002/TICKET-001-002.md << 'ENDOFFILE'
---
id: TICKET-001-002
epic: EPIC-001
title: Registration Flow
status: In Progress
source: local
stages:
  - STAGE-001-002-001
  - STAGE-001-002-002
  - STAGE-001-002-003
  - STAGE-001-002-004
  - STAGE-001-002-005
  - STAGE-001-002-006
stage_statuses:
  STAGE-001-002-001: Automatic Testing
  STAGE-001-002-002: Complete
  STAGE-001-002-003: Not Started
  STAGE-001-002-004: Not Started
  STAGE-001-002-005: Not Started
  STAGE-001-002-006: Design
depends_on: []
---

## Overview

Build the complete user registration flow including signup form, validation,
email verification, welcome emails, analytics tracking, and GDPR consent.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-002/STAGE-001-002-001.md << 'ENDOFFILE'
---
id: STAGE-001-002-001
ticket: TICKET-001-002
epic: EPIC-001
title: Signup Form UI
status: Automatic Testing
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

cat > epics/EPIC-001/TICKET-001-002/STAGE-001-002-002.md << 'ENDOFFILE'
---
id: STAGE-001-002-002
ticket: TICKET-001-002
epic: EPIC-001
title: User Validation API
status: Complete
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

cat > epics/EPIC-001/TICKET-001-002/STAGE-001-002-003.md << 'ENDOFFILE'
---
id: STAGE-001-002-003
ticket: TICKET-001-002
epic: EPIC-001
title: Email Verification
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-001-002-002
  - STAGE-001-001-002
priority: 0
---

## Overview

Send verification email on registration with a time-limited token. Implement
the verification endpoint and resend functionality. Block login until verified.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-002/STAGE-001-002-004.md << 'ENDOFFILE'
---
id: STAGE-001-002-004
ticket: TICKET-001-002
epic: EPIC-001
title: Welcome Email
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-001-002-003
priority: 0
---

## Overview

Send a branded welcome email after successful verification. Include getting
started tips, support contact information, and account settings link.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-002/STAGE-001-002-005.md << 'ENDOFFILE'
---
id: STAGE-001-002-005
ticket: TICKET-001-002
epic: EPIC-001
title: Registration Analytics
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-001-002-002
priority: 0
---

## Overview

Track registration funnel events: form started, form submitted, email sent,
email verified, first login. Emit events to the analytics pipeline for
conversion reporting.
ENDOFFILE

cat > epics/EPIC-001/TICKET-001-002/STAGE-001-002-006.md << 'ENDOFFILE'
---
id: STAGE-001-002-006
ticket: TICKET-001-002
epic: EPIC-001
title: GDPR Consent
status: Design
session_active: false
refinement_type:
  - frontend
  - backend
depends_on:
  - STAGE-001-001-001
priority: 2
---

## Overview

Add GDPR consent collection to the registration form. Store consent records
with timestamps, provide consent withdrawal mechanism, and ensure data
processing complies with GDPR requirements.
ENDOFFILE

###############################################################################
# EPIC-002: Payment System
###############################################################################

cat > epics/EPIC-002/EPIC-002.md << 'ENDOFFILE'
---
id: EPIC-002
title: Payment System
status: In Progress
tickets:
  - TICKET-002-001
  - TICKET-002-002
  - TICKET-002-003
ticket_statuses:
  TICKET-002-001: In Progress
  TICKET-002-002: In Progress
  TICKET-002-003: Not Started
depends_on: []
---

## Overview

Build a complete payment system supporting one-time purchases and recurring
subscriptions. Integrate with Stripe for payment processing, implement
checkout flows, subscription management, and refund handling.
ENDOFFILE

# --- TICKET-002-001: Checkout Flow ---

cat > epics/EPIC-002/TICKET-002-001/TICKET-002-001.md << 'ENDOFFILE'
---
id: TICKET-002-001
epic: EPIC-002
title: Checkout Flow
status: In Progress
source: local
stages:
  - STAGE-002-001-001
  - STAGE-002-001-002
  - STAGE-002-001-003
  - STAGE-002-001-004
  - STAGE-002-001-005
  - STAGE-002-001-006
stage_statuses:
  STAGE-002-001-001: Complete
  STAGE-002-001-002: Manual Testing
  STAGE-002-001-003: Not Started
  STAGE-002-001-004: Not Started
  STAGE-002-001-005: Not Started
  STAGE-002-001-006: Not Started
depends_on: []
---

## Overview

Implement the end-to-end checkout flow from cart summary through payment
processing to order confirmation. Includes Stripe integration, receipt
generation, and webhook handling.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-001.md << 'ENDOFFILE'
---
id: STAGE-002-001-001
ticket: TICKET-002-001
epic: EPIC-002
title: Cart Summary UI
status: Complete
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

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-002.md << 'ENDOFFILE'
---
id: STAGE-002-001-002
ticket: TICKET-002-001
epic: EPIC-002
title: Payment Form
status: Manual Testing
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-002-001-001
priority: 0
---

## Overview

Integrate Stripe Elements for secure card input. Build the payment form with
billing address, card details, and order review. Handle form validation and
submission states.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-003.md << 'ENDOFFILE'
---
id: STAGE-002-001-003
ticket: TICKET-002-001
epic: EPIC-002
title: Stripe Integration
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-002-001-002
  - STAGE-001-001-002
priority: 0
---

## Overview

Implement server-side Stripe payment intent creation, confirmation handling,
idempotency keys, and error mapping. Support both card payments and
saved payment methods.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-004.md << 'ENDOFFILE'
---
id: STAGE-002-001-004
ticket: TICKET-002-001
epic: EPIC-002
title: Order Confirmation
status: Not Started
session_active: false
refinement_type:
  - frontend
  - backend
depends_on:
  - STAGE-002-001-003
  - STAGE-001-002-001
priority: 0
---

## Overview

Show order confirmation page after successful payment. Send confirmation
email with order details, estimated delivery, and order tracking link.
Update inventory and order status in the database.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-005.md << 'ENDOFFILE'
---
id: STAGE-002-001-005
ticket: TICKET-002-001
epic: EPIC-002
title: Receipt Generation
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-002-001-003
priority: 1
---

## Overview

Generate PDF receipts for completed orders. Include itemized charges, tax
breakdown, payment method summary, and company details. Store receipts
and make them downloadable from order history.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-001/STAGE-002-001-006.md << 'ENDOFFILE'
---
id: STAGE-002-001-006
ticket: TICKET-002-001
epic: EPIC-002
title: Payment Webhooks
status: Not Started
session_active: false
refinement_type:
  - infrastructure
depends_on:
  - STAGE-002-001-003
  - EPIC-001
priority: 0
---

## Overview

Set up Stripe webhook endpoint to handle payment_intent.succeeded,
payment_intent.failed, charge.refunded, and dispute events. Implement
signature verification, idempotent processing, and dead letter queue
for failed webhook deliveries.
ENDOFFILE

# --- TICKET-002-002: Subscription Management ---

cat > epics/EPIC-002/TICKET-002-002/TICKET-002-002.md << 'ENDOFFILE'
---
id: TICKET-002-002
epic: EPIC-002
title: Subscription Management
status: In Progress
source: local
stages:
  - STAGE-002-002-001
  - STAGE-002-002-002
  - STAGE-002-002-003
  - STAGE-002-002-004
  - STAGE-002-002-005
  - STAGE-002-002-006
stage_statuses:
  STAGE-002-002-001: Finalize
  STAGE-002-002-002: Build
  STAGE-002-002-003: Not Started
  STAGE-002-002-004: Not Started
  STAGE-002-002-005: Not Started
  STAGE-002-002-006: Not Started
depends_on: []
---

## Overview

Build subscription lifecycle management including plan selection, billing,
cancellation, proration, and usage metering. Integrate with Stripe
Subscriptions API.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-001.md << 'ENDOFFILE'
---
id: STAGE-002-002-001
ticket: TICKET-002-002
epic: EPIC-002
title: Plan Selection UI
status: Finalize
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

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-002.md << 'ENDOFFILE'
---
id: STAGE-002-002-002
ticket: TICKET-002-002
epic: EPIC-002
title: Subscription API
status: Build
session_active: true
refinement_type:
  - backend
depends_on: []
priority: 0
---

## Overview

Implement subscription CRUD endpoints: create subscription, update plan,
cancel subscription, reactivate subscription. Map Stripe subscription
lifecycle events to internal state machine.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-003.md << 'ENDOFFILE'
---
id: STAGE-002-002-003
ticket: TICKET-002-002
epic: EPIC-002
title: Billing History
status: Not Started
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-002-002-002
priority: 0
---

## Overview

Display billing history page with invoice list, payment status, downloadable
invoices, and upcoming charge preview. Pull data from Stripe Invoices API
and cache locally.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-004.md << 'ENDOFFILE'
---
id: STAGE-002-002-004
ticket: TICKET-002-002
epic: EPIC-002
title: Cancellation Flow
status: Not Started
session_active: false
refinement_type:
  - frontend
  - backend
depends_on:
  - STAGE-002-002-002
priority: 0
---

## Overview

Build the subscription cancellation flow with reason selection, retention
offers, confirmation step, and grace period handling. Cancel at period end
by default with immediate cancellation as an option.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-005.md << 'ENDOFFILE'
---
id: STAGE-002-002-005
ticket: TICKET-002-002
epic: EPIC-002
title: Proration Logic
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-002-002-002
priority: 3
---

## Overview

Implement proration calculations for mid-cycle plan changes. Handle upgrades
(charge difference immediately) and downgrades (credit on next invoice).
Use Stripe's proration behavior configuration.
ENDOFFILE

cat > epics/EPIC-002/TICKET-002-002/STAGE-002-002-006.md << 'ENDOFFILE'
---
id: STAGE-002-002-006
ticket: TICKET-002-002
epic: EPIC-002
title: Usage Metering
status: Not Started
session_active: false
refinement_type:
  - database
depends_on:
  - STAGE-002-002-002
priority: 0
---

## Overview

Track API usage per subscription for metered billing. Implement usage record
ingestion, aggregation pipeline, and Stripe usage record reporting. Add
usage dashboards and threshold alerts.
ENDOFFILE

# --- TICKET-002-003: Refund Processing (no stages - "To Convert" ticket) ---

cat > epics/EPIC-002/TICKET-002-003/TICKET-002-003.md << 'ENDOFFILE'
---
id: TICKET-002-003
epic: EPIC-002
title: Refund Processing
status: Not Started
source: jira
jira_key: PAY-456
stages: []
stage_statuses: {}
depends_on:
  - TICKET-002-001
---

## Overview

Handle refund requests including full refunds, partial refunds, and refund
to store credit. Integrate with Stripe Refunds API and update order status
accordingly. Imported from Jira ticket PAY-456.
ENDOFFILE

###############################################################################
# EPIC-003: Notifications
###############################################################################

cat > epics/EPIC-003/EPIC-003.md << 'ENDOFFILE'
---
id: EPIC-003
title: Notifications
status: Not Started
tickets:
  - TICKET-003-001
ticket_statuses:
  TICKET-003-001: Not Started
depends_on:
  - EPIC-001
---

## Overview

Build a notification system for transactional emails including email templates,
a notification dispatch service, and payment-related notifications. Depends on
authentication and payment infrastructure from EPIC-001 and EPIC-002.
ENDOFFILE

# --- TICKET-003-001: Email Notifications ---

cat > epics/EPIC-003/TICKET-003-001/TICKET-003-001.md << 'ENDOFFILE'
---
id: TICKET-003-001
epic: EPIC-003
title: Email Notifications
status: Not Started
source: local
stages:
  - STAGE-003-001-001
  - STAGE-003-001-002
  - STAGE-003-001-003
stage_statuses:
  STAGE-003-001-001: Not Started
  STAGE-003-001-002: Not Started
  STAGE-003-001-003: Not Started
depends_on: []
---

## Overview

Implement email notification capabilities including reusable email templates,
a notification dispatch service, and payment-specific notifications. Builds on
the Welcome Email work from registration and integrates with the payment system.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-001/STAGE-003-001-001.md << 'ENDOFFILE'
---
id: STAGE-003-001-001
ticket: TICKET-003-001
epic: EPIC-003
title: Email Templates
status: Not Started
session_active: false
refinement_type:
  - frontend
depends_on:
  - STAGE-001-002-004
  - TICKET-001-002
priority: 0
---

## Overview

Create a reusable email template system with base layout, header/footer
components, and responsive design. Build templates for common notification
types. Extends the Welcome Email template patterns from registration.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-001/STAGE-003-001-002.md << 'ENDOFFILE'
---
id: STAGE-003-001-002
ticket: TICKET-003-001
epic: EPIC-003
title: Notification Service
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-003-001-001
  - STAGE-001-001-003
priority: 0
---

## Overview

Implement the core notification dispatch service with queue-based delivery,
retry logic, rate limiting, and delivery tracking. Requires session management
from auth to identify notification recipients and their preferences.
ENDOFFILE

cat > epics/EPIC-003/TICKET-003-001/STAGE-003-001-003.md << 'ENDOFFILE'
---
id: STAGE-003-001-003
ticket: TICKET-003-001
epic: EPIC-003
title: Payment Notifications
status: Not Started
session_active: false
refinement_type:
  - backend
depends_on:
  - STAGE-003-001-002
  - STAGE-002-001-005
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
echo "--- Epic 1: User Authentication (EPIC-001) ---"
echo "  TICKET-001-001: Login Flow (6 stages)"
echo "    - STAGE-001-001-001: Login Form UI          [Complete]"
echo "    - STAGE-001-001-002: Auth API Endpoints      [Complete]"
echo "    - STAGE-001-001-003: Session Management      [Build]"
echo "    - STAGE-001-001-004: Password Reset          [Not Started]"
echo "    - STAGE-001-001-005: Login Error Handling    [Design]"
echo "    - STAGE-001-001-006: Auth Logging            [Not Started]"
echo ""
echo "  TICKET-001-002: Registration Flow (6 stages)"
echo "    - STAGE-001-002-001: Signup Form UI          [Automatic Testing]"
echo "    - STAGE-001-002-002: User Validation API     [Complete]"
echo "    - STAGE-001-002-003: Email Verification      [Not Started]"
echo "    - STAGE-001-002-004: Welcome Email           [Not Started]"
echo "    - STAGE-001-002-005: Registration Analytics  [Not Started]"
echo "    - STAGE-001-002-006: GDPR Consent            [Design]"
echo ""
echo "--- Epic 2: Payment System (EPIC-002) ---"
echo "  TICKET-002-001: Checkout Flow (6 stages)"
echo "    - STAGE-002-001-001: Cart Summary UI         [Complete]"
echo "    - STAGE-002-001-002: Payment Form            [Manual Testing]"
echo "    - STAGE-002-001-003: Stripe Integration      [Not Started]"
echo "    - STAGE-002-001-004: Order Confirmation      [Not Started]"
echo "    - STAGE-002-001-005: Receipt Generation      [Not Started, priority=1]"
echo "    - STAGE-002-001-006: Payment Webhooks        [Not Started] (also depends: EPIC-001)"
echo ""
echo "  TICKET-002-002: Subscription Management (6 stages)"
echo "    - STAGE-002-002-001: Plan Selection UI       [Finalize]"
echo "    - STAGE-002-002-002: Subscription API        [Build, session_active]"
echo "    - STAGE-002-002-003: Billing History         [Not Started]"
echo "    - STAGE-002-002-004: Cancellation Flow       [Not Started]"
echo "    - STAGE-002-002-005: Proration Logic         [Not Started, priority=3]"
echo "    - STAGE-002-002-006: Usage Metering          [Not Started]"
echo ""
echo "  TICKET-002-003: Refund Processing (no stages - To Convert)"
echo "    Source: jira, jira_key: PAY-456"
echo "    Depends on: TICKET-002-001 (ticket→ticket)"
echo ""
echo "--- Epic 3: Notifications (EPIC-003, depends: EPIC-001) ---"
echo "  TICKET-003-001: Email Notifications (3 stages)"
echo "    - STAGE-003-001-001: Email Templates           [Not Started] (depends: STAGE-001-002-004 CROSS-EPIC, TICKET-001-002 stage→ticket)"
echo "    - STAGE-003-001-002: Notification Service      [Not Started] (depends: STAGE-003-001-001, STAGE-001-001-003 CROSS-EPIC)"
echo "    - STAGE-003-001-003: Payment Notifications     [Not Started] (depends: STAGE-003-001-002, STAGE-002-001-005 CROSS-EPIC)"
echo ""
echo "--- Cross-boundary Dependencies ---"
echo "  Cross-ticket (same epic, stage→stage):"
echo "    STAGE-001-002-003 (Email Verification) -> STAGE-001-001-002 (Auth API Endpoints)"
echo "    STAGE-001-002-006 (GDPR Consent) -> STAGE-001-001-001 (Login Form UI)"
echo "  Cross-epic (stage→stage):"
echo "    STAGE-002-001-003 (Stripe Integration) -> STAGE-001-001-002 (Auth API Endpoints)"
echo "    STAGE-002-001-004 (Order Confirmation) -> STAGE-001-002-001 (Signup Form UI)"
echo "    STAGE-003-001-001 (Email Templates) -> STAGE-001-002-004 (Welcome Email)"
echo "    STAGE-003-001-002 (Notification Service) -> STAGE-001-001-003 (Session Management)"
echo "    STAGE-003-001-003 (Payment Notifications) -> STAGE-002-001-005 (Receipt Generation)"
echo "  Stage → Ticket:"
echo "    STAGE-003-001-001 (Email Templates) -> TICKET-001-002 (Registration Flow)"
echo "  Stage → Epic:"
echo "    STAGE-002-001-006 (Payment Webhooks) -> EPIC-001 (User Authentication)"
echo "  Ticket → Ticket:"
echo "    TICKET-002-003 (Refund Processing) -> TICKET-002-001 (Checkout Flow)"
echo "  Epic → Epic:"
echo "    EPIC-003 (Notifications) -> EPIC-001 (User Authentication)"
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
