import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockState, type MockSeedData } from '../src/state.js';
import {
  handleConfluenceGetPage,
  registerConfluenceTools,
  type ConfluenceToolDeps,
} from '../src/tools/confluence.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import seedData from '../fixtures/mock-data.json';

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

describe('Confluence tools', () => {
  let state: MockState;
  let deps: ConfluenceToolDeps;
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

  describe('handleConfluenceGetPage', () => {
    it('returns page data for existing page', async () => {
      const result = await handleConfluenceGetPage({ pageId: '12345' }, deps);
      expect(result.isError).toBeUndefined();
      const data = parseResult(result);
      expect(data.pageId).toBe('12345');
      expect(data.title).toBe('Architecture Overview');
      expect(data.body).toContain('Architecture');
      expect(data.url).toBe('https://wiki.example.com/pages/12345');
    });

    it('returns error for nonexistent page', async () => {
      const result = await handleConfluenceGetPage({ pageId: '99999' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('Page not found');
    });

    it('returns not-configured error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handleConfluenceGetPage({ pageId: '12345' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('not yet configured');
    });
  });

  describe('registerConfluenceTools', () => {
    it('registers 1 tool on the server without error', () => {
      const server = new McpServer({ name: 'test-server', version: '0.0.1' });
      const spy = vi.spyOn(server, 'tool');
      registerConfluenceTools(server, deps);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
