import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KanbanDatabase } from '../../src/db/database.js';

describe('KanbanDatabase', () => {
  const tmpDir = path.join(os.tmpdir(), 'kanban-db-test-' + Date.now());
  let dbPath: string;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new database file at the specified path', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      expect(fs.existsSync(dbPath)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('creates the repos table', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const tables = db.raw()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repos'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('creates the epics table', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const tables = db.raw()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='epics'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('creates the tickets table', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const tables = db.raw()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tickets'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('creates the stages table with session_active, locked_at, locked_by columns', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const columns = db.raw()
        .prepare("PRAGMA table_info(stages)")
        .all() as Array<{ name: string }>;
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain('session_active');
      expect(colNames).toContain('locked_at');
      expect(colNames).toContain('locked_by');
    } finally {
      db.close();
    }
  });

  it('creates the dependencies table', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const tables = db.raw()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dependencies'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('creates parent directories if they do not exist', () => {
    const nestedPath = path.join(tmpDir, 'a', 'b', 'c', 'test.db');
    const db = new KanbanDatabase(nestedPath);
    try {
      expect(fs.existsSync(nestedPath)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('opens an existing database without re-creating tables', () => {
    const db1 = new KanbanDatabase(dbPath);
    db1.raw().prepare("INSERT INTO repos (path, name, registered_at) VALUES (?, ?, ?)").run(
      '/test', 'test', new Date().toISOString()
    );
    db1.close();

    const db2 = new KanbanDatabase(dbPath);
    try {
      const rows = db2.raw().prepare("SELECT * FROM repos").all();
      expect(rows).toHaveLength(1);
    } finally {
      db2.close();
    }
  });

  it('enables WAL mode for concurrency', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const result = db.raw().pragma('journal_mode') as Array<{ journal_mode: string }>;
      expect(result[0].journal_mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('enables foreign keys', () => {
    const db = new KanbanDatabase(dbPath);
    try {
      const result = db.raw().pragma('foreign_keys') as Array<{ foreign_keys: number }>;
      expect(result[0].foreign_keys).toBe(1);
    } finally {
      db.close();
    }
  });
});
