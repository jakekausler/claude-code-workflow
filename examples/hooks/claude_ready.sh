#!/bin/bash

################################################################################
# Claude Ready Notification Hook
################################################################################
# This script sends a notification to Home Assistant when Claude Code
# enters an idle state (waiting for user input or permission).
#
# Hook Triggers:
#   - permission_prompt: Claude is waiting for permission approval
#   - idle_prompt: Claude has finished responding and is waiting for input
#
# Usage:
#   1. Copy this script to ~/.claude/hooks/claude_ready.sh
#   2. Make it executable: chmod +x ~/.claude/hooks/claude_ready.sh
#   3. Configure the hooks in your ~/.claude/settings.json (see settings-hooks-example.json)
#   4. Replace YOUR_HOME_ASSISTANT_TOKEN_HERE with your actual long-lived access token
#   5. Replace the Home Assistant URL with your instance URL
#
# How to get a Home Assistant token:
#   1. Log into your Home Assistant instance
#   2. Click on your profile (bottom left)
#   3. Scroll down to "Long-Lived Access Tokens"
#   4. Click "Create Token"
#   5. Give it a name like "Claude Code Notifications"
#   6. Copy the token and replace YOUR_HOME_ASSISTANT_TOKEN_HERE below
#
# How to configure the endpoint:
#   - Replace http://YOUR_HOME_ASSISTANT_IP:8123 with your Home Assistant URL
#   - The endpoint is: /api/services/notify/YOUR_NOTIFICATION_SERVICE
#   - Common services: mobile_app_DEVICE_NAME, persistent_notification, notify
#   - Find your device name in Home Assistant > Settings > Devices & Services > Mobile App
################################################################################

# Read JSON input from Claude Code (contains metadata like cwd, event type, etc.)
input=$(cat)

# Extract working directory from JSON input, or fallback to environment variables
REPO_PATH=$(echo "$input" | jq -r '.cwd // empty')
if [ -z "$REPO_PATH" ]; then
  REPO_PATH="${CLAUDE_PROJECT_DIR:-$PWD}"
fi

# Get the repository/project name from the path
REPO_NAME=$(basename "$REPO_PATH")

# Optional: Log that the hook ran (useful for debugging)
echo "Claude ready notification sent for $REPO_NAME at $(date)" > ~/.claude_ready.log

# Send notification to Home Assistant
# Replace YOUR_HOME_ASSISTANT_TOKEN_HERE with your actual token
# Replace the URL with your Home Assistant instance URL
# Replace mobile_app_YOUR_DEVICE with your notification service name
curl -X POST \
  -H "Authorization: Bearer YOUR_HOME_ASSISTANT_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Claude needs input in $REPO_NAME\",
    \"title\": \"Claude Ready - $REPO_NAME\"
  }" \
  http://YOUR_HOME_ASSISTANT_IP:8123/api/services/notify/mobile_app_YOUR_DEVICE

################################################################################
# Additional Configuration Options:
################################################################################
# You can customize the notification with additional Home Assistant data fields:
#
# - Add notification actions:
#   \"data\": {
#     \"actions\": [
#       {\"action\": \"URI\", \"title\": \"Open Project\", \"uri\": \"file://$REPO_PATH\"}
#     ]
#   }
#
# - Set notification priority:
#   \"data\": {\"priority\": \"high\", \"ttl\": 0}
#
# - Add notification sound:
#   \"data\": {\"notification_icon\": \"mdi:robot\", \"sound\": \"US-EN-Morgan-Freeman-Roommate-Is-Arriving.wav\"}
#
# - Send to multiple services (uncomment and configure):
#   # curl -X POST \
#   #   -H "Authorization: Bearer YOUR_HOME_ASSISTANT_TOKEN_HERE" \
#   #   -H "Content-Type: application/json" \
#   #   -d "{\"message\": \"Claude needs input in $REPO_NAME\"}" \
#   #   http://YOUR_HOME_ASSISTANT_IP:8123/api/services/notify/persistent_notification
################################################################################
