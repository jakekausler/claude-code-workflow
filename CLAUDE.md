# Development Guidelines

## Philosophy

### Core Beliefs

- **Incremental progress over big bangs** - Small changes that compile and pass tests
- **Learning from existing code** - Study and plan before implementing
- **Pragmatic over dogmatic** - Adapt to project reality
- **Clear intent over clever code** - Be boring and obvious

### Simplicity Means

- Single responsibility per function/class
- Avoid premature abstractions
- No clever tricks - choose the boring solution
- If you need to explain it, it's too complex

## Process

### 1. Planning & Staging

Break complex work into epics and stages using the epic/stage workflow:

- Use the `creating-epics-and-stages` skill to create structured tracking documents
- Use `/next_task` to navigate between tasks within the current stage
- Use `/finish_phase` to advance from one stage to the next
- Epics are stored in the `epics/` directory with a clear structure:
  - **Epic metadata**: Name, goals, and completion status
  - **Stages**: Design, Build, Refinement, and Finalize phases
  - **Tasks**: Specific actionable items within each stage
- Update task and stage status as you progress through the work
- The epic file serves as the single source of truth for project state

### 2. Implementation Flow

1. **Understand** - Study existing patterns in codebase
2. **Test** - Write test first (red)
3. **Implement** - Minimal code to pass (green)
4. **Refactor** - Clean up with tests passing
5. **Commit** - With clear message linking to epic/stage

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

## Quality Gates

### Definition of Done

- [ ] Tests written and passing
- [ ] Code follows project conventions
- [ ] No linter/formatter warnings
- [ ] Commit messages are clear
- [ ] Implementation matches epic/stage requirements
- [ ] No TODOs without issue numbers

### Test Guidelines

- Test behavior, not implementation
- One assertion per test when possible
- Clear test names describing scenario
- Use existing test utilities/helpers
- Tests should be deterministic

## Important Reminders

**NEVER**:
- Use `--no-verify` to bypass commit hooks
- Disable tests instead of fixing them
- Commit code that doesn't compile
- Make assumptions - verify with existing code

**ALWAYS**:
- Commit working code incrementally
- Update epic and stage status as you go
- Learn from existing implementations
- Stop after 3 failed attempts and reassess

---

## Subagent Delegation Philosophy

For complex projects, use a coordination model where the main agent orchestrates while subagents execute.

### Main Agent Role (Coordinator)

The main agent should:
- Communicate with the user
- Plan strategy and coordinate tasks
- Present options and gather feedback
- Summarize subagent results
- Run task navigation commands

### Subagent Role (Executor)

Delegate to subagents for:
- **File reading** - Exploring code, reading documentation
- **Code implementation** - Writing, editing files
- **Testing** - Running tests, debugging failures
- **Codebase exploration** - Searching patterns, finding implementations

### Why Subagents?

- **Context isolation** - Keeps main conversation focused on coordination
- **Parallel execution** - Multiple subagents can work concurrently
- **Failure containment** - Subagent errors don't derail main session
- **Cleaner history** - Detailed tool calls stay in subagent context

### Subagent Prompt Instructions

**IMPORTANT**: Subagents have DIFFERENT permissions than the main agent. When spawning a subagent, you MUST include context about what the subagent can do.

**Always include in subagent prompts:**

```
You are a subagent (not the main coordinating agent). As a subagent, you CAN and SHOULD:
- Execute bash commands that the main agent delegates to you
- Make code edits directly (Read, Edit, Write tools)
- Run tests and handle their output
- Call any tools the main agent delegates to you
```

**Why this matters:**

- Main agent restrictions do NOT apply to subagents
- Subagents are the delegated executors - they DO the work the main agent coordinates
- Without this context, subagents may incorrectly refuse to perform their core functions

**Example subagent prompt:**

```
You are a subagent (not the main coordinating agent). As a subagent, you CAN and SHOULD make code edits directly and run tests.

Task: Fix the failing tests in src/utils/config.test.ts
1. Read the test file to understand expected behavior
2. Read the implementation to find the bug
3. Fix the implementation code
4. Run tests to verify the fix
```

