# Slack Integration Setup

This guide explains how to configure Slack notifications for the claude-code-workflow MCP server
and how to verify the integration using the verification script.

## Required Environment Variables

| Variable               | Required | Description                                                                 |
| ---------------------- | -------- | --------------------------------------------------------------------------- |
| `WORKFLOW_SLACK_WEBHOOK` | Yes    | Incoming webhook URL for posting workflow notifications                     |
| `SLACK_BOT_TOKEN`      | Optional | Bot token (`xoxb-...`) — enables message delivery verification              |
| `SLACK_CHANNEL_ID`     | Optional | Channel ID (e.g. `C0123456789`) — used alongside `SLACK_BOT_TOKEN`         |

`SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` are only needed if you want the verification script to
confirm that the message actually arrived in the channel. The webhook alone is sufficient for
normal operation.

## Creating a Slack App and Incoming Webhook

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**.
2. Choose **From scratch**, give it a name (e.g. `Claude Workflow`), and select your workspace.
3. In the left sidebar, click **Incoming Webhooks** and toggle **Activate Incoming Webhooks** on.
4. Click **Add New Webhook to Workspace**.
5. Select the target channel (see naming convention below) and click **Allow**.
6. Copy the generated webhook URL — it starts with `https://hooks.slack.com/services/...`.
7. Set `WORKFLOW_SLACK_WEBHOOK` to that URL in your environment (`.env`, shell profile, or CI secrets).

## Test Channel Naming Convention

Use `#claude-workflow-test` as the dedicated test channel. This keeps automated integration
test messages separate from production workflow notifications.

Create the channel in Slack before configuring the webhook so you can select it in step 4 above.

## Adding Optional Bot Token (for delivery verification)

If you want the verification script to confirm message delivery:

1. In your Slack app settings, click **OAuth & Permissions** in the left sidebar.
2. Under **Bot Token Scopes**, add:
   - `channels:history` (for public channels)
   - `groups:history` (for private channels)
   - `chat:write` (optional, not required for verification)
3. Click **Install to Workspace** (or **Reinstall** if already installed).
4. Copy the **Bot User OAuth Token** (`xoxb-...`).
5. Find your channel ID: right-click the channel in Slack → **View channel details** → copy the
   ID at the bottom (format: `C0123456789`).
6. Set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` in your environment.
7. Invite the bot to the channel: `/invite @<your-app-name>` in the channel.

## Running the Verification Script

Webhook-only (confirms Slack accepts the message):

```bash
WORKFLOW_SLACK_WEBHOOK=https://hooks.slack.com/services/... \
  npx ts-node scripts/test-setup/slack-verify.ts
```

With delivery verification (confirms the message appeared in the channel):

```bash
WORKFLOW_SLACK_WEBHOOK=https://hooks.slack.com/services/... \
SLACK_BOT_TOKEN=xoxb-... \
SLACK_CHANNEL_ID=C0123456789 \
  npx ts-node scripts/test-setup/slack-verify.ts
```

A successful run exits with code `0` and prints:

```
Slack integration verification
==============================
Webhook URL : https://hooks.slack.com/services/...
Marker      : 2024-01-15T12:34:56.789Z

Step 1: Posting test message via webhook...
  Webhook accepted the message (HTTP 200, body "ok").

Step 2: Verifying message delivery via conversations.history...
  Waiting 3000ms before checking message history...
  Message confirmed in channel history.

Verification complete. Slack integration is working.
```

## Troubleshooting

**Message not appearing in Slack**

- Verify `WORKFLOW_SLACK_WEBHOOK` is the correct URL and has not been revoked.
- Check the Slack app is still installed to the workspace (**App Settings → Install App**).
- Confirm the webhook is pointing to the right channel.

**HTTP 403 / 404 from webhook**

- The webhook URL was deleted or the app was uninstalled. Regenerate it in the app settings.

**`conversations.history` returns `channel_not_found`**

- `SLACK_CHANNEL_ID` is wrong, or the bot has not been invited to the channel.
- Run `/invite @<your-app-name>` inside the target channel.

**`conversations.history` returns `missing_scope`**

- The bot token is missing `channels:history` (public) or `groups:history` (private) scope.
- Add the scope under **OAuth & Permissions** and reinstall the app.

**Test message found in wrong channel**

- The webhook and `SLACK_CHANNEL_ID` point to different channels. Update one to match the other.

**`DISABLE_SLACK=true` in environment**

- The MCP server skips real webhook calls when this variable is set. Unset it before running the
  verification script.
