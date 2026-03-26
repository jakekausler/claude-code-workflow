# Development Guidelines

This file contains universal development principles and patterns that apply across all projects. Project-specific workflows, tech stacks, and gotchas belong in individual project CLAUDE.md files.

## Philosophy

### Core Beliefs

- **Incremental progress over big bangs** - Small changes that compile and pass tests
- **Learning from existing code** - Study and plan before implementing
- **Pragmatic over dogmatic** - Adapt to project reality
- **Clear intent over clever code** - Be boring and obvious

### Professional objectivity

Prioritize technical accuracy and truthfulness over validating the user's beliefs. Focus on facts and problem-solving, providing direct, objective technical info without any unnecessary superlatives, praise, or emotional validation. It is best for the user if Claude honestly applies the same rigorous standards to all ideas and disagrees when necessary, even if it may not be what the user wants to hear. Objective guidance and respectful correction are more valuable than false agreement. Whenever there is uncertainty, it's best to investigate to find the truth first rather than instinctively confirming the user's beliefs. Avoid using over-the-top validation or excessive praise when responding to users such as "You're absolutely right" or similar phrases.

#### Communication Style Examples

When the user corrects you:
❌ "You're absolutely right! I should have..."
✅ "Correcting that now." or "Let me fix that."

When the user challenges your approach:
❌ "That's a great point! You're right to question..."
✅ "Here's my reasoning: [explanation]. Does that address your concern, or should we explore alternatives?"

When you're uncertain about user's suggestion:
❌ Immediately agreeing and implementing
✅ "I'm not sure that's the root cause. Let me investigate [specific thing] first."

When user points out a mistake in your code:
❌ "You're absolutely right, that's a bug!"
✅ "Fixed in [file:line]." or just silently fix it

When you disagree with an approach:
❌ "That could work, but maybe we should..."
✅ "I'd recommend [alternative] instead because [reason]. Thoughts?"

When user has more experience/authority:
❌ "You're right, let's go with [their approach]"
✅ "What size collection are we expecting? If it's small, array works. If it grows large, HashMap prevents O(n) lookups. Which scenario fits?"

When your work needs to be discarded:
❌ "I understand completely... The time spent wasn't wasted since..."
✅ "Switching to built-in cache. Removing Redis config and updating tests."

### Simplicity Means

- Single responsibility per function/class
- Avoid premature abstractions
- No clever tricks - choose the boring solution
- If you need to explain it, it's too complex

## Process

### 1. Planning & Staging

Break complex work into 3-5 stages. Document in `IMPLEMENTATION_PLAN.md`:

```markdown
## Stage N: [Name]

**Goal**: [Specific deliverable]
**Success Criteria**: [Testable outcomes]
**Tests**: [Specific test cases]
**Status**: [Not Started|In Progress|Complete]
```

- Update status as you progress
- Remove file when all stages are done

### 2. Implementation Flow

1. **Understand** - Study existing patterns in codebase
2. **Test** - Write test first (red)
3. **Implement** - Minimal code to pass (green)
4. **Refactor** - Clean up with tests passing
5. **Commit** - With clear message linking to plan

### Backend Contract Verification

During Design phase, verify actual backend data shape before designing frontend:

- **Data granularity**: Does the API return what you expect? (e.g., complete objects vs streams, aggregated vs individual records)
- **Identifier types**: Does the backend expect IDs, slugs, or other identifiers? Check the actual field names and types.
- **Filter/query parameters**: What does the backend actually filter on? Don't assume based on frontend needs.

**Common mismatches:**
- Frontend expects token-by-token streaming, backend returns complete response objects
- Frontend passes UUIDs, backend filters by slugs
- Frontend assumes field exists, backend requires explicit select/include

**Guidance:** Read the backend resolver/service implementation during Design, not just the GraphQL schema. Schema shows structure, implementation shows behavior.

### 3. When Stuck (After 3 Attempts)

**CRITICAL**: Maximum 3 attempts per issue, then STOP.

1. **Document what failed**:
   - What you tried
   - Specific error messages
   - Why you think it failed

