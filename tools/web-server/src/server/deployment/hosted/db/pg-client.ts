import pg from 'pg';

/**
 * Re-export Pool types for consumer convenience.
 */
export type PgPool = pg.Pool;
export type PgPoolClient = pg.PoolClient;

let pool: pg.Pool | null = null;

/**
 * Create and cache a PostgreSQL connection pool.
 * Reads DATABASE_URL from the environment if no explicit URL is provided.
 * Subsequent calls return the existing pool unless it was closed.
 */
export function createPool(databaseUrl?: string): pg.Pool {
  if (pool) return pool;

  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required for hosted mode');
  }

  pool = new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    console.error('[pg-client] Unexpected pool error:', err.message);
  });

  return pool;
}

/**
 * Return the current pool, throwing if none has been created.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('PostgreSQL pool not initialized — call createPool() first');
  }
  return pool;
}

/**
 * Drain and close the pool. Safe to call multiple times.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
