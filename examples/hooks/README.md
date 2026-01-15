# Claude Code Hook Examples

This directory contains example hook configurations for Claude Code's lifecycle hooks system.

## Files

### `claude_ready.sh`

A notification hook that sends alerts to Home Assistant when Claude is waiting for input.

**Features:**
- Sends notifications on `permission_prompt` and `idle_prompt` events
- Includes the project/repository name in the notification
- Fully customizable notification content
- Supports all Home Assistant notification services

**Setup:**
1. Copy to `~/.claude/hooks/claude_ready.sh`
2. Make executable: `chmod +x ~/.claude/hooks/claude_ready.sh`
3. Edit the script to add your Home Assistant configuration:
   - Replace `YOUR_HOME_ASSISTANT_TOKEN_HERE` with your long-lived access token
   - Replace `YOUR_HOME_ASSISTANT_IP:8123` with your Home Assistant URL
   - Replace `mobile_app_YOUR_DEVICE` with your notification service name
4. Add the hook configuration to `~/.claude/settings.json` (see below)

**Getting a Home Assistant Token:**
1. Log into Home Assistant
2. Click your profile (bottom left)
3. Scroll to "Long-Lived Access Tokens"
4. Click "Create Token"
5. Name it "Claude Code Notifications"
6. Copy the token

**Finding Your Notification Service:**
- Mobile app: Go to Settings > Devices & Services > Mobile App
  - Service name format: `mobile_app_DEVICE_NAME`
- Persistent notification: Use `persistent_notification`
- Other services: `telegram_bot`, `pushover`, etc.

### `settings-hooks-example.json`

Complete hook configuration showing both notification hooks and the prompt enhancer hook.

**Usage:**

If you don't have a `~/.claude/settings.json` yet:
```bash
cp examples/hooks/settings-hooks-example.json ~/.claude/settings.json
# Edit to add your Home Assistant token in the claude_ready.sh script
```

If you already have `~/.claude/settings.json`:
```bash
# Merge the "hooks" section from settings-hooks-example.json into your existing file
# Make sure to keep your existing settings like model, permissions, etc.
```

## Hook Types

### Notification Hooks

Triggered when Claude enters specific notification states:

- **`permission_prompt`**: Claude is waiting for permission approval (file write, bash command, etc.)
- **`idle_prompt`**: Claude has finished responding and is waiting for your next prompt

**Use case:** Get notified on your phone when long-running operations complete, so you can return to Claude without constantly checking.

### UserPromptSubmit Hook

Triggered when you submit a prompt to Claude:

- **Purpose**: Automatically inject your `CLAUDE.md` guidelines into every prompt
- **Script**: `~/.claude/hooks/claude_prompt_enhancer.sh` (included in main workflow)
- **Effect**: Ensures Claude follows your development guidelines consistently

## Testing

Test the notification hook manually:

```bash
# Test with a sample project path
echo '{"cwd": "/home/user/test-project"}' | ~/.claude/hooks/claude_ready.sh

# Check if you received a notification on your device
# If not, check Home Assistant logs for errors
```

Test the prompt enhancer hook:

```bash
# Test with a sample prompt
echo "test prompt" | ~/.claude/hooks/claude_prompt_enhancer.sh

# Should output the prompt with CLAUDE.md content appended
```

## Customization

The `claude_ready.sh` script includes detailed comments showing how to customize:

- **Notification actions**: Add buttons to open the project
- **Priority levels**: Set high priority for urgent notifications
- **Sounds**: Choose custom notification sounds
- **Icons**: Set Material Design Icons
- **Multiple services**: Send to multiple notification endpoints

See the script comments for code examples.

## Troubleshooting

### Notifications Not Working

1. **Check Home Assistant connection:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://YOUR_HOME_ASSISTANT_IP:8123/api/
   # Should return {"message":"API running."}
   ```

2. **Check notification service exists:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://YOUR_HOME_ASSISTANT_IP:8123/api/services
   # Look for your notification service in the response
   ```

3. **Check hook is executable:**
   ```bash
   ls -la ~/.claude/hooks/claude_ready.sh
   # Should show: -rwxr-xr-x (executable)
   ```

4. **Check Claude Code logs:**
   - Claude Code logs hook execution errors
   - Look for error messages when the hook runs

### Hooks Not Running

1. **Verify settings.json syntax:**
   ```bash
   cat ~/.claude/settings.json | jq .
   # Should parse without errors
   ```

2. **Restart Claude Code:**
   - Settings changes require a restart
   - Close and reopen Claude Code

3. **Check hook paths:**
   - Paths must be absolute or use `~/` for home directory
   - Relative paths won't work

## Security Notes

- **Never commit your real Home Assistant token to version control**
- The example script uses placeholder tokens that must be replaced
- Consider using environment variables for sensitive values
- Restrict token permissions in Home Assistant if possible

## Additional Resources

- [Claude Code Documentation](https://docs.anthropic.com/claude-code)
- [Home Assistant Notifications](https://www.home-assistant.io/integrations/notify/)
- [Home Assistant Mobile App](https://companion.home-assistant.io/)
