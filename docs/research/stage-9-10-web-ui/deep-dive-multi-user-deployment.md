# Deep Dive: Multi-User Deployment Patterns

## Research Summary

This document examines three repositories for patterns applicable to building a web view of Claude Code sessions that works locally (single user) and on a hosted EC2 instance (multi-user).

---

## 1. vibe-kanban (PRIMARY FOCUS)

### Architecture Overview

vibe-kanban has the most mature local-to-remote architecture. It uses a **trait-based deployment abstraction** in Rust that cleanly separates local single-user mode from remote multi-user mode.

**Key insight**: They have TWO entirely separate crates for local vs. remote:
- `crates/local-deployment/` - Single-user Electron app mode
- `crates/remote/` - Multi-user hosted server with full auth, Postgres, and organizations

These share a common `crates/deployment/` trait but are otherwise independent applications.

### The Deployment Trait Pattern

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/deployment/src/lib.rs`

```rust
#[async_trait]
pub trait Deployment: Clone + Send + Sync + 'static {
    async fn new() -> Result<Self, DeploymentError>;
    fn user_id(&self) -> &str;
    fn config(&self) -> &Arc<RwLock<Config>>;
    fn db(&self) -> &DBService;
    fn analytics(&self) -> &Option<AnalyticsService>;
    fn container(&self) -> &impl ContainerService;
    fn git(&self) -> &GitService;
    fn repo(&self) -> &RepoService;
    fn image(&self) -> &ImageService;
    fn filesystem(&self) -> &FilesystemService;
    fn events(&self) -> &EventService;
    fn file_search_cache(&self) -> &Arc<FileSearchCache>;
    fn approvals(&self) -> &Approvals;
    fn queued_message_service(&self) -> &QueuedMessageService;
    fn auth_context(&self) -> &AuthContext;
    fn remote_client(&self) -> Result<RemoteClient, RemoteClientNotConfigured> {
        Err(RemoteClientNotConfigured) // Default: no remote
    }
    fn shared_api_base(&self) -> Option<String> {
        None // Default: no shared API
    }
}
```

**Key pattern**: The trait defines a common interface. Local deployment uses SQLite + filesystem, remote uses Postgres + S3/Azure Blob. The `remote_client()` and `shared_api_base()` methods have default implementations that return "not configured" — local mode simply uses the defaults.

### LocalDeployment Implementation

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/local-deployment/src/lib.rs`

The local deployment:
- Generates a `user_id` from system-level hashing (not auth)
- Uses `OAuthCredentials` loaded from a local file (`credentials_path()`)
- Optionally connects to a remote shared API via `VK_SHARED_API_BASE` env var
- Has PTY service for terminal sessions
- Uses file-based config (`config_path()`)

```rust
let user_id = generate_user_id();  // Hash-based, no auth required
let oauth_credentials = Arc::new(OAuthCredentials::new(credentials_path()));
let auth_context = AuthContext::new(oauth_credentials.clone(), profile_cache.clone());

// Remote client is optional — only if VK_SHARED_API_BASE is set
let api_base = std::env::var("VK_SHARED_API_BASE").ok();
let remote_client = match &api_base {
    Some(url) => RemoteClient::new(url, auth_context.clone()),
    None => Err(RemoteClientNotConfigured),
};
```

### Remote (Multi-User) Authentication System

#### OAuth Flow

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/remote/src/auth/provider.rs`

Two OAuth providers are supported:
- **GitHub OAuth** — `read:user`, `user:email` scopes
- **Google OAuth** — `openid`, `email`, `profile` scopes (with refresh token support)

The `AuthorizationProvider` trait:
```rust
#[async_trait]
pub trait AuthorizationProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn scopes(&self) -> &[&str];
    fn authorize_url(&self, state: &str, redirect_uri: &str) -> Result<Url>;
    async fn exchange_code(&self, code: &str, redirect_uri: &str) -> Result<AuthorizationGrant>;
    async fn fetch_user(&self, access_token: &SecretString) -> Result<ProviderUser>;
    async fn validate_token(
        &self,
        token_details: &ProviderTokenDetails,
        max_retries: u32,
    ) -> Result<Option<ProviderTokenDetails>, TokenValidationError>;
}
```

The `ProviderRegistry` allows registering multiple providers dynamically.

#### JWT Token System

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/remote/src/auth/jwt.rs`

