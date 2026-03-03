import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { PgPool } from './pg-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run the schema.sql migration and any numbered migration files from
 * the migrations/ subdirectory against the provided PostgreSQL pool.
 * All statements use IF NOT EXISTS / CREATE OR REPLACE so they are
 * idempotent and safe to run on every server startup.
 */
export async function runMigrations(pool: PgPool): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Run base schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    await client.query(schemaSql);
    console.log('[migrate] Base schema migration completed successfully');

    // 2. Run numbered migration files from migrations/ directory
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');
        await client.query(sql);
        console.log(`[migrate] Migration ${file} completed successfully`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[migrate] Schema migration failed:', message);
    throw err;
  } finally {
    client.release();
  }
}
