/**
 * Minimal Slack webhook notifier for the orchestrator.
 * Extracted from mcp-server to avoid a cross-package dependency.
 */

export interface SlackNotifyArgs {
  title?: string;
  message: string;
  stage?: string;
  ticket?: string;
  url?: string;
}

/**
 * Send a Slack notification via webhook.
 * Silently skips if DISABLE_SLACK=true.
 * Always resolves (never rejects) — failures are non-fatal.
 */
export async function slackNotify(
  args: SlackNotifyArgs,
  webhookUrl: string,
): Promise<void> {
  if (process.env.DISABLE_SLACK === 'true') {
    return;
  }

  const lines: string[] = [];
  lines.push(`*${args.title ?? 'Workflow Notification'}*`);
  lines.push('');
  lines.push(args.message);
  if (args.stage) lines.push(`*Stage:* ${args.stage}`);
  if (args.ticket) lines.push(`*Ticket:* ${args.ticket}`);
  if (args.url) lines.push(`<${args.url}|View MR/PR>`);

  const payload = {
    text: args.message,
    blocks: [
      {
        type: 'section' as const,
        text: { type: 'mrkdwn' as const, text: lines.join('\n') },
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Non-fatal: swallow errors silently
  }
}
