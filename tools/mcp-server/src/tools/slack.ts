import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isMockMode, successResult, errorResult } from '../types.js';
import type { ToolResult } from '../types.js';
import type { MockState } from '../state.js';

const slackNotifyArgsSchema = z.object({
  message: z.string(),
  webhook_url: z
    .string()
    .optional()
    .describe('Override the global webhook URL. Use for per-repo Slack channel routing.'),
  stage: z.string().optional(),
  title: z.string().optional(),
  ticket: z.string().optional(),
  ticket_title: z.string().optional(),
  epic: z.string().optional(),
  epic_title: z.string().optional(),
  url: z.string().url().optional(),
});

export type SlackNotifyArgs = z.infer<typeof slackNotifyArgsSchema>;

export interface SlackToolDeps {
  mockState: MockState | null;
  webhookUrl?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

// --- Exported handler functions (testable without MCP server) ---

export async function handleSlackNotify(
  args: SlackNotifyArgs,
  deps: SlackToolDeps,
): Promise<ToolResult> {
  // Validate args
  const parsed = slackNotifyArgsSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(parsed.error.issues.map((i) => i.message).join('; '));
  }

  // Mock mode: store in MockState.
  // When KANBAN_MOCK=true, the server always provides mockState. If mockState is null here,
  // it means mock mode is active but no state object was wired up — return early with a
  // "skipped" message. Even if a real webhookUrl is configured, it will NOT fire in this
  // path; the null-state early-return is intentional.
  if (isMockMode()) {
    if (deps.mockState) {
      deps.mockState.addNotification({
        ...args,
        timestamp: (deps.now ?? (() => new Date()))().toISOString(),
      });
      return successResult('Notification stored (mock mode)');
    }
    return successResult('Slack notification skipped: mock mode but no state available');
  }

  // Real mode: resolve webhook URL (per-repo override > global default)
  const resolvedWebhookUrl = args.webhook_url || deps.webhookUrl;
  if (!resolvedWebhookUrl) {
    return successResult('Slack notification skipped: no webhook URL configured');
  }

  if (!resolvedWebhookUrl.startsWith('https://')) {
    return errorResult('Webhook URL must use https://');
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
    const response = await fetchFn(resolvedWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
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
    'Send a notification via Slack webhook',
    slackNotifyArgsSchema.shape,
    (args) => handleSlackNotify(args, deps),
  );
}
