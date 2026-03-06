#!/usr/bin/env ts-node
/**
 * Issue #10: Slack Integration E2E Test
 *
 * Fires each notification trigger type using the real slackNotify function
 * and verifies delivery + content via conversations.history.
 *
 * Usage:
 *   WORKFLOW_SLACK_WEBHOOK=https://... SLACK_BOT_TOKEN=xoxb-... SLACK_CHANNEL_ID=C... \
 *     npx tsx scripts/test-setup/slack-e2e.ts
 */

import { slackNotify } from '../../tools/orchestrator/src/slack-notify.js';

const POLL_DELAY_MS = 3_000;
const TIMEOUT_MS = 10_000;

interface SlackMessage {
  text: string;
  blocks?: Array<{ text?: { text: string } }>;
}

interface ConversationsHistoryResponse {
  ok: boolean;
  messages?: SlackMessage[];
  error?: string;
}

type Result = { name: string; passed: boolean; reason?: string };

let passed = 0;
let failed = 0;
const results: Result[] = [];

function recordResult(name: string, ok: boolean, reason?: string): void {
  results.push({ name, passed: ok, reason });
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${reason ? ` — ${reason}` : ''}`);
  }
}

async function fetchHistory(botToken: string, channelId: string): Promise<SlackMessage[]> {
  const url = new URL('https://slack.com/api/conversations.history');
  url.searchParams.set('channel', channelId);
  url.searchParams.set('limit', '30');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = (await response.json()) as ConversationsHistoryResponse;
  if (!data.ok) throw new Error(`conversations.history API error: ${data.error ?? 'unknown'}`);
  return data.messages ?? [];
}

function findMessage(messages: SlackMessage[], marker: string): SlackMessage | undefined {
  return messages.find((m) => {
    const inText = m.text?.includes(marker);
    const inBlocks = m.blocks?.some((b) => b.text?.text?.includes(marker));
    return inText || inBlocks;
  });
}

function blockText(msg: SlackMessage): string {
  return msg.blocks?.map((b) => b.text?.text ?? '').join('\n') ?? '';
}

async function runTest(
  label: string,
  webhookUrl: string,
  botToken: string,
  channelId: string,
  payload: Parameters<typeof slackNotify>[0],
  assertions: Array<{ desc: string; check: (msg: SlackMessage) => boolean }>,
): Promise<void> {
  const marker = `[e2e-${Date.now()}]`;
  const augmented = { ...payload, message: `${payload.message} ${marker}` };

  console.log(`\n${label}`);

  // Send notification
  await slackNotify(augmented, webhookUrl);

  // Wait then fetch history
  await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
  let messages: SlackMessage[];
  try {
    messages = await fetchHistory(botToken, channelId);
  } catch (err) {
    recordResult('delivery', false, (err as Error).message);
    return;
  }

  const msg = findMessage(messages, marker);
  recordResult('delivery', !!msg, msg ? undefined : 'message not found in channel history');

  if (!msg) return;

  for (const { desc, check } of assertions) {
    try {
      recordResult(desc, check(msg));
    } catch {
      recordResult(desc, false, 'assertion threw');
    }
  }
}

async function main(): Promise<void> {
  const webhookUrl = process.env.WORKFLOW_SLACK_WEBHOOK;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!webhookUrl || !botToken || !channelId) {
    console.error(
      'ERROR: Set WORKFLOW_SLACK_WEBHOOK, SLACK_BOT_TOKEN, and SLACK_CHANNEL_ID before running.',
    );
    process.exit(1);
  }

  console.log('Slack E2E Notification Tests');
  console.log('============================');

  // --- Test 1: User Input Required ---
  await runTest(
    'Test 1: User Input Required (question-requested)',
    webhookUrl,
    botToken,
    channelId,
    {
      title: 'User Input Required',
      message: "Claude is waiting for a response in stage `design-001`",
      stage: 'design-001',
    },
    [
      {
        desc: 'contains title "User Input Required"',
        check: (m) => blockText(m).includes('User Input Required'),
      },
      {
        desc: 'contains stage name',
        check: (m) => blockText(m).includes('design-001'),
      },
    ],
  );

  // --- Test 2: Tool Approval Required ---
  await runTest(
    'Test 2: Tool Approval Required (approval-requested)',
    webhookUrl,
    botToken,
    channelId,
    {
      title: 'Tool Approval Required',
      message: "Claude is requesting approval to use `Bash` in stage `build-002`",
      stage: 'build-002',
    },
    [
      {
        desc: 'contains title "Tool Approval Required"',
        check: (m) => blockText(m).includes('Tool Approval Required'),
      },
      {
        desc: 'contains tool name',
        check: (m) => blockText(m).includes('Bash'),
      },
      {
        desc: 'contains stage name',
        check: (m) => blockText(m).includes('build-002'),
      },
    ],
  );

  // --- Test 3: MR Created ---
  await runTest(
    'Test 3: MR Created (PR Created status transition)',
    webhookUrl,
    botToken,
    channelId,
    {
      title: 'MR Created',
      message: "A merge request was created for stage `implement-003`",
      stage: 'implement-003',
      ticket: 'PROJ-42',
      url: 'https://github.com/example/repo/pull/123',
    },
    [
      {
        desc: 'contains title "MR Created"',
        check: (m) => blockText(m).includes('MR Created'),
      },
      {
        desc: 'contains stage name',
        check: (m) => blockText(m).includes('implement-003'),
      },
      {
        desc: 'contains ticket reference',
        check: (m) => blockText(m).includes('PROJ-42'),
      },
      {
        desc: 'contains MR link',
        check: (m) => blockText(m).includes('github.com/example/repo/pull/123'),
      },
    ],
  );

  // --- Test 4: MR Comments Need Addressing ---
  await runTest(
    'Test 4: MR Comments Need Addressing (mr-comment-poll)',
    webhookUrl,
    botToken,
    channelId,
    {
      title: 'MR Comments Need Addressing',
      message: "New review comments on stage `review-004` — 2 unresolved thread(s)",
      stage: 'review-004',
      url: 'https://github.com/example/repo/pull/124',
    },
    [
      {
        desc: 'contains title "MR Comments Need Addressing"',
        check: (m) => blockText(m).includes('MR Comments Need Addressing'),
      },
      {
        desc: 'contains stage name',
        check: (m) => blockText(m).includes('review-004'),
      },
      {
        desc: 'contains unresolved count',
        check: (m) => blockText(m).includes('unresolved'),
      },
      {
        desc: 'contains MR link',
        check: (m) => blockText(m).includes('github.com/example/repo/pull/124'),
      },
    ],
  );

  // --- Summary ---
  console.log('\n============================');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nFailed checks:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ✗ ${r.name}${r.reason ? ` — ${r.reason}` : ''}`);
    }
    process.exit(1);
  }

  console.log('\nAll E2E notification tests passed.');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
