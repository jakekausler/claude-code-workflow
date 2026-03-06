# Stage 5.5C: Jira Conversion Enrichment — Design Document

**Date**: 2026-02-23
**Status**: Approved
**Branch**: kanban
**Depends on**: Stage 5.5A (schema with `jira_links` field)
**Independent of**: Stage 5.5B (skill updates)

## Overview

Stage 5.5C enhances two parts of the Jira integration:

1. **`jira-import`** captures a link manifest from Jira during ticket import, populating the `jira_links` frontmatter field that Stage 5.5A added to the schema.
2. **`kanban-cli enrich`** (new command) fetches linked content for enriched brainstorming context during ticket conversion.

## Architecture: Approach A — Enrichment in CLI Code

All enrichment logic lives in CLI code (`src/cli/logic/enrich-ticket.ts`), making it testable, deterministic, and reproducible. The `convert-ticket` skill invokes the CLI command before brainstorming.

## Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Script contract | Extend `getTicket()` with optional `links` field | Single round-trip, backward compatible |
| Content storage | Save as `-enrichment.md` sibling file | Persistent, reusable across sessions |
| Concurrency | Sequential fetching | Simpler, respects rate limits, not a hot path |
| Confluence reader | Use `atlassian-tools` plugin scripts | Available on this machine, same spawn pattern as Jira |
| Backward compat | `links` field is `.optional().default([])` | Scripts without links still pass validation |

---

## 1. Jira Reading Script Contract Extension

### Schema Change (`src/jira/schemas.ts`)

Add optional `links` array to `jiraTicketDataSchema`:

```typescript
links: z.array(z.object({
  type: z.enum(['confluence', 'jira_issue', 'attachment', 'external']),
  url: z.string(),
  title: z.string(),
  key: z.string().optional(),
  relationship: z.string().optional(),
  filename: z.string().optional(),
  mime_type: z.string().optional(),
})).optional().default([]),
```

The `.optional().default([])` ensures scripts that don't return links pass validation.

### Reader Script Changes (`scripts/jira/default-jira-reader.ts`)

The script currently fetches `fields.*` from the Jira REST API. It needs to additionally extract:

- **`fields.issuelinks[]`** — Jira issue links (inward/outward issues with relationship types)
- **Remote links** via `/rest/api/3/issue/{key}/remotelink` — Confluence pages and external URLs
- **`fields.attachment[]`** — File attachments

Link type classification:
- URLs matching `*.atlassian.net/wiki/*` → `type: 'confluence'`
- URLs matching `*.atlassian.net/browse/*` or links from `issuelinks` → `type: 'jira_issue'`
- Attachment URLs → `type: 'attachment'`
- Everything else → `type: 'external'`

### Type Inference

`JiraTicketData` in `src/jira/types.ts` is inferred from the Zod schema via `z.infer<>`, so the type updates automatically when the schema changes.

---

## 2. jira-import Link Manifest Population

### Changes to `src/cli/logic/jira-import.ts`

After `executor.getTicket(key)` returns, the import logic:

1. Reads `jiraData.links` (defaults to `[]`)
2. If non-empty, serializes `jira_links` into YAML frontmatter using `js-yaml` (already a transitive dependency via `gray-matter`)
3. If empty, omits `jira_links` from frontmatter (schema default handles it)

### Ticket Frontmatter with Links

```yaml
---
id: TICKET-001-001
epic: EPIC-001
title: "Feature Title"
status: Not Started
jira_key: PROJ-456
source: jira
stages: []
depends_on: []
jira_links:
  - type: confluence
    url: "https://company.atlassian.net/wiki/spaces/TEAM/pages/12345"
    title: "Design Doc"
  - type: jira_issue
    url: "https://company.atlassian.net/browse/PROJ-999"
    key: "PROJ-999"
    title: "SSO Integration"
    relationship: "blocks"
---
```

### YAML Serialization

Use the `yaml` package (already a project dependency) `stringify()` for the `jira_links` array to avoid hand-building YAML strings. The rest of the frontmatter template remains as string interpolation for consistency with the existing code pattern.

### Scope

- **Tickets only** — epics don't have `jira_links` in their schema
- **Empty links** — if the script returns no links, `jira_links` is omitted (schema default `[]` applies)

---

## 3. Enrich-Ticket Module

### New File: `src/cli/logic/enrich-ticket.ts`

Core function:

```typescript
export async function enrichTicket(
  ticketPath: string,
  options: EnrichOptions,
): Promise<EnrichResult>
```

### Flow

1. Read ticket frontmatter, extract `jira_links` and `jira_key`
2. If `jira_links` is empty and no `jira_key`, return early (nothing to enrich)
3. If `jira_key` exists, re-pull fresh Jira data via `executor.getTicket(key)`
4. For each link in `jira_links`, fetch content sequentially:
   - **`confluence`**: Spawn `npx tsx <confluence-get-script> <url> --no-metadata`
   - **`jira_issue`**: Call `executor.getTicket(link.key)`
   - **`attachment`**: HTTP download, extract text if text-based (PDF noted as unsupported)
   - **`external`**: HTTP GET, extract body text