Two-token system:
1. **Access Token** — 120 seconds TTL (very short)
   - Contains: `sub` (user UUID), `session_id`, `iat`, `exp`, `aud: "access"`
2. **Refresh Token** — 365 days TTL
   - Contains: same fields + `jti` (unique token ID) + encrypted provider tokens blob
   - Provider tokens are AES-256-GCM encrypted inside the JWT

```rust
pub const ACCESS_TOKEN_TTL_SECONDS: i64 = 120;
pub const REFRESH_TOKEN_TTL_DAYS: i64 = 365;
```

Token rotation: When refreshing, the old refresh token is revoked and a new one is issued. Reuse detection triggers revocation of ALL user sessions (security measure against token theft).

#### Auth Middleware

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/remote/src/auth/middleware.rs`

The `require_session` middleware:
1. Extracts Bearer token from `Authorization` header
2. Decodes JWT access token
3. Validates session exists in DB and is not revoked
4. Checks session inactivity (365-day max)
5. Loads user from DB
6. Injects `RequestContext { user, session_id, access_token_expires_at }` into request extensions
7. Touches session (updates `last_used_at`)

```rust
pub struct RequestContext {
    pub user: User,
    pub session_id: Uuid,
    pub access_token_expires_at: DateTime<Utc>,
}
```

#### OAuth Token Validation

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/remote/src/auth/oauth_token_validator.rs`

On refresh, the system validates that the OAuth provider token is still valid (checking GitHub API rate limit endpoint or Google tokeninfo). If the provider token is revoked, ALL user sessions are revoked.

### Organization Model & Multi-Tenancy

#### Database Schema

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/remote/migrations/20251001000000_shared_tasks_activity.sql`

```sql
CREATE TABLE organizations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    is_personal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT NOT NULL UNIQUE,
    first_name   TEXT,
    last_name    TEXT,
    username     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE member_role AS ENUM ('admin', 'member');

CREATE TABLE organization_member_metadata (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            member_role NOT NULL DEFAULT 'member',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ,
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    ...
);

CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_id UUID REFERENCES issues(id) ON DELETE SET NULL,
    local_workspace_id UUID UNIQUE,
    ...
);
```

**Key design**:
- Row-level isolation through foreign keys: `organizations` -> `projects` -> `issues`/`workspaces`
- Membership table (`organization_member_metadata`) links users to orgs with roles
- `owner_user_id` on workspaces — resources owned by specific users within an org
- NOT schema-per-tenant; single shared schema with row-level scoping

#### RBAC Model

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/api-types/src/organization_member.rs`

Two roles:
```rust
pub enum MemberRole {
    Admin,
    Member,
}
```

Access control in routes always checks membership:
```rust
// From routes/organizations.rs
organization_members::assert_membership(&state.pool, org_id, ctx.user.id).await?;

// From shape_routes.rs
ensure_member_access(state.pool(), query.organization_id, ctx.user.id).await?;
ensure_project_access(state.pool(), ctx.user.id, query.project_id).await?;
```

#### Invitation System

Organizations have an invitation workflow:
```sql
CREATE TABLE organization_invitations (
    id                  UUID PRIMARY KEY,
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    invited_by_user_id  UUID REFERENCES users(id),
    email               TEXT NOT NULL,
    role                member_role NOT NULL DEFAULT 'member',
    status              invitation_status NOT NULL DEFAULT 'pending',
    token               TEXT NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,
    ...
);
```

