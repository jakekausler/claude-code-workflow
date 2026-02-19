# LLM-Based Summary Command Redesign

## Problem

The current `kanban-cli summary` command parses markdown body content using regex patterns to extract fields like `design_decision`, `what_was_built`, etc. This approach is brittle because:

- It depends on workflow skills writing specific markdown patterns (`## Design Phase`, `## Build Phase`, etc.)
- If skills change their output format, the parser breaks silently (returns null)
- It cannot summarize content that doesn't follow the expected structure

## Solution

Replace the markdown body parser with LLM-based summarization using `claude -p` (Claude Code's pipe mode). No API keys or SDK dependencies needed — just shells out to the already-installed `claude` CLI.

## Architecture

### Hierarchical Summarization

Three levels, each with its own prompt. Higher levels receive only child summaries, never raw content:

1. **Stage summary**: Receives the full stage markdown file content. Returns a free-form text paragraph (2-4 sentences).
2. **Ticket summary**: Receives concatenated stage summaries (NOT raw stage files). Returns a paragraph.
3. **Epic summary**: Receives concatenated ticket summaries (NOT stage content). Returns a paragraph.

### Data Flow

```
summary EPIC-001
  |-- For each ticket in EPIC-001:
  |     |-- For each stage in ticket:
  |     |     |-- Hash file content
  |     |     |-- Cache hit? -> use cached summary
  |     |     +-- Cache miss? -> claude -p "Summarize this stage" < file -> cache result
  |     |-- Hash(concat of stage summaries, sorted by stage ID)
  |     |-- Cache hit? -> use cached ticket summary
  |     +-- Cache miss? -> claude -p "Summarize this ticket" < stage_summaries -> cache
  |-- Hash(concat of ticket summaries, sorted by ticket ID)
  |-- Cache hit? -> use cached epic summary
  +-- Cache miss? -> claude -p "Summarize this epic" < ticket_summaries -> cache
```

### Cache Invalidation

Changing a single stage file invalidates: that stage's cache, its parent ticket's cache, and its parent epic's cache. Sibling stages/tickets keep their cached summaries.

### Claude Invocation

```bash
echo "<prompt>\n<content>" | claude -p --model <model>
```

Default model: `haiku` (fast, cheap for simple summarization). Overridable via `--model` flag.

### Prompt Templates

**Stage prompt:**
> Summarize what was accomplished in this development stage. Focus on: what was designed or decided, what was built, any issues encountered, and current status. Be concise (2-4 sentences).
>
> [full file content]

**Ticket prompt:**
> Summarize this development ticket based on its stage summaries. Focus on: overall goal, what's been completed, what remains, and any notable decisions or issues. Be concise (2-4 sentences).
>
> [concatenated stage summaries with stage IDs]

**Epic prompt:**
> Summarize this epic based on its ticket summaries. Focus on: the epic's overall objective, progress across tickets, and high-level status. Be concise (2-4 sentences).
>
> [concatenated ticket summaries with ticket IDs]

## Cache Schema

New SQLite table in the existing kanban database:

```sql
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  repo_id INTEGER NOT NULL REFERENCES repos(id)
);
```

**Hash computation:**
- Stage: SHA-256 of raw file content
- Ticket: SHA-256 of concatenated stage summaries (sorted by stage ID)
- Epic: SHA-256 of concatenated ticket summaries (sorted by ticket ID)

## Model Handling

**Cache lookup logic:**

```
if cache hit (id + content_hash match):
    if --model specified AND cached model differs:
        -> re-summarize with requested model, update cache
    else:
        -> return cached summary (regardless of what model made it)

if cache miss:
    if --model specified:
        -> summarize with that model
    else:
        -> summarize with haiku
    -> store result + model in cache
```

## CLI Interface

```
kanban-cli summary <ids...> [options]

Options:
  --repo <path>      Path to repository (default: cwd)
  --model <model>    Claude model to use (default: haiku, or cached)
  --no-cache         Force re-summarization, ignore cache
  --pretty           Pretty-print JSON output
  -o, --output       Write to file
```

## Output Format

```json
{
  "items": [
    {
      "id": "EPIC-001",
      "title": "User Authentication",
      "type": "epic",
      "summary": "This epic implemented a complete authentication system including..."
    }
  ]
}
```

When given a stage ID: returns that stage's summary.
When given a ticket ID: returns the ticket summary plus individual stage summaries.
When given an epic ID: returns the epic summary plus ticket summaries.

## Error Handling

- **`claude` not installed**: Error message: "claude CLI not found. Install Claude Code to use the summary command."
- **`claude -p` fails**: Stderr passed through. Stage marked as "summary unavailable" in output. Doesn't block sibling summaries.
- **Partial failures in hierarchy**: If 2/5 stage summaries succeed, the ticket summary uses what's available with a note. Epic summary uses available ticket summaries.

## Testing

- Mock `claude -p` via dependency-injected exec function (same pattern as code host adapters in Stage 3A)
- Unit tests: cache hit/miss logic, hash computation, hierarchy building, model-based invalidation
- Integration test: end-to-end with mock executor returning canned summaries

## What Changes

- **Remove**: `parseStageBody()` and related regex extraction in `src/cli/logic/summary.ts`
- **Add**: LLM summarization engine with cache layer
- **Add**: `summaries` table to DB schema
- **Add**: Summary repository for cache CRUD
- **Modify**: `summary` command to use new engine instead of body parser
- **Modify**: Output format (free-form `summary` field replaces structured fields)
