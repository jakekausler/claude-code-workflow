import type { FastifyRequest } from 'fastify';
import type {
  DeploymentContext,
  FileSystemProvider,
  AuthProvider,
  EventBroadcaster,
} from '../types.js';
import { HostedAuthProvider } from './hosted-auth-provider.js';
import { ScopedFileSystemProvider } from './scoped-fs-provider.js';
import { UserScopedSSE } from './user-scoped-sse.js';
import { createPool, type PgPool } from './db/pg-client.js';
import { runMigrations } from './db/migrate.js';

/**
 * Hosted (multi-user) deployment context.
 * Wires together PostgreSQL, JWT auth, scoped filesystem, and per-user SSE.
 */
export class HostedDeploymentContext implements DeploymentContext {
  readonly mode = 'hosted' as const;

  private constructor(
    private readonly pool: PgPool,
    private readonly authProvider: HostedAuthProvider,
    private readonly eventBroadcaster: UserScopedSSE,
  ) {}

  /**
   * Factory: creates the pool, runs migrations, and assembles all providers.
   */
  static async create(): Promise<HostedDeploymentContext> {
    const pool = createPool(process.env.DATABASE_URL);

    // Run schema migrations on startup
    await runMigrations(pool);

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET environment variable is required for hosted mode');

    const ghClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    if (!ghClientId) throw new Error('GITHUB_OAUTH_CLIENT_ID environment variable is required for hosted mode');

    const ghClientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
    if (!ghClientSecret) throw new Error('GITHUB_OAUTH_CLIENT_SECRET environment variable is required for hosted mode');

    const auth = new HostedAuthProvider(jwtSecret, pool, ghClientId, ghClientSecret);
    const broadcaster = new UserScopedSSE();

    return new HostedDeploymentContext(pool, auth, broadcaster);
  }

  async getUserId(request: FastifyRequest): Promise<string> {
    return this.authProvider.getUserIdFromRequest(request);
  }

  getFileAccess(): FileSystemProvider {
    // In hosted mode the caller should use getClaudeRoot(userId) to construct
    // a per-request ScopedFileSystemProvider. This default returns a scoped
    // provider rooted at a safe fallback; route handlers are expected to
    // build their own provider with the resolved user path.
    throw new Error(
      'Use getClaudeRoot(userId) to construct a ScopedFileSystemProvider per-request',
    );
  }

  /**
   * Convenience: build a ScopedFileSystemProvider for a specific user.
   */
  getFileAccessForUser(userId: string): FileSystemProvider {
    const root = this.getClaudeRoot(userId);
    return new ScopedFileSystemProvider(root);
  }

  getAuthProvider(): AuthProvider {
    return this.authProvider;
  }

  /**
   * Return the concrete HostedAuthProvider (for route registration).
   */
  getHostedAuthProvider(): HostedAuthProvider {
    return this.authProvider;
  }

  getEventBroadcaster(): EventBroadcaster {
    return this.eventBroadcaster;
  }

  getClaudeRoot(userId: string): string {
    // Default derivation from userId.
    // In production the caller would look up users.claude_home_path or
    // users.os_username from the database; this provides the fallback.
    return `/home/${userId}/.claude`;
  }

  /**
   * Expose the pool for direct queries (e.g. kanban data layer).
   */
  getPool(): PgPool {
    return this.pool;
  }
}