### Real-Time Updates: ElectricSQL

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/remote/src/routes/electric_proxy.rs`

vibe-kanban uses **ElectricSQL** for real-time data sync to the browser. The Electric proxy:
1. Receives requests from the browser
2. Sets the table and WHERE clause **server-side** (security: client cannot override)
3. Proxies to Electric service with organization-scoped filters
4. Streams SSE-like responses back to browser

```rust
// Security: table and where clause set server-side
origin_url.query_pairs_mut().append_pair("table", shape.table());
origin_url.query_pairs_mut().append_pair("where", shape.where_clause());
```

Shape scopes from `shape_routes.rs`:
- `ShapeScope::Org` — filtered by `organization_id`
- `ShapeScope::OrgWithUser` — filtered by `organization_id` AND `user_id`
- `ShapeScope::Project` — filtered by `project_id` (org membership checked)
- `ShapeScope::User` — filtered by `user_id`
- `ShapeScope::Issue` — filtered by `issue_id` (project/org membership checked)

### Docker Deployment

#### Main Dockerfile (`/home/jakekausler/dev/localenv/vibe-kanban/Dockerfile`)

Multi-stage build:
1. Builder: Node + Rust, builds web frontend and server binary
2. Runtime: Alpine, runs as non-root `appuser` (uid 1001)
3. Health check via wget
4. Binds to `0.0.0.0:3000`

#### Remote Dockerfile (`/home/jakekausler/dev/localenv/vibe-kanban/crates/remote/Dockerfile`)

Separate build for the remote/shared server:
1. Frontend build stage: Builds `remote-web` package
2. Rust build stage: Builds the `remote` binary (with optional private billing features)
3. Runtime: Debian slim, non-root user, port 8081

#### docker-compose.yml (`/home/jakekausler/dev/localenv/vibe-kanban/crates/remote/docker-compose.yml`)

Full stack:
- **PostgreSQL 16** with WAL logical replication
- **ElectricSQL** for real-time sync (SSE-based)
- **Azurite** (Azure Storage emulator) for file attachments
- **Remote server** with OAuth config

Key environment variables:
```yaml
GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
VIBEKANBAN_REMOTE_JWT_SECRET          # Required - base64 encoded, 32+ bytes
SERVER_PUBLIC_BASE_URL                 # The public URL users see
REMOTE_SERVER_PORTS: "127.0.0.1:3000:8081"  # Self-host: "0.0.0.0:3000:8081"
```

#### Origin Validation for Reverse Proxy

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/crates/server/src/middleware/origin.rs`

- `VK_ALLOWED_ORIGINS` env var: comma-separated list of allowed origins
- Loopback addresses normalized (localhost, 127.0.0.1, ::1 all equivalent)
- Same-origin requests always allowed
- Cross-origin blocked unless in allowed list

### Remote Web vs. Local Web

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/packages/remote-web/`

The remote-web package has:
- Login flow with OAuth (GitHub/Google)
- Token management with auto-refresh (short access token, long refresh token)
- Organization switching, invitation accept flow
- Uses browser `navigator.locks.request()` for safe concurrent token refresh

**File**: `/home/jakekausler/dev/localenv/vibe-kanban/packages/remote-web/src/shared/lib/auth/tokenManager.ts`

```typescript
export async function getToken(): Promise<string> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    if (!(await getRefreshToken())) throw new Error("Not authenticated");
    return handleTokenRefresh();
  }
  if (shouldRefreshAccessToken(accessToken)) return handleTokenRefresh();
  return accessToken;
}
```

---

## 2. claude-devtools

### Architecture Overview

claude-devtools is an Electron app that reads Claude Code's `~/.claude/` directory to display sessions. It has a **standalone server mode** for Docker/headless deployment.

### Standalone Server (Docker Mode)

**File**: `/home/jakekausler/dev/localenv/claude-devtools/src/main/standalone.ts`

- Runs HTTP server without Electron
- Binds to `0.0.0.0:3456` (configurable via `HOST`/`PORT` env vars)
- Uses `CLAUDE_ROOT` env var to override the `.claude` directory path
- SSH features are stubbed out (no-op)
- Default CORS: `*` (Docker network isolation replaces CORS)

```typescript
const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = parseInt(process.env.PORT ?? '3456', 10);
const CLAUDE_ROOT = process.env.CLAUDE_ROOT;

