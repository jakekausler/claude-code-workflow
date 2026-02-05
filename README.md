# Claude Code Structured Autonomy Workflow

A complete workflow system for Claude Code that enables structured autonomy through phase-based development, epic/stage tracking, subagent delegation, and prompt injection for consistent behavior.

## Overview

This repository contains a proven workflow system that transforms Claude Code from a powerful assistant into a structured autonomous development partner. It provides:

- **Phase-based development**: Design -> Build -> Refinement -> Finalize
- **Epic/Stage tracking**: Multi-session work with clear milestones
- **Subagent delegation**: Context management for complex tasks
- **Prompt injection**: Consistent behavior through global guidelines
- **Navigation commands**: `/next_task` for workflow control
- **Hook system**: Automatic prompt enhancement with CLAUDE.md

## Repository Structure

```
.
├── CLAUDE.md                              # Global development guidelines
├── README.md                              # This file
├── agents/                                # Specialized subagents (16 total)
│   ├── brainstormer.md                    # Generate architecture options (Opus)
│   ├── code-reviewer.md                   # Code review before commits (Opus)
│   ├── debugger.md                        # Complex multi-file bug analysis (Opus)
│   ├── debugger-lite.md                   # Medium-complexity error analysis (Sonnet)
│   ├── doc-updater.md                     # Documentation and tracking updates (Haiku)
│   ├── doc-writer.md                      # Comprehensive documentation (Opus)
│   ├── doc-writer-lite.md                 # Simple documentation (Sonnet)
│   ├── e2e-tester.md                      # Backend E2E test scenarios (Sonnet)
│   ├── fixer.md                           # Apply fix instructions (Haiku)
│   ├── planner.md                         # Complex implementation specs (Opus)
│   ├── planner-lite.md                    # Simple implementation specs (Sonnet)
│   ├── scribe.md                          # Write code from specs (Haiku)
│   ├── task-navigator.md                  # Task hierarchy navigation
│   ├── test-writer.md                     # Write tests for existing code (Sonnet)
│   ├── tester.md                          # Run test suites (Haiku)
│   └── verifier.md                        # Run build/type-check/lint (Haiku)
├── commands/                              # Slash commands for workflow navigation
│   ├── analyze_learnings.md               # Analyze learnings/journal for improvement
│   ├── competitive-review.md              # Competitive code review with 5 agents
│   └── next_task.md                       # Find next task to work on
├── examples/                              # Example configurations
│   ├── epics/
│   │   └── EPIC-001/                      # Sample completed epic
│   │       ├── EPIC-001.md                # Epic overview and stages
│   │       └── STAGE-001-002.md           # Example stage with phases
│   └── hooks/                             # Hook examples
│       ├── README.md                      # Hook documentation
│       ├── claude_ready.sh                # Home Assistant notification hook (sanitized)
│       └── settings-hooks-example.json    # Complete hooks configuration
├── hooks/                                 # Lifecycle hooks
│   └── claude_prompt_enhancer.sh          # Inject context into prompts
├── settings.json.example                  # Claude Code settings template
└── skills/                                # Custom skills (9 total)
    ├── epic-stage-setup/                  # Create new epics and stages
    ├── epic-stage-workflow/               # Main workflow coordinator (orchestrator)
    ├── journal/                           # Emotional reflection after phases
    ├── lessons-learned/                   # Structured learning capture
    ├── meta-insights/                     # Analyze learnings for continuous improvement
    ├── phase-build/                       # Build phase guidance
    ├── phase-design/                      # Design phase guidance
    ├── phase-finalize/                    # Finalize phase guidance
    └── phase-refinement/                  # Refinement phase guidance
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

**Optional: Set Up Notification Hooks**

If you use Home Assistant, you can get notifications when Claude is waiting for input:

```bash
# Copy the notification hook example
cp examples/hooks/claude_ready.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/claude_ready.sh

# Edit the script to add your Home Assistant token and URL
# See the comments in the script for detailed instructions
nano ~/.claude/hooks/claude_ready.sh

