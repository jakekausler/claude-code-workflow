import { describe, it, expect } from 'vitest';
import matter from 'gray-matter';
import {
  generateEpicMarkdown,
  generateTicketMarkdown,
  generateStageMarkdown,
} from '../../src/migration/frontmatter-generator.js';

describe('generateEpicMarkdown', () => {
  it('produces valid YAML frontmatter with required fields', () => {
    const md = generateEpicMarkdown({
      id: 'EPIC-001',
      title: 'User Authentication',
      status: 'Not Started',
      tickets: ['TICKET-001-001'],
      dependsOn: [],
    });

    const { data, content } = matter(md);
    expect(data.id).toBe('EPIC-001');
    expect(data.title).toBe('User Authentication');
    expect(data.status).toBe('Not Started');
    expect(data.tickets).toEqual(['TICKET-001-001']);
    expect(data.depends_on).toEqual([]);
    expect(content.trim()).toContain('## Overview');
  });

  it('preserves existing body content', () => {
    const md = generateEpicMarkdown({
      id: 'EPIC-001',
      title: 'Auth',
      status: 'In Progress',
      tickets: ['TICKET-001-001'],
      dependsOn: [],
      body: 'Some existing description.',
    });

    const { content } = matter(md);
    expect(content).toContain('Some existing description.');
  });
});

describe('generateTicketMarkdown', () => {
  it('produces valid YAML frontmatter with required fields', () => {
    const md = generateTicketMarkdown({
      id: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Flow',
      status: 'Not Started',
      stages: ['STAGE-001-001-001', 'STAGE-001-001-002'],
      dependsOn: [],
    });

    const { data, content } = matter(md);
    expect(data.id).toBe('TICKET-001-001');
    expect(data.epic).toBe('EPIC-001');
    expect(data.title).toBe('Login Flow');
    expect(data.status).toBe('Not Started');
    expect(data.source).toBe('local');
    expect(data.stages).toEqual(['STAGE-001-001-001', 'STAGE-001-001-002']);
    expect(data.depends_on).toEqual([]);
    expect(content.trim()).toContain('## Overview');
  });
});

describe('generateStageMarkdown', () => {
  it('produces valid YAML frontmatter with required fields', () => {
    const md = generateStageMarkdown({
      id: 'STAGE-001-001-001',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Form UI',
      status: 'Not Started',
      dependsOn: [],
    });

    const { data, content } = matter(md);
    expect(data.id).toBe('STAGE-001-001-001');
    expect(data.ticket).toBe('TICKET-001-001');
    expect(data.epic).toBe('EPIC-001');
    expect(data.title).toBe('Login Form UI');
    expect(data.status).toBe('Not Started');
    expect(data.session_active).toBe(false);
    expect(data.refinement_type).toEqual([]);
    expect(data.depends_on).toEqual([]);
    expect(data.priority).toBe(0);
  });

  it('includes depends_on when provided', () => {
    const md = generateStageMarkdown({
      id: 'STAGE-001-001-002',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Auth API',
      status: 'Not Started',
      dependsOn: ['STAGE-001-001-001'],
    });

    const { data } = matter(md);
    expect(data.depends_on).toEqual(['STAGE-001-001-001']);
  });

  it('preserves body content from old stage', () => {
    const md = generateStageMarkdown({
      id: 'STAGE-001-001-001',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Login Form',
      status: 'Complete',
      dependsOn: [],
      body: '## Overview\n\nBuild the login form.',
    });

    const { content } = matter(md);
    expect(content).toContain('Build the login form.');
  });

  it('normalizes status values to valid config statuses', () => {
    const md = generateStageMarkdown({
      id: 'STAGE-001-001-001',
      ticket: 'TICKET-001-001',
      epic: 'EPIC-001',
      title: 'Stage',
      status: 'Done',
      dependsOn: [],
    });

    const { data } = matter(md);
    // "Done" should be normalized to "Complete"
    expect(data.status).toBe('Complete');
  });
});
