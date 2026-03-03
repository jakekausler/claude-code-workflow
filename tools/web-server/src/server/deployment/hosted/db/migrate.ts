import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { PgPool } from './pg-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run the schema.sql migration against the provided PostgreSQL pool.
 * The schema uses IF NOT EXISTS / CREATE OR REPLACE so it is idempotent
 * and safe to run on every server startup.
 */
export async function runMigrations(pool: PgPool): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('[migrate] Schema migration completed successfully');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[migrate] Schema migration failed:', message);
    throw err;
  } finally {
    client.release();
  }
}
