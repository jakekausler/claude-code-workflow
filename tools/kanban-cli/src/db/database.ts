import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ALL_CREATE_STATEMENTS, ALTER_TABLE_MIGRATIONS } from './schema.js';

/**
 * Default database path: ~/.config/kanban-workflow/kanban.db
 */
export const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  '.config',
  'kanban-workflow',
  'kanban.db'
);

/**
 * Thin wrapper around better-sqlite3 that creates tables on open.
 */
export class KanbanDatabase {
  private db: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Enable foreign key enforcement
    this.db.pragma('foreign_keys = ON');

    // Create tables
    this.initializeTables();
  }

  /**
   * Returns the raw better-sqlite3 Database instance for direct queries.
   */
  raw(): Database.Database {
    return this.db;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  private initializeTables(): void {
    const migrate = this.db.transaction(() => {
      for (const sql of ALL_CREATE_STATEMENTS) {
        this.db.exec(sql);
      }
      // ALTER TABLE migrations: try/catch each because SQLite throws
      // if the column already exists (no IF NOT EXISTS support).
      for (const sql of ALTER_TABLE_MIGRATIONS) {
        try {
          this.db.exec(sql);
        } catch {
          // Column already exists — safe to ignore.
        }
      }
    });
    migrate();
  }
}
