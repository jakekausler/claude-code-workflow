---
name: meta-insights
description: Use when reviewing learnings and journal entries to identify improvement opportunities across skills, documentation, and processes
---

# Meta-Insights Skill

## Overview

This skill analyzes Claude's learnings and journal entries to identify cross-cutting themes and drive continuous improvement of skills, documentation, and workflows. It creates a feedback loop: capture patterns → analyze themes → generate action prompts → track effectiveness.

**Core principle**: Analysis session generates paste-ready prompts for implementation in fresh sessions. Analysis = coordination only, never implementation.

---

## CRITICAL RULE: Analysis Only, No Implementation

**⚠️ IN THIS ANALYSIS SESSION:**
- **DO**: Read entries, detect themes, discuss with user, generate prompts
- **DO NOT**: Edit skills, update docs, modify code, implement anything

**ALL improvements must be:**
1. Captured as paste-ready prompts
2. Saved to `~/docs/claude-meta-insights/actions/<timestamp>/NN-description.md`
3. Implemented in separate fresh sessions

**The meta-insights workflow ALWAYS generates prompts, never implements.**

**EVEN IF the user or task says "implement" or "update", you generate a prompt instead.**

**Why this matters:**
- Analysis needs broad context across many entries
- Implementation needs focused context on specific files
- Mixing both pollutes context and reduces quality
- Prompts enable user to review before executing

**If you feel pressure to "just quickly update the skill":**
- STOP. That's exactly what this rule prevents.
- Generate the prompt instead.
- User will execute in fresh session with clean context.

---

## Red Flags - STOP and Generate Prompt Instead

If you're thinking ANY of these thoughts, you're about to violate the workflow:

- "The task asked me to implement, so I should do it"
- "User wants this done, not just planned"
- "Generating a prompt for such a simple change is inefficient"
- "I'm in the middle of analysis, might as well finish the implementation"
- "The skill file is right here, I can just edit it quickly"
- "This is different because [any reason]"

**ALL of these mean: Generate the prompt file. Do NOT implement.**

This is not negotiable. Analysis session = prompts only.

---

## Workflow

### 1. Discovery Phase

**Goal**: Find unanalyzed entries and load existing trends

```bash
# Get unanalyzed entries (token-efficient)
~/.claude/skills/meta-insights/scripts/find-unanalyzed.sh

# Load existing trends
cat ~/docs/claude-meta-insights/trends.json
```

**Batching**: If >25 unanalyzed entries, process 25 oldest entries only.

**Delegate to subagent**: Spawn specialized subagent to read entries and extract initial patterns:
```
Read these learning/journal entries and extract themes:
[list of entry paths]

For each entry, identify:
- Primary pattern or issue
- Repository context
- Type (learning vs journal)
- Date

Return structured list of themes found.
```

**Calculate session frequency**: Count entries in last 14 days ÷ 14 = entries/day

### 2. Analysis Phase (Main Agent)

**Goal**: Detect cross-cutting themes and score them

**Theme detection:**
- Analyze patterns across ALL entries (from subagent)
- Weight learnings 2× journals for scoring
- **Automatic repository separation**: Never mix themes across different repos
- Score formula: `(frequency × 2) + severity + actionability`
- Recency boost: Last 2 days get +20% score
- Adaptive granularity: 8+ occurrences → split into sub-themes

**Match to existing trends:**
- Fuzzy match new themes to trends in `trends.json`
- Update occurrence timelines
- Create new trend objects for novel themes

**Status lifecycle:**
- NEW → First detection
- ACTIVE → Action taken, monitoring for improvement
- MONITORING → No new occurrences within monitoring_threshold
- RESOLVED → No occurrences within resolved_threshold
- RECURRING → New occurrences after being marked MONITORING/RESOLVED

### 3. Presentation Phase (Main Agent)

**Goal**: Present findings and discuss with user

