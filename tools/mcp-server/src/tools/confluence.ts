import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isMockMode, successResult, errorResult } from '../types.js';
import type { ToolResult } from '../types.js';
import type { MockState } from '../state.js';

export interface ConfluenceToolDeps {
  mockState: MockState | null;
  // Real mode will use confluence read script
}

// --- Exported handler functions (testable without MCP server) ---

export async function handleConfluenceGetPage(
  args: { pageId: string },
  deps: ConfluenceToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const page = deps.mockState.getPage(args.pageId);
    if (!page) return errorResult(`Page not found: ${args.pageId}`);
    return successResult(page);
  }
  return errorResult('Real Confluence integration not yet configured');
}

// --- MCP tool registration ---

export function registerConfluenceTools(server: McpServer, deps: ConfluenceToolDeps): void {
  server.tool(
    'confluence_get_page',
    'Get a Confluence page by ID',
    { pageId: z.string() },
    (args) => handleConfluenceGetPage(args, deps),
  );
}
