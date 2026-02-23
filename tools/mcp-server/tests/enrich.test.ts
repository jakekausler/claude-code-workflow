import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockState, type MockSeedData } from '../src/state.js';
import {
  handleEnrichTicket,
  registerEnrichTools,
  type EnrichToolDeps,
} from '../src/tools/enrich.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import seedData from '../fixtures/mock-data.json';

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

describe('Enrich tools', () => {
  let state: MockState;
  let deps: EnrichToolDeps;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.KANBAN_MOCK;
    process.env.KANBAN_MOCK = 'true';
    state = new MockState(seedData as MockSeedData);
    deps = { mockState: state };
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.KANBAN_MOCK;
    } else {
      process.env.KANBAN_MOCK = savedEnv;
    }
  });

  describe('handleEnrichTicket', () => {
    it('returns mock enrichment result in mock mode', async () => {
      const result = await handleEnrichTicket({ ticketPath: '/tmp/tickets/PROJ-101' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.ticketId).toBe('MOCK');
      expect(data.enrichmentFilePath).toBeNull();
      expect(data.freshJiraData).toBe(false);
      expect(data.linkResults).toEqual([]);
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handleEnrichTicket({ ticketPath: '/tmp/tickets/PROJ-101' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('not yet configured');
    });
  });

  describe('registerEnrichTools', () => {
    it('registers 1 tool on the server without error', () => {
      const server = new McpServer({ name: 'test-server', version: '0.0.1' });
      const spy = vi.spyOn(server, 'tool');
      registerEnrichTools(server, deps);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
