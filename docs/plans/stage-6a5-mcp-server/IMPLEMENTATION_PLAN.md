# Stage 6A.5: MCP Server — Implementation Plan

**Design Doc:** `docs/plans/2026-02-23-stage-6a5-mcp-server-design.md`
**Branch:** kanban

---

## Dependency Graph

```
Task 1 (Scaffolding + MCP SDK)
  ├── Task 2 (Mock State)
  │     ├── Task 3 (Jira Tools)
  │     ├── Task 4 (PR Tools)
  │     ├── Task 5 (Enrich + Confluence Tools)
  │     └── Task 6 (Mock Admin Tools)
  │           └── Task 7 (Server Factory + Entry Point)
  │                 └── Task 8 (.mcp.json + Orchestrator Integration)
  │                       └── Task 9 (Skill Updates)
  │                             └── Task 10 (Integration Tests + Design Doc Update)
```

---

## Task 1: Package Scaffolding

**Goal:** Set up `tools/mcp-server/` package with TypeScript, Vitest, MCP SDK, and kanban-cli dependency.

**Files to create:**
- `tools/mcp-server/package.json`
- `tools/mcp-server/tsconfig.json`
- `tools/mcp-server/vitest.config.ts`
- `tools/mcp-server/src/types.ts` (shared types)

**Details:**

`package.json`:
- name: `mcp-server`
- type: `module`
- dependencies: `kanban-cli` via `file:../kanban-cli`, `@modelcontextprotocol/sdk`, `zod`
- devDependencies: `typescript`, `tsx`, `vitest`, `@types/node`
- scripts: `build` (tsc), `dev` (tsx src/index.ts), `test` (vitest run), `lint` (tsc --noEmit), `verify` (npm run lint && npm run test)

`src/types.ts`: Re-export needed types from kanban-cli + define MCP-specific types:
```typescript
// Tool result wrapper
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// Mock mode check
export function isMockMode(): boolean {
  return process.env.KANBAN_MOCK === 'true';
}
```

**Success criteria:** `cd tools/mcp-server && npm install && npm run lint` passes.

**Status:** Not Started

---

## Task 2: Mock State

**Goal:** Stateful in-memory mock store for PRs, Jira tickets, and Confluence pages.

**Files to create:**
- `tools/mcp-server/src/state.ts`
- `tools/mcp-server/fixtures/mock-data.json`
- `tools/mcp-server/tests/state.test.ts`

**Details:**

`state.ts` exports `MockState` class:
- Constructor accepts optional `MockSeedData` (loaded from fixture file)
- PR operations: createPr, getPr, updatePr, closePr, addPrComment, getPrComments, setPrMerged, getPrStatus
- Jira operations: getTicket, searchTickets, transitionTicket, assignTicket, addTicketComment
- Confluence: getPage
- Sequential PR number generation (starts at 1000, incremented per create)
- All read operations return deep copies (prevent external mutation)

`fixtures/mock-data.json`: Default seed data with 2-3 Jira tickets, 1 Confluence page.

**Tests:**
- PR CRUD: create → get → update → get reflects changes
- PR comments: add → get returns comment
- PR merge: setPrMerged → getPrStatus returns merged=true
- Jira CRUD: seed data accessible, transition updates status, assign updates assignee
- Jira comments: add → getTicket includes comment
- Confluence: get seeded page, get nonexistent returns null
- Seed data loading from fixture
- Deep copy: modifying returned object doesn't affect store

**Status:** Not Started

---

## Task 3: Jira Tools

**Goal:** Register 6 Jira MCP tools that call JiraExecutor in real mode and MockState in mock mode.

**Files to create:**
- `tools/mcp-server/src/tools/jira.ts`
- `tools/mcp-server/tests/jira.test.ts`

**Details:**

`jira.ts` exports `registerJiraTools(server, deps)` function. Takes an MCP server instance and a deps object with injectable JiraExecutor and MockState.

Each tool:
1. Defines a Zod input schema
2. Registers with `server.setRequestHandler` for `tools/call`
3. In handler: check `isMockMode()` → mock or real path
4. Return structured `ToolResult` with JSON content

**Tools:**
- `kanban_jira_get_ticket`: input `{ key }`, calls `executor.getTicket(key)` or `mockState.getTicket(key)`
- `kanban_jira_search`: input `{ jql, maxResults? }`, calls `executor.searchTickets(jql, maxResults)`
- `kanban_jira_transition`: input `{ key, targetStatus }`, calls `executor.transitionTicket(key, targetStatus)`
- `kanban_jira_assign`: input `{ key, assignee? }`, calls `executor.assignTicket(key, assignee)`
- `kanban_jira_comment`: input `{ key, body }`, calls `executor.addComment(key, body)`
- `kanban_jira_sync`: input `{ ticketId, repoPath, dryRun? }`, calls `jiraSync()` logic

