# Stage 6A.5: kanban-cli MCP Server — Design Document

**Date:** 2026-02-23
**Status:** Approved
**Branch:** kanban

---

## 1. Goal

Create an MCP (Model Context Protocol) server that wraps all external service interactions (Jira, GitHub/GitLab PR, Confluence, Slack) as structured tools. Claude Code sessions call MCP tools instead of raw CLI commands. This provides: schema-validated inputs, mockable responses for testing, auditability, and a single gateway for all external calls.

## 2. Architecture Overview

```
Claude Code Session (in worktree)
  └── calls MCP tool: kanban_pr_create({ branch, title, body, ... })
        └── MCP Server (stdio transport, spawned by Claude Code)
              ├── KANBAN_MOCK=false → calls real service (gh/glab/jira scripts)
              └── KANBAN_MOCK=true  → returns stateful mock response
```

The MCP server is a separate TypeScript package (`tools/mcp-server/`) that:
- Imports types and logic from kanban-cli
- Exposes tools via the Model Context Protocol (stdio transport)
- Is auto-discovered by Claude Code via `.mcp.json` at the repo root
- Supports mock mode via `KANBAN_MOCK=true` environment variable

## 3. Resolved Design Decisions

| Question | Resolution | Rationale |
|----------|-----------|-----------|
| MCP discovery | `.mcp.json` at repo root | Auto-discovered by Claude Code, no orchestrator changes needed |
| Server location | `tools/mcp-server/` separate package | Clean separation; imports kanban-cli types |
| Mock strategy | `KANBAN_MOCK=true` env var | Simple, propagates through env inheritance |
| Mock state | Stateful in-memory | Operations mutate state (create PR → readable via get PR) |
| Mock seed data | Fixture file + test repo data | Deterministic, matches existing test infrastructure |
| Mock injection | Mock-only admin tools | `kanban_mock_inject_comment`, etc. Only available when KANBAN_MOCK=true |
| PR implementation | Wrap `gh`/`glab` CLI | Reuse existing auth, migrate to REST API later if needed |
| Jira implementation | Reuse JiraExecutor pattern | Script-based, already validated |
| Platform detection | `WORKFLOW_GIT_PLATFORM` env + auto-detect | Same as existing code-host-factory.ts |
| Skill updates | Replace CLI commands with MCP tool references | Gradual, per-skill |

## 4. Package Structure

```
tools/mcp-server/
├── package.json              # Deps: kanban-cli, @modelcontextprotocol/sdk
├── tsconfig.json             # ES2022, NodeNext
├── vitest.config.ts
├── src/
│   ├── index.ts              # Entry point: create server, connect stdio transport
│   ├── server.ts             # createKanbanMcpServer() factory, registers all tools
│   ├── state.ts              # MockState class: in-memory stateful mock store
│   ├── tools/
│   │   ├── jira.ts           # Jira tool registrations (6 tools)
│   │   ├── pr.ts             # PR/MR tool registrations (8 tools)
│   │   ├── enrich.ts         # Ticket enrichment tool (1 tool)
│   │   ├── confluence.ts     # Confluence page reader (1 tool)
│   │   ├── slack.ts          # Slack notification placeholder (1 tool)
│   │   └── mock-admin.ts     # Mock-only admin tools (3+ tools)
│   ├── mock/
│   │   ├── fixtures.ts       # Seed data loader
│   │   └── handlers.ts       # Mock response generators
│   └── types.ts              # Shared types
├── fixtures/
│   └── mock-data.json        # Default mock seed data
└── tests/
    ├── jira.test.ts
    ├── pr.test.ts
    ├── enrich.test.ts
    ├── confluence.test.ts
    ├── state.test.ts
    └── mock-admin.test.ts
```

## 5. MCP Tool Inventory

### 5.1 Jira Tools

| Tool | Input Schema | Output | Real Implementation |
|------|-------------|--------|---------------------|
| `kanban_jira_get_ticket` | `{ key: string }` | JiraTicketData | JiraExecutor.getTicket |
| `kanban_jira_search` | `{ jql: string, maxResults?: number }` | JiraSearchResult | JiraExecutor.searchTickets |
| `kanban_jira_transition` | `{ key: string, targetStatus: string }` | JiraTransitionResult | JiraExecutor.transitionTicket |
| `kanban_jira_assign` | `{ key: string, assignee?: string }` | JiraAssignResult | JiraExecutor.assignTicket |
| `kanban_jira_comment` | `{ key: string, body: string }` | JiraCommentResult | JiraExecutor.addComment |
| `kanban_jira_sync` | `{ ticketId: string, repoPath: string, dryRun?: bool }` | JiraSyncResult | jiraSync() logic |

### 5.2 PR/MR Tools

| Tool | Input Schema | Output | Real Implementation |
|------|-------------|--------|---------------------|
| `kanban_pr_create` | `{ branch, title, body, base?, draft?, assignees?, reviewers? }` | `{ url, number }` | `gh pr create` / `glab mr create` |
| `kanban_pr_update` | `{ number, title?, body?, base?, draft?, assignees?, reviewers? }` | `{ success }` | `gh pr edit` / `glab mr update` |
| `kanban_pr_get` | `{ number }` | PR details with comments, reviews | `gh pr view --json` / `glab mr view` |
| `kanban_pr_close` | `{ number }` | `{ success }` | `gh pr close` / `glab mr close` |
| `kanban_pr_get_comments` | `{ number }` | `{ comments[] }` | `gh api` for review comments |
| `kanban_pr_add_comment` | `{ number, body }` | `{ id }` | `gh pr comment` |
| `kanban_pr_get_status` | `{ prUrl: string }` | PRStatus | CodeHostAdapter.getPRStatus |
| `kanban_pr_mark_ready` | `{ number }` | `{ success }` | CodeHostAdapter.markPRReady |

