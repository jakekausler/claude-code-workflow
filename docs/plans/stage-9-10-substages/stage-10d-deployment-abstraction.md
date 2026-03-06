# Stage 10D: Deployment Abstraction

**Parent:** Stage 10 (Session Monitor Integration)
**Dependencies:** None (can parallel with 10A-10C)
**Design doc:** `docs/plans/2026-02-25-stage-9-10-web-ui-design.md`

## Goal

Define deployment abstraction interfaces that enable local (single-user, no auth) and hosted (multi-user, OAuth) deployment. Build only the local implementations. Document the hosted design for future work.

## What Ships

1. TypeScript interfaces: DeploymentContext, FileSystemProvider, AuthProvider, EventBroadcaster
2. Local implementations of all interfaces
3. Integration point in server startup (select deployment mode)
4. Documentation of hosted implementation design

## Interfaces

### DeploymentContext

The top-level interface that provides all deployment-specific services.

```typescript
interface DeploymentContext {
  mode: 'local' | 'hosted';
  getUserId(request: FastifyRequest): Promise<string>;
  getFileAccess(): FileSystemProvider;
  getAuthProvider(): AuthProvider;
  getEventBroadcaster(): EventBroadcaster;
  getClaudeRoot(userId: string): string;  // Path to user's ~/.claude
}
```

### FileSystemProvider

Abstraction over filesystem access. Local reads directly; hosted would scope to user's home directory.

```typescript
interface FileSystemProvider {
  type: 'local' | 'scoped';
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ size: number; mtimeMs: number; isDirectory: boolean }>;
  exists(path: string): Promise<boolean>;
  createReadStream(path: string, options?: { start?: number; encoding?: string }): ReadStream;
  watch(path: string, options?: { recursive?: boolean }): FSWatcher;
}
```

**Reference:** claude-devtools `FileSystemProvider` pattern used for local vs SSH file access. See `src/main/services/infrastructure/ServiceContext.ts`.

### AuthProvider

Authentication middleware. No-op for local, JWT validation for hosted.

```typescript
interface AuthProvider {
  // Returns null for local mode (no auth required)
  getAuthenticatedUser(request: FastifyRequest): Promise<User | null>;

  // Fastify preHandler hook. No-op for local, 401 for hosted without valid token.
  requireAuth(): FastifyPreHandler;

  // Optional: returns user ID for scoping. Local always returns 'local-user'.
  getUserIdFromRequest(request: FastifyRequest): Promise<string>;
}

interface User {
  id: string;
  email: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}
```

### EventBroadcaster

SSE broadcast with optional user scoping.

```typescript
interface EventBroadcaster {
  // Add a connected SSE client, optionally scoped to a user
  addClient(reply: FastifyReply, scope?: { userId: string }): void;

  // Remove a disconnected client
  removeClient(reply: FastifyReply): void;

  // Broadcast to all clients (local) or scoped clients (hosted)
  broadcast(event: string, data: unknown, scope?: { userId?: string }): void;
}
```

## Local Implementations

### LocalDeploymentContext

```typescript
class LocalDeploymentContext implements DeploymentContext {
  mode = 'local' as const;

  async getUserId(): Promise<string> {
    return 'local-user';
  }

  getFileAccess(): FileSystemProvider {
    return new DirectFileSystemProvider();
  }

  getAuthProvider(): AuthProvider {
    return new NoopAuthProvider();
  }

  getEventBroadcaster(): EventBroadcaster {
    return new BroadcastAllSSE();
  }

  getClaudeRoot(): string {
    return process.env.CLAUDE_ROOT || path.join(os.homedir(), '.claude');
  }
}
```

### DirectFileSystemProvider

Thin wrapper over Node.js `fs` module with no access restrictions.

### NoopAuthProvider

- `getAuthenticatedUser()` returns `null` (no user concept)
- `requireAuth()` returns a preHandler that calls `next()` (pass-through)
- `getUserIdFromRequest()` returns `'local-user'`

### BroadcastAllSSE

- Maintains `Set<FastifyReply>` for all connected clients
- `broadcast()` sends to ALL clients regardless of scope parameter
- Ignores `scope.userId` (single user, all events are visible)