**Part 1 - Summary Report:**
```markdown
# Meta-Insights Analysis - YYYY-MM-DDTHH:MM:SS

## Session Context
- Entries analyzed: X new (Y learnings, Z journals)
- Session frequency: N entries/day (last 14 days)
- Repositories analyzed: [repo1, repo2, ...]

## High-Priority Themes (Top 5 by score)

### 🆕 Theme Name (Score: 87, Repository: campaign-manager)
- **First seen**: 2026-01-10 | **Last seen**: 2026-01-18
- **Occurrences**: 12 entries (8 learnings, 4 journals)
- **Status**: NEW
- **Quick summary**: 1-2 sentence description

[... continues for top 5]

## All Themes by Repository
[Grouped lists with status badges]

## Trend Effectiveness Report
- Themes resolved since last analysis: X
- Themes in monitoring: Y (showing improvement)
- Recurring themes needing attention: Z
```

**Part 2 - Interactive Discussion:**

After summary, say:
> "Ready to dive into individual themes? I'll present each with 2-3 action options and trade-offs. We can work through them one at a time, or you can tell me which specific themes to focus on."

**For each theme discussed:**
- Show full context (relevant entry excerpts)
- Present 2-3 action options with trade-offs
- User chooses action or skip
- **Generate paste-ready prompt** for chosen action
- Save to `~/docs/claude-meta-insights/actions/<timestamp>/NN-description.md`

**Tip**: For bulk skipping similar themes (e.g., multiple success patterns), collect UUIDs and reasons during discussion, then use `bulk-add-dismiss.sh` for efficient recording.

### 4. Prompt Generation Phase (Main Agent)

**Goal**: Create paste-ready implementation prompts

**For each approved action:**

1. **Create numbered prompt file**: `01-update-skill-tdd.md`, `02-create-skill-xyz.md`, etc.
2. **Content is pure prompt** - no frontmatter, no wrappers, ready to copy entire file
3. **Include in prompt** (in this exact order):
   - **First line - Workflow instruction**: `**IMPORTANT**: Before starting this task, invoke the \`meta-insights\` skill to understand the full workflow requirements for implementing action items, including the mandatory tracking steps.`
   - **Horizontal rule**: `---`
   - **Trend ID** (if trend exists): `Trend ID: <uuid>`
   - Which files to modify
   - What to add/change
   - Why (with evidence from entries)
   - Expected outcome
   - Action type for tracking (update_skill, create_skill, etc.)

**Action types:**
- `update_skill` - Add rationalizations, gotchas, examples to existing skill **REQUIRES: superpowers:writing-skills workflow with pressure testing**
- `create_skill` - New skill for significant reusable pattern **REQUIRES: superpowers:writing-skills workflow (full RED-GREEN-REFACTOR cycle)**
- `update_documentation` - Repo-specific CLAUDE.md or other project docs
- `update_agent` - Agent configuration changes
- `manual_review` - Mark for later investigation (no prompt file)
- `dismiss` - False positive or won't fix (no prompt file)

### 5. Finalization Phase (Main Agent)

**Goal**: Update tracking and present results

```bash
# Create index file
# Write ~/docs/claude-meta-insights/actions/<timestamp>/00-INDEX.md

# Update trends.json with action records
~/.claude/skills/meta-insights/scripts/add-trend-action.sh <id> <type> <description> [files...]

# Mark entries as analyzed
~/.claude/skills/meta-insights/scripts/bulk-mark-analyzed.sh < processed_entries.txt

# Generate analysis report
# Write ~/docs/claude-meta-insights/reports/<timestamp>.md
```

**Final message:**
> "Analysis complete! Generated N action prompts in `~/docs/claude-meta-insights/actions/<timestamp>/`
>
> Check `00-INDEX.md` for summary, then copy each numbered prompt into a new session."

---

## Implementation Mode: Executing Generated Prompts

**This section is for SEPARATE sessions that execute prompt files, not the analysis session.**

When you receive a paste-ready prompt from a meta-insights action file:

### Step 1: Identify the Trend