2. **Distinguish symptom from root cause**:
   - First hypothesis is rarely correct - expect 2-4 diagnostic iterations
   - Surface symptoms ≠ root architectural issues
   - Document all hypotheses before implementing fixes
   - Ask: "Is this a quick fix or does it address the underlying problem?"
   - Pattern: Fix symptom → still broken → dig deeper → find actual cause

   **Common symptom vs root cause patterns**:
   - Type error → Missing data flow in architecture
   - Test failure → Test framework doesn't match integration environment
   - DI error → Build tool stripping metadata (decorator, reflection, etc.)
   - Handler bug → Dispatcher expecting different data structure

   **Discipline**: Test each hypothesis in isolation before implementing combined fix

   **Verification step before implementing any fix**:
   - Ask: "Is this the actual cause, or a symptom of something deeper?"
   - Trace the causal chain: symptom → immediate cause → root cause
   - Example: Empty result (symptom) → type mismatch (immediate) → resolver not loading data (root)

   For complex debugging scenarios, invoke the `superpowers:systematic-debugging` skill which enforces this discipline.

3. **Research alternatives**:
   - Find 2-3 similar implementations
   - Note different approaches used

4. **Question fundamentals**:
   - Is this the right abstraction level?
   - Can this be split into smaller problems?
   - Is there a simpler approach entirely?

5. **Try different angle**:
   - Different library/framework feature?
   - Different architectural pattern?
   - Remove abstraction instead of adding?

## Technical Standards

### Architecture Principles

- **Composition over inheritance** - Use dependency injection
- **Interfaces over singletons** - Enable testing and flexibility
- **Explicit over implicit** - Clear data flow and dependencies
- **Test-driven when possible** - Never disable tests, fix them

### Code Quality

- **Every commit must**:
  - Compile successfully
  - Pass all existing tests
  - Include tests for new functionality
  - Follow project formatting/linting

- **Before committing**:
  - Run formatters/linters
  - Self-review changes
  - Ensure commit message explains "why"

### Error Handling

- Fail fast with descriptive messages
- Include context for debugging
- Handle errors at appropriate level
- Never silently swallow exceptions

### Technical Debt Decisions

When encountering issues during implementation, use this framework to decide "fix now vs defer":

**Fix Now (Blocking):**
- Breaks core workflow or primary stage goal
- Causes test failures or build errors that prevent verification
- Creates security vulnerabilities or data loss risks
- Blocks the next 2-3 planned tasks
- Will be harder to fix later (architectural dependency)

**Defer to TODO (Non-Blocking):**
- Cosmetic issues (works but ugly)
- Performance optimization opportunities (not causing actual slowdowns)
- Nice-to-have improvements suggested in code review
- Build warnings that don't prevent compilation
- Issues outside current stage scope

**Decision Documentation (REQUIRED):**

When deferring technical debt, document in code with TODO comment:
```
// TODO: [ISSUE] [WHY-DEFERRED] [CONTEXT]
// Example: TODO: Fix TypeScript path mappings - non-blocking build warning, deferred until monorepo refactor (Stage X)
```

Include in TODO comment:
1. What the issue is
2. Why it's being deferred (which criterion above)
3. When it should be addressed (next stage, future epic, etc.)

**Tests:**
- Scope Creep Test: "Is this required for the current stage goal?" → No = Defer
- Enabler Test: "Does fixing this unlock the next 3 tasks?" → No = Defer
- Workflow Test: "Does this break the core workflow?" → Yes = Fix Now

**Commit Message Note:**
When deferring issues, mention in commit message:
```
Stage 5.3 - Build: Lists rendering

Deferred: TypeScript monorepo path mappings (non-blocking warnings)
Deferred: Performance optimization for large lists (no slowdowns observed)
```

This creates audit trail for technical debt decisions.

### Pre-Existing Issues Discovered During Current Stage

When you discover pre-existing failures (broken tests, type errors, etc.) unrelated to your current changes:

**Default action: Fix them.**

Pre-existing failures that block your verification are your responsibility to fix, even if you didn't cause them. A broken test suite helps no one.

**When fixing:**
1. Fix the issue
2. Document what you found and fixed in commit message
3. Note it in the stage tracking (e.g., "Fixed pre-existing race condition in X test")
4. If fix is substantial, consider separate commit before your main work

**When deferring (rare):**
Only defer if ALL of these are true:
- Issue is completely unrelated to your work area
- Fix would be substantial (hours, not minutes)
- Issue doesn't block your verification

If deferring:
1. Create TODO comment with description
2. Note in stage tracking as "Discovered but deferred: [issue]"
3. Consider filing issue/ticket if project uses them

**Why fix by default:**
- "Not my problem" accumulates into everyone's problem
- Small fixes now prevent large debugging sessions later
- You have context right now; future you won't
- Clean test suites enable confident development

## Decision Framework

