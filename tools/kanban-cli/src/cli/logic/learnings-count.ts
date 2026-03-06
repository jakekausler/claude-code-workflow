import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

export interface LearningsCountInput {
  /** Absolute path to the repository root (used to locate scripts). */
  repoPath: string;
  /** Threshold for the exceeded flag. */
  threshold: number;
}

export interface LearningsCountOutput {
  count: number;
  threshold: number;
  exceeded: boolean;
  files: string[];
}

/**
 * Counts unanalyzed learnings by calling the count-unanalyzed.sh script.
 *
 * The script greps for `analyzed: false` across ~/docs/claude-learnings/*.md
 * and ~/docs/claude-journal/*.md, returning one file path per line.
 *
 * If the script is missing or fails, returns count: 0 with an empty files array.
 */
export function countUnanalyzedLearnings(
  input: LearningsCountInput,
): LearningsCountOutput {
  const scriptPath = path.join(
    input.repoPath,
    'skills',
    'meta-insights',
    'scripts',
    'count-unanalyzed.sh',
  );

  let rawOutput: string;
  try {
    rawOutput = execFileSync('bash', [scriptPath], {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Script missing, failed, or timed out — treat as zero unanalyzed files.
    return {
      count: 0,
      threshold: input.threshold,
      exceeded: false,
      files: [],
    };
  }

  const lines = rawOutput.trim().split('\n').filter((line) => line.trim().length > 0);
  const basenames = lines.map((line) => path.basename(line));

  return {
    count: basenames.length,
    threshold: input.threshold,
    exceeded: basenames.length > input.threshold,
    files: basenames,
  };
}
