---
title: "Install script for agents and skills to global ~/.claude"
phase: 11
labels: [feature, infrastructure]
depends_on: []
---

# Install Script for Agents and Skills to Global ~/.claude

The orchestrator pipeline relies on agents and skills being available in the user's global `~/.claude` directory. Currently these are manually copied. We need an install/setup script.

## Problem

- The project defines custom agents (16 configs in `~/.claude/agents/`) and skills (11 directories in `~/.claude/skills/`) that the workflow pipeline depends on
- When a new developer sets up the project, they need these in their global `~/.claude` directory for the orchestrator and Claude sessions to work correctly
- There is no automated way to install or update these

## Requirements

### Install Script
- Script (e.g., `scripts/install.sh` or `npm run setup`) that copies/symlinks agents and skills to `~/.claude/`
- Handle existing files gracefully (prompt to overwrite, backup, or skip)
- Support both fresh install and update scenarios
- Verify installation was successful

### What to Install
- **Agents**: All agent configuration files from the project's agent definitions
- **Skills**: All skill directories from the project's skill definitions
- **Settings**: Optionally merge required settings into `~/.claude/settings.json` (model preferences, permissions)

### Considerations
- Symlinks vs copies: symlinks keep things in sync but break if repo moves; copies are safer but can drift
- Version tracking: how to know if installed agents/skills are up to date
- Uninstall: ability to remove project-specific agents/skills from global config

## Testing Note

When testing locally, developers MUST ensure these agents and skills are in their global `~/.claude` before running the orchestrator or expecting Claude sessions to follow the workflow pipeline.
