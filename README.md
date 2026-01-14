# Claude Code Structured Autonomy Workflow

A complete workflow system for Claude Code that enables structured autonomy through phase-based development, epic/stage tracking, subagent delegation, and prompt injection for consistent behavior.

## Overview

This repository contains a proven workflow system that transforms Claude Code from a powerful assistant into a structured autonomous development partner. It provides:

- **Phase-based development**: Design → Build → Refinement → Finalize
- **Epic/Stage tracking**: Multi-session work with clear milestones
- **Subagent delegation**: Context management for complex tasks
- **Prompt injection**: Consistent behavior through global guidelines
- **Navigation commands**: `/next_task` and `/finish_phase` for workflow control
- **Hook system**: Automatic prompt enhancement with CLAUDE.md

## Repository Structure

```
.
├── CLAUDE.md                              # Global development guidelines
├── README.md                              # This file
├── agents/                                # Specialized subagents
│   ├── code-reviewer.md                   # Code review before commits
│   ├── doc-updater.md                     # Documentation and tracking updates
│   ├── task-navigator.md                  # Task hierarchy navigation (powers /next_task)
│   ├── typescript-fixer.md                # TypeScript and ESLint error fixing
│   └── typescript-tester.md               # Test running and debugging
├── commands/                              # Slash commands for workflow navigation
│   ├── finish_phase.md                    # Complete current phase and advance
│   └── next_task.md                       # Find next task to work on
├── examples/                              # Example epic/stage structures
│   └── epics/
│       └── EPIC-001/                      # Sample completed epic
│           ├── EPIC-001.md                # Epic overview and stages
│           └── STAGE-001-002.md           # Example stage with phases
├── hooks/                                 # Lifecycle hooks
│   └── claude_prompt_enhancer.sh          # Inject context into prompts
├── settings.json.example                  # Claude Code settings template
└── skills/                                # Custom skills (8 total)
    ├── epic-stage-setup/                  # Create new epics and stages
    ├── epic-stage-workflow/               # Main workflow coordinator (orchestrator)
    ├── phase-design/                      # Design phase guidance
    ├── phase-build/                       # Build phase guidance
    ├── phase-refinement/                  # Refinement phase guidance
    ├── phase-finalize/                    # Finalize phase guidance
    ├── journal/                           # Emotional reflection after phases
    └── lessons-learned/                   # Structured learning capture
```

## Quick Start

### 1. Installation

Copy the configuration files to your Claude Code directory:

```bash
# Clone this repository
git clone <repository-url> claude-code-workflow
cd claude-code-workflow

# Copy CLAUDE.md (global guidelines)
cp CLAUDE.md ~/.claude/

# Copy agents
mkdir -p ~/.claude/agents
cp agents/*.md ~/.claude/agents/

# Copy slash commands
mkdir -p ~/.claude/commands
cp commands/*.md ~/.claude/commands/

# Copy skills
mkdir -p ~/.claude/skills
cp -r skills/* ~/.claude/skills/

# Copy hooks
mkdir -p ~/.claude/hooks
cp hooks/claude_prompt_enhancer.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/claude_prompt_enhancer.sh
```

### 2. Configure Settings

Copy the minimal settings template to enable prompt enhancement:

```bash
cp settings.json.example ~/.claude/settings.json
```

This configures the `UserPromptSubmit` hook that automatically injects your CLAUDE.md guidelines into every prompt, ensuring consistent behavior across sessions.

### 3. Set Up Hooks

The prompt enhancer hook automatically injects your CLAUDE.md guidelines:

```bash
# Verify the hook is executable
chmod +x ~/.claude/hooks/claude_prompt_enhancer.sh

# Test the hook
echo "test prompt" | ~/.claude/hooks/claude_prompt_enhancer.sh
```

### 4. Create Your First Epic

Use the `epic-stage-setup` skill to structure your work:

```
Use the epic-stage-setup skill to create a new epic for building a REST API
```

Claude will guide you through:

1. Defining the epic scope and goals
2. Breaking it into stages (3-5 stages recommended)
3. Creating tracking documents in `epics/EPIC-XXX/`

## Components

### CLAUDE.md - Global Development Guidelines

