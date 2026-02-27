# Hosted Deployment Design

> **Status: Design only — NOT implemented.**
> All interfaces (`DeploymentContext`, `FileSystemProvider`, `AuthProvider`, `EventBroadcaster`) are already defined in `types.ts`. This document captures what the hosted (multi-user) implementations would look like. No hosted code exists yet.

## Overview

The deployment abstraction separates the web server into two modes:

- **Local** (current): Single user, no authentication, direct filesystem access. Already built.
- **Hosted** (future): Multi-user, GitHub OAuth, scoped filesystem, per-user SSE channels.

Switching from local to hosted requires implementing the interfaces defined in `types.ts` and setting `DEPLOYMENT_MODE=hosted`. This document serves as the design reference for that future work.

**Reference architecture:** [vibe-kanban](https://github.com/jakekausler/vibe-kanban) remote deployment patterns.

---

## Authentication: GitHub OAuth + JWT

Follow vibe-kanban's auth pattern:

- **GitHub OAuth** with `read:user, user:email` scopes
- **Short-lived access tokens** — 120-second expiry, signed JWT
- **Long-lived refresh tokens** — 365-day expiry with rotation and reuse detection
- Refresh tokens contain **AES-256-GCM encrypted GitHub tokens** (allows server to call GitHub API on behalf of user)
- On refresh, the old refresh token is revoked and a new one is issued (rotation)
- If a revoked refresh token is reused, all sessions for that user are revoked (reuse detection)

### Auth Flow

```
1. Client redirects to /auth/github
2. Server redirects to GitHub OAuth authorize URL
3. GitHub redirects back with code
4. Server exchanges code for GitHub access token
5. Server fetches user profile from GitHub API
6. Server creates/updates user record in PostgreSQL
7. Server issues short-lived access token + long-lived refresh token
8. Client stores tokens, uses access token for API requests
9. On 401, client calls /auth/refresh with refresh token
10. Server validates refresh token, rotates it, issues new access token
```

### JwtAuthProvider (implements AuthProvider)

```typescript
class JwtAuthProvider implements AuthProvider {
  constructor(
    private jwtSecret: string,
    private db: PostgresClient,
  ) {}

  async getAuthenticatedUser(request: FastifyRequest): Promise<User | null> {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;

    try {
      const payload = jwt.verify(token, this.jwtSecret) as JwtPayload;
      return {
        id: payload.sub,
        email: payload.email,
        username: payload.username,
        displayName: payload.displayName,
        avatarUrl: payload.avatarUrl,
      };
    } catch {
      return null;
    }
  }

  requireAuth(): FastifyPluginCallback {
    return (instance, _opts, done) => {
      instance.addHook('preHandler', async (request, reply) => {
        const user = await this.getAuthenticatedUser(request);
        if (!user) {
          reply.code(401).send({ error: 'Unauthorized' });
          return;
        }
        request.user = user;
      });
      done();
    };
  }

  async getUserIdFromRequest(request: FastifyRequest): Promise<string> {
    const user = await this.getAuthenticatedUser(request);
    if (!user) throw new Error('Unauthorized');
    return user.id;
  }
}
```

**Reference:** `vibe-kanban/crates/remote/src/auth/jwt.rs`, `vibe-kanban/crates/remote/src/auth/provider.rs`

---

## Database: PostgreSQL

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

### Key Design Decisions

- **`users.os_username`** — Maps the authenticated user to a Unix account on the host machine. The `getClaudeRoot()` method uses this to resolve `/home/<os_username>/.claude`.
- **`users.claude_home_path`** — Explicit path override, allowing non-standard home directories.
- **`revoked_refresh_tokens`** — Enables reuse detection. If a refresh token appears here, it was already rotated, indicating possible token theft.
- **`oauth_accounts`** — Supports multiple OAuth providers per user in the future (e.g., GitLab, Google), though initially only GitHub is supported.

**Reference:** `vibe-kanban/crates/remote/migrations/`

---

## ScopedFileSystemProvider

Implements `FileSystemProvider` with path traversal protection. All filesystem operations are restricted to a user's root directory.

```typescript
class ScopedFileSystemProvider implements FileSystemProvider {
  readonly type = 'scoped' as const;

  constructor(private rootPath: string) {} // e.g., /home/username/.claude

  private assertWithinRoot(requestedPath: string): string {
    const resolved = fs.realpathSync(requestedPath);
    if (!resolved.startsWith(this.rootPath)) {
      throw new ForbiddenError(
        `Path traversal denied: ${requestedPath} resolves outside ${this.rootPath}`,
      );
    }
    return resolved;
  }

  async readFile(path: string): Promise<Buffer> {
    const safe = this.assertWithinRoot(path);
    return fs.promises.readFile(safe);
  }

  async readdir(path: string): Promise<string[]> {
    const safe = this.assertWithinRoot(path);
    return fs.promises.readdir(safe);
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number; isDirectory: boolean }> {
    const safe = this.assertWithinRoot(path);
    const s = await fs.promises.stat(safe);
    return { size: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory() };
  }

  async exists(path: string): Promise<boolean> {
    try {
      this.assertWithinRoot(path);
      return true;
    } catch {
      return false;
    }
  }

  createReadStream(path: string, options?: { start?: number; encoding?: BufferEncoding }): ReadStream {
    const safe = this.assertWithinRoot(path);
    return fs.createReadStream(safe, options);
  }

  watch(path: string, options?: { recursive?: boolean }): FSWatcher {
    const safe = this.assertWithinRoot(path);
    return fs.watch(safe, options);
  }
}
```

### Security Notes

- **`realpathSync`** resolves symlinks before checking the prefix, preventing symlink-based traversal attacks.
- **`startsWith`** check ensures the resolved path is within the user's root. This prevents `../../etc/passwd` style attacks.
- The `rootPath` is set per-user from `users.claude_home_path` or derived from `users.os_username`.

---

## UserScopedSSE (EventBroadcaster)

Implements `EventBroadcaster` with per-user event channels. Each user only receives events for their own sessions.

```typescript
class UserScopedSSE implements EventBroadcaster {
  private userClients = new Map<string, Set<FastifyReply>>();

  get clientCount(): number {
    let count = 0;
    for (const clients of this.userClients.values()) {
      count += clients.size;
    }
    return count;
  }

  addClient(reply: FastifyReply, scope?: { userId: string }): void {
    if (!scope?.userId) {
      throw new Error('UserScopedSSE requires a userId scope');
    }
    const clients = this.userClients.get(scope.userId) || new Set();
    clients.add(reply);
    this.userClients.set(scope.userId, clients);
  }

  removeClient(reply: FastifyReply): void {
    for (const [userId, clients] of this.userClients.entries()) {
      clients.delete(reply);
      if (clients.size === 0) {
        this.userClients.delete(userId);
      }
    }
  }

  broadcast(event: string, data: unknown, scope?: { userId?: string }): void {
    if (scope?.userId) {
      // Send only to this user's clients
      const clients = this.userClients.get(scope.userId);
      if (clients) {
        this.sendToAll(clients, event, data);
      }
    } else {
      // Broadcast to all connected clients (admin events)
      for (const clients of this.userClients.values()) {
        this.sendToAll(clients, event, data);
      }
    }
  }

  private sendToAll(clients: Set<FastifyReply>, event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const reply of clients) {
      reply.raw.write(payload);
    }
  }
}
```

### Design Notes

- **`addClient` requires `scope.userId`** in hosted mode. The route handler extracts the user ID from the JWT and passes it when registering the SSE connection.
- **`removeClient`** iterates all user sets to find and remove the reply. This is O(users) but acceptable since disconnects are infrequent.
- **Unscoped broadcast** (no `userId` in scope) sends to all connected clients across all users. This is reserved for admin/system-wide events.

---

## Docker Deployment

### docker-compose.yml

```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: claude_workflow
      POSTGRES_USER: claude
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U claude"]
      interval: 5s
      timeout: 3s
      retries: 5

  web-server:
    build: tools/web-server
    restart: unless-stopped
    ports:
      - "127.0.0.1:3100:3100"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DEPLOYMENT_MODE: hosted
      DATABASE_URL: postgres://claude:${POSTGRES_PASSWORD}@postgres:5432/claude_workflow
      GITHUB_OAUTH_CLIENT_ID: ${GITHUB_OAUTH_CLIENT_ID}
      GITHUB_OAUTH_CLIENT_SECRET: ${GITHUB_OAUTH_CLIENT_SECRET}
      JWT_SECRET: ${JWT_SECRET}
      PUBLIC_BASE_URL: https://kanban.example.com
      ALLOWED_ORIGINS: https://kanban.example.com
    volumes:
      - /home:/data/homes:ro

volumes:
  db-data:
```

### Environment Variables

| Variable | Description |
|---|---|
| `DEPLOYMENT_MODE` | `local` (default) or `hosted` |
| `DATABASE_URL` | PostgreSQL connection string |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth app client secret |
| `JWT_SECRET` | Secret for signing/verifying JWTs |
| `PUBLIC_BASE_URL` | Public URL for OAuth callback redirects |
| `ALLOWED_ORIGINS` | Comma-separated origins for CORS |
| `POSTGRES_PASSWORD` | PostgreSQL password (used in docker-compose) |

### Deployment Notes

- The `/home:/data/homes:ro` volume mount gives the web server read-only access to user home directories.
- The server listens on `127.0.0.1:3100` — a reverse proxy (nginx, Caddy) handles TLS termination and public exposure.
- `PUBLIC_BASE_URL` is used to construct the GitHub OAuth callback URL (`${PUBLIC_BASE_URL}/auth/github/callback`).

**Reference:** `vibe-kanban/crates/remote/docker-compose.yml`, `docs/research/stage-9-10-web-ui/deep-dive-multi-user-deployment.md`

---

## HostedDeploymentContext

The top-level class that wires all hosted implementations together.

```typescript
class HostedDeploymentContext implements DeploymentContext {
  readonly mode = 'hosted' as const;

  private constructor(
    private db: PostgresClient,
    private authProvider: JwtAuthProvider,
    private broadcaster: UserScopedSSE,
  ) {}

  static async create(): Promise<HostedDeploymentContext> {
    const db = await connectPostgres(process.env.DATABASE_URL!);
    const auth = new JwtAuthProvider(process.env.JWT_SECRET!, db);
    const broadcaster = new UserScopedSSE();
    return new HostedDeploymentContext(db, auth, broadcaster);
  }

  async getUserId(request: FastifyRequest): Promise<string> {
    return this.authProvider.getUserIdFromRequest(request);
  }

  getFileAccess(): FileSystemProvider {
    // Note: In practice, this would need the userId to construct
    // a ScopedFileSystemProvider per-request. The interface may
    // need to evolve to accept userId, or the route handler
    // constructs it directly using getClaudeRoot().
    throw new Error('Use getClaudeRoot(userId) to construct a ScopedFileSystemProvider per-request');
  }

  getAuthProvider(): AuthProvider {
    return this.authProvider;
  }

  getEventBroadcaster(): EventBroadcaster {
    return this.broadcaster;
  }

  getClaudeRoot(userId: string): string {
    // Look up user's claude_home_path or os_username from DB
    // This is a simplified sketch — actual implementation would be async
    // and cache the mapping
    return `/home/${userId}/.claude`;
  }
}
```

---

## Implementation Checklist

What needs to be built to enable hosted mode:

- [ ] `HostedDeploymentContext` class implementing `DeploymentContext`
- [ ] `ScopedFileSystemProvider` with `realpathSync` + `startsWith` path traversal protection
- [ ] `UserScopedSSE` with `Map<string, Set<FastifyReply>>` per-user channels
- [ ] `JwtAuthProvider` with GitHub OAuth flow (`/auth/github`, `/auth/github/callback`, `/auth/refresh`)
- [ ] PostgreSQL schema migration (users, auth_sessions, oauth_accounts, revoked_refresh_tokens)
- [ ] User-to-OS-username mapping (populate `users.os_username` during OAuth registration)
- [ ] Docker compose configuration (postgres + web-server services)
- [ ] CORS configuration for hosted origins (`ALLOWED_ORIGINS` env var)
- [ ] Reverse proxy configuration documentation (nginx/Caddy TLS termination)
- [ ] Integration tests for auth flow and scoped filesystem
