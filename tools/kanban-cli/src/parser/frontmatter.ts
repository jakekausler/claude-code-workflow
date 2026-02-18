import matter from 'gray-matter';
import type { Epic, Ticket, Stage, WorkItemType } from '../types/work-items.js';

/**
 * Extract raw frontmatter data from markdown content.
 * Returns the YAML data as an untyped record.
 */
export function parseFrontmatterRaw(content: string): Record<string, unknown> {
  const { data } = matter(content);
  return data;
}

/**
 * Extract and validate frontmatter data from markdown content.
 * Throws if frontmatter is missing or if required fields are absent.
 */
function extractData(content: string, filePath: string): Record<string, unknown> {
  const { data } = matter(content);

  if (!data || Object.keys(data).length === 0) {
    throw new Error(`No frontmatter found in ${filePath}`);
  }

  return data;
}

/**
 * Require a field to exist in the frontmatter data.
 * Throws a descriptive error if missing.
 */
function requireField<T>(
  data: Record<string, unknown>,
  field: string,
  filePath: string,
): T {
  if (data[field] === undefined || data[field] === null) {
    throw new Error(`Missing required field "${field}" in frontmatter of ${filePath}`);
  }
  return data[field] as T;
}

/**
 * Parse an epic from markdown file content.
 */
export function parseEpicFrontmatter(content: string, filePath: string): Epic {
  const data = extractData(content, filePath);

  return {
    id: requireField<string>(data, 'id', filePath),
    title: requireField<string>(data, 'title', filePath),
    status: requireField<string>(data, 'status', filePath),
    jira_key: (data.jira_key as string) ?? null,
    tickets: Array.isArray(data.tickets) ? data.tickets : [],
    depends_on: Array.isArray(data.depends_on) ? data.depends_on : [],
    file_path: filePath,
  };
}

/**
 * Parse a ticket from markdown file content.
 */
export function parseTicketFrontmatter(content: string, filePath: string): Ticket {
  const data = extractData(content, filePath);

  return {
    id: requireField<string>(data, 'id', filePath),
    epic: requireField<string>(data, 'epic', filePath),
    title: requireField<string>(data, 'title', filePath),
    status: requireField<string>(data, 'status', filePath),
    jira_key: (data.jira_key as string) ?? null,
    source: (data.source as 'local' | 'jira') ?? 'local',
    stages: Array.isArray(data.stages) ? data.stages : [],
    depends_on: Array.isArray(data.depends_on) ? data.depends_on : [],
    file_path: filePath,
  };
}

/**
 * Parse a stage from markdown file content.
 */
export function parseStageFrontmatter(content: string, filePath: string): Stage {
  const data = extractData(content, filePath);

  return {
    id: requireField<string>(data, 'id', filePath),
    ticket: requireField<string>(data, 'ticket', filePath),
    epic: requireField<string>(data, 'epic', filePath),
    title: requireField<string>(data, 'title', filePath),
    status: requireField<string>(data, 'status', filePath),
    session_active: data.session_active === true ? true : false,
    refinement_type: Array.isArray(data.refinement_type) ? data.refinement_type : [],
    depends_on: Array.isArray(data.depends_on) ? data.depends_on : [],
    worktree_branch: (data.worktree_branch as string) ?? null,
    priority: typeof data.priority === 'number' ? data.priority : 0,
    due_date: (data.due_date as string) ?? null,
    file_path: filePath,
  };
}

/**
 * Generic dispatcher: parse frontmatter based on work item type.
 */
export function parseFrontmatter(
  content: string,
  filePath: string,
  type: WorkItemType,
): Epic | Ticket | Stage {
  switch (type) {
    case 'epic':
      return parseEpicFrontmatter(content, filePath);
    case 'ticket':
      return parseTicketFrontmatter(content, filePath);
    case 'stage':
      return parseStageFrontmatter(content, filePath);
  }
}
