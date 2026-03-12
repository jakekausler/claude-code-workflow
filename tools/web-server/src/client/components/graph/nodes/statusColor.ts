/**
 * Maps a kanban status string to a left-border color for graph nodes.
 *
 * The border color encodes workflow status:
 *   - green  → completed / done / complete
 *   - amber  → in-progress stages (build, manual_testing, etc.)
 *   - red    → blocked
 *   - gray   → not started / design / anything else
 */
export function statusBorderColor(status: string): string {
  const s = status.toLowerCase().replace(/\s+/g, '_');

  if (s === 'completed' || s === 'done' || s === 'complete') {
    return '#22c55e';
  }
  if (
    s === 'in_progress' ||
    s === 'build' ||
    s === 'manual_testing' ||
    s === 'automatic_testing' ||
    s === 'finalize'
  ) {
    return '#f59e0b';
  }
  if (s === 'blocked' || s.startsWith('blocked')) {
    return '#ef4444';
  }
  // not_started, design, or anything else
  return '#9ca3af';
}
