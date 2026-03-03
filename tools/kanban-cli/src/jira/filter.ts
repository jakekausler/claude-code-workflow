import type { JiraFilterConfig } from '../types/pipeline.js';

/**
 * Build a JQL query string from a JiraFilterConfig.
 *
 * If jql_override is set, it is returned as-is.
 * Otherwise, filter dimensions are combined using the configured logic (AND/OR).
 * Returns a safe fallback JQL if no clauses are produced.
 */
export function buildJqlFromFilter(filter: JiraFilterConfig): string {
  if (filter.jql_override) return filter.jql_override;

  const clauses: string[] = [];

  if (filter.labels.length > 0) {
    clauses.push(`labels in (${filter.labels.map((l) => `"${l}"`).join(', ')})`);
  }

  if (filter.statuses.length > 0) {
    clauses.push(`status in (${filter.statuses.map((s) => `"${s}"`).join(', ')})`);
  }

  if (filter.assignee) {
    clauses.push(`assignee = "${filter.assignee}"`);
  }

  for (const [k, v] of Object.entries(filter.custom_fields)) {
    clauses.push(`cf[${k}] = "${String(v)}"`);
  }

  return clauses.join(` ${filter.logic} `) || 'ORDER BY created DESC';
}
