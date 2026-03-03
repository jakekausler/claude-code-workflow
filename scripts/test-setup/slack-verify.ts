#!/usr/bin/env ts-node
/**
 * Slack integration verification script.
 *
 * Usage:
 *   WORKFLOW_SLACK_WEBHOOK=https://hooks.slack.com/... npx ts-node scripts/test-setup/slack-verify.ts
 *
 * Optional (message delivery verification via conversations.history):
 *   SLACK_BOT_TOKEN=xoxb-... SLACK_CHANNEL_ID=C... npx ts-node scripts/test-setup/slack-verify.ts
 */

const MARKER_PREFIX = '[claude-workflow-test]';
const TIMEOUT_MS = 10_000;
const POLL_DELAY_MS = 3_000; // wait before checking history

function abortSignal(): AbortSignal {
  return AbortSignal.timeout(TIMEOUT_MS);
}

async function postTestMessage(webhookUrl: string, marker: string): Promise<void> {
  const payload = {
    text: `${MARKER_PREFIX} Integration test ping - ${marker}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${MARKER_PREFIX} Integration test ping*\n\nTimestamp: \`${marker}\`\n_This message was sent by the claude-code-workflow verification script. Safe to ignore._`,
        },
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: abortSignal(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new Error(`Webhook POST failed: HTTP ${response.status} — ${body}`);
  }

  // Slack webhook returns plain "ok" on success
  const body = await response.text();
  if (body.trim() !== 'ok') {
    throw new Error(`Unexpected webhook response: ${body}`);
  }
}

interface SlackMessage {
  text: string;
  ts: string;
}

interface ConversationsHistoryResponse {
  ok: boolean;
  messages?: SlackMessage[];
  error?: string;
}

async function verifyMessageArrived(
  botToken: string,
  channelId: string,
  marker: string,
): Promise<void> {
  console.log(`  Waiting ${POLL_DELAY_MS}ms before checking message history...`);
  await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));

  const url = new URL('https://slack.com/api/conversations.history');
  url.searchParams.set('channel', channelId);
  url.searchParams.set('limit', '20');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${botToken}` },
    signal: abortSignal(),
  });

  if (!response.ok) {
    throw new Error(`conversations.history request failed: HTTP ${response.status}`);
  }

  const data: ConversationsHistoryResponse = (await response.json()) as ConversationsHistoryResponse;

  if (!data.ok) {
    throw new Error(`conversations.history API error: ${data.error ?? 'unknown'}`);
  }

  const messages = data.messages ?? [];
  const found = messages.some((m) => m.text?.includes(marker));

  if (!found) {
    throw new Error(
      `Test message with marker "${marker}" not found in the last ${messages.length} messages.\n` +
        'The webhook POST succeeded but the message may not have reached the expected channel,\n' +
        'or SLACK_CHANNEL_ID points to a different channel than the webhook target.',
    );
  }

  console.log('  Message confirmed in channel history.');
}

async function main(): Promise<void> {
  const webhookUrl = process.env.WORKFLOW_SLACK_WEBHOOK;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!webhookUrl) {
    console.error('ERROR: WORKFLOW_SLACK_WEBHOOK environment variable is not set.');
    console.error('');
    console.error('Usage:');
    console.error('  WORKFLOW_SLACK_WEBHOOK=https://hooks.slack.com/... npx ts-node scripts/test-setup/slack-verify.ts');
    process.exit(1);
  }

  if (!webhookUrl.startsWith('https://')) {
    console.error('ERROR: WORKFLOW_SLACK_WEBHOOK must be an https:// URL.');
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  const marker = timestamp;

  console.log('Slack integration verification');
  console.log('==============================');
  console.log(`Webhook URL : ${webhookUrl.substring(0, 50)}...`);
  console.log(`Marker      : ${marker}`);
  console.log('');

  // Step 1: Post test message via webhook
  console.log('Step 1: Posting test message via webhook...');
  try {
    await postTestMessage(webhookUrl, marker);
    console.log('  Webhook accepted the message (HTTP 200, body "ok").');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  FAILED: ${message}`);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  - Verify the webhook URL is still active in your Slack app settings.');
    console.error('  - Ensure the Slack app is still installed to the workspace.');
    process.exit(1);
  }

  // Step 2 (optional): Verify via conversations.history
  if (botToken && channelId) {
    console.log('');
    console.log('Step 2: Verifying message delivery via conversations.history...');
    console.log(`  Channel ID  : ${channelId}`);
    try {
      await verifyMessageArrived(botToken, channelId, marker);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${message}`);
      console.error('');
      console.error('Troubleshooting:');
      console.error('  - Confirm SLACK_CHANNEL_ID matches the channel the webhook posts to.');
      console.error('  - Ensure the bot token has the channels:history (or groups:history) scope.');
      console.error('  - Check that the bot is a member of the channel.');
      process.exit(1);
    }
  } else {
    console.log('');
    console.log('Step 2: Skipped (SLACK_BOT_TOKEN and/or SLACK_CHANNEL_ID not set).');
    console.log('  Set both to enable message delivery verification.');
  }

  console.log('');
  console.log('Verification complete. Slack integration is working.');
  process.exit(0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Unexpected error: ${message}`);
  process.exit(1);
});
