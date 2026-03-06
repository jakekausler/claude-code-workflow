import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { runMigration } from '../../../src/cli/logic/migrate.js';

const TEST_DIR = '/tmp/kanban-migrate-engine-test';

function setupOldFormatRepo(structure: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = path.join(TEST_DIR, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe('runMigration', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('migrates a simple old-format repo with one epic and two stages', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n\n## Overview\n\nBuild the login form.\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Auth API\n\n## Status\nNot Started\n\n## Overview\n\nBuild the auth API.\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });

    expect(result.migrated).toBe(true);
    expect(result.dry_run).toBe(false);
    expect(result.epics).toHaveLength(1);
    expect(result.epics[0].id).toBe('EPIC-001');
    expect(result.epics[0].tickets_created).toBe(1);
    expect(result.epics[0].stages_migrated).toBe(2);
    expect(result.total_stages_migrated).toBe(2);
    expect(result.total_tickets_created).toBe(1);
  });

  it('creates ticket subdirectory with correct structure', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    // Ticket directory should exist
    const ticketDir = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001');
    expect(fs.existsSync(ticketDir)).toBe(true);

    // Ticket file should exist with frontmatter
    const ticketFile = path.join(ticketDir, 'TICKET-001-001.md');
    expect(fs.existsSync(ticketFile)).toBe(true);
    const ticketContent = fs.readFileSync(ticketFile, 'utf-8');
    const { data: ticketData } = matter(ticketContent);
    expect(ticketData.id).toBe('TICKET-001-001');
    expect(ticketData.epic).toBe('EPIC-001');
    expect(ticketData.stages).toContain('STAGE-001-001-001');
  });

  it('moves and renames stage files to new three-level IDs', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Auth API\n\n## Status\nNot Started\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    // Old files should be gone
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-001.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-002.md'))).toBe(false);

    // New files should exist in ticket directory
    const stageFile1 = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md');
    const stageFile2 = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md');
    expect(fs.existsSync(stageFile1)).toBe(true);
    expect(fs.existsSync(stageFile2)).toBe(true);

    // Verify frontmatter on stage files
    const { data: stage1 } = matter(fs.readFileSync(stageFile1, 'utf-8'));
    expect(stage1.id).toBe('STAGE-001-001-001');
    expect(stage1.ticket).toBe('TICKET-001-001');
    expect(stage1.epic).toBe('EPIC-001');
    expect(stage1.title).toBe('Login Form');
    expect(stage1.status).toBe('Complete');
    expect(stage1.session_active).toBe(false);
  });

  it('creates or updates epic file with YAML frontmatter', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Status\nComplete\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const epicFile = path.join(TEST_DIR, 'epics/EPIC-001/EPIC-001.md');
    expect(fs.existsSync(epicFile)).toBe(true);
    const { data } = matter(fs.readFileSync(epicFile, 'utf-8'));
    expect(data.id).toBe('EPIC-001');
    expect(data.tickets).toContain('TICKET-001-001');
    expect(data.depends_on).toEqual([]);
  });

  it('infers sequential dependencies between stages (order-based)', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# First\n\n## Status\nComplete\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Second\n\n## Status\nNot Started\n',
      'epics/EPIC-001/STAGE-001-003.md': '# Third\n\n## Status\nNot Started\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });

    expect(result.epics[0].dependencies_inferred).toBe(2);
    expect(result.total_dependencies_inferred).toBe(2);

    // Verify stage 2 depends on stage 1
    const stage2File = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md');
    const { data: stage2 } = matter(fs.readFileSync(stage2File, 'utf-8'));
    expect(stage2.depends_on).toEqual(['STAGE-001-001-001']);

    // Verify stage 3 depends on stage 2
    const stage3File = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-003.md');
    const { data: stage3 } = matter(fs.readFileSync(stage3File, 'utf-8'));
    expect(stage3.depends_on).toEqual(['STAGE-001-001-002']);
  });

  it('first stage has empty depends_on', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# First\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const stageFile = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md');
    const { data } = matter(fs.readFileSync(stageFile, 'utf-8'));
    expect(data.depends_on).toEqual([]);
  });

  it('dry run does not modify files', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Auth API\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: true });

    expect(result.migrated).toBe(true);
    expect(result.dry_run).toBe(true);
    expect(result.total_stages_migrated).toBe(2);

    // Old files should still exist
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-002.md'))).toBe(true);

    // Ticket directory should NOT exist
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001'))).toBe(false);
  });

  it('migrates multiple epics', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login\n',
      'epics/EPIC-001/STAGE-001-002.md': '# Register\n',
      'epics/EPIC-002/STAGE-002-001.md': '# Cart\n',
      'epics/EPIC-002/STAGE-002-002.md': '# Checkout\n',
      'epics/EPIC-002/STAGE-002-003.md': '# Payment\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });

    expect(result.epics).toHaveLength(2);
    expect(result.total_stages_migrated).toBe(5);
    expect(result.total_tickets_created).toBe(2);
    // EPIC-001: 1 dep (002 -> 001), EPIC-002: 2 deps (002 -> 001, 003 -> 002)
    expect(result.total_dependencies_inferred).toBe(3);
  });

  it('preserves body content from old stage files', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n\n## Overview\n\nBuild the login form with validation.\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const stageFile = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md');
    const content = fs.readFileSync(stageFile, 'utf-8');
    expect(content).toContain('Build the login form with validation.');
  });

  it('preserves existing epic file body when updating', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/EPIC-001.md': '# User Authentication\n\nImplement a complete auth system.\n',
      'epics/EPIC-001/STAGE-001-001.md': '# Login Form\n',
    });

    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const epicFile = path.join(TEST_DIR, 'epics/EPIC-001/EPIC-001.md');
    const { data, content } = matter(fs.readFileSync(epicFile, 'utf-8'));
    expect(data.id).toBe('EPIC-001');
    expect(data.title).toBe('User Authentication');
    expect(content).toContain('Implement a complete auth system.');
  });

  it('returns migrated: false when no old-format epics found', () => {
    fs.mkdirSync(path.join(TEST_DIR, 'epics'), { recursive: true });
    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });
    expect(result.migrated).toBe(false);
    expect(result.epics).toHaveLength(0);
  });

  it('returns migrated: false when epics dir does not exist', () => {
    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });
    expect(result.migrated).toBe(false);
  });

  it('adds warning when a stage has unknown status value', () => {
    setupOldFormatRepo({
      'epics/EPIC-001/STAGE-001-001.md': '# Stage\n\n## Status\nWeirdStatus\n',
    });

    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });
    expect(result.warnings.some((w) => w.includes('WeirdStatus'))).toBe(true);
  });
});
