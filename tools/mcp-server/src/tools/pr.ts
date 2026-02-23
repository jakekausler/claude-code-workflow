import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isMockMode, successResult, errorResult } from '../types.js';
import type { ToolResult } from '../types.js';
import type { MockState } from '../state.js';

export interface PrToolDeps {
  mockState: MockState | null;
  execFn?: (command: string, args: string[]) => Promise<string>; // for real mode gh/glab calls
  platform?: 'github' | 'gitlab'; // defaults to 'github'
}

/** Extract PR/MR number from a GitHub or GitLab URL. */
export function extractPrNumber(prUrl: string): number | null {
  const match = prUrl.match(/\/(?:pull|merge_requests)\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// --- Exported handler functions (testable without MCP server) ---

export async function handlePrCreate(
  args: {
    branch: string;
    title: string;
    body: string;
    base?: string;
    draft?: boolean;
    assignees?: string[];
    reviewers?: string[];
  },
  deps: PrToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const result = deps.mockState.createPr(args);
    return successResult(result);
  }
  return errorResult('Real PR integration not yet configured');
}

export async function handlePrUpdate(
  args: {
    number: number;
    title?: string;
    body?: string;
    base?: string;
    draft?: boolean;
    assignees?: string[];
    reviewers?: string[];
  },
  deps: PrToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const { number, ...updates } = args;
    const success = deps.mockState.updatePr(number, updates);
    if (!success) return errorResult(`PR not found: #${number}`);
    return successResult({ success: true });
  }
  return errorResult('Real PR integration not yet configured');
}

export async function handlePrGet(
  args: { number: number },
  deps: PrToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const pr = deps.mockState.getPr(args.number);
    if (!pr) return errorResult(`PR not found: #${args.number}`);
    return successResult(pr);
  }
  return errorResult('Real PR integration not yet configured');
}

export async function handlePrClose(
  args: { number: number },
  deps: PrToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const success = deps.mockState.closePr(args.number);
    if (!success) return errorResult(`PR not found: #${args.number}`);
    return successResult({ success: true });
  }
  return errorResult('Real PR integration not yet configured');
}

export async function handlePrGetComments(
  args: { number: number },
  deps: PrToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const pr = deps.mockState.getPr(args.number);
    if (!pr) return errorResult(`PR not found: #${args.number}`);
    const comments = deps.mockState.getPrComments(args.number);
    return successResult(comments);
  }
  return errorResult('Real PR integration not yet configured');
}

export async function handlePrAddComment(
  args: { number: number; body: string },
  deps: PrToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const comment = deps.mockState.addPrComment(args.number, { body: args.body });
    if (!comment) return errorResult(`PR not found: #${args.number}`);
    return successResult({ id: comment.id });
  }
  return errorResult('Real PR integration not yet configured');
}

export async function handlePrGetStatus(
  args: { prUrl: string },
  deps: PrToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const number = extractPrNumber(args.prUrl);
    if (number === null) return errorResult(`Could not parse PR number from URL: ${args.prUrl}`);
    const status = deps.mockState.getPrStatus(number);
    if (!status) return errorResult(`PR not found: #${number}`);
    return successResult(status);
  }
  return errorResult('Real PR integration not yet configured');
}

export async function handlePrMarkReady(
  args: { number: number },
  deps: PrToolDeps,
): Promise<ToolResult> {
  if (isMockMode() && deps.mockState) {
    const success = deps.mockState.updatePr(args.number, { draft: false });
    if (!success) return errorResult(`PR not found: #${args.number}`);
    return successResult({ success: true });
  }
  return errorResult('Real PR integration not yet configured');
}

// --- MCP tool registration ---

export function registerPrTools(server: McpServer, deps: PrToolDeps): void {
  server.tool(
    'pr_create',
    'Create a pull/merge request',
    {
      branch: z.string(),
      title: z.string(),
      body: z.string(),
      base: z.string().optional(),
      draft: z.boolean().optional(),
      assignees: z.array(z.string()).optional(),
      reviewers: z.array(z.string()).optional(),
    },
    (args) => handlePrCreate(args, deps),
  );

  server.tool(
    'pr_update',
    'Update an existing pull/merge request',
    {
      number: z.number(),
      title: z.string().optional(),
      body: z.string().optional(),
      base: z.string().optional(),
      draft: z.boolean().optional(),
      assignees: z.array(z.string()).optional(),
      reviewers: z.array(z.string()).optional(),
    },
    (args) => handlePrUpdate(args, deps),
  );

  server.tool(
    'pr_get',
    'Get details of a pull/merge request by number',
    { number: z.number() },
    (args) => handlePrGet(args, deps),
  );

  server.tool(
    'pr_close',
    'Close a pull/merge request',
    { number: z.number() },
    (args) => handlePrClose(args, deps),
  );

  server.tool(
    'pr_get_comments',
    'Get comments on a pull/merge request',
    { number: z.number() },
    (args) => handlePrGetComments(args, deps),
  );

  server.tool(
    'pr_add_comment',
    'Add a comment to a pull/merge request',
    { number: z.number(), body: z.string() },
    (args) => handlePrAddComment(args, deps),
  );

  server.tool(
    'pr_get_status',
    'Get the status of a pull/merge request (merged, state, unresolved comments)',
    { prUrl: z.string() },
    (args) => handlePrGetStatus(args, deps),
  );

  server.tool(
    'pr_mark_ready',
    'Mark a draft pull/merge request as ready for review',
    { number: z.number() },
    (args) => handlePrMarkReady(args, deps),
  );
}
