import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createKanbanMcpServer } from '../src/server.js';

describe('createKanbanMcpServer', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.KANBAN_MOCK;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.KANBAN_MOCK;
    } else {
      process.env.KANBAN_MOCK = savedEnv;
    }
  });

  it('returns an McpServer instance in real mode', () => {
    delete process.env.KANBAN_MOCK;
    const server = createKanbanMcpServer();
    expect(server).toBeInstanceOf(McpServer);
  });

  it('returns an McpServer instance in mock mode', () => {
    process.env.KANBAN_MOCK = 'true';
    const server = createKanbanMcpServer();
    expect(server).toBeInstanceOf(McpServer);
  });

});