// Default CORS to allow all in standalone mode
if (!process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN = '*';
}
```

### Docker Deployment

**File**: `/home/jakekausler/dev/localenv/claude-devtools/docker-compose.yml`

```yaml
services:
  claude-devtools:
    build: .
    ports:
      - "3456:3456"
    volumes:
      - ${CLAUDE_DIR:-~/.claude}:/data/.claude:ro  # Read-only mount
    environment:
      - CLAUDE_ROOT=/data/.claude
      - HOST=0.0.0.0
      - PORT=3456
```

**Key insight**: The Docker container mounts `~/.claude` as a **read-only** volume. It only reads session data, never writes. This is the simplest possible deployment model.

**Security note from docker-compose**: "The standalone server has zero outbound network calls -- no telemetry, no analytics, no auto-updater."

### SSH Remote Sessions

**File**: `/home/jakekausler/dev/localenv/claude-devtools/src/main/services/infrastructure/SshConnectionManager.ts`

In Electron mode (not standalone), claude-devtools can SSH into remote machines to read their `~/.claude/projects/` directories:

```typescript
export class SshConnectionManager extends EventEmitter {
  async connect(config: SshConnectionConfig): Promise<void> {
    // Opens SSH + SFTP channel
    // Creates SshFileSystemProvider
    // Resolves remote ~/.claude/projects/ path
  }
}
```

After connecting:
1. Resolves remote `$HOME` via `printf %s "$HOME"`
2. Looks for `~/.claude/projects/` on the remote machine
3. Creates `SshFileSystemProvider` that reads files over SFTP
4. All services (ProjectScanner, SessionParser, etc.) work identically through the `FileSystemProvider` abstraction

**Multi-user pattern insight**: Each user's Claude sessions live in their own `~/.claude/` directory. SSH allows the devtools to read any user's sessions. On a shared server, each user would have their own `~/.claude/` in their home directory.

### ServiceContext Isolation

**File**: `/home/jakekausler/dev/localenv/claude-devtools/src/main/services/infrastructure/ServiceContext.ts`

```typescript
export class ServiceContext {
  readonly id: string;       // e.g., 'local', 'ssh-myserver'
  readonly type: 'local' | 'ssh';
  readonly fsProvider: FileSystemProvider;
  readonly projectScanner: ProjectScanner;
  readonly sessionParser: SessionParser;
  readonly subagentResolver: SubagentResolver;
  readonly chunkBuilder: ChunkBuilder;
  readonly dataCache: DataCache;
  readonly fileWatcher: FileWatcher;
}
```

The `ServiceContextRegistry` manages multiple contexts:
```typescript
export class ServiceContextRegistry {
  private contexts = new Map<string, ServiceContext>();
  private activeContextId: string = 'local';

  registerContext(context: ServiceContext): void;
  switch(contextId: string): { previous, current };
  destroy(contextId: string): void;
}
```

**Key pattern**: Each context is a complete, isolated service stack. The registry tracks which is active and handles switching (pausing watchers on old context, starting on new).

### Real-Time Updates: SSE

**File**: `/home/jakekausler/dev/localenv/claude-devtools/src/main/http/events.ts`

Simple SSE broadcast to all connected clients:
```typescript
const clients = new Set<FastifyReply>();

export function broadcastEvent(channel: string, data: unknown): void {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.raw.write(payload);
  }
}
```

**Important limitation**: This broadcasts to ALL connected SSE clients with no user scoping. In single-user mode this is fine, but for multi-user it would need per-user channels.

### Security Model

The standalone server has **zero authentication**. Security comes from:
1. Docker network isolation (commented `network_mode: "none"` option)
2. Read-only volume mount
3. No outbound network calls
4. Default binding to `127.0.0.1` in non-standalone mode

---

## 3. claude-code-monitor

### Architecture Overview

claude-code-monitor uses a **Primary/Secondary distributed architecture** where:
- **Secondary servers** run on each developer machine, watching local `~/.claude/projects/`
- **Primary server** aggregates data from all secondaries and serves the dashboard

### Primary/Secondary Protocol

#### Secondary Server

**File**: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/secondary/index.ts`

