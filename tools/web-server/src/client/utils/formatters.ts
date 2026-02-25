/**
 * Convert a slug like "ready_for_work" to title case "Ready For Work".
 */
export function slugToTitle(slug: string): string {
  return slug
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Compute completion percentage from a count and total.
 * Returns 0 if total is 0.
 */
export function completionPercent(complete: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((complete / total) * 100);
}

/**
 * Map a column slug to a display color for the BoardColumn dot.
 */
const COLUMN_COLORS: Record<string, string> = {
  backlog: '#94a3b8',
  ready_for_work: '#3b82f6',
  design: '#8b5cf6',
  user_design_feedback: '#a855f7',
  build: '#f59e0b',
  automatic_testing: '#10b981',
  manual_testing: '#14b8a6',
  finalize: '#06b6d4',
  pr_created: '#6366f1',
  addressing_comments: '#ec4899',
  done: '#22c55e',
  refinement: '#f97316',
  review: '#0ea5e9',
  archived: '#6b7280',
};

export function columnColor(slug: string): string {
  return COLUMN_COLORS[slug] ?? '#64748b';
}

/**
 * Map an epic/ticket status to a display color.
 */
export function statusColor(status: string): string {
  switch (status) {
    case 'not_started':
      return '#94a3b8';
    case 'in_progress':
      return '#3b82f6';
    case 'complete':
      return '#22c55e';
    default:
      return '#64748b';
  }
}

/**
 * Map a refinement type to a badge color.
 */
const REFINEMENT_COLORS: Record<string, string> = {
  frontend: '#3b82f6',
  backend: '#f59e0b',
  cli: '#8b5cf6',
  api: '#10b981',
  database: '#ef4444',
  infrastructure: '#6366f1',
  documentation: '#64748b',
  testing: '#14b8a6',
};

export function refinementColor(type: string): string {
  return REFINEMENT_COLORS[type] ?? '#64748b';
}