**Tests:** Mock executor injected. Verify each tool: correct executor method called, correct args, response mapped to ToolResult. Mock mode: verify MockState is used instead.

**Status:** Not Started

---

## Task 4: PR/MR Tools

**Goal:** Register 8 PR/MR MCP tools that wrap `gh`/`glab` CLI in real mode and MockState in mock mode.

**Files to create:**
- `tools/mcp-server/src/tools/pr.ts`
- `tools/mcp-server/tests/pr.test.ts`

**Details:**

`pr.ts` exports `registerPrTools(server, deps)`. The deps include an injectable `execFn` for running CLI commands and `MockState`.

**Real mode implementation patterns:**

- `kanban_pr_create`: Runs `gh pr create --head <branch> --base <base> --title <title> --body <body>` (+ `--draft`, `--assignee`, `--reviewer` flags). Parses URL and number from output.
- `kanban_pr_update`: Runs `gh pr edit <number>` with applicable flags.
- `kanban_pr_get`: Runs `gh pr view <number> --json state,title,body,mergedAt,url,number,reviews,comments`.
- `kanban_pr_close`: Runs `gh pr close <number>`.
- `kanban_pr_get_comments`: Runs `gh api repos/{owner}/{repo}/pulls/{number}/comments` for inline review comments + `gh pr view <number> --json comments` for conversation comments.
- `kanban_pr_add_comment`: Runs `gh pr comment <number> --body <body>`.
- `kanban_pr_get_status`: Uses existing `CodeHostAdapter.getPRStatus(prUrl)`.
- `kanban_pr_mark_ready`: Uses existing `CodeHostAdapter.markPRReady(prNumber)`.

Platform detection: Read `WORKFLOW_GIT_PLATFORM` env var. If `github` → use `gh`. If `gitlab` → use `glab` equivalents. If `auto` → detect from git remote.

**Tests:** Mock execFn. Verify correct CLI commands constructed. Mock mode: verify MockState used.

**Status:** Not Started

---

## Task 5: Enrich + Confluence Tools

**Goal:** Register enrichment and Confluence MCP tools.

**Files to create:**
- `tools/mcp-server/src/tools/enrich.ts`
- `tools/mcp-server/src/tools/confluence.ts`
- `tools/mcp-server/src/tools/slack.ts` (placeholder)
- `tools/mcp-server/tests/enrich.test.ts`
- `tools/mcp-server/tests/confluence.test.ts`

**Details:**

`enrich.ts`: `registerEnrichTools(server, deps)` — registers `kanban_enrich_ticket` tool.
- Real mode: calls `enrichTicket()` from kanban-cli
- Mock mode: returns empty enrichment result (no linked content fetched)

`confluence.ts`: `registerConfluenceTools(server, deps)` — registers `kanban_confluence_get_page` tool.
- Real mode: spawns the confluence read script
- Mock mode: returns page from MockState

`slack.ts`: `registerSlackTools(server, deps)` — registers `kanban_slack_notify` placeholder.
- Returns `{ success: false, message: "Slack integration not yet implemented" }` regardless of mode.

**Tests:** Verify tool registration, mock/real routing, correct responses.

**Status:** Not Started

---

## Task 6: Mock Admin Tools

**Goal:** Register mock-only tools for injecting test state.

**Files to create:**
- `tools/mcp-server/src/tools/mock-admin.ts`
- `tools/mcp-server/tests/mock-admin.test.ts`

**Details:**

`mock-admin.ts`: `registerMockAdminTools(server, mockState)` — only called when `isMockMode()`.

**Tools:**
- `kanban_mock_inject_comment`: input `{ prNumber, body, author? }` — adds a comment to MockState
- `kanban_mock_set_pr_merged`: input `{ prNumber }` — marks PR as merged in MockState
- `kanban_mock_set_ticket_status`: input `{ key, status }` — overrides ticket status in MockState

These tools are NOT registered in real mode. If called without KANBAN_MOCK=true, they don't exist.

**Tests:** Verify tools only registered in mock mode. Verify each tool mutates MockState correctly.

**Status:** Not Started

---

## Task 7: Server Factory + Entry Point

**Goal:** Wire all tool groups into the MCP server and create the entry point.

**Files to create:**
- `tools/mcp-server/src/server.ts`
- `tools/mcp-server/src/index.ts`
- `tools/mcp-server/tests/server.test.ts`

**Details:**

`server.ts` exports `createKanbanMcpServer(deps?)`:
1. Create `McpServer` instance from `@modelcontextprotocol/sdk`
2. If `isMockMode()`: create `MockState` with seed data from fixtures
3. Create deps object with JiraExecutor (from config), CodeHostAdapter, MockState
4. Call all `registerXxxTools(server, deps)` functions
5. If `isMockMode()`: call `registerMockAdminTools(server, mockState)`
6. Return server