The heart of the system. Contains:

- **Philosophy**: Core beliefs (incremental progress, learning from code, pragmatism)
- **Process**: Planning, implementation flow, what to do when stuck
- **Technical Standards**: Architecture, code quality, error handling
- **Subagent Delegation**: How to coordinate work across multiple agents
- **Session Protocols**: Starting and ending sessions consistently
- **Phase-Based Workflow**: Design → Build → Refinement → Finalize
- **Testing Principles**: TDD workflow, test quality standards

### Commands

#### `/next_task`

Scans your `epics/` directory to find the next work item:

- Identifies current epic and stage
- Shows current phase
- Provides phase-specific instructions
- Run this at the start of every session

#### `/finish_phase`

Advances to the next phase or stage:

- Validates phase completion
- Updates tracking documents
- Shows what's next
- Run this when completing each phase

### Agents

Specialized subagents handle specific workflow tasks. These are invoked using the Task tool and provide focused capabilities:

#### `task-navigator`

Powers the `/next_task` command to navigate the task hierarchy:

- Scans epic/stage tracking documents
- Finds the next incomplete work item
- Determines current phase (Design, Build, Refinement, Finalize)
- Returns formatted instructions for the current phase
- Detects when all tasks are complete

The task-navigator is the foundation of multi-session work, restoring context at the start of each session.

#### `code-reviewer`

Expert code review before commits:

- Reviews code changes for best practices and quality
- Checks for security vulnerabilities (SQL injection, XSS, secrets)
- Identifies performance issues (N+1 queries, memory leaks)
- Flags unnecessary complexity
- Ensures type safety and error handling
- Returns APPROVED or CHANGES REQUIRED with specific feedback

Use before every commit to maintain code quality.

#### `doc-updater`

Updates tracking documents and project documentation:

- Records design decisions and rationale
- Marks tasks and phases as complete
- Updates status fields
- Records user feedback
- Adds CHANGELOG entries
- Updates README and feature documentation

Preserves context across sessions by keeping documentation current.

#### `typescript-fixer`

Fixes TypeScript compilation and ESLint errors:

- Resolves type mismatches and inference issues
- Fixes import/export and module resolution problems
- Handles strict mode violations
- Addresses missing type declarations
- Makes minimal, targeted fixes
- Verifies fixes with type-check and lint

Use when TypeScript or ESLint errors block progress.

#### `typescript-tester`

Runs and debugs tests following TDD principles:

- Executes test suites and captures failures
- Analyzes test failures to understand expected behavior
- Fixes code to match test expectations (not the other way around)
- Supports TDD workflow (Red-Green-Refactor)
- Verifies fixes don't introduce regressions

Critical principle: When tests fail, fix the code, not the tests.

### Skills

Claude Code skills are interactive workflows that guide specific tasks. This workflow includes **8 specialized skills**:

#### Epic and Stage Management

##### `epic-stage-setup`

Creates new epic/stage structures:

- Guides epic definition and scope
- Creates properly formatted tracking documents
- Bootstraps the project hierarchy
- **Use when**: Starting a new project or feature area

##### `epic-stage-workflow`

Core workflow orchestrator:

- Coordinates Design → Build → Refinement → Finalize flow
- Automatically invoked after `/next_task`
- Routes to appropriate phase skill
- Contains shared rules for all phases
- **Use when**: Working on existing epics/stages

#### Phase-Specific Skills

Each phase has a dedicated skill with specialized guidance:

##### `phase-design`

- Explores requirements and constraints
- Facilitates A/B/C option generation
- Documents design decisions and user preferences
- Sets success criteria

##### `phase-build`

- Structures implementation with spec-first workflow
- Coordinates planner → scribe → verifier pipeline
- Enforces TDD patterns
- Manages subagent delegation

##### `phase-refinement`

- Facilitates user testing across viewports
- Manages approval workflow with retraction handling
- Documents issues and resolutions
- Enforces viewport reset rules on code changes

##### `phase-finalize`

- Orchestrates pre/post-test code review
- Validates test coverage
- Coordinates documentation updates
- Manages git commit workflow

#### Reflection Skills (Phase Exit Gates)