### Main Agent vs Subagent Permissions

| Main Agent (Coordinator) | Subagent (Executor) |
|--------------------------|---------------------|
| Communicate with user | Read/write ANY files |
| Plan strategy | Explore codebase (`Glob`, `Grep`) |
| Present options to user | Execute code changes |
| Coordinate subagent tasks | Execute tests |
| Summarize subagent results | Debug and fix errors |
| Run navigation commands | Run bash commands |

**Main agent should NOT directly:**
- Make large code changes
- Run extensive test suites
- Perform deep codebase exploration

**Subagents CAN directly:**
- Everything the main agent delegates
- Tools that the main agent avoids for context reasons

---

## Session Protocols

For multi-session work, use consistent protocols to maintain context.

### Session Start Protocol

1. **Understand current state** - Check tracking documents, git status
2. **Confirm context** - "We're working on [X] for [Y]"
3. **State goal** - "This session's goal is to [specific outcome]"
4. **Proceed or clarify** - Start work or ask questions if context is missing

### Session End Protocol

1. **Update tracking** - Document what was done
2. **State progress** - "Completed [X], next session will [Y]"
3. **If phase complete** - Run completion command/validation

### Multi-Session Work Patterns

- Each session focuses on one clear goal
- Context preserved in tracking documents
- Don't leave work in broken state between sessions
- Commit working code before ending session

---

## Phase-Based Workflow

For feature development, use a phased approach with quality gates.

### Design Phase

- Present 2-3 UI/architecture options
- User picks preferred approach
- Confirm data/configuration needs
- Document decisions

### Build Phase

- Implement chosen approach
- Add necessary scaffolding
- Ensure dev environment shows working feature
- Document what was built

### Refinement Phase

- User tests the implementation
- Collect feedback
- Iterate until approved
- **Dual sign-off** for UI work: Desktop AND Mobile approval

### Finalize Phase

1. Code review (pre-tests)
2. Write comprehensive tests
3. Code review (post-tests)
4. Update documentation
5. Commit with detailed message
6. Add changelog entry

---

## Code Reviewer Checklist

Use this checklist before commits.

### Security

- [ ] No hardcoded secrets or credentials
- [ ] Proper input validation and sanitization
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (proper escaping)
- [ ] Authentication and authorization checks
- [ ] Secure dependencies (no known vulnerabilities)
- [ ] No sensitive data in error messages

### Performance

- [ ] No N+1 query problems
- [ ] Efficient algorithms and data structures
- [ ] Proper indexing for database queries
- [ ] No unnecessary re-renders (React)
- [ ] Memory leak prevention
- [ ] Lazy loading where appropriate

### Code Quality

- [ ] Single Responsibility Principle
- [ ] DRY (Don't Repeat Yourself)
- [ ] Clear and descriptive naming
- [ ] Appropriate abstraction level
- [ ] Proper error handling
- [ ] Type safety (strict mode)

### Maintainability

- [ ] Code is readable and self-documenting
- [ ] Functions are small and focused
- [ ] Low coupling, high cohesion
- [ ] Easy to test
- [ ] No magic numbers or strings

---

## Testing Principles

### Fix Code, Not Tests

When tests fail, the default assumption is the **code is wrong**, not the tests.

1. Read the test to understand expected behavior
2. Fix the implementation to match test expectations
3. Only modify tests if they genuinely test the wrong thing

### TDD Workflow

1. **Red** - Write a failing test
2. **Green** - Write minimal code to pass
3. **Refactor** - Improve code with tests passing

### Test Quality

- Test behavior, not implementation details
- One assertion per test when possible
- Clear test names describing scenario
- Tests should be deterministic
- Don't mock what you don't understand

---

## Common Gotchas Template

Document project-specific quirks in project CLAUDE.md.

### Categories to Document

- **Database configuration** - Connection strings, multiple databases, migrations
- **Environment variables** - Required vars, where to get values
- **Dev server** - Ports, startup commands, health checks
- **Build issues** - Common failures, cache clearing
- **Testing** - Database reset, viewport testing, slow tests
- **Deployment** - Staging vs production differences
