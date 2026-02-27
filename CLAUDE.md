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

### 3. When Stuck (After 3 Attempts)

**CRITICAL**: Maximum 3 attempts per issue, then STOP.

1. **Document what failed**:
   - What you tried
   - Specific error messages
   - Why you think it failed

2. **Research alternatives**:
   - Find 2-3 similar implementations
   - Note different approaches used

3. **Question fundamentals**:
   - Is this the right abstraction level?
   - Can this be split into smaller problems?
   - Is there a simpler approach entirely?

4. **Try different angle**:
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

## Subagent Delegation Rules

### Mandatory Subagent Operations

**CRITICAL**: When operating as a main/coordinating agent, you are a **coordinator only**. ALL execution work MUST be delegated to subagents.

| Operation                         | Delegate To                         | Rationale                                                          |
| --------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| **ANY `mcp__playwright__*` call** | `typescript-tester` or similar      | Browser automation requires focused context and isolated execution |
| **Code edits (Read/Edit/Write)**  | `general-purpose` or phase-specific | Isolates implementation from coordination, enables parallel work   |
| **File reading**                  | `general-purpose` or `Explore`      | Main agent should not read code files directly                     |
| **Codebase exploration**          | `Explore`                           | Efficient pattern searching without polluting main context         |
| **Test execution**                | `typescript-tester` or similar      | Test runs need isolation to handle output and iterate on failures  |
| **ANY implementation work**       | `general-purpose`                   | Main agent coordinates, subagents execute                          |

**⚠️ MAIN AGENT: EXPLORATION, IMPLEMENTATION, OR EXECUTION = SUBAGENT. NO EXCEPTIONS.**

This rule applies to the **main/coordinating agent only**. Subagents (like `typescript-tester`) **SHOULD** use tools directly — that's their job.

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

## Frontend Remote Logging

All browser `console.*` calls are forwarded to `/tmp/claude-code-workflow.frontend.log` via `POST /api/log`. The log file is cleared on every page refresh (`POST /api/log/clear`). This enables reading frontend console output from the terminal without opening browser DevTools.

- **Log file**: `/tmp/claude-code-workflow.frontend.log`
- **Clear**: Happens automatically on page refresh, or manually via `POST /api/log/clear`
- **Format**: `[ISO-timestamp] [LEVEL] arg1 arg2 ...`

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
