import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { successResult, errorResult } from '../types.js';
import type { ToolResult } from '../types.js';
import type { MockState } from '../state.js';

export interface MockAdminDeps {
  mockState: MockState; // NOT nullable — admin tools only work in mock mode
}

// --- Exported handler functions (testable without MCP server) ---

export async function handleMockInjectComment(
  args: { prNumber: number; body: string; author?: string },
  deps: MockAdminDeps,
): Promise<ToolResult> {
  const comment = deps.mockState.addPrComment(args.prNumber, {
    body: args.body,
    author: args.author,
  });
  if (!comment) return errorResult(`PR not found: #${args.prNumber}`);
  return successResult(comment);
}

export async function handleMockSetPrMerged(
  args: { prNumber: number },
  deps: MockAdminDeps,
): Promise<ToolResult> {
  const success = deps.mockState.setPrMerged(args.prNumber);
  if (!success) return errorResult(`PR not found: #${args.prNumber}`);
  return successResult({ success: true });
}

export async function handleMockSetTicketStatus(
  args: { key: string; status: string },
  deps: MockAdminDeps,
): Promise<ToolResult> {
  const result = deps.mockState.transitionTicket(args.key, args.status);
  if (!result) return errorResult(`Ticket not found: ${args.key}`);
  return successResult(result);
}

// --- MCP tool registration ---

export function registerMockAdminTools(server: McpServer, deps: MockAdminDeps): void {
  server.tool(
    'mock_inject_comment',
    'Inject a comment on a mock PR (mock mode only)',
    { prNumber: z.number(), body: z.string(), author: z.string().optional() },
    (args) => handleMockInjectComment(args, deps),
  );

  server.tool(
    'mock_set_pr_merged',
    'Set a mock PR as merged (mock mode only)',
    { prNumber: z.number() },
    (args) => handleMockSetPrMerged(args, deps),
  );

  server.tool(
    'mock_set_ticket_status',
    'Set the status of a mock ticket (mock mode only)',
    { key: z.string(), status: z.string() },
    (args) => handleMockSetTicketStatus(args, deps),
  );
}
