/**
 * Returns inline style + text class for a graph node based on its workflow status.
 *
 * Status categories:
 *   - Completed (completed/done/complete) → dimmed, low opacity
 *   - In progress (in_progress/build/manual_testing/automatic_testing/finalize) → diagonal stripes
 *   - Blocked (blocked or starts with "blocked") → red-tinted diagonal stripes
 *   - Not started (everything else) → solid background, normal colors
 */

export interface StatusStyle {
  /** CSS `background` property (solid color or gradient + color). */
  background: string;
  /** Opacity for the whole node (< 1 for completed). */
  opacity: number;
  /** Tailwind text class — muted for completed nodes. */
  textClass: string;
}

const COMPLETED = new Set(['completed', 'done', 'complete']);
const IN_PROGRESS = new Set([
  'in_progress',
  'build',
  'manual_testing',
  'automatic_testing',
  'finalize',
]);

export function getStatusStyle(status: string, baseColor: string): StatusStyle {
  const s = status.toLowerCase().replace(/\s+/g, '_');

  if (COMPLETED.has(s)) {
    return {
      background: baseColor,
      opacity: 0.6,
      textClass: 'text-gray-400',
    };
  }

  if (IN_PROGRESS.has(s)) {
    return {
      background: `repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 8px), ${baseColor}`,
      opacity: 1,
      textClass: '',
    };
  }

  if (s === 'blocked' || s.startsWith('blocked')) {
    return {
      background: `repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(239,68,68,0.08) 4px, rgba(239,68,68,0.08) 8px), ${baseColor}`,
      opacity: 1,
      textClass: '',
    };
  }

  // Not started / design / unknown — solid background, normal colors
  return {
    background: baseColor,
    opacity: 1,
    textClass: '',
  };
}
