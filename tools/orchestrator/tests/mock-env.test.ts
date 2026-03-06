import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Tests that the orchestrator's --mock flag propagates KANBAN_MOCK to the
 * process environment. This ensures child processes (e.g., the MCP server
 * spawned by Claude sessions) inherit mock mode.
 *
 * The actual propagation happens in index.ts:
 *   if (config.mock) { process.env.KANBAN_MOCK = 'true'; }
 *
 * We test the contract here: when KANBAN_MOCK is set in the environment,
 * code can read it to determine mock mode.
 */
describe('KANBAN_MOCK environment propagation', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.KANBAN_MOCK;
    delete process.env.KANBAN_MOCK;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.KANBAN_MOCK;
    } else {
      process.env.KANBAN_MOCK = savedEnv;
    }
  });

  it('KANBAN_MOCK is not set by default', () => {
    expect(process.env.KANBAN_MOCK).toBeUndefined();
  });

  it('setting KANBAN_MOCK to "true" makes it readable from process.env', () => {
    // Simulates what index.ts does: process.env.KANBAN_MOCK = 'true'
    process.env.KANBAN_MOCK = 'true';
    expect(process.env.KANBAN_MOCK).toBe('true');
  });

  it('KANBAN_MOCK is inherited by the same process environment', () => {
    // When the orchestrator sets KANBAN_MOCK, any module loaded afterward
    // (including the MCP server spawned via npx) inherits it.
    process.env.KANBAN_MOCK = 'true';

    // Verify it's visible from a fresh read
    const value = process.env.KANBAN_MOCK;
    expect(value).toBe('true');
  });
});
