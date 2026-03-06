import matter from 'gray-matter';

/**
 * Status normalization map.
 * Old repos may use different status strings; map them to config-compatible values.
 */
const STATUS_NORMALIZATION: Record<string, string> = {
  'done': 'Complete',
  'completed': 'Complete',
  'complete': 'Complete',
  'in progress': 'In Progress',
  'in-progress': 'In Progress',
  'not started': 'Not Started',
  'not-started': 'Not Started',
  'todo': 'Not Started',
  'to do': 'Not Started',
  'blocked': 'Not Started',
  'skipped': 'Skipped',
};

/**
 * Normalize a status string to a config-compatible value.
 * If the status is already valid (case-sensitive match), return it as-is.
 * Otherwise, look up in normalization map using lowercase.
 */
function normalizeStatus(status: string): string {
  // Check normalization map (case-insensitive)
  const normalized = STATUS_NORMALIZATION[status.toLowerCase()];
  if (normalized) return normalized;
  // Return as-is if not in the map (could be a valid pipeline status like "Design", "Build")
  return status;
}

export interface EpicMarkdownInput {
  id: string;
  title: string;
  status: string;
  tickets: string[];
  dependsOn: string[];
  body?: string;
}

export interface TicketMarkdownInput {
  id: string;
  epic: string;
  title: string;
  status: string;
  stages: string[];
  dependsOn: string[];
  body?: string;
}

export interface StageMarkdownInput {
  id: string;
  ticket: string;
  epic: string;
  title: string;
  status: string;
  dependsOn: string[];
  body?: string;
}

/**
 * Generate a new-format epic markdown file with YAML frontmatter.
 */
export function generateEpicMarkdown(input: EpicMarkdownInput): string {
  const frontmatter: Record<string, unknown> = {
    id: input.id,
    title: input.title,
    status: normalizeStatus(input.status),
    tickets: input.tickets,
    depends_on: input.dependsOn,
  };

  const body = input.body || `## Overview\n\n${input.title}`;

  return matter.stringify(`\n${body}\n`, frontmatter);
}

/**
 * Generate a new-format ticket markdown file with YAML frontmatter.
 */
export function generateTicketMarkdown(input: TicketMarkdownInput): string {
  const frontmatter: Record<string, unknown> = {
    id: input.id,
    epic: input.epic,
    title: input.title,
    status: normalizeStatus(input.status),
    source: 'local',
    stages: input.stages,
    depends_on: input.dependsOn,
  };

  const body = input.body || `## Overview\n\n${input.title}`;

  return matter.stringify(`\n${body}\n`, frontmatter);
}

/**
 * Generate a new-format stage markdown file with YAML frontmatter.
 */
export function generateStageMarkdown(input: StageMarkdownInput): string {
  const frontmatter: Record<string, unknown> = {
    id: input.id,
    ticket: input.ticket,
    epic: input.epic,
    title: input.title,
    status: normalizeStatus(input.status),
    session_active: false,
    refinement_type: [],
    depends_on: input.dependsOn,
    priority: 0,
  };

  const body = input.body || `## Overview\n\n${input.title}`;

  return matter.stringify(`\n${body}\n`, frontmatter);
}