- Runs on each developer machine (port 3202)
- Watches `~/.claude/projects/` via `TranscriptWatcher`
- Receives hook events from Claude Code
- Stores events in local SQLite
- Connects to Primary via WebSocket

```typescript
const MACHINE_ID = process.env.CMON_MACHINE_ID || hostname();
const PRIMARY_URL = `ws://${primaryConnectHost}:${PRIMARY_PORT}/api/secondary`;
const PROJECTS_PATH = process.env.CLAUDE_PROJECTS_PATH || join(homedir(), '.claude', 'projects');
```

#### Primary Server

**File**: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/primary/index.ts`

- Aggregation hub (port 3200)
- Accepts WebSocket connections from secondaries on `/api/secondary`
- Serves dashboard WebSocket on `/api/dashboard`
- Routes event queries to the correct secondary

#### WebSocket Protocol

**Registration** (Secondary -> Primary):
```typescript
interface RegisterMessage {
  type: 'register';
  machineId: string;
  hostname: string;
  apiUrl: string;  // Secondary's HTTP API base URL
}
```

**Session metadata** (Secondary -> Primary):
```typescript
interface SessionMetadataMessage {
  type: 'session_metadata';
  sessionId: string;
  machineId: string;
  status: 'active' | 'waiting' | 'ended';
  eventCount: number;
  lastActivity: string;
  waitingState?: { type: 'user_input' | 'permission' | 'idle'; since: string };
  cwd?: string;
  gitBranch?: string;
  tokens?: { input: number; output: number; ... };
  model?: string;
}
```

**Events added** (Secondary -> Primary):
```typescript
interface EventsAddedMessage {
  type: 'events_added';
  sessionId: string;
  newEventCount: number;
  latestTimestamp: string;
}
```

**Dashboard updates** (Primary -> Dashboard):
```typescript
interface DashboardMessage {
  type: 'init' | 'session_update' | 'timeline_invalidation' | ...;
}
```

#### Event Routing

**File**: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/primary/event-router.ts`

The primary proxies event queries to the correct secondary:
```typescript
app.get('/api/sessions/:sessionId/events', async (req, res) => {
  const session = coordinator.getSession(sessionId);
  const secondary = connections.get(session.machineId);

  // Proxy request to the correct secondary
  const response = await fetch(`${secondary.apiUrl}/api/sessions/${sessionId}/events?...`);
  res.json(await response.json());
});
```

**Caching**: Primary caches timeline data with invalidation on events_added/events_inserted messages.

### Session Coordinator

**File**: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/primary/session-coordinator.ts`

In-memory index mapping session IDs to their source machine:
```typescript
export class SessionCoordinator {
  private sessions: Map<string, SessionMetadata> = new Map();

  updateSession(metadata: SessionMetadata): void;
  getSession(sessionId: string): SessionMetadata | null;
  getAllSessions(): SessionMetadata[];
}
```

### Dashboard Hub

**File**: `/home/jakekausler/dev/localenv/claude-code-monitor/packages/server/src/primary/dashboard-hub.ts`

WebSocket broadcast to all connected dashboards:
```typescript
class DashboardHub {
  private clients: Map<string, DashboardClient> = new Map();

  broadcast(message: DashboardMessage) {
    for (const { ws } of this.clients.values()) {
      ws.send(JSON.stringify(message));
    }
  }
}
```

**Like claude-devtools, this broadcasts to ALL clients with no user scoping.**

---

## Answers to Specific Questions

### 1. What authentication patterns can work for a web UI that shows Claude sessions?

**Recommended: OAuth (GitHub) + JWT, following vibe-kanban's pattern.**

For a Claude session viewer:

