import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isMockMode, successResult, errorResult } from '../types.js';
import type { ToolResult } from '../types.js';
import type { MockState } from '../state.js';

export interface JiraToolDeps {
  mockState: MockState | null;
  // Real mode deps would include JiraExecutor - added in future when wiring real mode
}

// --- Exported handler functions (testable without MCP server) ---

export async function handleJiraGetTicket(
  args: { key: string },
  deps: JiraToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const ticket = deps.mockState.getTicket(args.key);
    if (!ticket) return errorResult(`Ticket not found: ${args.key}`);
    return successResult(ticket);
  }
  return errorResult('Real Jira integration not yet configured');
}

export async function handleJiraSearch(
  args: { jql: string; maxResults?: number },
  deps: JiraToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const tickets = deps.mockState.searchTickets(args.jql);
    return successResult(tickets);
  }
  return errorResult('Real Jira integration not yet configured');
}

export async function handleJiraTransition(
  args: { key: string; targetStatus: string },
  deps: JiraToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const result = deps.mockState.transitionTicket(args.key, args.targetStatus);
    if (!result) return errorResult(`Ticket not found: ${args.key}`);
    return successResult(result);
  }
  return errorResult('Real Jira integration not yet configured');
}

export async function handleJiraAssign(
  args: { key: string; assignee?: string },
  deps: JiraToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const success = deps.mockState.assignTicket(args.key, args.assignee ?? null);
    if (!success) return errorResult(`Ticket not found: ${args.key}`);
    return successResult({ success: true, key: args.key, assignee: args.assignee ?? null });
  }
  return errorResult('Real Jira integration not yet configured');
}

export async function handleJiraComment(
  args: { key: string; body: string },
  deps: JiraToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const comment = deps.mockState.addTicketComment(args.key, { body: args.body });
    if (!comment) return errorResult(`Ticket not found: ${args.key}`);
    return successResult(comment);
  }
  return errorResult('Real Jira integration not yet configured');
}

export async function handleJiraSync(
  args: { ticketId: string; repoPath: string; dryRun?: boolean },
  deps: JiraToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    return successResult({
      ticket_id: args.ticketId,
      jira_key: 'MOCK-KEY',
      event: null,
      actions: [],
      dry_run: args.dryRun ?? false,
      confirmation_needed: false,
    });
  }
  return errorResult('Real Jira integration not yet configured');
}

// --- MCP tool registration ---

export function registerJiraTools(server: McpServer, deps: JiraToolDeps): void {
  server.tool(
    'jira_get_ticket',
    'Get a Jira ticket by key',
    { key: z.string() },
    (args) => handleJiraGetTicket(args, deps),
  );

  server.tool(
    'jira_search',
    'Search Jira tickets using JQL',
    { jql: z.string(), maxResults: z.number().optional() },
    (args) => handleJiraSearch(args, deps),
  );

  server.tool(
    'jira_transition',
    'Transition a Jira ticket to a new status',
    { key: z.string(), targetStatus: z.string() },
    (args) => handleJiraTransition(args, deps),
  );

  server.tool(
    'jira_assign',
    'Assign a Jira ticket to a user',
    { key: z.string(), assignee: z.string().optional() },
    (args) => handleJiraAssign(args, deps),
  );

  server.tool(
    'jira_comment',
    'Add a comment to a Jira ticket',
    { key: z.string(), body: z.string() },
    (args) => handleJiraComment(args, deps),
  );

  server.tool(
    'jira_sync',
    'Sync a ticket between local repo and Jira',
    { ticketId: z.string(), repoPath: z.string(), dryRun: z.boolean().optional() },
    (args) => handleJiraSync(args, deps),
  );
}