This is the existing SSE implementation from 9G, extracted into the interface.

## Server Startup Integration

```typescript
// src/server/index.ts
const deployment = process.env.DEPLOYMENT_MODE === 'hosted'
  ? await HostedDeploymentContext.create()  // Future: 10D-hosted
  : new LocalDeploymentContext();

// Pass deployment context to route registrations
registerBoardRoutes(app, deployment);
registerSessionRoutes(app, deployment);
registerEventRoutes(app, deployment);

// Auth middleware (no-op for local)
app.addHook('preHandler', deployment.getAuthProvider().requireAuth());
```

## Hosted Design (Documented, NOT Built)

### Authentication: GitHub OAuth + JWT

Follow vibe-kanban's exact pattern:
- GitHub OAuth with `read:user, user:email` scopes
- Short-lived access tokens (120 seconds)
- Long-lived refresh tokens (365 days) with rotation and reuse detection
- Refresh tokens contain AES-256-GCM encrypted GitHub tokens

**Reference:** `vibe-kanban/crates/remote/src/auth/jwt.rs`, `vibe-kanban/crates/remote/src/auth/provider.rs`

### Database: PostgreSQL

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    os_username TEXT,          -- Maps to Unix account on EC2
    claude_home_path TEXT,     -- /home/<username>/.claude
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    refresh_token_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE TABLE oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    UNIQUE (provider, provider_user_id)
);

CREATE TABLE revoked_refresh_tokens (
    token_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    revoked_reason TEXT,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Reference:** `vibe-kanban/crates/remote/migrations/` for the full schema.

### Scoped file access

```typescript
class ScopedFileSystemProvider implements FileSystemProvider {
  constructor(private rootPath: string) {} // e.g., /home/username/.claude

  async readFile(path: string): Promise<Buffer> {
    const resolved = fs.realpathSync(path);
    if (!resolved.startsWith(this.rootPath)) throw new ForbiddenError();
    return fs.readFile(resolved);
  }
}
```

### Per-user SSE

```typescript
class UserScopedSSE implements EventBroadcaster {
  private userClients = new Map<string, Set<FastifyReply>>();

  addClient(reply: FastifyReply, scope: { userId: string }): void {
    const clients = this.userClients.get(scope.userId) || new Set();
    clients.add(reply);
    this.userClients.set(scope.userId, clients);
  }

  broadcast(event: string, data: unknown, scope?: { userId?: string }): void {
    if (scope?.userId) {
      // Send only to this user's clients
      const clients = this.userClients.get(scope.userId);
      if (clients) sendToAll(clients, event, data);
    } else {
      // Broadcast to all (admin events)
      for (const clients of this.userClients.values()) {
        sendToAll(clients, event, data);
      }
    }
  }
}
```

### Docker deployment

```yaml
services:
  postgres:
    image: postgres:16-alpine
    volumes: [db-data:/var/lib/postgresql/data]
  web-server:
    build: tools/web-server
    ports: ["127.0.0.1:3100:3100"]
    environment:
      DEPLOYMENT_MODE: hosted
      DATABASE_URL: postgres://...
      GITHUB_OAUTH_CLIENT_ID: ${GITHUB_OAUTH_CLIENT_ID}
      GITHUB_OAUTH_CLIENT_SECRET: ${GITHUB_OAUTH_CLIENT_SECRET}
      JWT_SECRET: ${JWT_SECRET}
      PUBLIC_BASE_URL: https://kanban.example.com
      ALLOWED_ORIGINS: https://kanban.example.com
    volumes:
      - /home:/data/homes:ro
```

**Reference:** `vibe-kanban/crates/remote/docker-compose.yml`, `docs/research/stage-9-10-web-ui/deep-dive-multi-user-deployment.md`

## Success Criteria

- All server code uses DeploymentContext interfaces (no direct fs calls outside providers)
- Local mode works identically to pre-abstraction behavior
- `DEPLOYMENT_MODE=local` (default) uses local implementations
- Hosted interface design is complete and documented
- No hosted implementation code exists (future work)
- Switching from local to hosted requires only implementing the interfaces + setting env vars