5. Compile fetched content into structured markdown
6. Write to `<ticket-path-without-.md>-enrichment.md`
7. Return `EnrichResult` with per-link success/failure

### Enrichment File Format

```markdown
# Enrichment Context for TICKET-001-001

> Auto-generated by `kanban-cli enrich`. Do not edit manually.
> Generated: 2026-02-23T12:00:00Z

## Fresh Jira Data (PROJ-123)

**Status**: In Progress
**Assignee**: alice
**Labels**: backend, priority-high

### Description

[fresh description from Jira]

### Comments

**bob** (2024-01-15): comment text...

## Linked Content

### [Confluence] Design Doc
*Source: https://...*

[fetched markdown content]

### [Jira Issue] PROJ-999: SSO Integration
*Source: https://...*
*Relationship: blocks*

**Status**: Done
**Description**: ...

### [Attachment] wireframes.pdf
*Source: https://...*

> PDF content extraction not available. Download manually from link above.

### [External] Design Spec
*Source: https://docs.google.com/...*

[fetched content or "Could not fetch: 403 Forbidden"]
```

### Confluence Script Path Resolution

1. Look for the `atlassian-tools` plugin at the known cache path: `~/.claude/plugins/cache/claude-code-marketplace/atlassian-tools/*/skills/confluence-reader/scripts/confluence-get.ts`
2. Fall back: check `CONFLUENCE_GET_SCRIPT` environment variable
3. If not found, log "Confluence reader not available" and skip confluence links

### Graceful Degradation

- Each link fetch is wrapped in try/catch
- Failures are recorded in the enrichment file with the error reason
- The function continues with remaining links
- `EnrichResult` reports which links succeeded and which failed
- A ticket with zero successful fetches still gets an enrichment file noting what failed

### New CLI Command: `kanban-cli enrich <ticket-path>`

- Registered in the CLI command tree alongside `jira-import`, `sync`, `validate`
- Loads config, creates executor, calls `enrichTicket()`
- Outputs summary to stdout: fetched N/M links successfully

---

## 4. Convert-Ticket Skill Update

### Changes to `skills/convert-ticket/SKILL.md`

Insert new Step 1.5 between "Read Ticket Context" and "Brainstorm Stage Breakdown":

**Step 1.5: Enrich Ticket Context**

1. Check if the ticket has `source: jira` and a `jira_key`
2. If yes, run `kanban-cli enrich <ticket-path>`
3. Read the generated `-enrichment.md` file
4. Include enrichment content as additional brainstormer context

**Behavior:**
- If enrichment fails or has partial results, brainstormer still receives available context
- If no `jira_links` or not a Jira-sourced ticket, skip enrichment entirely
- Enrichment is additive, never blocking

### Updated Brainstormer Context Assembly

1. Ticket frontmatter (id, title, epic, depends_on, etc.)
2. Ticket markdown body (description, requirements)
3. Parent epic context
4. **NEW: Enrichment file content** (fresh Jira data + linked content)

---

## 5. Testing Strategy

### Schema Extension Tests

In existing `tests/cli/logic/jira-import.test.ts`:
- `getTicket()` response with links is parsed correctly
- `getTicket()` response without links defaults to `[]`

### jira-import Link Population Tests

In existing `tests/cli/logic/jira-import.test.ts`:
- Ticket import with links → frontmatter contains `jira_links` array
- Ticket import without links → no `jira_links` in frontmatter (defaults via schema)
- Various link types (confluence, jira_issue, attachment, external)

### Enrich-Ticket Unit Tests

New `tests/cli/logic/enrich-ticket.test.ts`:
- Enrichment with mocked executor (Jira re-pull, linked issue fetch)
- Enrichment with mocked Confluence script spawn
- Graceful degradation: link fetch fails, enrichment continues
- Empty `jira_links` → early return, no enrichment file
- Enrichment file format and content structure
- Non-Jira ticket → skip enrichment

### Enrich CLI Command Tests

In new or existing command test file:
- Command registration and argument parsing
- End-to-end with mock executor

### Mock Reader Script Updates

- Update `tests/fixtures/jira/mock-reader.ts` to optionally return link data
- New mock fixture: `mock-reader-with-links.ts` for explicit link testing

### Invariants

- All 703 existing tests pass unchanged
- `npm run verify` passes after every task

---

## 6. File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/jira/schemas.ts` | Modify | Add optional `links` to `jiraTicketDataSchema` |
| `scripts/jira/default-jira-reader.ts` | Modify | Extract links from Jira API response |
| `src/cli/logic/jira-import.ts` | Modify | Populate `jira_links` in ticket frontmatter |
| `src/cli/logic/enrich-ticket.ts` | **New** | Enrichment logic module |
| `src/cli/commands/enrich.ts` | **New** | CLI command registration |
| `skills/convert-ticket/SKILL.md` | Modify | Add enrichment step before brainstorming |
| `tests/cli/logic/enrich-ticket.test.ts` | **New** | Enrichment unit tests |
| `tests/cli/logic/jira-import.test.ts` | Modify | Add link population tests |
| `tests/fixtures/jira/mock-reader.ts` | Modify | Support optional link data |
| `tests/fixtures/jira/mock-reader-with-links.ts` | **New** | Mock reader returning links |
