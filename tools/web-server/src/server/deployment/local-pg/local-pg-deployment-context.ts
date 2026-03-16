import path from 'path';
import os from 'os';
import type { FastifyRequest } from 'fastify';
import type {
  DeploymentContext,
  FileSystemProvider,
  AuthProvider,
  EventBroadcaster,
} from '../types.js';
import { DirectFileSystemProvider } from '../local/direct-fs-provider.js';
import { NoopAuthProvider } from '../local/noop-auth-provider.js';
import { BroadcastAllSSE } from '../local/broadcast-all-sse.js';
import { createPool, type PgPool } from '../hosted/db/pg-client.js';
import { runMigrations } from '../hosted/db/migrate.js';

/**
 * Local + PostgreSQL deployment context.
 * Uses PostgreSQL for data storage (like hosted mode) but keeps local-mode auth
 * (NoopAuthProvider) and broadcasting (BroadcastAllSSE) for single-user development.
 *
 * This is useful for testing multi-database scenarios locally without needing
 * JWT auth or user scoping infrastructure.
 */
export class LocalPgDeploymentContext implements DeploymentContext {
  readonly mode = 'local' as const;

  private constructor(
    private readonly pool: PgPool,
    private readonly fileAccess = new DirectFileSystemProvider(),
    private readonly authProvider = new NoopAuthProvider(),
    private readonly eventBroadcaster = new BroadcastAllSSE(),
  ) {}

  /**
   * Factory: creates the PostgreSQL pool, runs migrations, and assembles all providers.
   */
  static async create(): Promise<LocalPgDeploymentContext> {
    const pool = createPool(process.env.DATABASE_URL);

    // Run schema migrations on startup
    await runMigrations(pool);

    return new LocalPgDeploymentContext(pool);
  }

  async getUserId(_request: FastifyRequest): Promise<string> {
    return 'local-user';
  }

  getFileAccess(): FileSystemProvider {
    return this.fileAccess;
  }

  getAuthProvider(): AuthProvider {
    return this.authProvider;
  }

  getEventBroadcaster(): EventBroadcaster {
    return this.eventBroadcaster;
  }

  getClaudeRoot(_userId: string): string {
    return process.env.CLAUDE_ROOT || path.join(os.homedir(), '.claude');
  }

  /**
   * Expose the pool for direct queries (e.g. kanban data layer).
   */
  getPool(): PgPool {
    return this.pool;
  }
}