| Mode | Auth Strategy |
|------|--------------|
| **Local** | None. `localhost` binding + optional `VK_ALLOWED_ORIGINS` |
| **Hosted** | GitHub OAuth + short-lived JWT access tokens (2 min) + long-lived refresh tokens (1 year) |

vibe-kanban's approach is production-proven:
- Short access tokens minimize damage from token theft
- Refresh token rotation with reuse detection
- OAuth provider token validation ensures revoked GitHub tokens invalidate sessions
- Session inactivity timeout

**Minimal viable auth for hosted mode**:
1. GitHub OAuth (most users will have GitHub accounts)
2. JWT with access/refresh token pair
3. `require_session` middleware on all API routes
4. Store sessions in Postgres with revocation support

### 2. How should user isolation work?

**Recommended: Separate `~/.claude/` directories + row-level DB isolation.**

Three isolation strategies from the repos:

| Strategy | Used By | Pros | Cons |
|----------|---------|------|------|
| **Filesystem isolation** (separate home dirs) | claude-devtools SSH | Simple, natural for CLI tool | Requires SSH or similar |
| **Row-level DB isolation** | vibe-kanban remote | Scalable, single DB instance | Requires careful access control |
| **Machine-level isolation** | claude-code-monitor | Each user's machine is the boundary | Requires secondary per machine |

For a hosted Claude session viewer:

1. **Filesystem**: Each OS user on EC2 has their own `~/.claude/` directory. Claude Code runs under each user's account.
2. **Database**: Sessions are indexed with `user_id` column. All queries filter by authenticated user.
3. **API layer**: Middleware injects `user_id` from JWT, all queries scoped to that user.

```sql
-- Example session index table
CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    claude_session_id TEXT NOT NULL,
    machine_id TEXT,
    cwd TEXT,
    status TEXT,
    last_activity TIMESTAMPTZ,
    ...
    CONSTRAINT unique_session_per_user UNIQUE (user_id, claude_session_id)
);
```

### 3. How should the architecture differ between local and hosted?

**Follow vibe-kanban's Deployment trait pattern, adapted for TypeScript.**

```typescript
// Core interface
interface DeploymentContext {
  getUserId(): string;
  getSessionStore(): SessionStore;
  getFileAccess(): FileAccessProvider;
  getEventStream(): EventStreamProvider;
}

// Local implementation
class LocalDeployment implements DeploymentContext {
  getUserId() { return 'local-user'; }  // No auth needed
  getSessionStore() { return new FilesystemSessionStore('~/.claude'); }
  getFileAccess() { return new DirectFileAccess(); }
  getEventStream() { return new BroadcastSSE(); }  // All clients see everything
}

// Hosted implementation
class HostedDeployment implements DeploymentContext {
  constructor(private user: AuthenticatedUser) {}
  getUserId() { return this.user.id; }
  getSessionStore() { return new PostgresSessionStore(this.user.id); }
  getFileAccess() { return new ScopedFileAccess(this.user.homeDir); }
  getEventStream() { return new UserScopedSSE(this.user.id); }
}
```

Key differences:

| Concern | Local | Hosted |
|---------|-------|--------|
| Auth | None | OAuth + JWT |
| Session data source | Direct filesystem (`~/.claude/`) | Per-user filesystem + Postgres index |
| Database | SQLite (or none) | PostgreSQL |
| Real-time events | Broadcast to all | Scoped per user |
| File access | Unrestricted | Chroot to user's home |
| Origin validation | Localhost only | `VK_ALLOWED_ORIGINS` + reverse proxy |

### 4. What's the minimal abstraction layer needed?

Based on all three repos, the **minimum abstractions** are:

1. **FileSystemProvider** (from claude-devtools)
   ```typescript
   interface FileSystemProvider {
     type: 'local' | 'remote';
     readFile(path: string): Promise<Buffer>;
     readdir(path: string): Promise<string[]>;
     stat(path: string): Promise<Stats>;
     exists(path: string): Promise<boolean>;
   }
   ```

