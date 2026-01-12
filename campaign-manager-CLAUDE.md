# Campaign Manager (With Input) - AI Development Guide

This project follows a **user-driven, incremental development approach** where the user shapes the UI through A/B options and iterative refinement.

## Reference Documents

- **Design Document**: [docs/design/2025-11-30-campaign-manager-with-input-design.md](docs/design/2025-11-30-campaign-manager-with-input-design.md)
- **Original Repository**: `/storage/programs/campaign_manager` (reference implementation)

## Table of Contents

1. [Project Overview](#project-overview)
2. [Repository Structure](#repository-structure)
3. [Tech Stack](#tech-stack)
4. [Development Commands](#development-commands)
5. [Subagents](#subagents)
6. [Common Gotchas](#common-gotchas)
7. [Temporal Evolution Terminology Glossary](#temporal-evolution-terminology-glossary)
8. [Git Worktrees](#git-worktrees)

---

## Project Overview

### Core Principles

- **User-driven UI**: Present 2-3 options for each component, user picks, then refine based on testing
- **Incremental development**: Small stages with frequent feedback loops
- **Session independence**: Each phase is a separate conversation; context preserved in tracking documents
- **Documentation as you go**: Docs updated with each feature, not batched at the end
- **Full feature parity**: All features from original campaign_manager, but UI/UX may differ based on feedback

### Hierarchy

- **Epic** = Feature (Dashboard, Map, Timeline, etc.)
- **Stage** = Single component or interaction within that feature
- **Phase** = Design | Build | Refinement | Finalize

---

## Repository Structure

```
campaign-manager-with-input/
   packages/
      api/               # NestJS GraphQL API
      frontend/          # React + Vite
      shared/            # Shared types
      rules-engine/      # Worker (placeholder initially)
      scheduler/         # Worker (placeholder initially)
   epics/
      EPIC-000-scaffolding/
         EPIC-000.md
         STAGE-000-XXX.md
      EPIC-001-dashboard/
         EPIC-001.md
         STAGE-001-XXX.md
      ...
   docs/
      design/            # Design documents
      features/          # Feature documentation
      development/       # Dev guides
      decisions/         # Detailed decision context (optional)
   .claude/
      commands/          # Slash commands (next_task, finish_phase)
      agents/            # Subagent definitions
   CHANGELOG.md           # Decision log with timestamps + commit hashes
   README.md              # User-facing, links to docs/
   CLAUDE.md              # This file - AI development protocol
   docker-compose.yml     # PostgreSQL + PostGIS + Redis
```

---

## Tech Stack

Identical to original campaign_manager repository:

- **Backend**: NestJS, GraphQL (Code-First), Prisma, PostgreSQL + PostGIS
- **Frontend**: React 18, Vite 5, Apollo Client, Zustand, Tailwind CSS
- **Visualization**: Leaflet, React Flow, Custom Canvas (timeline)
- **Workers**: rules-engine, scheduler (separate Node processes)
- **Testing**: Jest (backend), Vitest (frontend), Playwright (e2e - existing tests only, no new E2E tests being written)

### API Architecture Notes

- **GraphQL Code-First**: Schema auto-generated from TypeScript decorators
- **TypeScript classes** with `@ObjectType` and `@Field` define GraphQL types
- **Resolvers** use `@Query`, `@Mutation`, `@Subscription` decorators
- **Never manually edit** `schema.gql` - it regenerates on server start
- **See**: [docs/api/graphql-schema/](docs/api/graphql-schema/) for detailed API documentation

---

## Development Commands

**CRITICAL: Always run all commands from the project root directory** (`/storage/programs/campaign-manager-with-input`). Do NOT use `cd` to navigate into package directories. Use `pnpm --filter` to target specific packages instead.

```bash
# Root-level commands (run everything)
pnpm install          # Install all dependencies
pnpm run build        # Build all packages
pnpm run dev          # Start all dev servers
pnpm run test         # Run all tests
pnpm run type-check   # Type-check all packages
pnpm run lint         # Lint all packages
pnpm run format       # Format all code

# Verify commands (CI pipeline locally)
pnpm run verify           # Run all checks: build, type-check, lint, test
pnpm run verify:continue  # Run all checks, continue on failure
pnpm run verify:quick     # Skip build step (if already built)

# Package-specific commands (use --filter)
pnpm --filter @campaign/api dev           # Start API only
pnpm --filter @campaign/frontend dev      # Start frontend only
pnpm --filter @campaign/shared test       # Test shared only
pnpm --filter @campaign/api type-check    # Type-check API only
```

---

## Subagents

### Usage Rules

- **doc-updater**: Use for ALL tracking document updates
- **code-reviewer**: Use before AND after tests in Finalize phase
- **typescript-tester**: Use to write and run unit tests (no new E2E tests being written)
- **typescript-fixer**: Use for TypeScript/ESLint errors
- **prisma-debugger**: Use for database/Prisma issues
- **task-navigator**: Powers `/next_task` command
- **Explore**: Use for ALL codebase research and pattern discovery
- **general-purpose**: Use for code implementation during Build phase

### Finalize Phase Subagent Sequence

```
1. code-reviewer    → Review code before tests
2. typescript-tester → Write unit tests only (no new E2E tests)
3. code-reviewer    → Review code after tests
4. doc-updater      → Update README, feature docs, CLAUDE.md
5. doc-updater      → Add CHANGELOG entry after commit
```

**Code Review Policy:**

- ALL code review suggestions must be implemented, regardless of severity
- Minor suggestions (naming, consistency, type specificity) are still mandatory
- Only skip a suggestion if it would break functionality (document why in the stage file)
- "Nice to have" = "Must have" in this project
- Both pre-test and post-test code reviews follow this policy

**Testing Strategy:**

- **Unit tests only**: Write unit tests for new features and bugfixes
- **Existing E2E tests**: Remain in the codebase and can be run for regression testing, but no new E2E tests are being written
- **E2E test documentation**: Kept for reference when running existing E2E tests

### Project-Specific Reminders

- **Never break the dev server** - User should always see working code
- **Placeholders for future features** - Stub out related features as you go
- **Always run from root directory** - Never `cd` into package directories
- **Present 2-3 UI options in Design phase**
- **Iterate in Refinement until user explicitly approves**

---

## Common Gotchas

### Database Configuration

#### Multiple Databases

This project has **two databases** configured:

- `campaign_db` - Used by the dev server (defined in `packages/api/.env`)
- `campaign_dev` - Used by existing E2E tests (defined in test configurations)

**Always check which database you're targeting:**

```bash
# Check what .env uses
cat packages/api/.env | grep DATABASE_URL
# → postgresql://campaign_user:campaign_pass@localhost:5432/campaign_db

# When running Prisma commands, use the correct DATABASE_URL
DATABASE_URL="postgresql://campaign_user:campaign_pass@localhost:5432/campaign_db" \
  pnpm --filter @campaign/api exec prisma migrate reset --force
```

#### Prisma AI Agent Consent (Development Repository)

Prisma v6.15+ detects AI agents and blocks destructive commands like `migrate reset` without explicit user consent. **This is a development-only repository**, so when the user confirms they want to reset the database, always include the consent variable:

```bash
# ALWAYS use this pattern for database resets in this repo
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" \
DATABASE_URL="postgresql://campaign_user:campaign_pass@localhost:5432/campaign_db" \
pnpm --filter @campaign/api exec prisma migrate reset --force
```

**Important notes:**

- This repo has NO production database - all databases are local development only
- When the user says "yes" to reset, use `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes"`
- There is currently no way to disable this check globally (see [Prisma issue #28196](https://github.com/prisma/prisma/issues/28196))
- After reset, always run the seed script: `pnpm --filter @campaign/api run prisma:seed` (this also creates version records automatically)

#### Prisma Client Caching After Migrations

When you run `prisma migrate reset` or `prisma generate`, the Prisma client is updated in `node_modules`. However, **a running dev server won't pick up these changes** because:

- `ts-node-dev` doesn't watch `node_modules`
- The old Prisma client is cached in memory

**Fix:** After any Prisma schema/migration changes:

1. Stop the dev server (`pkill -f "ts-node-dev"`)
2. Run the migration: `prisma migrate reset --force` or `prisma generate`
3. Restart the dev server: `pnpm run dev`

#### Migration Sync Issues

If migrations show as "applied" but tables don't exist, the migration history is out of sync:

```bash
# Nuclear option - reset everything
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" \
DATABASE_URL="postgresql://campaign_user:campaign_pass@localhost:5432/campaign_db" \
pnpm --filter @campaign/api exec prisma migrate reset --force

# Then re-seed (includes version records automatically)
DATABASE_URL="postgresql://campaign_user:campaign_pass@localhost:5432/campaign_db" \
pnpm --filter @campaign/api run prisma:seed
```

#### Nullable JSON Fields (Prisma.DbNull)

When explicitly setting a nullable `Json?` field to `null` in Prisma, you must use `Prisma.DbNull` instead of `null`. This is required because Prisma distinguishes between:

- `undefined` - Don't update this field
- `null` - Set to JSON `null` value (not what you want for database NULL)
- `Prisma.DbNull` - Set the database column to NULL

**Example (tombstone versioning):**

```typescript
import { Prisma } from '@prisma/client';

// WRONG - sets JSON value to null, not database NULL
await prisma.entityVersion.create({
  data: {
    snapshot: null, // This stores the JSON value null
    isTombstone: true,
  },
});

// CORRECT - sets database column to NULL
await prisma.entityVersion.create({
  data: {
    snapshot: Prisma.DbNull, // This stores database NULL
    isTombstone: true,
  },
});
```

This pattern is used in the versioning module for tombstone records where the snapshot should be database NULL (not a JSON null value).

#### BigInt Handling in GraphQL Mutations

GraphQL scalar types (like `BigInt`) require custom serialization/deserialization transformers. When a mutation has nullable BigInt parameters alongside other fields, you cannot pass these parameters directly to the mutation signature. Instead, wrap them in an `InputType` class with proper decorators.

**Problem**: Passing nullable parameters with custom transformers directly causes serialization errors:

```typescript
// WRONG - BigInt transformer doesn't apply to nullable direct parameters
@Mutation()
updateEntity(
  @Args('worldTime', { type: () => BigInt, nullable: true }) worldTime?: bigint,
) {
  // worldTime fails to deserialize if null or undefined
}
```

**Solution**: Wrap BigInt and related parameters in an `InputType`:

```typescript
import { InputType, Field } from '@nestjs/graphql';
import { BigIntTransform } from '@campaign/shared';

@InputType()
export class VersioningOptionsInput {
  @Field(() => BigInt, { nullable: true })
  @BigIntTransform()
  worldTime?: bigint;

  @Field({ nullable: true })
  skipVersioning?: boolean;
}

// CORRECT - VersioningOptionsInput wraps both fields with proper decorators
@Mutation()
updateEntity(
  @Args('input') input: UpdateEntityInput,
  @Args('options', { nullable: true }) options?: VersioningOptionsInput,
) {
  const worldTime = options?.worldTime;
  const skipVersioning = options?.skipVersioning;
  // Now serialization works correctly
}
```

**Why this matters:**

- The `@BigIntTransform()` decorator only applies to fields when they're inside an `InputType` class
- Direct mutation parameters bypass the InputType decorator mechanism
- Nullable parameters with custom transformers need to be wrapped for decorators to take effect
- This pattern is used in version-aware mutations: `updateEntity`, `updateEntityTypeDefinition`, geometry updates, etc.

**Related files:**

- `packages/api/src/graphql/types/versioning-options.type.ts` - The InputType wrapper
- `packages/api/src/graphql/resolvers/entity.resolver.ts` - Usage example
- `packages/shared/src/decorators/big-int.decorator.ts` - The BigIntTransform decorator

### Dev Server

#### Port Conflicts

The dev server uses:

- **Port 3000**: Frontend (Vite)
- **Port 4000**: API (NestJS)

If ports are in use, check for zombie processes:

```bash
# Find what's using the ports
ss -tlnp | grep -E ":3000|:4000"

# Kill all campaign-manager processes
pkill -f "ts-node-dev"; pkill -f "vite"
```

#### Verifying Server Health

```bash
# Frontend check
curl -s http://localhost:3000 > /dev/null && echo "Frontend: OK" || echo "Frontend: FAIL"

# API check
curl -s http://localhost:4000/graphql -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}' && echo " - API: OK"
```

### Derived Properties

#### UI Display Pattern

Derived properties are computed values displayed in the Entity Inspector with distinct visual treatment:

**Component Pattern:**

- `DerivedPropertyField.tsx` - Display component with loading/error states
- `useDerivedPropertyValue.ts` - Hook for fetching computed values
- Uses `cache-first` fetchPolicy to reduce network load (intentional for performance)

**Visual States:**

- **Loading**: Skeleton shimmer while fetching
- **Success**: Blue "Computed" badge + formatted value
- **Error**: "Error loading value" with retry button

**Formula Editor Integration:**

- Click edit icon to open FormulaEditorModal
- Return type is locked when editing entity-level overrides (prevents type mismatches)
- Modal shows formula preview and allows editing

**Important Notes:**

- Derived property values are fetched separately from entity data (not included in entity query)
- Each derived property makes its own GraphQL query: `evaluateDerivedProperty(entityId, propertyName, worldTime)`
- Results are cached in Apollo Client cache with `cache-first` policy
- Backend caches results in Redis (5-minute TTL, campaign-wide invalidation)

**Example Seed Data:**

- Character type has `fullName` derived property (formula: firstName + " " + lastName)
- Character type has `isAdult` derived property (formula: age >= 18)
- Test case: Bokken the Hermit (age 16) for testing isAdult=false

### Frontend Logs

All browser console output (log, info, warn, error, debug) is forwarded to the API and written to a file for debugging.

#### Log File Location

```
/tmp/campaign-frontend.log
```

#### Log Clearing

Logs are automatically cleared on each page load/refresh to ensure fresh logs for each debugging session. You can also manually clear logs:

```bash
# Clear the log file via API
curl -X DELETE http://localhost:4000/logs

# Or directly remove the file
rm /tmp/campaign-frontend.log
```

**Note**: Automatic clearing happens in `logger.ts` initialization, so each browser session starts with an empty log file.

#### Reading Logs

```bash
# View latest logs
tail -f /tmp/campaign-frontend.log

# View last 50 lines
tail -50 /tmp/campaign-frontend.log

# Search for errors
grep "ERROR" /tmp/campaign-frontend.log
```

#### What Gets Logged

- All `console.log/info/warn/error/debug` calls from the browser
- React errors caught by the Error Boundary (with component stack traces)
- Unhandled JavaScript errors
- Unhandled promise rejections

#### Log Format

```
[ISO-TIMESTAMP] LEVEL [URL] Message
  Stack: ... (for errors)
  Component Stack: ... (for React errors)
```

#### Implementation Details

- **API Endpoints**:
  - `POST /logs` (single entry) or `POST /logs/batch` (multiple entries)
  - `DELETE /logs` (clear log file)
- **Frontend**: `packages/frontend/src/utils/logger.ts` - intercepts console methods and clears on init
- **API**: `packages/api/src/logging/logging.controller.ts` - writes to file
- **Error Boundary**: `packages/frontend/src/components/ErrorBoundary.tsx`

**Note**: Logs are ephemeral - `/tmp` is cleared on system reboot. For persistent debugging, copy the log file elsewhere.

### GraphQL API

#### Schema Auto-Generation

The `schema.gql` file is auto-generated from TypeScript decorators. **Never edit it manually.** It regenerates when the API server starts.

#### Finding the Right Query/Mutation Names

Use GraphQL introspection or check the resolver files:

```bash
# List all queries
grep -r "@Query" packages/api/src/graphql/resolvers/

# List all mutations
grep -r "@Mutation" packages/api/src/graphql/resolvers/
```

#### Event Payload Field Names

When calling `EventAppendService.appendEventWithTx()` for entity mutations, the payload must use `entityType` (containing the type **name**, not UUID). This is a common source of confusion:

**Wrong** - passing the ID:

```typescript
await this.eventAppendService.appendEventWithTx(tx, {
  eventType: 'ENTITY_CREATED',
  entityType: entity.entityTypeId, // WRONG - this is a UUID
  // ...
});
```

**Correct** - passing the type name:

```typescript
const entityType = await tx.entityTypeDefinition.findUniqueOrThrow({
  where: { id: input.entityTypeId },
});

await this.eventAppendService.appendEventWithTx(tx, {
  eventType: 'ENTITY_CREATED',
  entityType: entityType.name, // CORRECT - "Character", "Settlement", etc.
  // ...
});
```

The `EventAppendService` validator expects `entityType` to be a human-readable type name string, not a database ID. This affects all entity mutations: `createEntity`, `updateEntity`, `deleteEntity`, `restoreEntity`.

### Docker (PostgreSQL)

#### Checking Database Contents

```bash
# Get the postgres container ID
CONTAINER_ID=$(docker ps -q --filter "name=postgres")

# Run queries
docker exec -i $CONTAINER_ID psql -U campaign_user -d campaign_db -c "SELECT * FROM campaigns;"
```

#### Database Connection Issues

If the API can't connect to the database:

1. Ensure Docker is running: `docker ps`
2. Check if postgres container is up: `docker ps --filter "name=postgres"`
3. Verify connection string matches `.env` file

### Redis Cache

#### Cache Key Encoding

Cache keys use colons (`:`) as separators. If entity/type/geometry IDs contain colons, they are automatically encoded to double-underscores (`__`) to prevent key structure corruption:

```typescript
// ID with colons: "some:id:with:colons"
// Encoded in key: "entity:some__id__with__colons:branch-id:latest"
```

**Always use the CacheKeys helper functions** rather than constructing keys manually.

#### TTL Environment Overrides

All cache TTL values can be overridden via environment variables (values in seconds):

```bash
CACHE_TTL_ENTITY_LATEST=600    # Default: 300 (5 min)
CACHE_TTL_ENTITY_VERSION=7200  # Default: 3600 (1 hour)
CACHE_TTL_TYPE_LATEST=1800     # Default: 600 (10 min)
CACHE_TTL_GEOMETRY_LATEST=600  # Default: 300 (5 min)
```

#### Redis Connection

Redis connection is configured via environment variables:

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=       # Optional
REDIS_DB=0           # Database number
```

The `RedisService` connects automatically on module init and disconnects on shutdown.

#### Version Compression

The `CompressionService` runs hourly to convert old version snapshots to JSON Patches:

```bash
COMPRESSION_KEEP_UNCOMPRESSED=10  # Default: 10 (versions to keep as full snapshots)
COMPRESSION_BATCH_SIZE=1000       # Default: 1000 (max items per compression run)
JOB_RUN_RETENTION_DAYS=30         # Default: 30 (days to keep job run records)
```

**Key behaviors:**

- Keeps last N versions as full snapshots for fast retrieval
- Older versions are converted to JSON Patches (RFC 6902) referencing a base version
- Tombstone versions (deletions) are never compressed
- Manual trigger: `CompressionScheduler.triggerCompression()`

### Metrics & Monitoring

#### Prometheus and Grafana

Monitoring infrastructure is included in docker-compose.yml:

- **Prometheus**: http://localhost:9091 - Metrics storage and querying
- **Grafana**: http://localhost:3003 - Visualization dashboards (credentials: admin/campaign)
- **Metrics Endpoint**: http://localhost:4000/metrics - Raw Prometheus metrics

The `prom-client` npm package is used for instrumenting the API with Prometheus-compatible metrics.

#### Checking Metrics

```bash
# View raw Prometheus metrics
curl http://localhost:4000/metrics

# View JSON cache metrics
curl http://localhost:4000/admin/metrics/cache

# Access Grafana dashboard
open http://localhost:3003  # Login: admin/campaign
```

#### Metric Types

The codebase uses these `prom-client` metric types:

- **Counter**: Monotonically increasing values (e.g., `cache_hits_total`)
- **Gauge**: Values that can go up or down (e.g., `cache_memory_bytes`)
- **Histogram**: Distribution of values with configurable buckets (e.g., `cache_reconstruction_duration_seconds`)

---

### E2E Tests Database Reset

**NOTE: This section describes existing E2E tests. No new E2E tests are being written. This documentation is maintained for running and debugging the existing E2E test suite.**

E2E tests automatically reset and re-seed the database before running. This is handled by Playwright's global setup script (`packages/frontend/e2e/global-setup.ts`).

#### What Happens on Test Run

1. `prisma migrate reset --force` drops all tables and re-applies migrations
2. The seed script (`packages/api/prisma/seed.ts`) runs automatically
3. Tests execute with clean, consistent data

#### Important Notes

- **Dev server shares database**: E2E tests use `campaign_db` (same as dev server)
- **Don't manually test during E2E runs**: Tests will reset data you're working with
- **Prisma client regenerates**: The `migrate reset` regenerates Prisma client; dev server may need restart after interrupted test runs

#### Running E2E Tests

```bash
# Run fast tests only (default for CI - excludes @slow tagged tests)
pnpm --filter @campaign/frontend exec playwright test --grep-invert @slow

# Run all E2E tests (includes database reset)
pnpm --filter @campaign/frontend exec playwright test

# Run specific test file
pnpm --filter @campaign/frontend exec playwright test map-settings.spec.ts

# Run specific project (viewport)
pnpm --filter @campaign/frontend exec playwright test --project=desktop
```

#### Skipping Database Reset

If you need to run tests without resetting (e.g., testing against existing data):

```bash
# Set SKIP_DB_RESET environment variable
SKIP_DB_RESET=true pnpm --filter @campaign/frontend exec playwright test
```

Note: The global setup checks for this variable and skips reset if set.

### Slow E2E Tests (Tile Generation)

**NOTE: This section describes existing E2E tests. No new E2E tests are being written. This documentation is maintained for running and debugging the existing E2E test suite.**

This project has two categories of tile generation E2E tests:

- **Fast tests (22 tests)**: Run in CI, use mocking fixtures, complete in seconds
- **Slow tests (187 tests)**: Tagged with `@slow`, test real tile generation (30-120s per layer)

#### What the @slow Tag Means

Tests tagged with `@slow` in their test name call the real tile slicer API instead of using mocks:

- **Fast tests** (default): Use mocking fixtures from `packages/frontend/e2e/fixtures/tile-mocking.ts` to simulate tile generation instantly
- **@slow tests**: Call the real tile slicer API, generating actual map tiles and testing the full integration

**Use @slow tests for:**

- Local development when testing tile generation changes
- Full integration verification before merging tile-related PRs
- Debugging tile generation issues

**Do NOT use @slow tests for:**

- CI/CD pipelines (too slow)
- Quick feedback during development
- Testing non-tile features

#### Test Files with @slow Tests

| Test File                  | Slow Tests | What They Test                               |
| -------------------------- | ---------- | -------------------------------------------- |
| `map-layer-upload.spec.ts` | 23 tests   | Upload flows, offset workflows, layer CRUD   |
| `canvas-resizing.spec.ts`  | 49 tests   | Canvas size changes triggering regeneration  |
| `map-settings.spec.ts`     | 115 tests  | Settings panel interactions, offset controls |

**Total @slow tests**: 187 across 3 files

#### Running Slow Tests

```bash
# Run only fast tests (default - recommended for CI)
pnpm --filter @campaign/frontend exec playwright test --grep-invert @slow

# Run ONLY @slow tests (WARNING: takes 15-60 minutes)
pnpm --filter @campaign/frontend exec playwright test --grep @slow

# Run @slow tests for specific file
pnpm --filter @campaign/frontend exec playwright test --grep @slow map-layer-upload.spec.ts

# Run @slow tests for specific viewport
pnpm --filter @campaign/frontend exec playwright test --grep @slow --project=desktop

# Run ALL tests (fast + slow)
pnpm --filter @campaign/frontend exec playwright test
```

#### Timeout Considerations

@slow tests have extended timeouts to accommodate real tile generation:

- **Per-test timeout**: 120 seconds (vs. 30s default)
- **Layer generation time**: 30-120s depending on layer size
- **Total suite time**: 15-60 minutes for all @slow tests

**Why @slow tests are slow:**

- Real tile slicer API generates actual raster tiles
- Large layers (4096×4096px) can take 2 minutes
- Multiple layers per test accumulate time
- No parallelization within viewport (Playwright runs serially per project)

#### Mock vs. Real Test Coverage

**Fast tests (mocked):**

- Verify UI interactions work correctly
- Check that tile requests are made
- Test progress UI updates
- Validate error handling flows

**@slow tests (real):**

- Confirm tiles actually generate on disk
- Verify tile metadata is correct
- Test offset regeneration produces different tiles
- Ensure canvas resizing triggers regeneration
- Validate layer deletion cleans up tiles

**Strategy**: Use fast tests for development velocity, run `--grep @slow` before merging tile-related changes.

---

## Temporal Evolution Terminology Glossary

### Branch-Related Terms

- **Main Branch**: The primary timeline representing the canonical campaign state. All materialized events and current world state exist on this branch.
- **Stub Branch**: A visual-only placeholder for potential future outcomes displayed in the timeline UI. Contains no actual data - state is computed on-demand when explored.
- **Materialized Branch**: A branch with fully computed and stored state. Created either from exploration decisions or encounter outcomes, with all events persisted to the database.
- **Lazy Materialization**: Computing branch state on-demand when a user explores a stub branch. Computes from parent branch state + decision outcome effects + any additional events. Cache is temporary until the branch becomes permanent.
- **Permanent Materialization**: When a stub branch becomes a full materialized branch. Triggered by user hitting a decision point while exploring, or explicitly choosing to keep the branch.
- **Branch Divergence**: A record tracking how two branches differ. Stores property-level deltas between branches for equivalence detection and merge operations.
- **Branch Collapse**: When two branches become equivalent (same state) and are merged back into one. Triggered when divergence delta becomes empty or confidence threshold is met.
- **Branch Equivalence**: When two branches have the same effective state despite different event histories. Detected via divergence comparison with confidence scoring.

### Time-Related Terms

- **World Time**: The in-game/in-world time tracked by the campaign's fantasy calendar. Distinct from real-world time - advances via explicit time controls.
- **Present Time**: The current world time - the "now" of the campaign. Represents the latest materialized time on the active branch.
- **View Time**: The world time the user is currently viewing in the UI. Can be different from present time (viewing the past or future stubs).
- **Free Edit Mode**: A toggle that suppresses "editing the past" warnings. Allows direct modifications to historical events without confirmation dialogs.

### State-Related Terms

- **Materialized State Cache**: Pre-computed snapshots of entity state at specific time points. Stored for quick retrieval instead of replaying all events from the beginning.
- **Snapshot**: A specific cached state at a point in time. Part of the materialized state cache system.
- **State Reconstruction**: The process of rebuilding entity state by replaying events from the event store. Used when cache misses occur or refresh is needed.
- **Event Replay**: Sequential application of events from the event store to reconstruct state at any point in time. Foundation of event sourcing architecture.

### Event-Related Terms

- **Event Store**: Append-only storage of all state-changing events. Foundation of event sourcing - current state is derived from event history rather than stored directly.
- **CampaignEvent**: The Prisma model representing a single immutable event in the event store. Contains eventType, worldTime (BigInt), sequenceNumber, entityId/entityType, and a JSON payload. Indexed for temporal queries by campaign and entity.
- **EventType**: System-defined enum of event types used by CampaignEvent. Core entity types (ENTITY_CREATED, ENTITY_UPDATED, ENTITY_SOFT_DELETED, ENTITY_RESTORED) are wired to GraphQL mutations via EventAppendService. Extended types include geometry, relationship, and rules engine events.
- **State Event**: An immutable record of a state change (entity created, property modified, geometry moved, etc.). Once written, events are never modified or deleted.
- **Event Sourcing**: Architecture pattern where current state is computed from event history rather than stored directly. Enables time travel, branching, and audit trails.

### Rules Engine Terms

- **State Variable**: A named value scoped to campaign, kingdom, party, settlement, or character level. Can be primitive (string/number/boolean) or structured (JSON).
- **Derived Variable**: A computed state variable whose value is calculated from other variables using JSONLogic formulas. Read-only and automatically updated when dependencies change.
- **Condition**: A JSONLogic expression that evaluates to true/false. Used for triggers, validations, and branching logic in encounters and rules.
- **Effect**: An action triggered by a condition or encounter outcome. Uses JSON Patch format to modify state (add/remove/update properties or variables).
- **Cascade Propagation**: When a state change triggers re-evaluation of dependent conditions, which may trigger more effects, which may trigger more conditions, etc. System detects and prevents infinite loops.

### Conflict-Related Terms

- **Conflict**: When merging branches produces incompatible values for the same property or geometry. Requires resolution before merge can complete.
- **Conflict Resolution**: The process of choosing which value to keep when branches conflict. Can be manual (user picks), priority-based (branch priority wins), or auto-merged (for compatible changes like geometry on different maps).

### Geometry Terms

- **Campaign Isolation**: Entities must exist in the same campaign as their map geometry. Cross-campaign geometry (e.g., an entity from Campaign A having geometry on a map in Campaign B) is not supported. This is enforced by the versioning system which requires matching campaign IDs when creating GeometryVersions.
- **Entity-Owned Geometry**: All map geometries (points, paths, polygons) are owned by an entity. No orphan geometries allowed - geometry lifecycle tied to entity lifecycle. This rule is enforced at the database level via NOT NULL constraints on `entityId` columns in geometry tables (MapLayerPoint, MapLayerPath, MapLayerPolygon). The seed script ensures all geometries link to valid entities.
- **Ownership Transfer Pattern**: When geometry ownership changes between entities, the system creates two GeometryVersions: a tombstone in the old owner's lineage (marking the end of their ownership) and a new version with `previousVersionId: null` starting a fresh lineage for the new owner. This preserves complete history while establishing clear ownership boundaries.
- **Per-Map Geometry**: Position and shape are stored separately for each map an entity appears on. An entity can have different geometry on different maps (e.g., regional map vs. city map).
- **Placeholder Layer**: When restoring geometry that belonged to a deleted map layer, the system can create a placeholder layer with `isRestoredPlaceholder: true`. This allows the geometry to be restored without recreating the original layer, giving users the option to move the geometry to an appropriate layer later.

### Version Model Terms

- **Three-Table Version Hierarchy**: The temporal versioning architecture uses three linked tables: TypeVersion (schema evolution), EntityVersion (entity state evolution), and GeometryVersion (geometry evolution). Each level references its parent to maintain schema context.
- **TypeVersion**: Tracks schema evolution for entity types. When a type's property schema changes, a new TypeVersion is created containing the complete schema snapshot. EntityVersions reference the TypeVersion that was active at creation time.
- **EntityVersion**: Tracks entity state changes over time. Each change creates a new version rather than modifying in place (event sourcing). Links to TypeVersion for schema context and can store full snapshots or JSON patches for compression.
- **Version Chain**: Self-referential relation (previousVersion/childVersions) forming a git-like history of changes. Enables traversing version history forward or backward.
- **Base Version / Derived Versions**: Self-referential relation for compression. A derived version stores only a JSON patch relative to its base version rather than a full snapshot.
- **Tombstone**: A version record marking entity deletion. `isTombstone: true` indicates the entity was deleted at this version point. Entity.deletedAt stores the soft delete timestamp.
- **Snapshot vs Patch**: Two storage strategies for version data. Snapshots store complete state (fast retrieval, more storage). Patches store only changes from a base version (less storage, requires reconstruction).

---

## Git Worktrees

### Rules

- Never create a worktree without explicit user consent
- Never merge a worktree without explicit user consent
- All subagents must be told they're on worktrees (include full context block from skill)
- Always use the `using-git-worktrees` skill when working with worktrees
- When starting a worktree, the main agent moves INTO the worktree directory
- When ending a worktree, the main agent moves BACK to the project root
- These are the ONLY permitted directory changes - subagents NEVER change directories

### Worktree Config

```
worktree-directory: .worktrees
worktree-ports:
  frontend: 3000 → 3001
  api: 4000 → 4001
worktree-database: separate
worktree-database-pattern: campaign_db_[feature]
worktree-start-commands:
  frontend: pnpm --filter @campaign/frontend dev
  api: pnpm --filter @campaign/api dev
```
