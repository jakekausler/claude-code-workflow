import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { errorResult } from '../types.js';
import type { ToolResult } from '../types.js';

export interface SlackToolDeps {
  // No mock state needed — placeholder only
}

// --- Exported handler functions (testable without MCP server) ---

export async function handleSlackNotify(
  _args: { message: string; channel?: string },
  _deps: SlackToolDeps,
): Promise<ToolResult> {
  return errorResult('Slack integration not yet implemented');
}

// --- MCP tool registration ---

export function registerSlackTools(server: McpServer, deps: SlackToolDeps): void {
  server.tool(
    'slack_notify',
    'Send a notification to a Slack channel',
    { message: z.string(), channel: z.string().optional() },
    (args) => handleSlackNotify(args, deps),
  );
}
