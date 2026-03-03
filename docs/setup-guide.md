# Setup and Usage Guide

This guide covers installing, configuring, and using the Claude Code Structured Autonomy Workflow tools.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start: Local Mode](#quick-start-local-mode)
- [Configuration](#configuration)
- [CLI Reference: kanban-cli](#cli-reference-kanban-cli)
- [Web UI Usage](#web-ui-usage)
- [Orchestrator Guide](#orchestrator-guide)
- [MCP Server](#mcp-server)

---

## Prerequisites

- **Node.js 24** (LTS). Use [fnm](https://github.com/Schniz/fnm) to manage versions: `fnm use 24`
- **npm** (comes with Node)
- **git**
- **Claude Code** CLI installed and authenticated

---

## Installation

Clone the repository and build each tool in order. The orchestrator and MCP server depend on `kanban-cli`, so build that first.

```bash
git clone <repository-url> claude-code-workflow
cd claude-code-workflow
```

### Build kanban-cli

```bash
cd tools/kanban-cli
npm ci
npm run build
cd ../..
```

### Build the orchestrator

```bash
cd tools/orchestrator
npm ci
npm run build
cd ../..
```

### Build the MCP server

```bash
cd tools/mcp-server
npm ci
npm run build
cd ../..
```

### Build the web server

```bash
cd tools/web-server
npm ci
npm run build
cd ../..
```

### Install kanban-cli globally (optional)

After building, you can link `kanban-cli` so it is available on your `PATH`:

```bash
cd tools/kanban-cli
npm link
cd ../..
```

Verify:

```bash
kanban-cli --version
# 0.1.0
```

---

## Quick Start: Local Mode

This walkthrough takes you from a fresh repository to a running board in local (non-remote) mode.

### 1. Initialise your project repository

Your project repository needs an `epics/` directory. The kanban-cli reads epic, ticket, and stage markdown files from there.

```bash
mkdir -p my-project/epics
cd my-project
```

### 2. Sync the repository into the database

```bash
kanban-cli sync --repo .
```

Output confirms how many epics, tickets, stages, and dependencies were parsed.

### 3. View the board

```bash
kanban-cli board --repo . --pretty
```

To see a standalone HTML page instead:

```bash
kanban-cli board --repo . --html -o board.html
open board.html
```

### 4. Find the next workable stage

```bash
kanban-cli next --repo . --pretty
```

Returns up to 5 stages ready to start, sorted by priority.

### 5. Validate your configuration and data

```bash
kanban-cli validate --repo . --pretty
```

Reports frontmatter errors and dependency integrity issues.

---

## Configuration

### Pipeline config files

The tool resolves config from three locations, in priority order (highest first):

| Location | Path | Purpose |
|---|---|---|
| Repo config | `.kanban-workflow.yaml` in your project root | Per-project overrides |
| Global config | `~/.config/kanban-workflow/config.yaml` | Shared defaults across all projects |
| Built-in default | Embedded in `kanban-cli` | Fallback when no files exist |

A repo config can be partial. You only need to specify the fields you want to override; unspecified sections fall back to the global config or built-in default.

#### Built-in default pipeline

The following is the pipeline that runs when no config file is found:

```yaml
workflow:
  entry_phase: Design

  phases:
    - name: Design
      skill: phase-design
      status: Design
      transitions_to: [Build, User Design Feedback]

    - name: User Design Feedback
      skill: user-design-feedback
      status: User Design Feedback
      transitions_to: [Build]

    - name: Build
      skill: phase-build
      status: Build
      transitions_to: [Automatic Testing]

    - name: Automatic Testing
      skill: automatic-testing
      status: Automatic Testing
      transitions_to: [Manual Testing]

    - name: Manual Testing
      skill: manual-testing
      status: Manual Testing
      transitions_to: [Finalize]

    - name: Finalize
      skill: phase-finalize
      status: Finalize
      transitions_to: [Done, PR Created]

    - name: PR Created
      resolver: pr-status
      status: PR Created
      transitions_to: [Done, Addressing Comments]

    - name: Addressing Comments
      skill: review-cycle
      status: Addressing Comments
      transitions_to: [PR Created]

  defaults:
    WORKFLOW_REMOTE_MODE: false
    WORKFLOW_AUTO_DESIGN: false
    WORKFLOW_MAX_PARALLEL: 1
    WORKFLOW_GIT_PLATFORM: auto
    WORKFLOW_LEARNINGS_THRESHOLD: 10

cron:
  mr_comment_poll:
    enabled: true
    interval_seconds: 300
  insights_threshold:
    enabled: true
    interval_seconds: 600
```

#### Repo-level overrides example

To change defaults without redefining phases, add a `.kanban-workflow.yaml` at your project root:

```yaml
workflow:
  defaults:
    WORKFLOW_REMOTE_MODE: true
    WORKFLOW_MAX_PARALLEL: 2
    WORKFLOW_GIT_PLATFORM: github
    WORKFLOW_SLACK_WEBHOOK: "https://hooks.slack.com/services/..."

jira:
  project: MYPROJ
  assignee: "your.email@example.com"
```

### Workflow defaults reference

These keys live under `workflow.defaults` in the config file. Each can also be set as an environment variable with the same name; the environment variable takes precedence over the config file.

| Key | Type | Default | Description |
|---|---|---|---|
| `WORKFLOW_REMOTE_MODE` | boolean | `false` | Enable remote mode (PR-based workflow) |
| `WORKFLOW_AUTO_DESIGN` | boolean | `false` | Skip manual design step |
| `WORKFLOW_MAX_PARALLEL` | integer | `1` | Maximum concurrent stage sessions |
| `WORKFLOW_GIT_PLATFORM` | string | `auto` | Git platform: `github`, `gitlab`, or `auto` |
| `WORKFLOW_LEARNINGS_THRESHOLD` | integer | `10` | Number of unanalyzed learnings before alert |
| `WORKFLOW_JIRA_CONFIRM` | boolean | — | Require confirmation before writing to Jira |
| `WORKFLOW_SLACK_WEBHOOK` | URL | — | Default Slack incoming webhook URL |

### Environment variables

Additional environment variables used by the tools:

| Variable | Used by | Description |
|---|---|---|
| `WORKFLOW_MAX_PARALLEL` | orchestrator | Overrides `workflow.defaults.WORKFLOW_MAX_PARALLEL` |
| `WORKFLOW_SLACK_WEBHOOK` | mcp-server | Slack webhook URL for the `slack_notify` MCP tool |
| `KANBAN_MOCK` | orchestrator, mcp-server | Set to `true` to enable mock mode (no real Claude sessions or API calls) |
| `KANBAN_DB_PATH` | web-server | Path to SQLite database file (default: managed internally) |
| `ORCHESTRATOR_WS_URL` | web-server | WebSocket URL of the orchestrator (default: `ws://localhost:3101`) |
| `PORT` | web-server | HTTP port for the web server (default: `3100`) |
| `HOST` | web-server | Bind host for the web server (default: `0.0.0.0`) |
| `CLAUDE_PROJECTS_DIR` | web-server | Claude projects directory (default: `~/.claude/projects`) |
| `CLAUDE_ROOT` | web-server | Claude root directory (default: `~/.claude`) |
| `JIRA_EMAIL` | kanban-cli jira scripts | Jira account email |
| `JIRA_TOKEN` | kanban-cli jira scripts | Jira API token |
| `JIRA_BASE_URL` | kanban-cli jira scripts | Jira instance URL (e.g. `https://myorg.atlassian.net`) |
| `ATLASSIAN_TOOLS_PATH` | kanban-cli jira scripts | Override path to atlassian-tools plugin |
| `CONFLUENCE_GET_SCRIPT` | kanban-cli enrich | Override path to Confluence fetch script |
| `DISABLE_SLACK` | mcp-server | Set to `true` to suppress real Slack HTTP calls in test environments |

### Jira integration

Jira integration uses two external scripts (`reading_script` and `writing_script`) that act as a bridge to your Jira instance. The built-in defaults delegate to the `atlassian-tools` Claude Code plugin.

Configure Jira in your `.kanban-workflow.yaml`:

```yaml
jira:
  project: PROJ          # Jira project key for new issues
  assignee: "you@example.com"
  reading_script: null   # null = use built-in atlassian-tools bridge
  writing_script: null   # null = use built-in atlassian-tools bridge
  status_map:
    first_stage_design: "In Progress"
    stage_pr_created: "In Review"
    all_stages_done: "Done"
```

The built-in bridge reads credentials from environment variables:

```bash
export JIRA_EMAIL="you@example.com"
export JIRA_TOKEN="your-api-token"
export JIRA_BASE_URL="https://yourorg.atlassian.net"
```

To use a custom script, set `reading_script` or `writing_script` to an absolute path. The script receives a JSON payload on stdin and must return JSON on stdout.

### GitHub/GitLab integration

Set `WORKFLOW_GIT_PLATFORM` to `github`, `gitlab`, or `auto` (auto-detects from the remote URL). The orchestrator uses the platform value when polling PR/MR status.

No additional credentials are required beyond what `gh` (GitHub CLI) or `glab` (GitLab CLI) already have configured on your system.

### Slack integration

Supply a Slack incoming webhook URL in one of these ways, in priority order:

1. Per-repo: `--slack-webhook <url>` when running `register-repo`
2. Global default: `WORKFLOW_SLACK_WEBHOOK` env var or `workflow.defaults.WORKFLOW_SLACK_WEBHOOK` in config

The MCP server's `slack_notify` tool also accepts a `webhook_url` argument at call time to override the global default for per-channel routing.

### Multi-repo registry

The global repos list is stored at `~/.config/kanban-workflow/repos.yaml`. Manage it with the `register-repo`, `unregister-repo`, and `list-repos` CLI commands. See [CLI Reference](#cli-reference-kanban-cli) below.

---

## CLI Reference: kanban-cli

All commands output JSON to stdout by default. Use `--pretty` for readable output and `-o <file>` to write to a file instead of stdout.

### validate-pipeline

Validate the workflow pipeline config. Runs a 4-layer audit of the config file.

```
kanban-cli validate-pipeline [options]
```

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--global-config <path>` | Path to global config file |
| `--dry-run` | Execute resolver dry-runs |
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

Exit codes: `0` = valid, `1` = invalid, `2` = error.

### board

Output the kanban board as JSON or HTML.

```
kanban-cli board [options]
```

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--global` | Aggregate board across all registered repos |
| `--epic <id>` | Filter to a specific epic |
| `--ticket <id>` | Filter to a specific ticket |
| `--column <name>` | Filter to a specific column (snake_case) |
| `--exclude-done` | Omit completed stages |
| `--pretty` | Pretty-print JSON output |
| `--html` | Output as standalone HTML page |
| `-o, --output <file>` | Write output to file |

### graph

Output the dependency graph as JSON or a Mermaid diagram.

```
kanban-cli graph [options]
```

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--global` | Show graph across all registered repos |
| `--epic <id>` | Filter to a specific epic |
| `--ticket <id>` | Filter to a specific ticket |
| `--pretty` | Pretty-print JSON output |
| `--mermaid` | Output as Mermaid diagram instead of JSON |
| `-o, --output <file>` | Write output to file |

### next

Output next workable stages, sorted by priority.

```
kanban-cli next [options]
```

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--global` | Show ready stages across all registered repos |
| `--max <n>` | Maximum number of stages to return (default: `5`) |
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

### validate

Validate all frontmatter and dependency integrity. Also runs pipeline validation.

```
kanban-cli validate [options]
```

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--global` | Validate across all registered repos |
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

Exit codes: `0` = valid, `1` = invalid, `2` = error.

### sync

Force a re-parse of markdown files into SQLite.

```
kanban-cli sync [options]
```

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--stage <id>` | Sync a single stage by ID |
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

### summary

Summarize stages, tickets, or epics using an LLM.

```
kanban-cli summary <ids...> [options]
```

`<ids...>` accepts one or more IDs in the form `STAGE-*`, `TICKET-*`, or `EPIC-*`.

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--model <model>` | Claude model to use for summarization |
| `--no-cache` | Bypass the summary cache and re-summarize |
| `-q, --quiet` | Suppress progress output |
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

### migrate

Migrate old-format repos to the current format.

```
kanban-cli migrate [options]
```

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--dry-run` | Show what would happen without making changes |
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

### jira-import

Import a Jira issue as a local epic or ticket.

```
kanban-cli jira-import <key> [options]
```

`<key>` is the Jira issue key, e.g. `PROJ-1234`.

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--epic <id>` | Parent epic ID override |
| `--pretty` | Human-readable output |
| `-o, --output <file>` | Write output to file |

### jira-sync

Compute the expected Jira state from workflow state and sync status/assignee.

```
kanban-cli jira-sync <ticket-id> [options]
```

`<ticket-id>` is the internal ticket ID, e.g. `TICKET-001-001`.

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--dry-run` | Show what would change without executing |
| `--pretty` | Human-readable output |
| `-o, --output <file>` | Write output to file |

Exit codes: `0` = success, `1` = error, `2` = confirmation needed (`WORKFLOW_JIRA_CONFIRM=true`).

### enrich

Fetch linked content (Confluence pages, Jira details) for a Jira-sourced ticket.

```
kanban-cli enrich <ticket-path> [options]
```

`<ticket-path>` is the path to the ticket markdown file.

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--pretty` | Human-readable output |
| `-o, --output <file>` | Write output to file |

### learnings-count

Count unanalyzed learnings. Intended for cron integration.

```
kanban-cli learnings-count [options]
```

| Flag | Description |
|---|---|
| `--repo <path>` | Path to repository (default: current directory) |
| `--threshold <n>` | Override threshold (default: from config, or `10`) |
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

### register-repo

Register a repository for multi-repo tracking.

```
kanban-cli register-repo <path> [options]
```

The path must contain an `epics/` directory.

| Flag | Description |
|---|---|
| `--name <name>` | Display name (default: directory basename) |
| `--slack-webhook <url>` | Slack webhook URL for this repo |
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

### unregister-repo

Remove a repository from multi-repo tracking.

```
kanban-cli unregister-repo <name> [options]
```

| Flag | Description |
|---|---|
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

### list-repos

List all registered repositories.

```
kanban-cli list-repos [options]
```

| Flag | Description |
|---|---|
| `--pretty` | Pretty-print JSON output |
| `-o, --output <file>` | Write output to file |

---

## Web UI Usage

The web server provides a browser-based dashboard at `http://localhost:3100` (default).

### Starting the web server

The web server requires the kanban-cli to be built first (it imports from `../kanban-cli/dist`).

```bash
cd tools/web-server
node dist/server/index.js
```

The server binds to `0.0.0.0:3100` by default. Override with `PORT` and `HOST` env vars:

```bash
PORT=8080 HOST=127.0.0.1 node dist/server/index.js
```

### Pages

| Route | Page | Description |
|---|---|---|
| `/` | Dashboard | Overview of active sessions, recent activity |
| `/board` | Kanban Board | All stages organised by pipeline column |
| `/epics/:epicId` | Epic Detail | Epic overview and its tickets |
| `/tickets/:ticketId` | Ticket Detail | Ticket details and its stages |
| `/stages/:stageId` | Stage Detail | Stage frontmatter, status, and session log |
| `/sessions/:projectId/:sessionId` | Session Viewer | Raw Claude session transcript |
| `/graph` | Dependency Graph | Interactive Mermaid dependency graph |

### Dashboard

The dashboard shows a summary of workflow state: active sessions, recent stage transitions, and any pending interactions waiting for user input.

### Kanban Board

The board page shows all stages in columns that match the pipeline phases defined in `.kanban-workflow.yaml`. Stages in multi-repo mode include a repo label.

Use the column filter or epic/ticket filter in the UI to narrow the view. Clicking a stage card opens the Stage Detail drawer.

### Detail drawers

Clicking any epic, ticket, or stage navigates to its detail page. Stage detail shows:

- Current status and pipeline column
- Frontmatter fields (branch, priority, due date)
- Whether a session is currently active
- Links to related ticket and epic

### Session viewer

Navigate to `/sessions/:projectId/:sessionId` to read the raw transcript of a Claude session. This is useful for debugging what a stage session did and why it transitioned.

### Dependency graph

The `/graph` page renders the full dependency graph using Mermaid. Nodes represent epics, tickets, and stages; edges represent `depends_on` relationships. Use the epic/ticket filter to focus on a subset.

---

## Orchestrator Guide

The orchestrator is a long-running process that polls the board, picks up workable stages, and launches Claude Code sessions in git worktrees to execute them.

### Starting the orchestrator

```bash
cd tools/orchestrator
node dist/index.js --repo /path/to/your/project
```

The orchestrator reads the pipeline config from the target repo, starts a cron scheduler, and begins the stage execution loop.

### CLI flags

```
orchestrator [options]
```

| Flag | Default | Description |
|---|---|---|
| `--repo <path>` | current directory | Target repository path |
| `--once` | `false` | Run a single tick then exit |
| `--idle-seconds <n>` | `30` | Seconds to wait when no stages are ready |
| `--log-dir <path>` | `<repo>/.kanban-logs/` | Directory for session logs |
| `--model <model>` | `sonnet` | Claude model to use for stage sessions |
| `--verbose` | `false` | Enable verbose log output |
| `--mock` | `false` | Mock mode: auto-advance stages without launching real Claude sessions |

### Phase lifecycle

The orchestrator drives each stage through the phases defined in the pipeline config. The built-in default lifecycle is:

```
Design -> [User Design Feedback] -> Build -> Automatic Testing
       -> Manual Testing -> Finalize -> PR Created
       -> [Addressing Comments] -> PR Created -> Done
```

Brackets indicate optional phases. Phase transitions are defined in the config `transitions_to` array and resolved by either a skill (run inside a Claude session) or a resolver (run by the orchestrator directly without a Claude session).

At each tick:

1. `kanban-cli next` is called to find the highest-priority ready stage.
2. The orchestrator acquires a lock on the stage to prevent duplicate sessions.
3. A git worktree is created for the stage's branch.
4. A Claude Code session is launched in the worktree with the appropriate skill.
5. The session runs to completion; the orchestrator reads the resulting stage status.
6. The worktree is cleaned up and the lock released.

### Dependency resolution

A stage is "ready" when all of its `depends_on` dependencies are resolved. The `kanban-cli next` command applies this filter. You do not need to manually manage dependencies; the orchestrator respects them automatically.

### `--mock` flag

Use `--mock` when you want to test the orchestrator loop without running real Claude sessions or making real API calls. In mock mode:

- Stages auto-advance through the pipeline on each tick.
- `KANBAN_MOCK=true` is set in the environment, which also switches the MCP server into mock mode.
- No git worktrees are created.
- No Claude CLI is invoked.

This is useful for verifying pipeline config and testing the orchestrator's scheduling logic.

### `--once` flag

`--once` runs a single scheduler tick and then exits. Use it to manually trigger one round of stage processing in a script or CI job:

```bash
node dist/index.js --repo . --once
```

### Log directory

Session logs are written to `<repo>/.kanban-logs/` by default. Each session produces a log file named after the stage ID and timestamp. Override the location with `--log-dir`.

---

## MCP Server

The MCP server exposes kanban workflow tools to Claude Code via the Model Context Protocol (MCP). Claude can call these tools during a session to interact with Jira, PRs, Confluence, and Slack.

### Building and running

```bash
cd tools/mcp-server
npm run build
node dist/index.js
```

The server communicates over stdio (standard MCP transport). It does not listen on a network port.

### Registering with Claude Code

Add the server to your Claude Code MCP configuration (typically in `~/.claude/settings.json` or a project-level `.claude/settings.json`):

```json
{
  "mcpServers": {
    "kanban": {
      "command": "node",
      "args": ["/absolute/path/to/tools/mcp-server/dist/index.js"],
      "env": {
        "WORKFLOW_SLACK_WEBHOOK": "https://hooks.slack.com/services/..."
      }
    }
  }
}
```

Replace the path with the absolute path to the built `dist/index.js` on your machine.

### Available tools

| Tool group | Tools | Description |
|---|---|---|
| Jira | `jira_get_ticket`, `jira_search`, `jira_transition`, `jira_assign` | Read and update Jira tickets |
| PR/MR | `pr_create`, `pr_update`, `pr_get`, and others | Create and manage pull/merge requests |
| Enrich | enrich tools | Fetch Confluence and linked content for a ticket |
| Confluence | confluence tools | Read Confluence pages |
| Slack | `slack_notify` | Send notifications to a Slack channel |

### Mock mode

Set `KANBAN_MOCK=true` before starting the server to run in mock mode. In mock mode all tools operate against an in-memory state seeded from `fixtures/mock-data.json` (if present). No real Jira, GitHub, GitLab, or Slack API calls are made.

The orchestrator sets `KANBAN_MOCK=true` automatically when started with `--mock`, so the MCP server it spawns also runs in mock mode.

### Slack tool

The `slack_notify` tool sends a formatted message to a Slack channel. The webhook URL is resolved in this order:

1. `webhook_url` argument passed at call time (per-repo routing)
2. `WORKFLOW_SLACK_WEBHOOK` environment variable
3. `workflow.defaults.WORKFLOW_SLACK_WEBHOOK` in the pipeline config

If no URL is configured, the tool returns a success result with a "skipped" message rather than an error.
