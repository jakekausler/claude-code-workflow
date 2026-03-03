import { describe, it, expect } from 'vitest';
import { buildJqlFromFilter } from '../../src/jira/filter.js';
import type { JiraFilterConfig } from '../../src/types/pipeline.js';
import { DEFAULT_JIRA_FILTER_CONFIG } from '../../src/types/pipeline.js';

function makeFilter(overrides: Partial<JiraFilterConfig> = {}): JiraFilterConfig {
  return { ...DEFAULT_JIRA_FILTER_CONFIG, ...overrides };
}

describe('buildJqlFromFilter', () => {
  it('returns jql_override as-is when set', () => {
    const filter = makeFilter({ jql_override: 'project = FOO AND sprint in openSprints()' });
    expect(buildJqlFromFilter(filter)).toBe('project = FOO AND sprint in openSprints()');
  });

  it('returns fallback when no clauses', () => {
    const filter = makeFilter({ labels: [], statuses: [], assignee: null, custom_fields: {}, jql_override: null });
    expect(buildJqlFromFilter(filter)).toBe('ORDER BY created DESC');
  });

  it('builds label clause', () => {
    const filter = makeFilter({ labels: ['claude-workflow'], statuses: [], assignee: null, custom_fields: {} });
    expect(buildJqlFromFilter(filter)).toBe('labels in ("claude-workflow")');
  });

  it('builds status clause', () => {
    const filter = makeFilter({ labels: [], statuses: ['To Do', 'Ready for Dev'], assignee: null, custom_fields: {} });
    expect(buildJqlFromFilter(filter)).toBe('status in ("To Do", "Ready for Dev")');
  });

  it('builds assignee clause', () => {
    const filter = makeFilter({ labels: [], statuses: [], assignee: 'johndoe', custom_fields: {} });
    expect(buildJqlFromFilter(filter)).toBe('assignee = "johndoe"');
  });

  it('builds custom_fields clauses', () => {
    const filter = makeFilter({ labels: [], statuses: [], assignee: null, custom_fields: { '10001': 'High' } });
    expect(buildJqlFromFilter(filter)).toBe('cf[10001] = "High"');
  });

  it('combines clauses with AND by default', () => {
    const filter = makeFilter({
      labels: ['foo'],
      statuses: ['To Do'],
      assignee: null,
      custom_fields: {},
      logic: 'AND',
    });
    expect(buildJqlFromFilter(filter)).toBe('labels in ("foo") AND status in ("To Do")');
  });

  it('combines clauses with OR when logic is OR', () => {
    const filter = makeFilter({
      labels: ['foo'],
      statuses: ['To Do'],
      assignee: null,
      custom_fields: {},
      logic: 'OR',
    });
    expect(buildJqlFromFilter(filter)).toBe('labels in ("foo") OR status in ("To Do")');
  });

  it('builds full multi-dimensional filter', () => {
    const filter = makeFilter({
      labels: ['claude-workflow'],
      statuses: ['To Do', 'Ready for Dev'],
      assignee: 'alice',
      custom_fields: { '10001': 'High' },
      logic: 'AND',
    });
    expect(buildJqlFromFilter(filter)).toBe(
      'labels in ("claude-workflow") AND status in ("To Do", "Ready for Dev") AND assignee = "alice" AND cf[10001] = "High"',
    );
  });

  it('default config produces expected JQL', () => {
    const jql = buildJqlFromFilter(DEFAULT_JIRA_FILTER_CONFIG);
    expect(jql).toBe('labels in ("claude-workflow") AND status in ("To Do", "Ready for Dev")');
  });
});
