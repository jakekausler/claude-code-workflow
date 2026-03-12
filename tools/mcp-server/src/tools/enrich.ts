import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isMockMode, successResult, errorResult } from '../types.js';
import type { ToolResult } from '../types.js';
import type { MockState } from '../state.js';
import { log } from '../logger.js';

export interface EnrichToolDeps {
  mockState: MockState | null;
}

// --- Exported handler functions (testable without MCP server) ---

export async function handleEnrichTicket(
  args: { ticketPath: string },
  deps: EnrichToolDeps,
): Promise<ToolResult> {
  log('INFO', 'enrich_ticket called', { ticketPath: args.ticketPath, mockMode: isMockMode() });
  if (isMockMode() && deps.mockState) {
    log('INFO', 'enrich_ticket returning mock data');
    return successResult({
      ticketId: args.ticketPath,
      enrichmentFilePath: null,
      freshJiraData: false,
      linkResults: [],
    });
  }
  log('ERROR', 'enrich_ticket failed', { error: 'Real enrichment not yet configured' });
  return errorResult('Real enrichment not yet configured');
}

// --- MCP tool registration ---

export function registerEnrichTools(server: McpServer, deps: EnrichToolDeps): void {
  server.tool(
    'enrich_ticket',
    'Enrich a ticket with Jira data and linked resources',
    { ticketPath: z.string() },
    (args) => handleEnrichTicket(args, deps),
  );
}
