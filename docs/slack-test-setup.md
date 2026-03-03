# Slack Integration Test Setup

This guide walks through configuring a Slack app and test channel for repeatable notification testing with the Claude workflow.

## Prerequisites

- Admin (or app-installation) access to a Slack workspace
- Node.js 18+ installed locally

---

## Step 1: Create a Slack App

1. Navigate to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**.
2. Choose **From scratch**.
3. Enter an app name (e.g., `claude-workflow-test`) and select your target workspace.
4. Click **Create App**.

---

## Step 2: Enable Incoming Webhooks

1. In the app settings sidebar, click **Incoming Webhooks**.
2. Toggle **Activate Incoming Webhooks** to **On**.
3. Click **Add New Webhook to Workspace**.
4. When prompted, select (or create) the channel `#claude-workflow-test` and click **Allow**.
5. Copy the generated webhook URL — it will look like:
   ```
   https://hooks.slack.com/services/<TEAM_ID>/<BOT_ID>/<WEBHOOK_TOKEN>
   ```
6. Set this as your `SLACK_TEST_WEBHOOK_URL` environment variable.

---

## Step 3: Add Bot Token Scopes and Install the App

1. In the sidebar, click **OAuth & Permissions**.
2. Scroll to **Scopes → Bot Token Scopes** and add:
   - `chat:write` — allows the bot to post messages
   - `channels:history` — allows the bot to read channel message history
3. Scroll to the top of the page and click **Install to Workspace** (or **Reinstall** if already installed).
4. Review the permissions and click **Allow**.
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`).
6. Set this as your `SLACK_BOT_TOKEN` environment variable.

---

## Step 4: Invite the Bot to the Test Channel

In Slack, open `#claude-workflow-test` and run:

```
/invite @claude-workflow-test
```

Replace `claude-workflow-test` with the name you gave your app. The bot must be a member of the channel to read its history.

---

## Step 5: Configure Environment Variables

Add the following to your local `.env` file (see `.env.example` for the full template):

```bash
SLACK_TEST_WEBHOOK_URL=https://hooks.slack.com/services/<TEAM_ID>/<BOT_ID>/<WEBHOOK_TOKEN>
SLACK_BOT_TOKEN=xoxb-...
```

---

## Step 6: Run the Verification Script

```bash
npx ts-node scripts/verify-slack.ts
```

The script will:
1. Post a timestamped test message via the webhook.
2. Wait 2 seconds for Slack to process the message.
3. Look up the `#claude-workflow-test` channel ID via the Bot Token.
4. Fetch recent channel history and confirm the test message appears.

A successful run prints:

```
✓ Webhook POST succeeded
✓ Found channel #claude-workflow-test (C01234ABCDE)
✓ Test message found in channel history
All checks passed.
```

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `invalid_auth` | `SLACK_BOT_TOKEN` is wrong or expired | Re-copy the `xoxb-` token from **OAuth & Permissions** |
| `channel_not_found` | Bot is not a member of the channel, or channel name is wrong | Run `/invite @<app-name>` in `#claude-workflow-test` |
| `missing_scope` | Required scope was not added before installing | Add the missing scope under **OAuth & Permissions → Bot Token Scopes**, then reinstall the app |
| Webhook returns `no_service` | Webhook URL is stale or was regenerated | Copy the current webhook URL from **Incoming Webhooks** and update `SLACK_TEST_WEBHOOK_URL` |
| Message not found in history | `channels:history` scope missing or bot not in channel | Verify scopes and channel membership, then re-run |
