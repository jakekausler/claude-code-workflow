import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleSlackNotify,
  registerSlackTools,
  type SlackToolDeps,
} from '../src/tools/slack.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

describe('Slack tools', () => {
  let deps: SlackToolDeps;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.KANBAN_MOCK;
    deps = {};
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.KANBAN_MOCK;
    } else {
      process.env.KANBAN_MOCK = savedEnv;
    }
  });

  describe('handleSlackNotify', () => {
    it('returns not-implemented error in mock mode', async () => {
      process.env.KANBAN_MOCK = 'true';
      const result = await handleSlackNotify({ message: 'Hello', channel: '#general' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('not yet implemented');
    });

    it('returns not-implemented error in real mode', async () => {
      delete process.env.KANBAN_MOCK;
      const result = await handleSlackNotify({ message: 'Hello' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('not yet implemented');
    });

    it('returns not-implemented error without channel', async () => {
      process.env.KANBAN_MOCK = 'true';
      const result = await handleSlackNotify({ message: 'Test message' }, deps);
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.error).toContain('not yet implemented');
    });
  });

  describe('registerSlackTools', () => {
    it('registers 1 tool on the server without error', () => {
      const server = new McpServer({ name: 'test-server', version: '0.0.1' });
      const spy = vi.spyOn(server, 'tool');
      registerSlackTools(server, deps);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