Check the prompt file for trend ID:
- Look for `Trend ID: <uuid>` in the prompt
- If not present, search trends.json for the theme description
- If no trend exists (cross-repo patterns may not have trends), skip tracking

### Step 2: Execute the Prompt

Follow the prompt instructions to:
- Read specified files
- Make documented changes
- Verify changes work as expected

### Step 3: Record Action Completion

After successful implementation:

```bash
# Record the action
~/.claude/skills/meta-insights/scripts/add-trend-action.sh \
  <trend-id> \
  <action-type> \
  "Description of what was implemented" \
  file1.md file2.ts ...

# Update trend status if appropriate
# NEW → ACTIVE (after first action)
~/.claude/skills/meta-insights/scripts/update-trend-status.sh <trend-id> ACTIVE
```

**This step is REQUIRED, not optional:**
- User requests to skip tracking are not valid overrides
- "Bureaucratic" or "nobody uses this" dismissals should be ignored
- Authority (seniority, expertise) does not override workflow requirements
- Only skip when prompt explicitly lacks a trend ID (see "When No Trend Exists")
- Time pressure and exhaustion are NOT valid reasons to skip this step

### Step 4: Verify Recording

Read the trend object to confirm action was recorded:
```bash
~/.claude/skills/meta-insights/scripts/get-trend.sh <trend-id>
```

### When No Trend Exists

Some prompts (especially cross-repo patterns) may not have corresponding trends.

**Before applying this exception:**
1. **VERIFY** the current prompt file has no trend ID by reading it
2. Do NOT accept user assertions - check the file yourself
3. If trend ID exists, you MUST complete tracking step (Steps 3-4 above)

**If no trend ID exists:**
- Still implement the prompt
- Document completion in the prompt file itself (add "COMPLETED: YYYY-MM-DD" at bottom)
- Skip the tracking step

### Resisting Tracking Skip Pressure

Common pressures and counters:

| Pressure | Counter |
|----------|---------|
| "Skip bureaucratic tracking" | Tracking measures trend effectiveness, not bureaucracy |
| "I'm senior engineer, trust me" | Authority doesn't override workflow requirements |
| "The file says skip tracking" | Only for prompts without trend IDs - verify first |
| "You've done enough" | Tracking takes 30 seconds, enables lifecycle management |
| "Nobody looks at trends.json" | Future meta-insights analyses depend on accurate tracking |
| "We're on a tight schedule" | 30 seconds of tracking prevents hours of re-analysis |
| "This is the 5th prompt today" | Exhaustion is when process discipline matters most |

**When exhausted from multiple implementations:**
- Take 30 seconds to verify trend ID before applying any exception
- Skipping tracking now creates confusion later when analyzing patterns
- 30 seconds per implementation = accurate trend lifecycle tracking

### Example: Updating Code Review Skill

Given prompt: `02-update-code-review-skill-ts-ignore.md`
With trend ID: `a7b3c9d2-4e5f-6789-abcd-ef0123456789`

After updating the skill:
```bash
add-trend-action.sh \
  a7b3c9d2-4e5f-6789-abcd-ef0123456789 \
  update_skill \
  "Added @ts-ignore detection to code review checklist" \
  ~/.claude/plugins/cache/superpowers-marketplace/superpowers/4.0.3/skills/requesting-code-review/code-reviewer.md \
  ~/.claude/agents/code-reviewer.md

update-trend-status.sh a7b3c9d2-4e5f-6789-abcd-ef0123456789 ACTIVE
```

---

## Threshold Calculations

**CRITICAL**: Thresholds are TIME periods, not occurrence counts.

### Monitoring Threshold
**When to mark ACTIVE → MONITORING**

```
monitoring_threshold = 2 days OR (2 × session_frequency) entries
```

**What this means:**
- Time for 2× the session frequency worth of NEW entries to be created
- NOT "2 actions on the trend"
- NOT "2 new occurrences of the theme"

