import { describe, it, expect, vi, beforeEach } from 'vitest';
import { countUnanalyzedLearnings } from '../../../src/cli/logic/learnings-count.js';
import type { LearningsCountInput } from '../../../src/cli/logic/learnings-count.js';

// Mock child_process so we don't actually run shell scripts
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
const mockExecFileSync = vi.mocked(execFileSync);

function makeInput(overrides: Partial<LearningsCountInput> = {}): LearningsCountInput {
  return {
    repoPath: '/fake/repo',
    threshold: 10,
    ...overrides,
  };
}

describe('countUnanalyzedLearnings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns exceeded: true when count exceeds threshold', () => {
    const files = Array.from({ length: 14 }, (_, i) =>
      `/home/user/docs/claude-learnings/2026-02-${String(i + 1).padStart(2, '0')}T10-00-00.md`,
    );
    mockExecFileSync.mockReturnValue(files.join('\n') + '\n');

    const result = countUnanalyzedLearnings(makeInput({ threshold: 10 }));

    expect(result.count).toBe(14);
    expect(result.threshold).toBe(10);
    expect(result.exceeded).toBe(true);
    expect(result.files).toHaveLength(14);
  });

  it('returns exceeded: false when count equals threshold', () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      `/home/user/docs/claude-learnings/file-${i}.md`,
    );
    mockExecFileSync.mockReturnValue(files.join('\n') + '\n');

    const result = countUnanalyzedLearnings(makeInput({ threshold: 10 }));

    expect(result.count).toBe(10);
    expect(result.threshold).toBe(10);
    expect(result.exceeded).toBe(false);
  });

  it('returns exceeded: false when count is below threshold', () => {
    const files = [
      '/home/user/docs/claude-learnings/a.md',
      '/home/user/docs/claude-journal/b.md',
    ];
    mockExecFileSync.mockReturnValue(files.join('\n') + '\n');

    const result = countUnanalyzedLearnings(makeInput({ threshold: 10 }));

    expect(result.count).toBe(2);
    expect(result.threshold).toBe(10);
    expect(result.exceeded).toBe(false);
  });

  it('respects custom threshold value', () => {
    const files = Array.from({ length: 5 }, (_, i) =>
      `/home/user/docs/claude-learnings/file-${i}.md`,
    );
    mockExecFileSync.mockReturnValue(files.join('\n') + '\n');

    const result = countUnanalyzedLearnings(makeInput({ threshold: 3 }));

    expect(result.count).toBe(5);
    expect(result.threshold).toBe(3);
    expect(result.exceeded).toBe(true);
  });

  it('returns count: 0 with empty files array when script fails', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('Script not found');
    });

    const result = countUnanalyzedLearnings(makeInput());

    expect(result.count).toBe(0);
    expect(result.threshold).toBe(10);
    expect(result.exceeded).toBe(false);
    expect(result.files).toEqual([]);
  });

  it('returns count: 0 with empty files array when script returns empty output', () => {
    mockExecFileSync.mockReturnValue('');

    const result = countUnanalyzedLearnings(makeInput());

    expect(result.count).toBe(0);
    expect(result.exceeded).toBe(false);
    expect(result.files).toEqual([]);
  });

  it('returns count: 0 with empty files array when script returns only whitespace', () => {
    mockExecFileSync.mockReturnValue('\n\n  \n');

    const result = countUnanalyzedLearnings(makeInput());

    expect(result.count).toBe(0);
    expect(result.exceeded).toBe(false);
    expect(result.files).toEqual([]);
  });

  it('extracts basenames from full paths', () => {
    mockExecFileSync.mockReturnValue(
      '/home/user/docs/claude-learnings/2026-02-18T10-30-00.md\n' +
        '/home/user/docs/claude-journal/2026-02-19T08-15-00.md\n',
    );

    const result = countUnanalyzedLearnings(makeInput());

    expect(result.files).toEqual([
      '2026-02-18T10-30-00.md',
      '2026-02-19T08-15-00.md',
    ]);
  });

  it('calls the correct script path relative to repoPath', () => {
    mockExecFileSync.mockReturnValue('');

    countUnanalyzedLearnings(makeInput({ repoPath: '/my/project' }));

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'bash',
      ['/my/project/skills/meta-insights/scripts/count-unanalyzed.sh'],
      expect.objectContaining({
        encoding: 'utf-8',
        timeout: 30_000,
      }),
    );
  });
});