# Merge the notification hooks into your settings.json
# See examples/hooks/settings-hooks-example.json for the complete hook configuration
```

See the [Notification Hooks](#notification-hooks) section below for detailed setup instructions.

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
- **Professional Objectivity**: Prioritizes technical accuracy, objective guidance, and honest disagreement
- **Process**: Planning, implementation flow, what to do when stuck
- **Technical Standards**: Architecture, code quality, error handling
- **Subagent Delegation**: How to coordinate work across multiple agents
- **Session Protocols**: Starting and ending sessions consistently
- **Phase-Based Workflow**: Design -> Build -> Refinement -> Finalize
- **Testing Principles**: TDD workflow, test quality standards

### Commands

#### `/next_task`

Scans your `epics/` directory to find the next work item:

- Identifies current epic and stage
- Shows current phase
- Provides phase-specific instructions
- Run this at the start of every session

#### `/analyze_learnings`

Analyzes learnings and journal entries to identify improvement opportunities:

- Finds unanalyzed entries in `~/docs/claude-learnings/` and `~/docs/claude-journal/`
- Detects cross-cutting themes across all repositories
- Presents findings with actionable recommendations
- Generates implementation prompts for approved actions
- Saves prompts to `~/docs/claude-meta-insights/actions/<timestamp>/` for execution in fresh sessions
- Powers the continuous improvement feedback loop

#### `/competitive-review`

Runs a competitive code review process with multiple parallel reviewers:

- Spawns 5 parallel code reviewers competing to find the most issues
- Arguments: `[rounds] [branch] [base]` - number of review cycles (default: 1), branch to review, base branch
- Each reviewer is told they're competing, incentivizing thorough analysis
- Reviews structured as: Summary, Critical issues, Major issues, Minor issues, Suggestions
- After reviews, summarizes findings in a table showing consensus across reviewers
- Spawns parallel fixers to address ALL issues found (including minor/suggestions)
- Iterates review/fix cycle for the specified number of rounds (default: 1 round)
- Runs verification after each fix cycle

**Use when**: You want thorough code review before merging, especially for critical changes where multiple perspectives help catch issues

### Agents

Specialized subagents handle specific workflow tasks. These are invoked using the Task tool and provide focused capabilities. Agents are organized by model tier for cost efficiency.

#### Opus Tier (Complex Reasoning)

##### `brainstormer`

Generate architectural options for complex decisions:

- Creates 2-3 distinct implementation approaches
- Analyzes trade-offs for each option
- Provides recommendation with reasoning
- Used in Design phase when multiple valid solutions exist

##### `code-reviewer`

Expert code review before commits:

- Reviews code changes for best practices and quality
- Checks for security vulnerabilities (SQL injection, XSS, secrets)
- Identifies performance issues (N+1 queries, memory leaks)
- Flags unnecessary complexity
- Ensures type safety and error handling
- Returns APPROVED or CHANGES REQUIRED with specific feedback

##### `debugger`

Find root cause of complex multi-file bugs:

- Analyzes errors spanning multiple files
- Traces through code to identify root cause
- Explains WHY errors occur, not just WHERE
- Produces fix instructions for fixer agent

##### `doc-writer`

Create comprehensive documentation:

- API documentation with examples
- Public-facing documentation
- Complex feature documentation
- Architecture documentation requiring synthesis

##### `planner`

Create detailed implementation specs for complex features:

- Multi-file architectural changes
- Features requiring coordination across modules
- New systems or significant refactors
- Outputs specs that scribe (Haiku) can execute

#### Sonnet Tier (Balanced Performance)

##### `debugger-lite`

Analyze medium-complexity errors:

- Single-file logic errors
- Errors with clear stack traces
- Type mismatches requiring some analysis
- Produces fix instructions for fixer agent

##### `doc-writer-lite`

Create simple documentation:

- Internal documentation
- README updates
- Simple feature documentation
- Status updates and summaries

##### `e2e-tester`

Design and run backend test scenarios:

- Creates temporary API/integration test scripts
- Tests backend-only changes during Refinement phase
- NOT Playwright browser tests (those are separate)
- Scripts are temporary, not committed

##### `planner-lite`

Create implementation specs for simpler tasks:

- Simple single-file features
- Straightforward multi-file changes
- Bug fixes with known solutions
- Outputs specs that scribe (Haiku) can execute

##### `test-writer`

Write tests for existing code:

- Unit tests and integration tests
- Follows project test patterns
- Covers edge cases and error scenarios
- Used in Finalize phase for coverage

#### Haiku Tier (Fast Execution)

##### `doc-updater`

Updates tracking documents and project documentation:

- Records design decisions and rationale
- Marks tasks and phases as complete
- Updates status fields
- Records user feedback
- Adds CHANGELOG entries
- Updates README and feature documentation

##### `fixer`

Execute fix instructions:

- Applies exact changes specified by debugger or code-reviewer
- Minimal, targeted fixes
- Does NOT run verification (that's verifier's job)
- Reports what was changed

##### `scribe`

Write code from detailed specifications:

- Creates/modifies files as specified by planner
- Writes code exactly as specified in specs
- Does NOT verify code compiles (that's verifier's job)
- Reports what files were created/modified

##### `tester`

Run test suites and report results:

- Executes test commands
- Reports pass/fail status
- Lists specific failures with error messages
- Does NOT investigate or fix failures

##### `verifier`

Run build, type-check, and lint commands:

- Executes verification commands
- Reports pass/fail with specific errors
- Lists all issues found
- Does NOT investigate or fix issues

#### Navigation Agent

##### `task-navigator`

Powers the `/next_task` command to navigate the task hierarchy:

- Scans epic/stage tracking documents
- Finds the next incomplete work item
- Determines current phase (Design, Build, Refinement, Finalize)
- Returns formatted instructions for the current phase
- Detects when all tasks are complete

The task-navigator is the foundation of multi-session work, restoring context at the start of each session.

#### Recent Agent Enhancements

The agent system has been continuously refined based on real-world usage. Recent improvements include:

- **code-reviewer**: Enhanced TypeScript type safety enforcement with stricter validation rules
- **doc-writer**: Includes accuracy validation step before finalizing documentation
- **test-writer**: Emphasizes behavior verification over structural checks, ensuring tests validate actual functionality rather than implementation details

These enhancements improve reliability and quality across the workflow, ensuring agents produce better results while maintaining their specialized focus.

### Skills

Claude Code skills are interactive workflows that guide specific tasks. This workflow includes **9 specialized skills**:

#### Epic and Stage Management

##### `epic-stage-setup`

Creates new epic/stage structures:

- Guides epic definition and scope
- Creates properly formatted tracking documents
- Bootstraps the project hierarchy
- **Use when**: Starting a new project or feature area

##### `epic-stage-workflow`

Core workflow orchestrator:

- Coordinates Design -> Build -> Refinement -> Finalize flow
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
- Coordinates planner -> scribe -> verifier pipeline
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

#### Continuous Improvement

##### `meta-insights`

Analyzes learnings and journal entries to drive continuous improvement:

- **Always invoked via** `/analyze_learnings` command
- Finds unanalyzed entries in `~/docs/claude-learnings/` and `~/docs/claude-journal/`
- Detects cross-cutting themes across repositories
- Scores themes by frequency, severity, and actionability
- Tracks theme lifecycle: NEW → ACTIVE → MONITORING → RESOLVED (or RECURRING)
- Presents findings with 2-3 action options per theme
- **Generates paste-ready prompts** for approved actions
- Saves prompts to `~/docs/claude-meta-insights/actions/<timestamp>/`
- **Implementation Mode**: Executes generated prompts in separate sessions with proper isolation
- **Bulk operations support**: Includes `bulk-add-dismiss.sh` script for efficient entry management
- Updates `trends.json` to track effectiveness of actions

**Critical rule**: Analysis session generates prompts only, never implements. Implementation happens in separate fresh sessions.

**Key features**:
- Automatic repository separation (never mixes themes across repos)
- Adaptive thresholds based on session frequency
- Helper scripts for efficient entry management
- Subagent delegation for reading entries
- Main agent handles analysis and user interaction

**Use when**: You want to review patterns from recent work and improve skills, documentation, or processes based on real evidence.

### Hooks

#### `claude_prompt_enhancer.sh`

Automatically injects CLAUDE.md into every user prompt:

- Runs on `UserPromptSubmit` lifecycle event
- Ensures consistent behavior across sessions
- Provides context about subagent permissions
- Enables Claude to follow development guidelines automatically

#### `claude_ready.sh` (Optional)

Sends notifications when Claude is waiting for input:

- Runs on `Notification` lifecycle events (`permission_prompt`, `idle_prompt`)
- Integrates with Home Assistant for mobile/desktop notifications
- Notifies you when Claude needs permission approval
- Notifies you when Claude has finished responding and is waiting for your next prompt
- Includes the project/repository name in the notification
- Fully customizable notification content and styling

**Use case**: Get notified on your phone or computer when long-running tasks complete, so you can come back and continue the conversation without constantly checking.

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

5. **Repeat Until Epic Complete**
   Each stage goes through all four phases. Epic is complete when all stages are done.

### Continuous Improvement Loop

The workflow includes a feedback system that learns from your work:

1. **Capture**: During work, `journal` and `lessons-learned` skills save entries with frontmatter linking to epic/stage/phase
2. **Analyze**: Periodically run `/analyze_learnings` to detect patterns across entries
3. **Review**: Claude presents themes sorted by score (frequency + severity + actionability)
4. **Generate**: For approved actions, Claude creates paste-ready prompts
5. **Implement**: Copy prompts into fresh sessions to update skills, docs, or processes
6. **Track**: The system monitors theme lifecycle (NEW → ACTIVE → MONITORING → RESOLVED)

**Benefits**:
- Skills improve based on real patterns from actual work
- Documentation stays relevant to common issues
- Repeated mistakes get systematically addressed
- Evidence-based workflow refinement

**Example flow**:
```
Work on feature → Hit Prisma migration issue → journal captures frustration
→ lessons-learned documents the gotcha → Continue working
→ Later: /analyze_learnings → Detects 8 instances of migration issues
→ Generates prompt to update project CLAUDE.md with gotcha
→ Paste prompt in fresh session → CLAUDE.md updated
→ Future work: No more migration confusion
```

### Subagent Delegation

For complex tasks, the main agent coordinates while specialized subagents execute:

**Main Agent (Coordinator)**:

- Communicates with you
- Plans strategy
- Presents options
- Runs navigation commands (`/next_task`)

**Specialized Subagents (Executors)**:

| Agent | Model | Purpose |
|-------|-------|---------|
| `brainstormer` | Opus | Generate architecture options |
| `code-reviewer` | Opus | Review code for quality and security |
| `debugger` | Opus | Analyze complex multi-file bugs |
| `planner` | Opus | Create detailed implementation specs |
| `doc-writer` | Opus | Write comprehensive documentation |
| `debugger-lite` | Sonnet | Analyze medium-complexity errors |
| `planner-lite` | Sonnet | Create simple implementation specs |
| `doc-writer-lite` | Sonnet | Write simple documentation |
| `e2e-tester` | Sonnet | Run backend test scenarios |
| `test-writer` | Sonnet | Write tests for existing code |
| `task-navigator` | Haiku | Navigate task hierarchy |
| `doc-updater` | Haiku | Update tracking documents |
| `fixer` | Haiku | Apply fix instructions |
| `scribe` | Haiku | Write code from specs |
| `tester` | Haiku | Run test suites |
| `verifier` | Haiku | Run verification commands |

This separation keeps the main conversation focused while distributing complex work to specialized agents with clear responsibilities.

### Multi-Session Work

The epic/stage system preserves context across sessions:

- Each session starts with `/next_task` to restore context
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

| Skill                 | Trigger                       | Purpose                        |
| --------------------- | ----------------------------- | ------------------------------ |
| `epic-stage-setup`    | User requests epic creation   | Bootstrap project structure    |
| `epic-stage-workflow` | `/next_task` finds work       | Coordinate phase workflow      |
| `phase-design`        | Entering Design phase         | Guide requirements/options     |
| `phase-build`         | Entering Build phase          | Guide implementation           |
| `phase-refinement`    | Entering Refinement phase     | Guide user testing             |
| `phase-finalize`      | Entering Finalize phase       | Guide review/commit            |
| `journal`             | After **every** phase         | Emotional reflection           |
| `lessons-learned`     | After **noteworthy** phases   | Capture learnings              |
| `meta-insights`       | `/analyze_learnings` command  | Continuous improvement         |

### Workflow Sequence

```
/next_task -> task-navigator -> epic-stage-workflow -> phase-* skill
                                                          |
                                              Phase completion
                                                          |
                                              journal (always) + lessons-learned (if applicable)
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

