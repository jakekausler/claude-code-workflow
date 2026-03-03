// Run with: npx ts-node scripts/verify-slack.ts

import * as https from "https";
import { URL } from "url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pass(msg: string): void {
  console.log(`\u2713 ${msg}`);
}

function fail(msg: string): void {
  console.error(`\u2717 ${msg}`);
}

function httpsPost(
  urlStr: string,
  body: string,
  headers: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode ?? 0, body: data });
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(
  urlStr: string,
  headers: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode ?? 0, body: data });
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Read and validate environment variables
  const webhookUrl = process.env.SLACK_TEST_WEBHOOK_URL;
  const botToken = process.env.SLACK_BOT_TOKEN;

  if (!webhookUrl) {
    console.error(
      "Error: SLACK_TEST_WEBHOOK_URL is not set.\n" +
        "Set it to the Incoming Webhook URL from your Slack app settings."
    );
    process.exit(1);
  }

  if (!botToken) {
    console.error(
      "Error: SLACK_BOT_TOKEN is not set.\n" +
        "Set it to the Bot User OAuth Token (xoxb-...) from your Slack app settings."
    );
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  const testText = `Claude workflow Slack test - ${timestamp}`;

  // 2. POST message via webhook
  let webhookOk = false;
  try {
    const webhookBody = JSON.stringify({ text: testText });
    const webhookRes = await httpsPost(webhookUrl, webhookBody, {});

    if (webhookRes.statusCode === 200 && webhookRes.body === "ok") {
      pass("Webhook POST succeeded");
      webhookOk = true;
    } else {
      fail(
        `Webhook POST failed (status ${webhookRes.statusCode}): ${webhookRes.body}`
      );
    }
  } catch (err) {
    fail(`Webhook POST threw an error: ${(err as Error).message}`);
  }

  if (!webhookOk) {
    process.exit(1);
  }

  // 3. Wait for Slack to process the message
  await sleep(2000);

  // 4. Find the #claude-workflow-test channel ID via conversations.list
  const authHeader = { Authorization: `Bearer ${botToken}` };
  let channelId: string | null = null;

  try {
    const listRes = await httpsGet(
      "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200",
      authHeader
    );

    const listJson = JSON.parse(listRes.body) as {
      ok: boolean;
      error?: string;
      channels?: Array<{ id: string; name: string }>;
    };

    if (!listJson.ok) {
      fail(`conversations.list failed: ${listJson.error ?? "unknown error"}`);
      process.exit(1);
    }

    const channel = (listJson.channels ?? []).find(
      (c) => c.name === "claude-workflow-test"
    );

    if (!channel) {
      fail(
        "channel_not_found: #claude-workflow-test not found. " +
          "Make sure the bot is invited to the channel (/invite @<app-name>)."
      );
      process.exit(1);
    }

    channelId = channel.id;
    pass(`Found channel #claude-workflow-test (${channelId})`);
  } catch (err) {
    fail(`conversations.list threw an error: ${(err as Error).message}`);
    process.exit(1);
  }

  // 5. Fetch channel history and verify the test message appears
  try {
    const historyRes = await httpsGet(
      `https://slack.com/api/conversations.history?channel=${channelId}&limit=20`,
      authHeader
    );

    const historyJson = JSON.parse(historyRes.body) as {
      ok: boolean;
      error?: string;
      messages?: Array<{ text: string }>;
    };

    if (!historyJson.ok) {
      fail(
        `conversations.history failed: ${historyJson.error ?? "unknown error"}`
      );
      process.exit(1);
    }

    const found = (historyJson.messages ?? []).some((m) =>
      m.text.includes(timestamp)
    );

    if (found) {
      pass("Test message found in channel history");
    } else {
      fail(
        "Test message not found in channel history. " +
          "The webhook may have posted to a different channel, or the message was delayed."
      );
      process.exit(1);
    }
  } catch (err) {
    fail(`conversations.history threw an error: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log("\nAll checks passed.");
  process.exit(0);
}

main();
