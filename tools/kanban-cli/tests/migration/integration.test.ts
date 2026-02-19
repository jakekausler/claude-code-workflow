import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runMigration } from '../../src/cli/logic/migrate.js';
import { isOldFormatRepo } from '../../src/migration/detector.js';
import { discoverWorkItems } from '../../src/parser/discovery.js';
import {
  parseEpicFrontmatter,
  parseTicketFrontmatter,
  parseStageFrontmatter,
} from '../../src/parser/frontmatter.js';

const TEST_DIR = '/tmp/kanban-migrate-integration-test';

function seedOldFormatRepo(): void {
  const structure: Record<string, string> = {
    // EPIC-001: User Authentication (3 stages)
    'epics/EPIC-001/EPIC-001.md': [
      '# User Authentication',
      '',
      'Implement a complete user authentication system.',
    ].join('\n'),
    'epics/EPIC-001/STAGE-001-001.md': [
      '# Login Form UI',
      '',
      '## Status',
      'Complete',
      '',
      '## Overview',
      '',
      'Create the login form component with email/password fields.',
    ].join('\n'),
    'epics/EPIC-001/STAGE-001-002.md': [
      '# Auth API Endpoints',
      '',
      '## Status',
      'In Progress',
      '',
      '## Overview',
      '',
      'Implement /api/auth/login and /api/auth/logout REST endpoints.',
    ].join('\n'),
    'epics/EPIC-001/STAGE-001-003.md': [
      '# Session Management',
      '',
      '## Status',
      'Not Started',
      '',
      '## Overview',
      '',
      'Implement server-side session storage.',
    ].join('\n'),

    // EPIC-002: Payment System (2 stages, no epic file)
    'epics/EPIC-002/STAGE-002-001.md': [
      '# Cart Summary',
      '',
      '## Status',
      'Complete',
      '',
      '## Overview',
      '',
      'Build the cart summary page.',
    ].join('\n'),
    'epics/EPIC-002/STAGE-002-002.md': [
      '# Checkout Flow',
      '',
      '## Status',
      'Not Started',
      '',
      '## Overview',
      '',
      'Build the checkout flow.',
    ].join('\n'),
  };

  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = path.join(TEST_DIR, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe('migration integration', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('repo is detected as old format before migration', () => {
    seedOldFormatRepo();
    expect(isOldFormatRepo(TEST_DIR)).toBe(true);
  });

  it('repo is no longer detected as old format after migration', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });
    expect(isOldFormatRepo(TEST_DIR)).toBe(false);
  });

  it('migrated files can be discovered by discoverWorkItems', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const discovered = discoverWorkItems(TEST_DIR);
    const epics = discovered.filter((d) => d.type === 'epic');
    const tickets = discovered.filter((d) => d.type === 'ticket');
    const stages = discovered.filter((d) => d.type === 'stage');

    expect(epics.length).toBe(2);
    expect(tickets.length).toBe(2);
    expect(stages.length).toBe(5);
  });

  it('migrated epic files can be parsed by parseEpicFrontmatter', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const epicFile = path.join(TEST_DIR, 'epics/EPIC-001/EPIC-001.md');
    const content = fs.readFileSync(epicFile, 'utf-8');
    const epic = parseEpicFrontmatter(content, epicFile);

    expect(epic.id).toBe('EPIC-001');
    expect(epic.title).toBe('User Authentication');
    expect(epic.tickets).toContain('TICKET-001-001');
    expect(epic.depends_on).toEqual([]);
  });

  it('migrated ticket files can be parsed by parseTicketFrontmatter', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const ticketFile = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md');
    const content = fs.readFileSync(ticketFile, 'utf-8');
    const ticket = parseTicketFrontmatter(content, ticketFile);

    expect(ticket.id).toBe('TICKET-001-001');
    expect(ticket.epic).toBe('EPIC-001');
    expect(ticket.stages).toHaveLength(3);
    expect(ticket.source).toBe('local');
  });

  it('migrated stage files can be parsed by parseStageFrontmatter', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    const stageFile = path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md');
    const content = fs.readFileSync(stageFile, 'utf-8');
    const stage = parseStageFrontmatter(content, stageFile);

    expect(stage.id).toBe('STAGE-001-001-002');
    expect(stage.ticket).toBe('TICKET-001-001');
    expect(stage.epic).toBe('EPIC-001');
    expect(stage.title).toBe('Auth API Endpoints');
    expect(stage.status).toBe('In Progress');
    expect(stage.session_active).toBe(false);
    expect(stage.depends_on).toEqual(['STAGE-001-001-001']);
  });

  it('full migration produces correct summary', () => {
    seedOldFormatRepo();
    const result = runMigration({ repoPath: TEST_DIR, dryRun: false });

    expect(result.migrated).toBe(true);
    expect(result.dry_run).toBe(false);
    expect(result.epics).toHaveLength(2);
    expect(result.total_stages_migrated).toBe(5);
    expect(result.total_tickets_created).toBe(2);
    // EPIC-001: 2 deps (002->001, 003->002), EPIC-002: 1 dep (002->001)
    expect(result.total_dependencies_inferred).toBe(3);
    expect(result.warnings).toHaveLength(0);
  });

  it('directory structure matches new format convention', () => {
    seedOldFormatRepo();
    runMigration({ repoPath: TEST_DIR, dryRun: false });

    // EPIC-001
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/EPIC-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/TICKET-001-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-002.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/TICKET-001-001/STAGE-001-001-003.md'))).toBe(true);

    // EPIC-002
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/EPIC-002.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/TICKET-002-001/TICKET-002-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/TICKET-002-001/STAGE-002-001-001.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/TICKET-002-001/STAGE-002-001-002.md'))).toBe(true);

    // Old files should be gone
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-001.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-002.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-001/STAGE-001-003.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/STAGE-002-001.md'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'epics/EPIC-002/STAGE-002-002.md'))).toBe(false);
  });
});