`index.ts`:
```typescript
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKanbanMcpServer } from './server.js';

const server = createKanbanMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Tests:** Verify server creates with all tools registered. Verify mock mode registers admin tools. Verify real mode does not register admin tools.

**Status:** Not Started

---

## Task 8: .mcp.json + Orchestrator Integration

**Goal:** Create .mcp.json config and update orchestrator --mock to set KANBAN_MOCK.

**Files to create/modify:**
- Create `.mcp.json` at project root (for this project's own testing)
- Modify `tools/orchestrator/src/index.ts` — set `process.env.KANBAN_MOCK = 'true'` when `--mock`
- Modify `tools/orchestrator/src/session.ts` — add `--mcp-config` support to spawn options (optional, for explicit config)

**Details:**

`.mcp.json`:
```json
{
  "mcpServers": {
    "kanban": {
      "command": "npx",
      "args": ["tsx", "tools/mcp-server/src/index.ts"],
      "env": {}
    }
  }
}
```

Orchestrator `--mock` update: In `index.ts` action handler, when `config.mock === true`, set `process.env.KANBAN_MOCK = 'true'` before creating any modules. This propagates to all child processes.

**Tests:** Verify .mcp.json is valid JSON. Verify orchestrator --mock sets KANBAN_MOCK in env.

**Status:** Not Started

---

## Task 9: Skill Updates

**Goal:** Update phase skills to reference MCP tools instead of direct CLI commands.

**Files to modify:**
- `skills/phase-finalize/SKILL.md` — PR creation, Jira sync, Slack
- `skills/review-cycle/SKILL.md` — PR comment fetch/reply
- `skills/convert-ticket/SKILL.md` — enrichment

**Details:**

For each skill, replace bash commands with MCP tool references:

**phase-finalize:** Replace `gh pr create ...` with instructions to use `kanban_pr_create` MCP tool. Replace `kanban-cli jira-sync` with `kanban_jira_sync`. Replace `curl` Slack with `kanban_slack_notify`.

**review-cycle:** Replace `gh pr view --json` with `kanban_pr_get`. Replace `gh api` comment fetch with `kanban_pr_get_comments`. Replace `gh pr comment` with `kanban_pr_add_comment`.

**convert-ticket:** Replace `kanban-cli enrich` with `kanban_enrich_ticket`.

The skill text changes from bash command instructions to MCP tool call instructions. The MCP tool names are prefixed with `mcp__kanban__` when called from Claude Code (the MCP server name is `kanban`, so tools become `mcp__kanban__kanban_pr_create`, etc.). Actually — the tool name registered in MCP is just `kanban_pr_create`, and Claude Code prefixes it with `mcp__<server-name>__`. So if the server is named `kanban` in .mcp.json, the tool becomes `mcp__kanban__kanban_pr_create`. To avoid the double `kanban_`, we should name the tools without the `kanban_` prefix (just `pr_create`, `jira_get_ticket`, etc.) so they become `mcp__kanban__pr_create`, `mcp__kanban__jira_get_ticket`.

**Revised tool naming:** Drop the `kanban_` prefix from tool names. Register as `jira_get_ticket`, `pr_create`, etc. Claude Code will expose them as `mcp__kanban__jira_get_ticket`, `mcp__kanban__pr_create`.

**Tests:** No automated tests for skill markdown changes. Manual verification that tool names are correct.

**Status:** Not Started

---

## Task 10: Integration Tests + Design Doc Update

**Goal:** End-to-end test of MCP server in mock mode. Update the redesign design doc.

**Files to create/modify:**
- `tools/mcp-server/tests/integration.test.ts`
- `docs/plans/2026-02-16-kanban-workflow-redesign-design.md` (add MCP server section)

**Details:**

**Integration tests:**
- Start MCP server programmatically in mock mode
- Create an MCP client that connects to it
- Call tools and verify responses: create PR → get PR returns it, transition ticket → get ticket shows new status
- Inject comment via admin tool → get comments returns it
- Verify mock admin tools not available in real mode

**Design doc update:**
- Add a new section describing the MCP server architecture
- Update Stage 6A.5 in the dependency graph
- Note that skills use MCP tools for all external service calls
- Document the mock mode strategy

**Status:** Not Started

---

## Verification

After all tasks complete:

1. `cd tools/mcp-server && npm run verify` — passes
2. `cd tools/orchestrator && npm run verify` — still passes (170 tests)
3. `cd tools/kanban-cli && npm run verify` — still passes (729 tests)
4. `.mcp.json` exists at project root with valid configuration
5. Skills reference MCP tool names instead of raw CLI commands