##### `journal`

Emotional reflection after phase completion:

- **Always invoked** after every phase (mandatory)
- Captures candid feelings about the work
- Provides emotional closure
- Focus: "How did that feel?"

##### `lessons-learned`

Structured learning capture:

- Invoked when something **noteworthy** happened
- Documents technical insights and gotchas
- Captures actionable improvements
- Focus: "What did I learn?"

**Key distinction**: Journal is emotional and always runs. Lessons-learned is technical and conditional.

### Hooks

#### `claude_prompt_enhancer.sh`

Automatically injects CLAUDE.md into every user prompt:

- Runs on `UserPromptSubmit` lifecycle event
- Ensures consistent behavior across sessions
- Provides context about subagent permissions
- Enables Claude to follow development guidelines automatically

## How It Works

### The Complete Workflow

1. **Start with Brainstorming** (optional but recommended)

   ```
   I want to build a user authentication system
   ```

   Claude will help refine your idea before implementation.

2. **Create Epic and Stages**

   ```
   Use the epic-stage-setup skill to create an epic for user authentication
   ```

   Define 3-5 stages that break down the work.

3. **Begin Each Session with `/next_task`**

   ```
   /next_task
   ```

   Claude will tell you exactly what to work on and what phase you're in. This command uses the `task-navigator` agent to scan your epic/stage tracking documents and restore session context.

4. **Work Through Phases**

   **Design Phase**: Claude presents 2-3 options, you choose, decisions are documented

   **Build Phase**: Claude implements the chosen approach

   **Refinement Phase**: You test, provide feedback, Claude iterates until approved

   **Finalize Phase**: Code review, tests, documentation, commit

5. **Complete Phase with `/finish_phase`**

   ```
   /finish_phase
   ```

   Updates tracking documents and advances to next phase.

6. **Repeat Until Epic Complete**
   Each stage goes through all four phases. Epic is complete when all stages are done.

### Subagent Delegation

For complex tasks, the main agent coordinates while specialized subagents execute:

**Main Agent (Coordinator)**:

- Communicates with you
- Plans strategy
- Presents options
- Runs navigation commands (`/next_task`, `/finish_phase`)

**Specialized Subagents (Executors)**:

- `task-navigator`: Navigates task hierarchy and restores session context
- `code-reviewer`: Reviews code for quality and security before commits
- `doc-updater`: Updates tracking documents and CHANGELOG
- `typescript-fixer`: Fixes TypeScript and ESLint errors
- `typescript-tester`: Runs tests and debugs failures

This separation keeps the main conversation focused while distributing complex work to specialized agents with clear responsibilities.

### Multi-Session Work

The epic/stage system preserves context across sessions:

- Each session starts with `/next_task` to restore context
- Each session ends with `/finish_phase` to checkpoint progress
- Tracking documents maintain state between sessions
- CLAUDE.md ensures consistent behavior

### Battle-Tested Reliability

This workflow has been stress-tested across **6 intensive sessions**, with **59 loopholes identified and fixed**. Key areas hardened:

- **Authority hierarchy**: Clear Level 1 (user) vs Level 2 (workflow integrity) boundaries
- **Approval lifecycle**: Handling of retractions, batch approvals, conditional approvals
- **Spec requirements**: "Almost done" is not an exception - specs required at any completion %
- **Cross-session state**: Mandatory git checks before trusting previous approvals
- **Per-stage reviews**: Batched reviews across stages explicitly prohibited

The skills are designed to resist rationalization and guide correct behavior even under pressure.

## Skill Invocation Patterns

| Skill                 | Trigger                     | Purpose                     |
| --------------------- | --------------------------- | --------------------------- |
| `epic-stage-setup`    | User requests epic creation | Bootstrap project structure |
| `epic-stage-workflow` | `/next_task` finds work     | Coordinate phase workflow   |
| `phase-design`        | Entering Design phase       | Guide requirements/options  |
| `phase-build`         | Entering Build phase        | Guide implementation        |
| `phase-refinement`    | Entering Refinement phase   | Guide user testing          |
| `phase-finalize`      | Entering Finalize phase     | Guide review/commit         |
| `journal`             | After **every** phase       | Emotional reflection        |
| `lessons-learned`     | After **noteworthy** phases | Capture learnings           |

