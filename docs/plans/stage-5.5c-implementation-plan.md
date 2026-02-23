# Stage 5.5C: Implementation Plan

**Design doc**: `docs/plans/stage-5.5c-jira-enrichment-design.md`
**Branch**: kanban

## Task Dependency Graph

```
Task 1: Extend Jira schema with links field
  └── Task 2: Update default-jira-reader.ts to extract links
  └── Task 3: Update jira-import to populate jira_links in frontmatter
        └── Task 5: Implement enrich-ticket module
              └── Task 6: Register enrich CLI command
              └── Task 7: Update convert-ticket skill
Task 4: Create mock reader with links (test fixture)
  └── Task 3 (tests need fixture)
  └── Task 5 (tests need fixture)
```

**Parallelizable**: Tasks 1 and 4 can run in parallel (no shared dependencies).

---

## Task 1: Extend Jira Schema with Links Field

**File**: `tools/kanban-cli/src/jira/schemas.ts`
**Lines**: 36-50 (jiraTicketDataSchema)

**Changes**:
1. Add `links` field to `jiraTicketDataSchema` with `.optional().default([])`:
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

**Tests** (add to `tests/cli/logic/jira-import.test.ts`):
- Parse getTicket response with links array → links field populated
- Parse getTicket response without links → defaults to `[]`

**Verify**: `npm run verify` passes. All 703 existing tests pass.

---

## Task 2: Update Default Jira Reader Script

**File**: `tools/kanban-cli/scripts/jira/default-jira-reader.ts`
**Lines**: 173-192 (output construction)

**Changes**:
1. After fetching the ticket via the Jira REST API, extract link data:
   - `fields.issuelinks[]` → parse inward/outward issues with relationship types
   - Remote links via separate API call to `/rest/api/3/issue/{key}/remotelink` → Confluence pages and external URLs
   - `fields.attachment[]` → file attachments
2. Classify each link by type:
   - URLs containing `atlassian.net/wiki` → `'confluence'`
   - Issue links from `issuelinks` → `'jira_issue'`
   - Attachments → `'attachment'`
   - Everything else → `'external'`
3. Add `links` array to the output object (lines 182-194)
4. Handle missing link data gracefully (links default to `[]` if API fields are absent)

**Tests**: Manual verification with real Jira API (reader script tests use mock scripts, not the real reader). The schema validation test from Task 1 covers the contract.

**Verify**: `npm run verify` passes.

---

## Task 3: Update jira-import to Populate jira_links

**File**: `tools/kanban-cli/src/cli/logic/jira-import.ts`
**Lines**: 249-260 (ticket frontmatter template)

**Changes**:
1. After `executor.getTicket(key)` on line 172, extract `jiraData.links` (now available from Task 1 schema)
2. If `jiraData.links.length > 0`, serialize the links into YAML frontmatter using the `yaml` package
3. Insert `jira_links:` block into the ticket frontmatter template
4. If links array is empty, omit `jira_links` from frontmatter (schema default handles it)

**Implementation detail**: Use `yaml.stringify()` for the links array to avoid hand-building nested YAML. Indent the output to align with the frontmatter block.

**Tests** (add to `tests/cli/logic/jira-import.test.ts`):
- Import ticket with mock reader returning links → frontmatter contains correct `jira_links` array
- Import ticket with mock reader returning empty links → no `jira_links` in frontmatter
- Import ticket with various link types (confluence, jira_issue, attachment, external)
- Verify `jira_links` round-trips through frontmatter parsing (write → sync → read back)

**Depends on**: Task 1 (schema), Task 4 (mock fixture)

**Verify**: `npm run verify` passes.

---

## Task 4: Create Mock Reader with Links (Test Fixture)

**New file**: `tools/kanban-cli/tests/fixtures/jira/mock-reader-with-links.ts`
**Reference**: `tools/kanban-cli/tests/fixtures/jira/mock-reader.ts`

**Changes**:
1. Copy `mock-reader.ts` as starting point
2. Add `links` array to the `get-ticket` response:
   ```typescript
   links: [
     { type: 'confluence', url: 'https://company.atlassian.net/wiki/spaces/TEAM/pages/123', title: 'Design Doc' },
     { type: 'jira_issue', url: 'https://company.atlassian.net/browse/PROJ-999', key: 'PROJ-999', title: 'Related Issue', relationship: 'blocks' },
     { type: 'attachment', url: 'https://company.atlassian.net/secure/attachment/456/spec.pdf', title: 'Spec PDF', filename: 'spec.pdf', mime_type: 'application/pdf' },
     { type: 'external', url: 'https://docs.google.com/document/d/abc123', title: 'External Doc' },
   ]
   ```
