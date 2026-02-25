import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isMockMode, successResult } from '../types.js';
import type { ToolResult } from '../types.js';
import type { MockState } from '../state.js';

export interface SlackToolDeps {
  mockState: MockState | null;
  webhookUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export type SlackNotifyArgs = {
  message: string;
  stage?: string;
  title?: string;
  ticket?: string;
  ticket_title?: string;
  epic?: string;
  epic_title?: string;
  url?: string;
};

// --- Exported handler functions (testable without MCP server) ---

export async function handleSlackNotify(
  args: SlackNotifyArgs,
  deps: SlackToolDeps,
): Promise<ToolResult> {
  // Mock mode: store in MockState.
  // When KANBAN_MOCK=true, the server always provides mockState. If mockState is null here,
  // it means mock mode is active but no state object was wired up — return early with a
  // "skipped" message. Even if a real webhookUrl is configured, it will NOT fire in this
  // path; the null-state early-return is intentional.
  if (isMockMode()) {
    if (deps.mockState) {
      deps.mockState.addNotification({
        ...args,
        timestamp: new Date().toISOString(),
      });
      return successResult('Notification stored (mock mode)');
    }
    return successResult('Slack notification skipped: mock mode but no state available');
  }

  // Real mode: check for webhook URL
  if (!deps.webhookUrl) {
    return successResult('Slack notification skipped: no webhook URL configured');
  }

  // Build mrkdwn body — only include fields that are provided
  const lines: string[] = [];
  lines.push(`*${args.title || 'Workflow Notification'}*`);
  lines.push('');
  lines.push(args.message);
  if (args.stage) lines.push(`*Stage:* ${args.stage}`);
  if (args.ticket) {
    const ticketLine = args.ticket_title
      ? `*Ticket:* ${args.ticket} — ${args.ticket_title}`
      : `*Ticket:* ${args.ticket}`;
    lines.push(ticketLine);
  }
  if (args.epic) {
    const epicLine = args.epic_title
      ? `*Epic:* ${args.epic} — ${args.epic_title}`
      : `*Epic:* ${args.epic}`;
    lines.push(epicLine);
  }
  if (args.url) lines.push(`<${args.url}|View MR/PR>`);

  const payload = {
    text: args.message, // Top-level fallback for clients that don't render Block Kit
    blocks: [
      {
        type: 'section' as const,
        text: { type: 'mrkdwn' as const, text: lines.join('\n') },
      },
    ],
  };

  // POST to webhook
  const fetchFn = deps.fetch ?? globalThis.fetch;
  try {
    const response = await fetchFn(deps.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return successResult('Slack notification sent');
    }
    return successResult(
      `Slack notification failed (HTTP ${response.status}), continuing`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return successResult(`Slack notification failed (${message}), continuing`);
  }
}

// --- MCP tool registration ---

export function registerSlackTools(server: McpServer, deps: SlackToolDeps): void {
  server.tool(
    'slack_notify',
    'Send a notification to a Slack channel',
    {
      message: z.string(),
      stage: z.string().optional(),
      title: z.string().optional(),
      ticket: z.string().optional(),
      ticket_title: z.string().optional(),
      epic: z.string().optional(),
      epic_title: z.string().optional(),
      url: z.string().optional(),
    },
    (args) => handleSlackNotify(args, deps),
  );
}
