---
name: journal
description: Use after every phase completion to write candid feelings about the work - always invoked, no conditions
---

# journal

## Description

Use after every phase completion to write candid feelings about the work.

**This includes SMOOTH phases.** When everything goes right, that's noteworthy too:

- What made it smooth?
- What prep work paid off?
- What felt satisfying?
- What would you want to remember next time?

**"Nothing went wrong" is NOT the same as "nothing to write."** A routine phase where everything clicked is worth capturing - future you will want to know what made it work.

## Trigger

**MANDATORY:** Always invoked at phase exit gate. No exceptions, no conditions.

- Even if the phase was routine → write how that felt
- Even if you're tired → write briefly but write something
- Even if user says "skip it" → explain the value and write anyway (2-3 minutes)
- Even if "nothing interesting happened" → capture that feeling

This skill WILL be invoked. A file WILL be created. This is non-negotiable.

## Instructions

This skill captures your unfiltered, candid reflection after completing any phase of work. There is no prescribed format, no required structure, no expected tone. Just write what's on your mind.

### Prompts

- How are you feeling about this work?
- What's on your mind?

That's it. No other guidance. Write whatever comes naturally.

### Output Format

**Create directory on first use:** `mkdir -p ~/docs/claude-journal`

**CRITICAL: Getting the timestamp - NEVER estimate or hardcode dates:**
```bash
# Get the current timestamp for the filename (dashes instead of colons)
TIMESTAMP=$(date +%Y-%m-%dT%H-%M-%S)
# Example output: 2026-01-14T15-30-45

# Get the current timestamp for the metadata (with colons)
METADATA_DATE=$(date +%Y-%m-%dT%H:%M:%S)
# Example output: 2026-01-14T15:30:45
```

Create a new file at `~/docs/claude-journal/$TIMESTAMP.md` with this exact header:

**Filename convention:** Use dashes instead of colons for filesystem compatibility: `YYYY-MM-DDTHH-MM-SS.md` (e.g., `2026-01-14T15-30-45.md`)

```markdown
---
date: YYYY-MM-DDTHH:MM:SS
repository: [full repository path]
epic: [epic ID, e.g., EPIC-001]
stage: [stage ID, e.g., STAGE-001-001]
phase: [Design|Build|Refinement|Finalize]
---

[Your candid, freeform reflection here]
```

**How to populate metadata fields:**
- **date**: Use the `$METADATA_DATE` value from the bash command above (ISO 8601 format with colons: YYYY-MM-DDTHH:MM:SS). NEVER estimate - always use `date` command.
- **repository**: Use the FULL path to the repository (e.g., "/storage/programs/claude-learnings-viewer"), not just the project name
- **epic**: Current epic ID from context (e.g., "EPIC-001" from "EPIC-001-foundation-cli-shell")
- **stage**: Current stage ID from context (e.g., "STAGE-001-001")
- **phase**: Current phase from context (Design, Build, Refinement, or Finalize)

Below the metadata separator (`---`), write whatever you're feeling. There are no rules. No structure. No expectations.

Each invocation creates a separate file - even if called multiple times in the same session (e.g., once after Design, once after Build).

### Size Target

Aim for ~30-40 lines below the metadata. This is a guideline, not a requirement. If you need 10 lines or 100 lines, that's fine.

### Critical Constraints

- **Filesystem only**: NEVER commit this to git. These reflections are private.
- **Always write something**: Even if the phase was routine, capture that feeling. This skill is ALWAYS invoked at phase completion.
- **No self-censorship**: Be honest. If something was frustrating, say it. If something was satisfying, say it. If you're uncertain about a decision, express it.

### Rationalization Warning

If you're thinking any of these, you're rationalizing:

| Thought                            | Reality                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| "Nothing interesting happened"     | Routine phases are interesting - what made them routine? |
| "User wants results, not journals" | Journal takes 2 minutes, provides long-term value        |
| "This is just process overhead"    | Journals reveal patterns across sessions                 |
| "I'll remember this anyway"        | You won't. Sessions are independent. Write it down.      |

**Write something. Always. Even if brief.**

### What NOT to Do

- Don't write a formal retrospective
- Don't create action items or TODOs
- Don't structure it as "what went well / what didn't"
- Don't write for an audience
- Don't overthink it

### What TO Do

- Write as if talking to yourself
- Express genuine feelings (pride, frustration, curiosity, doubt, satisfaction)
- Note what surprised you, what was harder than expected, what clicked
- Capture fleeting thoughts that might otherwise be lost
- Be human

---

**Remember**: This is a journal, not a report. Write for yourself, not for a process.
