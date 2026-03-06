/**
 * LCS-based diff utility.
 *
 * Computes a line-level diff between two strings using the
 * Longest Common Subsequence algorithm, producing an array of
 * DiffLine entries suitable for rendering a side-by-side or
 * unified diff view.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type DiffLineType = 'added' | 'removed' | 'context';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

// ─── LCS Matrix ──────────────────────────────────────────────────────────────

/**
 * Build an O(m x n) LCS length matrix for two arrays of strings.
 */
function computeLCSMatrix(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;
  const matrix: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      }
    }
  }

  return matrix;
}

// ─── Diff Computation ────────────────────────────────────────────────────────

/**
 * Compute a line-level diff between two strings.
 *
 * - `context` lines appear in both old and new; they carry both line numbers.
 * - `removed` lines appear only in old; they carry `oldLineNum`.
 * - `added`   lines appear only in new; they carry `newLineNum`.
 */
export function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const matrix = computeLCSMatrix(oldLines, newLines);

  // Backtrack from bottom-right to build diff in reverse
  const temp: DiffLine[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      // Context line — present in both
      temp.push({ type: 'context', content: oldLines[i - 1], oldLineNum: i, newLineNum: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
      // Added in new
      temp.push({ type: 'added', content: newLines[j - 1], newLineNum: j });
      j--;
    } else if (i > 0) {
      // Removed from old
      temp.push({ type: 'removed', content: oldLines[i - 1], oldLineNum: i });
      i--;
    }
  }

  temp.reverse();
  return temp;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/**
 * Compute add/remove counts from an array of DiffLines.
 */
export function getDiffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === 'added') added++;
    if (line.type === 'removed') removed++;
  }
  return { added, removed };
}