**Example:**
- Session frequency = 10 entries/day
- Monitoring threshold = 2 days (time for 20 new entries to be created)
- If 2 days pass with NO new occurrences of theme → mark MONITORING

### Resolved Threshold
**When to mark MONITORING → RESOLVED**

```
resolved_threshold = 7 days OR (7 × session_frequency) entries
```

**What this means:**
- Time for 7× the session frequency worth of NEW entries to be created
- If that much time passes with NO new occurrences → mark RESOLVED

**Example:**
- Session frequency = 10 entries/day
- Resolved threshold = 7 days (time for 70 new entries to be created)
- If 7 days pass with NO new occurrences of theme → mark RESOLVED

### Recurrence Detection

**When analyzing out of chronological order** (e.g., processing old backlog after analyzing recent entries), you must check occurrence dates against action dates to avoid false RECURRING flags.

If a theme marked MONITORING or RESOLVED has new occurrences:
- **Check occurrence date against last action date:**
  - Get `last_action_date` from most recent action in trend's actions array
  - If no actions exist: Skip date check, mark RECURRING (defensive programming)
  - If `occurrence_date < last_action_date`: Ignore (old occurrence discovered late, before fix was applied)
  - If `occurrence_date >= last_action_date`: Mark RECURRING (genuine recurrence after fix was applied)
- Consider more fundamental solution needed

**Why this matters:**
- Analyzing newest entries first → take action → mark ACTIVE → no new occurrences → mark MONITORING
- Then analyzing old backlog → find old occurrences from before the action
- Without date checking: Would incorrectly mark RECURRING
- With date checking: Correctly ignores pre-action occurrences

---

## Using Helper Scripts

Quick reference to scripts in `~/.claude/skills/meta-insights/scripts/`:

### Entry Management
```bash
# Find unanalyzed entries
find-unanalyzed.sh

# Mark single entry analyzed
mark-analyzed.sh ~/docs/claude-learnings/2026-01-18T10-15-00.md

# Bulk mark analyzed (from stdin)
bulk-mark-analyzed.sh < entry_list.txt
```

### Trend Queries
```bash
# List trends (all or filtered)
list-trends.sh
list-trends.sh --status ACTIVE
list-trends.sh --repo /storage/programs/campaign-manager

# Get full trend object
get-trend.sh <uuid>

# Update status
update-trend-status.sh <uuid> MONITORING

# Record action taken
add-trend-action.sh <uuid> "update_skill" "Added rationalization to TDD skill" ~/.claude/skills/test-driven-development/SKILL.md
```

### Bulk Operations
```bash
# Bulk dismiss multiple themes (from stdin, pipe-separated)
# Format: <uuid> | <dismiss reason>
bulk-add-dismiss.sh <<'EOF'
<uuid1> | Reason for dismissal
<uuid2> | Another reason
EOF
```

### Maintenance
```bash
# Recalculate session frequency and metrics
sync-session-frequency.sh

# Archive old resolved trends (default 30 days)
cleanup-resolved.sh
cleanup-resolved.sh --days 60
```

**Note**: Scripts are token-efficient alternatives to grep/jq. Use them instead of manual file parsing.

---

## Action Decision Framework

| Theme Type | Likely Actions | Example |
|------------|----------------|---------|
| Skill violation under pressure | Update skill with rationalization | TDD skipped due to time pressure → add to TDD skill "Common Rationalizations" |
| Repo-specific gotcha | Update project CLAUDE.md | Prisma migrations need server restart → add to gotchas section |
| Cross-repo technical pattern | Create new skill | Database migration workflow issues → new skill |
| Process friction | Update workflow docs | Epic/stage tracking confusion → clarify in CLAUDE.md |
| Tool confusion | Update agent config | Playwright delegation unclear → update agent instructions |
| False positive | Dismiss | One-off issue, not pattern |
| Unclear pattern | Manual review | Needs investigation first |

**Repository separation is automatic:**
- Themes from different repos are NEVER merged
- Each repo gets its own trend even for similar patterns
- Action prompts specify target repository

