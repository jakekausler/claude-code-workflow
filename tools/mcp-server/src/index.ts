#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKanbanMcpServer } from './server.js';

const server = createKanbanMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
