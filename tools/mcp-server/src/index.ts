#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKanbanMcpServer } from './server.js';

const server = createKanbanMcpServer();
const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (err) {
  console.error('MCP server failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
