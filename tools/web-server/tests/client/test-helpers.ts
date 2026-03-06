import type { SessionMetrics, Process } from '../../src/server/types/jsonl.js';

/**
 * Default SessionMetrics for tests.
 */
export const defaultMetrics: SessionMetrics = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalCost: 0,
  turnCount: 0,
  toolCallCount: 0,
  duration: 0,
};

/**
 * Create a test Process with default values.
 */
export function createTestProcess(overrides?: Partial<Process>): Process {
  return {
    id: 'test-process-1',
    parentTaskId: undefined,
    startTime: new Date('2025-01-01'),
    endTime: new Date('2025-01-01'),
    durationMs: 0,
    metrics: defaultMetrics,
    isParallel: false,
    filePath: '/tmp/test-session.jsonl',
    messages: [],
    ...overrides,
  };
}