### Notification Hooks

Claude Code supports notification hooks that can alert you when specific events occur. The workflow includes an optional Home Assistant integration for getting notified when Claude is waiting for input.

#### Setting Up Home Assistant Notifications

The `claude_ready.sh` hook sends notifications to Home Assistant when Claude enters an idle state. This is useful for long-running tasks where you want to be notified when Claude needs your input.

**Step 1: Get Your Home Assistant Token**

1. Log into your Home Assistant instance
2. Click on your profile (bottom left corner)
3. Scroll down to "Long-Lived Access Tokens"
4. Click "Create Token"
5. Give it a name like "Claude Code Notifications"
6. Copy the generated token

**Step 2: Find Your Notification Service**

Home Assistant supports multiple notification services:

- **Mobile app**: `mobile_app_DEVICE_NAME` (recommended for phone notifications)
- **Persistent notification**: `persistent_notification` (shows in Home Assistant UI)
- **Other services**: `telegram_bot`, `pushover`, etc.

To find your mobile device name:
1. Go to Home Assistant > Settings > Devices & Services
2. Click on "Mobile App"
3. Your device name will be listed (e.g., `jake_s_android`, `iphone`)

**Step 3: Configure the Hook**

```bash
# Copy the example hook
cp examples/hooks/claude_ready.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/claude_ready.sh

# Edit the script
nano ~/.claude/hooks/claude_ready.sh
```