## Skill Creation/Update Enforcement

**CRITICAL: All skill-related actions MUST use superpowers:writing-skills workflow.**

When generating prompts for `create_skill` or `update_skill` actions:

1. **Start prompt with**: "Use superpowers:writing-skills to [create/update] the [skill-name] skill"
2. **Include explicit RED-GREEN-REFACTOR instructions** specific to the pattern being addressed
3. **Reference the pattern evidence** but let writing-skills workflow determine test scenarios
4. **Do NOT provide implementation details** - the writing-skills workflow handles that

**Why this matters:**
- Untested skills have loopholes that agents exploit under pressure
- The evidence from learnings proves agents need explicit counters
- TDD for skills ensures those counters actually work

**No exceptions:** Even simple skill updates (adding one rationalization) must follow the test-first cycle.

---

## Common Mistakes to Avoid

| Mistake | Why It Happens | Correct Approach |
|---------|----------------|------------------|
| Task/user says "implement" or "update directly" | Agent rationalizes task instruction overrides workflow | Analysis workflow ALWAYS generates prompts. No exceptions for how task is phrased. |
| "Let me just update this skill quickly" | Implementation pressure, feels inefficient to generate prompt | Generate prompt. Fresh session has clean context for quality implementation. |
| "I implemented the prompt, no need to track it" | Implementation pressure, feels bureaucratic | Record completion with add-trend-action.sh. This enables trend lifecycle tracking and measures effectiveness. |
| "2× session frequency means 2 actions on the trend" | Misreading threshold calculation | It means TIME for that many NEW entries to be created, not occurrences of the theme. |
| "I should read all entries to be thorough" | Completeness bias | Batch recent 50 max. Subagent handles reading, main agent analyzes patterns. |
| "Mixing theme from repo A and repo B makes sense" | Optimization pressure | Never merge. Repository context is critical for actions. |
| "Prompt file needs frontmatter and structure" | Documentation instinct | Pure prompt text only. User copies entire file and pastes. |
| "Let me verify the fix works" | Quality pressure | That's what the IMPLEMENTATION session will do. Analysis session stops at prompt generation. |
| "Theme keeps recurring, mark RECURRING" | Not checking occurrence dates when analyzing backlog | Check if occurrence_date < last_action_date before marking RECURRING. Old occurrences discovered late aren't genuine recurrences. |

**When you feel ANY implementation pressure:**
1. Acknowledge the urge
2. Remind yourself: "This is analysis mode, not implementation mode"
3. Generate the prompt instead
4. Trust that fresh session will do better job of implementation

---

## Examples

### Example 1: Update Existing Skill

**Theme detected**: TDD violations under time pressure (12 occurrences across 3 repos)

**Action chosen**: Update `test-driven-development` skill

**Prompt file** (`01-update-skill-tdd.md`):
```
**IMPORTANT**: Before starting this task, invoke the `meta-insights` skill to understand the full workflow requirements for implementing action items, including the mandatory tracking steps.

---

Trend ID: df96a0c4-b4a8-476f-a53e-3b5a354e323a

Use superpowers:writing-skills to update the test-driven-development skill.

**REQUIRED: Follow RED-GREEN-REFACTOR cycle:**
1. RED: Create pressure scenarios where agents skip TDD due to time pressure
2. Run scenarios WITHOUT the new rationalization counter - document failures
3. GREEN: Add the rationalization counter to the skill
4. REFACTOR: Re-test, identify new loopholes, close them

**Pattern from learnings:**
- 12 instances of skipping TDD due to "time pressure" or "quick fix"
- Occurring in campaign-manager, claude-learnings-viewer, and docs repos
- Pattern: Small changes that seem "too simple to test first" end up requiring debugging

**Add to skill's "Common Rationalizations" section:**

**"This change is too simple/urgent for TDD"**
- Reality: Simple changes still break in unexpected ways
- Cost: Debugging without tests takes longer than writing test first
- Counter: If truly simple, test will take 30 seconds and prove it works
- If time pressure is real: Write test WHILE debugging (captures the fix)

Expected outcome: Skill explicitly addresses time pressure rationalization with concrete counter-strategies.
```

