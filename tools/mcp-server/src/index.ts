#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKanbanMcpServer } from './server.js';
import { isMockMode } from './types.js';
import { log } from './logger.js';

log('INFO', 'MCP server starting', { mockMode: isMockMode() });

const server = createKanbanMcpServer();
const transport = new StdioServerTransport();
try {
  log('INFO', 'Connecting stdio transport');
  await server.connect(transport);
  log('INFO', 'MCP server connected and ready');
} catch (err) {
  log('ERROR', 'MCP server failed to start', { error: err instanceof Error ? err.message : String(err) });
  console.error('MCP server failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
