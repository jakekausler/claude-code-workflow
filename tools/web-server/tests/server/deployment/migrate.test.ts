import { describe, it, expect, vi, beforeEach } from 'vitest';

// We unit-test runMigrations by mocking the filesystem and a pg client.
// The key behaviour under test: migrations whose version already exists in
// schema_migrations are skipped; new ones are applied and then recorded.

// ---------- filesystem mock ----------
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn((filePath: string, _enc: string) => {
      if (String(filePath).endsWith('schema.sql')) return '-- base schema';
      if (String(filePath).endsWith('001_init.sql')) return '-- migration 001';
      if (String(filePath).endsWith('002_rbac.sql')) return '-- migration 002';
      return '';
    }),
    existsSync: vi.fn(() => true),
    readdirSync: vi.fn(() => ['001_init.sql', '002_rbac.sql'] as unknown as ReturnType<typeof actual.readdirSync>),
  };
});

// ---------- helpers ----------

/**
 * Build a minimal fake pg client whose query() calls are tracked.
 * `appliedVersions` controls which versions are reported as already applied.
 */
function makeFakeClient(appliedVersions: string[] = []) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];

  const query = vi.fn(async (text: string, values?: unknown[]) => {
    queries.push({ text, values });

    // Respond to the "already applied?" SELECT
    if (text.includes('SELECT version FROM schema_migrations')) {
      const version = values?.[0] as string;
      if (appliedVersions.includes(version)) {
        return { rows: [{ version }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  });

  return { query, queries, release: vi.fn() };
}

function makeFakePool(client: ReturnType<typeof makeFakeClient>) {
  return { connect: vi.fn(async () => client) };
}

// ---------- tests ----------

describe('runMigrations – schema_migrations tracking', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('skips a migration that is already recorded in schema_migrations', async () => {
    const client = makeFakeClient(['001_init', '002_rbac']);
    const pool = makeFakePool(client);

    const { runMigrations } = await import(
      '../../../src/server/deployment/hosted/db/migrate.js'
    );

    await runMigrations(pool as any);

    // Neither migration SQL should have been executed
    const executedSql = client.queries
      .filter((q) => q.text.startsWith('-- migration'))
      .map((q) => q.text);
    expect(executedSql).toHaveLength(0);

    // No INSERT into schema_migrations should have occurred
    const inserts = client.queries.filter((q) =>
      q.text.includes('INSERT INTO schema_migrations'),
    );
    expect(inserts).toHaveLength(0);
  });

  it('applies and records a migration that has not been applied yet', async () => {
    // Only 001 is already applied; 002 is new
    const client = makeFakeClient(['001_init']);
    const pool = makeFakePool(client);

    const { runMigrations } = await import(
      '../../../src/server/deployment/hosted/db/migrate.js'
    );

    await runMigrations(pool as any);

    // 002's SQL should have run
    const executedMigrations = client.queries
      .filter((q) => q.text === '-- migration 002')
      .map((q) => q.text);
    expect(executedMigrations).toHaveLength(1);

    // An INSERT for version "002_rbac" should have been recorded
    const inserts = client.queries.filter(
      (q) =>
        q.text.includes('INSERT INTO schema_migrations') &&
        (q.values as string[])?.[0] === '002_rbac',
    );
    expect(inserts).toHaveLength(1);
  });

  it('applies and records all migrations when none have been applied', async () => {
    const client = makeFakeClient([]);
    const pool = makeFakePool(client);

    const { runMigrations } = await import(
      '../../../src/server/deployment/hosted/db/migrate.js'
    );

    await runMigrations(pool as any);

    // Both migration SQLs should have been executed
    const migrationQueries = client.queries.filter((q) =>
      q.text.startsWith('-- migration'),
    );
    expect(migrationQueries).toHaveLength(2);

    // Two INSERTs into schema_migrations
    const inserts = client.queries.filter((q) =>
      q.text.includes('INSERT INTO schema_migrations'),
    );
    expect(inserts).toHaveLength(2);

    const recordedVersions = inserts.map((q) => (q.values as string[])[0]);
    expect(recordedVersions).toContain('001_init');
    expect(recordedVersions).toContain('002_rbac');
  });

  it('releases the db client even when a migration fails', async () => {
    const client = makeFakeClient([]);
    // Make the second query (after base schema) throw
    let callCount = 0;
    client.query = vi.fn(async (text: string, values?: unknown[]) => {
      callCount++;
      if (callCount > 1) throw new Error('DB error');
      return { rows: [], rowCount: 0 };
    });
    const pool = makeFakePool(client);

    const { runMigrations } = await import(
      '../../../src/server/deployment/hosted/db/migrate.js'
    );

    await expect(runMigrations(pool as any)).rejects.toThrow('DB error');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