2. **SessionStore** (new, inspired by claude-code-monitor's DatabaseManager)
   ```typescript
   interface SessionStore {
     listSessions(userId: string): Promise<Session[]>;
     getSession(sessionId: string): Promise<Session | null>;
     getSessionEvents(sessionId: string, opts: EventQueryOptions): Promise<EventQueryResponse>;
   }
   ```

3. **AuthProvider** (new, inspired by vibe-kanban)
   ```typescript
   interface AuthProvider {
     // Returns null for local mode (no auth)
     getAuthenticatedUser(request: Request): Promise<User | null>;
     requireAuth(): Middleware;  // No-op for local, JWT validation for hosted
   }
   ```

4. **EventBroadcaster** (from claude-devtools)
   ```typescript
   interface EventBroadcaster {
     broadcast(event: string, data: unknown, scope?: { userId?: string }): void;
     addClient(client: SSEClient, scope?: { userId?: string }): void;
   }
   ```

### 5. How should file access be scoped per user on a shared server?

**Three-layer approach from the repos:**

**Layer 1 — OS-level isolation** (from claude-devtools SSH pattern):
Each user runs Claude Code under their own OS account. Sessions live in `/home/<username>/.claude/`.

**Layer 2 — Path validation** (from claude-code-monitor's file serving):
```typescript
// From secondary/index.ts
const resolved = resolve(session.cwd, filePath);
const realPath = await fsPromises.realpath(resolved);
const realCwd = await fsPromises.realpath(session.cwd);
if (!realPath.startsWith(realCwd + sep) && realPath !== realCwd) {
  return res.status(403).send('Forbidden');
}
```

**Layer 3 — API-level scoping** (from vibe-kanban):
```rust
// Every workspace query checks owner_user_id
ensure_project_access(state.pool(), ctx.user.id, workspace.project_id).await?;
```

**Recommended approach for hosted mode:**
1. Create OS users per team member on EC2
2. Each runs Claude Code under their own account
3. The web server process runs as a service account with read access to all home dirs
4. API middleware resolves authenticated user -> OS username -> `~/.claude/` path
5. All file reads validated against user's home directory (symlink-safe `realpath` check)

### 6. What deployment patterns enable multi-user?

**Docker + Reverse Proxy, following vibe-kanban:**

```yaml
# Minimal docker-compose for hosted mode
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - db-data:/var/lib/postgresql/data

  web-server:
    build: .
    ports:
      - "127.0.0.1:3000:3000"  # Bind to localhost, reverse proxy handles public
    environment:
      DATABASE_URL: postgres://...
      GITHUB_OAUTH_CLIENT_ID: ${GITHUB_OAUTH_CLIENT_ID}
      GITHUB_OAUTH_CLIENT_SECRET: ${GITHUB_OAUTH_CLIENT_SECRET}
      JWT_SECRET: ${JWT_SECRET}
      PUBLIC_BASE_URL: https://claude-sessions.example.com
      ALLOWED_ORIGINS: https://claude-sessions.example.com
    volumes:
      - /home:/data/homes:ro  # Read-only access to all user home dirs
```

**Reverse proxy (Nginx/Caddy):**
- Handles TLS termination
- Sets `X-Forwarded-For`, `X-Forwarded-Proto` headers
- Matches `VK_ALLOWED_ORIGINS` / `PUBLIC_BASE_URL`

**vibe-kanban's `REMOTE_SERVER_PORTS` pattern** is useful:
```yaml
# Development (localhost only):
REMOTE_SERVER_PORTS: "127.0.0.1:3000:8081"
# Self-hosted (public):
REMOTE_SERVER_PORTS: "0.0.0.0:3000:8081"
```

### 7. How should real-time updates be scoped?

**SSE with per-user channels, extending the patterns from all three repos.**

Current approaches:

| Repo | Technology | Scoping |
|------|-----------|---------|
| vibe-kanban | ElectricSQL (SSE-based) | Per-organization, server-side WHERE clause |
| claude-devtools | SSE | Broadcast to all (no scoping) |
| claude-code-monitor | WebSocket | Broadcast to all dashboards (no scoping) |

**Recommended for multi-user:**

```typescript
// User-scoped SSE
const userClients = new Map<string, Set<FastifyReply>>();

function broadcastToUser(userId: string, event: string, data: unknown): void {
  const clients = userClients.get(userId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.raw.write(payload);
  }
}

// In the SSE endpoint
app.get('/api/events', async (request, reply) => {
  const user = await getAuthenticatedUser(request);
  if (!user) return reply.status(401).send();

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Add to user-specific client set
  if (!userClients.has(user.id)) userClients.set(user.id, new Set());
  userClients.get(user.id)!.add(reply);

  request.raw.on('close', () => {
    userClients.get(user.id)?.delete(reply);
    if (userClients.get(user.id)?.size === 0) userClients.delete(user.id);
  });
});
```

For local mode, the user ID is always `'local-user'` so all clients see the same data.

**ElectricSQL approach** (if Postgres is used):
Like vibe-kanban, proxy Electric shape requests with server-side WHERE clauses:
```sql
-- Server sets this, client cannot override
WHERE user_id = $1
```

### 8. What database changes are needed for multi-tenancy?

**Start with no database locally, add Postgres for hosted mode.**

Based on all three repos:

**Local mode**:
- Read directly from `~/.claude/` filesystem (like claude-devtools)
- Optional SQLite for caching/indexing (like claude-code-monitor secondary)
- No user table needed

**Hosted mode (Postgres)**:
```sql
-- Users (created on first OAuth login)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    os_username TEXT,  -- Maps to their Unix account on the EC2 instance
    claude_home_path TEXT,  -- /home/<username>/.claude
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auth sessions (JWT refresh token tracking)
CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    refresh_token_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

-- OAuth accounts (GitHub, Google)
CREATE TABLE oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    avatar_url TEXT,
    UNIQUE (provider, provider_user_id)
);

-- Session index (cached from filesystem, updated by watchers)
CREATE TABLE claude_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    session_id TEXT NOT NULL,  -- Claude Code's session ID
    cwd TEXT,
    status TEXT DEFAULT 'active',
    last_activity TIMESTAMPTZ,
    model TEXT,
    tokens_input INTEGER,
    tokens_output INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, session_id)
);

CREATE INDEX idx_claude_sessions_user_activity
    ON claude_sessions (user_id, last_activity DESC);

-- Revoked refresh tokens (for token rotation security)
CREATE TABLE revoked_refresh_tokens (
    token_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    revoked_reason TEXT,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Recommended Architecture for claude-code-workflow Web View

### Phase 1: Local-Only Web View (Stage 9)
- HTTP server (Fastify) serving static SPA + API
- Read `~/.claude/` filesystem directly
- SSE for real-time updates (file watcher)
- No auth, localhost-only binding
- No database needed

### Phase 2: Add Deployment Abstraction
- `DeploymentContext` interface (inspired by vibe-kanban trait)
- `FileSystemProvider` abstraction (from claude-devtools)
- `SessionStore` interface (local: filesystem, hosted: Postgres)
- Environment variable to select mode: `DEPLOYMENT_MODE=local|hosted`

### Phase 3: Multi-User Hosted Mode
- Add Postgres (users, auth_sessions, oauth_accounts, session index)
- GitHub OAuth + JWT auth (following vibe-kanban's exact pattern)
- Per-user SSE channels
- User -> OS username mapping for file access
- Docker compose with Postgres + reverse proxy config
- `ALLOWED_ORIGINS` for reverse proxy support

### Key Design Decisions

1. **Row-level isolation, not schema-per-tenant** — simpler, proven by vibe-kanban
2. **Short-lived access tokens (2 min)** — security best practice from vibe-kanban
3. **OAuth provider token validation** — revoked GitHub account = revoked sessions
4. **Read-only file access** — the web view never writes to `~/.claude/`
5. **SSE over WebSocket for updates** — simpler, sufficient for our use case (one-way server-to-client)
6. **Filesystem as source of truth, DB as cache** — the `~/.claude/` directory is authoritative