### 5.3 Enrichment & Confluence

| Tool | Input Schema | Output | Real Implementation |
|------|-------------|--------|---------------------|
| `kanban_enrich_ticket` | `{ ticketPath: string }` | EnrichResult | enrichTicket() |
| `kanban_confluence_get_page` | `{ pageId: string }` | `{ title, body, url }` | Confluence read script |

### 5.4 Slack (Placeholder)

| Tool | Input Schema | Output | Notes |
|------|-------------|--------|-------|
| `kanban_slack_notify` | `{ message, channel? }` | `{ success }` | Returns "not yet implemented" |

### 5.5 Mock Admin Tools (KANBAN_MOCK only)

| Tool | Input Schema | Purpose |
|------|-------------|---------|
| `kanban_mock_inject_comment` | `{ prNumber, body, author? }` | Simulate a reviewer adding a comment |
| `kanban_mock_set_pr_merged` | `{ prNumber }` | Simulate a PR being merged |
| `kanban_mock_set_ticket_status` | `{ key, status }` | Override a ticket's Jira status |

These tools are only registered when `KANBAN_MOCK=true`. They modify the in-memory mock state.

## 6. Mock Mode Design

### Stateful Mock Store (`state.ts`)

```typescript
class MockState {
  private prs: Map<number, MockPR>;
  private tickets: Map<string, MockTicket>;
  private pages: Map<string, MockPage>;
  private nextPrNumber: number;

  constructor(seedData?: MockSeedData);

  // PR operations
  createPr(data: CreatePrInput): { url: string; number: number };
  getPr(number: number): MockPR | null;
  updatePr(number: number, updates: Partial<MockPR>): void;
  closePr(number: number): void;
  addPrComment(number: number, comment: MockComment): void;
  getPrComments(number: number): MockComment[];
  setPrMerged(number: number): void;

  // Jira operations
  getTicket(key: string): MockTicket | null;
  transitionTicket(key: string, status: string): void;
  assignTicket(key: string, assignee: string): void;
  addTicketComment(key: string, comment: MockComment): void;

  // Confluence
  getPage(pageId: string): MockPage | null;
}
```

### Seed Data (`fixtures/mock-data.json`)

```json
{
  "tickets": {
    "PROJ-101": { "key": "PROJ-101", "summary": "User authentication", "status": "To Do", "type": "Story" },
    "PROJ-102": { "key": "PROJ-102", "summary": "API rate limiting", "status": "In Progress", "type": "Task" }
  },
  "pages": {
    "12345": { "title": "Architecture Overview", "body": "# Architecture\n...", "url": "https://wiki.example.com/12345" }
  }
}
```

### Mock Response Pattern

Each tool handler:
1. Check `process.env.KANBAN_MOCK === 'true'`
2. If mock: call corresponding MockState method, return result
3. If real: call kanban-cli service function, return result

## 7. .mcp.json Configuration

Created at the target repo root:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "npx",
      "args": ["tsx", "<absolute-path-to-mcp-server>/src/index.ts"],
      "env": {}
    }
  }
}
```

The path is resolved at setup time. The orchestrator does not modify this file — mock mode is controlled purely via environment variable inheritance.

## 8. Orchestrator Integration

The orchestrator's `--mock` flag:
1. Sets `process.env.KANBAN_MOCK = 'true'` (propagates to child sessions)
2. Uses mock session executor (auto-advance, no real Claude CLI)
3. Uses mock worktree manager (no real git worktrees)

For **partial mock** (real Claude sessions + mock services):
1. User sets `KANBAN_MOCK=true` in their shell
2. Runs orchestrator without `--mock`
3. Real sessions spawn, MCP server receives mock env var, returns mock responses

## 9. Skill Updates

Skills updated to reference MCP tools:

| Skill | Current Pattern | New Pattern |
|-------|----------------|-------------|
| phase-finalize | `gh pr create --base main --title "..."` | `kanban_pr_create({ branch, title, body, base })` |
| phase-finalize | `kanban-cli jira-sync TICKET-XXX` | `kanban_jira_sync({ ticketId, repoPath })` |
| phase-finalize | `curl -X POST $WORKFLOW_SLACK_WEBHOOK` | `kanban_slack_notify({ message })` (future) |
| review-cycle | `gh pr view <n> --json reviews,comments` | `kanban_pr_get({ number })` + `kanban_pr_get_comments({ number })` |
| review-cycle | `gh pr comment <n> --body "..."` | `kanban_pr_add_comment({ number, body })` |
| convert-ticket | `kanban-cli enrich <path>` | `kanban_enrich_ticket({ ticketPath })` |

## 10. What Is NOT In Scope

- Slack implementation (placeholder only)
- REST API migration for GitHub/GitLab (staying with CLI wrappers)
- Changes to kanban-cli source code
- Changes to orchestrator loop logic (6A stays as-is)
- Exit gate logic (that's 6B)

## 11. Testing Strategy

| Module | Test Approach |
|--------|--------------|
| MockState | Unit tests: CRUD operations, seed data loading, state isolation |
| Jira tools | Mock JiraExecutor, verify tool params and response mapping |
| PR tools | Mock exec function (gh/glab), verify commands and parsing |
| Enrich tool | Mock enrichTicket, verify params and response |
| Confluence | Mock script execution, verify parsing |
| Mock admin | Verify tools only available when KANBAN_MOCK=true |
| Integration | Start MCP server in mock mode, call tools via SDK client, verify stateful behavior |