Replace these placeholders in the script:

- `YOUR_HOME_ASSISTANT_TOKEN_HERE` -> Your long-lived access token
- `YOUR_HOME_ASSISTANT_IP:8123` -> Your Home Assistant URL (e.g., `192.168.1.100:8123` or `homeassistant.local:8123`)
- `mobile_app_YOUR_DEVICE` -> Your notification service (e.g., `mobile_app_jake_s_android`)

**Step 4: Add Hook Configuration**

Add the notification hooks to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/claude_ready.sh"
          }
        ]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/claude_ready.sh"
          }
        ]
      }
    ],
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

See `examples/hooks/settings-hooks-example.json` for a complete example.

**Step 5: Test the Hook**

```bash
# Test the hook manually
echo '{"cwd": "/home/user/test-project"}' | ~/.claude/hooks/claude_ready.sh

# Check if you received a notification
# If not, check the Home Assistant logs for errors
```

#### Customizing Notifications

The hook script includes comments showing how to customize notifications with:

- **Notification actions**: Add buttons like "Open Project"
- **Priority levels**: Set high priority for important notifications
- **Custom sounds**: Choose notification sounds
- **Icons**: Set custom notification icons
- **Multiple services**: Send to multiple notification services

See the comments in `examples/hooks/claude_ready.sh` for detailed examples.

#### How Notification Hooks Work

Claude Code triggers notification hooks on these events:

- `permission_prompt`: Claude is waiting for permission approval (e.g., file write, bash command)
- `idle_prompt`: Claude has finished responding and is waiting for your next prompt

The hook receives a JSON payload with context:

```json
{
  "cwd": "/path/to/project",
  "event": "idle_prompt"
}
```

The script extracts the project path and sends a notification with the project name, making it easy to know which project needs attention.

## Best Practices

### Starting a New Project

1. Begin with brainstorming to refine your idea
2. Create an epic with 3-5 stages
3. Each stage should be completable in 1-3 sessions
4. Start each session with `/next_task`

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