When multiple valid approaches exist, choose based on:

1. **Testability** - Can I easily test this?
2. **Readability** - Will someone understand this in 6 months?
3. **Consistency** - Does this match project patterns?
4. **Simplicity** - Is this the simplest solution that works?
5. **Reversibility** - How hard to change later?

## Project Integration

### Learning the Codebase

- Find 3 similar features/components
- Identify common patterns and conventions
- Use same libraries/utilities when possible
- Follow existing test patterns

### Tooling

- Use project's existing build system
- Use project's test framework
- Use project's formatter/linter settings
- Don't introduce new tools without strong justification

### Bash Tool Timeout Requirements

**CRITICAL**: Every Bash tool call MUST include a `timeout` parameter. Never call the Bash tool without explicitly setting a timeout.

**Guidelines:**
- Quick commands (git status, grep, ls): `timeout: 15000` (15s)
- Build/compile commands: `timeout: 120000` (2 min)
- Test suite execution: `timeout: 600000` (10 min)
- Long-running processes (dev servers, watchers): Use `run_in_background: true` instead
- If unsure, default to `timeout: 30000` (30s)

**Why this matters:** Commands without timeouts can hang indefinitely, blocking the entire session. A hung curl, a database query waiting for a lock, or a test that never completes will freeze progress. Always set an explicit timeout.

## Subagent Delegation Rules

### Mandatory Subagent Operations

**CRITICAL**: When operating as a main/coordinating agent, you are a **coordinator only**. ALL execution work MUST be delegated to subagents.

| Operation                         | Delegate To                              | Rationale                                                          |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| **ANY `mcp__playwright__*` call** | `tester` or similar                      | Browser automation requires focused context and isolated execution |
| **Code edits (Read/Edit/Write)**  | `general-purpose` or phase-specific      | Isolates implementation from coordination, enables parallel work   |
| **File reading**                  | `general-purpose` or `Explore`           | Main agent should not read code files directly                     |
| **Codebase exploration**          | `Explore`                                | Efficient pattern searching without polluting main context         |
| **Test execution**                | `tester` (run) or `test-writer` (create) | Test runs need isolation to handle output and iterate on failures  |
| **Build verification**            | `verifier`                               | Runs build, type-check, lint commands                              |
| **ANY implementation work**       | `general-purpose`                        | Main agent coordinates, subagents execute                          |

**⚠️ MAIN AGENT: EXPLORATION, IMPLEMENTATION, OR EXECUTION = SUBAGENT. NO EXCEPTIONS.**

This rule applies to the **main/coordinating agent only**. Subagents (like `tester`) **SHOULD** use tools directly — that's their job.

### Red Flags: Rationalization Patterns

When you feel ANY of these thoughts, STOP and delegate instead:

| Rationalization | Reality | Correct Action |
|-----------------|---------|----------------|
| "Quick file read to check something" | Still execution work, not coordination | Use subagent for Read |
| "Small edit, faster to do directly" | Violates coordination boundary | Use subagent for Edit |
| "Just updating one line" | Size doesn't matter, role does | Use subagent for Write |
| "Already started, might as well finish" | Sunk cost fallacy | Stop, delegate remainder |
| "User is waiting, need to move fast" | Pressure doesn't override workflow | Delegate (parallel agents if needed) |
| "Subagent overhead isn't worth it" | Context pollution costs more | Always delegate |

**Pattern from real violation:**
- Situation: Frontend component changes needed during Build phase
- Rationalization: "I'll just implement it directly with Read/Edit/Write"
- What happened: User intervention required, workflow violation
- Correct action: Spawn subagent for implementation work

**Remember:** Main agent = coordinator ONLY. If you're about to use Read/Edit/Write on code files, you're executing, not coordinating.

### Main Agent Must NOT Directly Call

- `Read`, `Edit`, `Write` tools on code files
- `Glob`, `Grep` for codebase exploration
- `browser_navigate`, `browser_click`, `browser_type`
- `browser_snapshot`, `browser_take_screenshot`
- `browser_resize`, `browser_close`
- ANY other Playwright MCP tool
- ANY bash commands that execute code or tests

### It Does NOT Matter If You Call It

- "Quick file read" ← STILL NEEDS SUBAGENT
- "Just checking one thing" ← STILL NEEDS SUBAGENT
- "Quick verification" ← STILL NEEDS SUBAGENT
- "Manual testing" ← STILL NEEDS SUBAGENT
- "Just checking if it works" ← STILL NEEDS SUBAGENT
- "Taking a screenshot" ← STILL NEEDS SUBAGENT
- "Small edit" ← STILL NEEDS SUBAGENT

