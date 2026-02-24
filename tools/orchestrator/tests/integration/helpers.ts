import { vi } from 'vitest';
import type { FrontmatterData } from '../../src/locking.js';

/**
 * Shared test helpers for integration tests.
 *
 * Provides a mock frontmatter store and logger factory to avoid duplication
 * across exit-gate-flow.test.ts, resolver-flow.test.ts, and onboarding-flow.test.ts.
 */

/** Build a mock frontmatter store with deep-cloned entries and read/write fns. */
export function makeFrontmatterStore(entries: Record<string, FrontmatterData>) {
  const store: Record<string, FrontmatterData> = {};
  for (const [key, value] of Object.entries(entries)) {
    store[key] = structuredClone(value);
  }

  return {
    readFrontmatter: vi.fn(async (filePath: string) => {
      const entry = store[filePath];
      if (!entry) throw new Error(`ENOENT: ${filePath}`);
      return structuredClone(entry);
    }),
    writeFrontmatter: vi.fn(async (filePath: string, data: Record<string, unknown>, content: string) => {
      store[filePath] = structuredClone({ data, content });
    }),
    store,
  };
}

/** Build a mock logger with info/warn/error stubs. */
export function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