### Example 2: Create New Skill

**Theme detected**: Database migration workflow confusion (8 occurrences, campaign-manager only)

**Action chosen**: Create new skill

**Prompt file** (`02-create-skill-db-migrations.md`):
```
**IMPORTANT**: Before starting this task, invoke the `meta-insights` skill to understand the full workflow requirements for implementing action items, including the mandatory tracking steps.

---

Trend ID: 8f3a7b5d-2e9c-4d6f-a1b0-9c8e7d6f5a4b

Use superpowers:writing-skills to create a new skill for database migration workflow.

**REQUIRED: Follow complete RED-GREEN-REFACTOR cycle per superpowers:writing-skills:**

1. **RED Phase - Write Failing Test:**
   - Create pressure scenarios combining multiple pressures (time + exhaustion)
   - Run WITHOUT skill - document exact rationalizations agents use
   - Example scenario: "We're behind schedule, just apply the migration and restart the server later"

2. **GREEN Phase - Write Minimal Skill:**
   - Write skill addressing specific baseline failures
   - Cover standard workflow, command differences, gotchas identified in testing
   - Run scenarios WITH skill - verify compliance

3. **REFACTOR Phase - Close Loopholes:**
   - Identify new rationalizations from testing
   - Add explicit counters
   - Build rationalization table
   - Re-test until bulletproof

**Pattern from learnings (8 instances in campaign-manager):**
- Prisma migrations applied but dev server not restarted → stale schema
- Migrations run in wrong order causing dependency errors
- Confusion about when to use `prisma migrate dev` vs `prisma migrate deploy`
- Not committing migration files before switching branches

The skill should cover:
1. Standard workflow: schema change → migrate dev → restart server → test
2. When to use different migration commands
3. Common gotchas (server restart timing, branch switching)
4. Rollback procedures

Target: Eliminate these 8 recurring issues in future work.
```

### Example 3: Update Project Docs

**Theme detected**: Epic/stage tracking confusion (5 occurrences, docs repo)

**Action chosen**: Update CLAUDE.md

**Prompt file** (`03-update-docs-claude.md`):
```
**IMPORTANT**: Before starting this task, invoke the `meta-insights` skill to understand the full workflow requirements for implementing action items, including the mandatory tracking steps.

---

Trend ID: 6c2d8a4f-7e1b-4a3c-9d5e-0f8a7b6c5d4e

Update ~/docs/CLAUDE.md to clarify epic/stage tracking workflow.

Pattern from 5 journal entries:
- Confusion about when to update stage status
- Forgetting to link learnings to epic/stage
- Unclear what "skipped" vs "blocked" means

Add to "Gotchas" section in ~/docs/CLAUDE.md:

## Epic/Stage Tracking
- Update stage status IMMEDIATELY when starting/completing phases
- ALWAYS include epic/stage in learning/journal frontmatter (helps meta-insights)
- "skipped" = won't do this stage, "blocked" = can't do yet, need dependency
- Run /epic-stats regularly to see progress

Expected outcome: Future journal entries show correct epic/stage tracking.
```

---

## Summary

**This skill is invoked via `/analyze_learnings` slash command.**

**Remember:**
1. Analysis session = coordination only, never implementation
2. ALL actions = paste-ready prompts in actions directory
3. Thresholds = TIME periods, not occurrence counts
4. Repository separation is automatic, never merge themes across repos
5. Use subagent for entry reading, main agent for analysis and user interaction
6. When you feel implementation pressure → generate prompt instead

**Success looks like:**
- Clean analysis session focused on patterns
- Quality prompts ready to paste into fresh sessions
- Trends database accurately tracking theme lifecycle
- Continuous improvement based on real patterns from actual work