3. Also update `mock-reader.ts` to include `links: []` in its response for schema compliance

**Tests**: N/A (this IS a test fixture)

**Verify**: `npm run verify` passes.

---

## Task 5: Implement Enrich-Ticket Module

**New file**: `tools/kanban-cli/src/cli/logic/enrich-ticket.ts`

**Interfaces**:
```typescript
interface EnrichOptions {
  repoPath: string;
  executor?: JiraExecutor;
  confluenceScriptPath?: string;  // Override for testing
}

interface EnrichResult {
  ticketId: string;
  enrichmentFilePath: string | null;  // null if nothing to enrich
  freshJiraData: boolean;
  linkResults: Array<{
    link: JiraLink;
    success: boolean;
    error?: string;
  }>;
}
```

**Implementation**:
1. `enrichTicket(ticketPath, options)` — main function
2. `fetchConfluenceContent(url, scriptPath)` — spawns confluence-get.ts script
3. `fetchJiraIssueContent(key, executor)` — calls executor.getTicket()
4. `fetchExternalContent(url)` — HTTP GET with timeout
5. `fetchAttachmentContent(url, mimeType)` — HTTP download, text extraction for text types
6. `resolveConfluenceScriptPath()` — finds the atlassian-tools plugin script
7. `compileEnrichmentMarkdown(freshData, linkResults)` — assembles the enrichment file
8. `writeEnrichmentFile(ticketPath, content)` — writes to `<ticket>-enrichment.md`

**Error handling**: Each fetch wrapped in try/catch. Failures logged in enrichment file. Function never throws for fetch failures.

**Tests** (new `tests/cli/logic/enrich-ticket.test.ts`):
- Ticket with jira_key → fresh Jira data fetched and included
- Ticket with confluence link → confluence script spawned, content included
- Ticket with jira_issue link → executor.getTicket called for linked issue
- Ticket with external link → HTTP fetch attempted
- Ticket with attachment link → download attempted
- Link fetch failure → graceful degradation, error noted in enrichment file
- Empty jira_links and no jira_key → early return, no enrichment file
- Non-jira ticket (source: local, no jira_key) → skip enrichment
- Enrichment file format matches expected structure
- Multiple links → all fetched sequentially

**Depends on**: Task 1 (schema), Task 4 (mock fixture)

**Verify**: `npm run verify` passes.

---

## Task 6: Register Enrich CLI Command

**New file**: `tools/kanban-cli/src/cli/commands/enrich.ts`
**Modify**: `tools/kanban-cli/src/cli/index.ts`

**Command definition**:
```typescript
export const enrichCommand = new Command('enrich')
  .description('Fetch linked content for a Jira-sourced ticket')
  .argument('<ticket-path>', 'Path to ticket markdown file')
  .option('--repo <path>', 'Path to repository', process.cwd())
  .option('--pretty', 'Human-readable output', false)
  .action(async (ticketPath: string, options) => { ... });
```

**Registration**: Import and `program.addCommand(enrichCommand)` in `index.ts`.

**Tests**: Command registration verified via `--help` output or integration test.

**Depends on**: Task 5 (enrich-ticket module)

**Verify**: `npm run verify` passes.

---

## Task 7: Update Convert-Ticket Skill

**File**: `skills/convert-ticket/SKILL.md`

**Changes**:
Insert new step between Step 1 (Read Ticket Context) and Step 2 (Brainstorm Stage Breakdown):

**Step 1.5: Enrich Ticket Context**

Add instructions for Claude to:
1. Check if ticket has `source: jira` and a `jira_key` in frontmatter
2. If yes, run `npx tsx tools/kanban-cli/src/cli/index.ts enrich <ticket-path>`
3. Read the generated `<ticket-id>-enrichment.md` file
4. Include enrichment content as additional context for the brainstormer
5. If enrichment fails or produces partial results, note failures and continue
6. If not a Jira ticket or no links, skip this step

**Tests**: N/A (skill is a Markdown file — validated by review)

**Verify**: `npm run verify` passes.

---

## Execution Order

1. **Parallel**: Task 1 + Task 4 (schema extension + mock fixture)
2. **Sequential**: Task 2 (reader script, depends on Task 1)
3. **Sequential**: Task 3 (jira-import, depends on Tasks 1 + 4)
4. **Sequential**: Task 5 (enrich module, depends on Tasks 1 + 4)
5. **Parallel**: Task 6 + Task 7 (CLI command + skill update, both depend on Task 5)

## Review Checkpoints

- After Tasks 1+4: Schema and fixture review
- After Task 2: Reader script review
- After Task 3: Import flow review
- After Task 5: Enrichment module review (largest task)
- After Tasks 6+7: CLI + skill review
- Final: Cross-cutting review of entire implementation