### Workflow Sequence

```
/next_task → task-navigator → epic-stage-workflow → phase-* skill
                                                          ↓
                                              Phase completion
                                                          ↓
                                              journal (always) + lessons-learned (if applicable)
                                                          ↓
                                              /finish_phase → next phase
```

## Examples

See the `examples/epics/EPIC-001/` directory for a complete example:

- EPIC-001.md: Epic overview with all stages listed
- STAGE-001-002.md: Example stage with all four phases

The example shows a TypeScript CLI tool project that went from design through finalization using this workflow.

## Configuration Reference

### Hook Configuration

The key configuration is the `UserPromptSubmit` hook that enables automatic prompt enhancement:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/claude_prompt_enhancer.sh"
          }
        ]
      }
    ]
  }
}
```

This hook:

- Runs automatically when you submit a prompt
- Injects your CLAUDE.md guidelines into every prompt
- Ensures consistent behavior across sessions
- Enables Claude to follow development guidelines automatically

For additional Claude Code settings (models, permissions, plugins, etc.), see the [official Claude Code documentation](https://docs.anthropic.com/claude-code).

## Best Practices

### Starting a New Project

1. Begin with brainstorming to refine your idea
2. Create an epic with 3-5 stages
3. Each stage should be completable in 1-3 sessions
4. Start each session with `/next_task`
5. End each phase with `/finish_phase`

### Structuring Stages

Good stage breakdown:

- STAGE-001-001: Project setup and scaffolding
- STAGE-001-002: Core domain logic (TDD)
- STAGE-001-003: API/CLI interface
- STAGE-001-004: Documentation and examples
- STAGE-001-005: Final verification and polish

### Managing Context

- Use subagents for deep exploration
- Keep main conversation focused on decisions
- Document decisions in stage files
- Run `/next_task` when returning after a break

### Quality Gates

Never skip phases:

- **Design** ensures you build the right thing
- **Build** gets it working
- **Refinement** makes it work well
- **Finalize** ensures it's maintainable

## Troubleshooting

### Hooks Not Running

Check hook permissions:

```bash
ls -la ~/.claude/hooks/
chmod +x ~/.claude/hooks/*.sh
```

### Commands Not Available

Verify commands are installed:

```bash
ls -la ~/.claude/commands/
```

Restart Claude Code after copying commands.

### CLAUDE.md Not Applied

Check that:

1. The prompt enhancer hook is configured in `~/.claude/settings.json`
2. The hook script exists and is executable: `~/.claude/hooks/claude_prompt_enhancer.sh`
3. Restart Claude Code after making settings changes

## Related Projects

This workflow is designed to work with:

- **[Superpowers Plugin](https://github.com/obra/superpowers)**: Advanced skills for TDD, systematic debugging, code review, and more
- **[Episodic Memory Plugin](https://github.com/obra/episodic-memory)**: Long-term memory for Claude Code across sessions

Both plugins enhance the structured autonomy workflow with additional capabilities.

## Philosophy

This workflow is built on core beliefs:

- **Incremental progress over big bangs**: Small changes that compile and pass tests
- **Learning from existing code**: Study and plan before implementing
- **Pragmatic over dogmatic**: Adapt to project reality
- **Clear intent over clever code**: Be boring and obvious

The goal is to enable Claude to work autonomously while maintaining:

- Clear communication
- Consistent quality
- Traceable decisions
- Maintainable outcomes

## Contributing

This workflow system is open for contributions:

1. Fork the repository
2. Create a branch for your enhancement
3. Document your changes clearly
4. Submit a pull request

Areas for contribution:

- Additional slash commands
- More skills for common workflows
- Enhanced hook scripts
- Better templates
- Documentation improvements

## License

MIT License - see LICENSE file for details.

## Acknowledgments

Built on patterns from:

- The Superpowers plugin by obra
- The Claude Code community
- Years of software development best practices
- Agile and TDD methodologies

---

**Ready to start?** Copy the files, configure your settings, and run `/next_task` to begin your first epic.