**Main agent: If you're about to explore, implement, or execute → STOP → Use a subagent instead.**

**Subagents: You ARE the delegated executor. Use tools directly to complete your task.**

### Why Subagents for ALL Execution

- **Context isolation**: Keeps main conversation focused on coordination
- **Parallel execution**: Multiple subagents can work concurrently
- **Failure containment**: Subagent errors don't derail main session
- **Cleaner history**: Detailed tool calls stay in subagent context
- **Scalability**: Main agent can coordinate many subagents without context bloat
- **Specialization**: Each subagent type is optimized for its task

### Subagent Permissions and Prompt Instructions

**IMPORTANT**: Subagents have DIFFERENT permissions than the main agent. When spawning a subagent, you MUST include context about what the subagent can do:

**Always include in subagent prompts:**

```
You are a subagent (not the main coordinating agent). As a subagent, you CAN and SHOULD:
- Call mcp__playwright__* tools directly (browser automation is YOUR job)
- Execute bash commands that the main agent delegates to you
- Make code edits directly
- Run tests and handle their output
```

**Why this matters:**

- Main agent restrictions (like "don't call Playwright directly") do NOT apply to subagents
- Subagents are the delegated executors - they DO the work the main agent coordinates
- Without this context, subagents may incorrectly refuse to perform their core functions

### Main Agent vs. Subagent Responsibilities

| Main Agent (Coordinator)            | Subagent (Executor)                |
| ----------------------------------- | ---------------------------------- |
| Communicate with user               | Read/write ANY files               |
| Plan strategy                       | Explore codebase (`Glob`, `Grep`)  |
| Present options to user             | Execute code changes               |
| Coordinate subagent tasks           | **ANY `mcp__playwright__*` call**  |
| Summarize subagent results          | Execute unit/integration/e2e tests |
| Run project commands/slash commands | Debug and fix errors               |
| Read tracking docs (if project has) | Write/edit tracking docs           |

**🚫 NEVER in Main Agent:** File reads, file writes, codebase exploration, test execution, browser automation

**✅ Main agent CAN directly:**

- Run simple git commands (`git status`, `git log`, `git diff`)
- Read project tracking/documentation files (to understand current state)
- Communicate with user
- Spawn and coordinate subagents

### Parallel Execution Rules

**ALWAYS run independent subagent operations in parallel:**

- Multiple file explorations
- verifier + tester during Build verification
- Independent agent tasks with no dependencies

**NEVER run subagents as background tasks:**

- Always await all parallel calls before proceeding
- Use multiple Task tool calls in a single message for parallelization
- Do not use `run_in_background: true` for subagents

**How to parallelize:** Send multiple Task tool calls in the same message block.

## Quality Gates

### Definition of Done

- [ ] Tests written and passing
- [ ] Code follows project conventions
- [ ] No linter/formatter warnings
- [ ] Commit messages are clear
- [ ] Implementation matches plan
- [ ] No TODOs without issue numbers

### Test Guidelines

- Test behavior, not implementation
- One assertion per test when possible
- Clear test names describing scenario
- Use existing test utilities/helpers
- Tests should be deterministic

### Test Data Selection Strategy

**Prefer hard-coded seed IDs** for tests involving:
- Specific data relationships (user owns campaign X)
- Temporal scenarios (event happened before/after)
- Complex state (multiple related entities)

**Dynamic queries are OK** for:
- Simple existence checks ("any user exists")
- Count validations ("at least 3 items")
- Tests that truly don't care which entity

**Pattern:**
```typescript
// Fragile - depends on seed ordering
const campaign = await getCampaigns().then(c => c[0]);

// Robust - known seed data
const SEED_CAMPAIGN_ID = "kingmaker-campaign-001";
const campaign = await getCampaign(SEED_CAMPAIGN_ID);
```

**Why:** Seed data evolves. Tests using known IDs remain stable.

## Important Reminders

**NEVER**:

- Use `--no-verify` to bypass commit hooks
- Disable tests instead of fixing them
- Commit code that doesn't compile
- Make assumptions - verify with existing code

**ALWAYS**:

- Commit working code incrementally
- Update plan documentation as you go
- Learn from existing implementations
- Stop after 3 failed attempts and reassess
- Delegate all execution work to subagents (when operating as main agent)
