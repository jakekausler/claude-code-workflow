# Kanban Workflow System — Complete Flowchart

**Date**: 2026-02-16
**Purpose**: Single comprehensive Mermaid flowchart showing every path, decision point, integration, and column in the end-state workflow system.

## How to Read This Diagram

- **Red nodes** (🧑): Human intervention required
- **Orange nodes**: Awaiting/paused states
- **Green nodes**: Active work or completion
- **Blue nodes**: Automated decisions
- **Gray nodes**: Passive/waiting states
- **Diamond nodes**: Decision points
- **Dashed lines**: Optional/conditional paths

## Complete Flowchart

```mermaid
flowchart TD
    %% ═══════════════════════════════════════
    %% ENTRY POINTS
    %% ═══════════════════════════════════════

    subgraph ENTRY["1. ENTRY POINTS"]
        E1["👤 User creates locally<br/>/setup epic · ticket · stage"]
        E2["📥 Jira ticket import"]
        E3["🔗 Jira epic link<br/>(read-only)"]
        E4["🔄 Migration from<br/>old format"]
    end

    %% ═══════════════════════════════════════
    %% CREATION FLOWS
    %% ═══════════════════════════════════════

    subgraph CREATE["2. CREATION"]
        E1 --> CR1{"Has stages<br/>defined?"}
        CR1 -->|Yes| CR2["Create epic dir +<br/>ticket dir + stage files<br/>with YAML frontmatter"]
        CR1 -->|No| CR3["Create ticket with<br/>stages: &#91;&#93;"]

        E2 --> JI1{"Jira skill/MCP<br/>available?"}
        JI1 -->|No| JI2["❌ Jira import<br/>unavailable"]
        JI1 -->|Yes| JI3["Fetch ticket details<br/>from Jira API"]
        JI3 --> JI4["Create ticket file<br/>source: jira<br/>jira_key: PROJ-1234<br/>stages: &#91;&#93;"]

        E3 --> EP1["Create/update epic file<br/>jira_key: PROJ-EPIC-42<br/>(no auto-transitions)"]

        E4 --> MG1["migrate-repo skill:<br/>scan old-format files"]
        MG1 --> MG2["Analyze stages for<br/>thematic grouping"]
        MG2 --> MG3["Propose ticket<br/>groupings to user"]
        MG3 --> MG4["🧑 USER: Approve<br/>or adjust groupings"]
        MG4 --> MG5["Infer dependencies from<br/>stage order · git history ·<br/>code imports"]
        MG5 --> MG6["🧑 USER: Approve<br/>inferred dependencies"]
        MG6 --> CR2
    end

    %% ═══════════════════════════════════════
    %% TICKET CONVERSION
    %% ═══════════════════════════════════════

    subgraph CONVERT["3. TICKET CONVERSION"]
        CR3 --> TC1["📋 TO CONVERT column"]
        JI4 --> TC1

        TC1 --> TC2["convert-ticket skill<br/>invoked"]
        TC2 --> TC3["Invoke brainstorming skill:<br/>explore what stages needed"]
        TC3 --> TC4["🧑 USER: Approve<br/>stage breakdown"]
        TC4 --> TC5["Create stage files via<br/>ticket-stage-setup"]
        TC5 --> TC6["Update ticket frontmatter<br/>with stage list"]
        TC6 --> TC7["Set dependencies<br/>between stages"]
        TC7 --> TC8["kanban-cli validate"]
        TC8 --> CR2
    end

    %% ═══════════════════════════════════════
    %% DEPENDENCY RESOLUTION
    %% ═══════════════════════════════════════

    subgraph DEPS["4. DEPENDENCY RESOLUTION"]
        CR2 --> DEP1{"All depends_on<br/>resolved?"}
        DEP1 -->|No| DEP2["⏸️ BACKLOG column<br/>waiting for dependencies"]
        DEP1 -->|Yes| DEP3["✅ READY FOR WORK<br/>column"]

        DEP2 --> DEP4["Dependency completes<br/>(stage·ticket·epic·cross-repo)"]
        DEP4 --> DEP1
    end

    %% ═══════════════════════════════════════
    %% ORCHESTRATION LOOP
    %% ═══════════════════════════════════════

    subgraph ORCH["5. ORCHESTRATION LOOP"]
        DEP3 --> OL1["kanban-cli next<br/>--max WORKFLOW_MAX_PARALLEL"]

        OL1 --> OL2["Priority sort:<br/>1 Review comments pending<br/>2 Awaiting refinement<br/>3 Refinement ready<br/>4 Build ready<br/>5 Design ready<br/>6 Explicit priority field<br/>7 Due date proximity"]

        OL2 --> OL3{"needs_human?"}
        OL3 -->|Yes| OL4["⏸️ Skip — leave in<br/>Awaiting column"]
        OL3 -->|No| OL5{"Under<br/>MAX_PARALLEL<br/>limit?"}
        OL5 -->|No| OL6["Wait for active<br/>session to complete"]
        OL6 --> OL5
        OL5 -->|Yes| OL7["Assign WORKTREE_INDEX<br/>(1..N)"]
        OL7 --> OL8["git worktree add<br/>worktree_branch from frontmatter"]
        OL8 --> OL9{"Isolation strategy<br/>in CLAUDE.md?"}
        OL9 -->|No| OL10["❌ Error: repo must define<br/>Worktree Isolation Strategy"]
        OL9 -->|Yes| OL11["Configure isolation:<br/>Port = base + INDEX<br/>DB = name_INDEX<br/>.env.worktree template"]
        OL11 --> OL12["Spawn fresh Claude session<br/>in worktree<br/>(Ralph-loop: clean context)"]
        OL12 --> OL13["Session reads stage file<br/>determines current phase"]
        OL13 --> OL14["Invoke ticket-stage-workflow<br/>→ route to phase skill"]
    end

    %% ═══════════════════════════════════════
    %% DESIGN PHASE
    %% ═══════════════════════════════════════

    subgraph DESIGN["6. DESIGN PHASE"]
        OL14 -->|"status: Not Started<br/>or Design"| D1["🟣 DESIGN column<br/>phase-design skill"]

        D1 --> D2["Delegate: task-navigator<br/>get task card"]
        D2 --> D3["Delegate: Explore agent<br/>gather codebase context"]
        D3 --> D4{"Multiple approaches<br/>or architecturally<br/>complex?"}

        D4 -->|Yes| D5["Delegate: brainstormer<br/>(Opus model)<br/>generate 2-3 approaches<br/>with recommendation"]
        D4 -->|"No — single<br/>obvious approach"| D6["Document single<br/>approach in stage file"]

        D5 --> D7{"WORKFLOW_<br/>AUTO_DESIGN?"}
        D7 -->|true| D8["Accept recommended<br/>approach automatically<br/>log reasoning to stage file"]
        D7 -->|false| D9["Present options<br/>to user"]
        D9 --> D10["🟠 AWAITING DESIGN<br/>DECISION column<br/>Session exits"]

        D10 --> D11["🧑 USER: Select<br/>approach from options"]
        D11 --> D12["Log selection<br/>to stage file"]

        D8 --> D12
        D6 --> D12

        D12 --> D13{"First stage of ticket<br/>entering Design AND<br/>ticket has jira_key?"}
        D13 -->|Yes| D14{"WORKFLOW_<br/>JIRA_CONFIRM?"}
        D14 -->|false| D15["Auto: Jira assign +<br/>move to In Progress"]
        D14 -->|true| D16["🧑 USER: Confirm<br/>Jira transition"]
        D13 -->|No| D17["Skip Jira"]
        D15 --> D17
        D16 --> D17

        D17 --> D18["Delegate: doc-updater<br/>mark Design complete"]
        D18 --> EXIT1["→ Phase Exit Gate"]
    end

    %% ═══════════════════════════════════════
    %% BUILD PHASE
    %% ═══════════════════════════════════════

    subgraph BUILD["7. BUILD PHASE"]
        EXIT1 -->|"next phase"| B1["🟢 BUILD column<br/>phase-build skill"]

        B1 --> B2["Ensure worktree exists<br/>git worktree add if needed"]
        B2 --> B3{"Complexity?"}

        B3 -->|"3+ files,<br/>cross-package"| B4["Delegate: planner (Opus)<br/>write spec → /tmp/spec-*"]
        B3 -->|"Single file,<br/>clear requirements"| B5["Delegate: planner-lite<br/>(Sonnet)<br/>write spec → /tmp/spec-*"]
        B3 -->|"Literally<br/>one line"| B6["Skip planner"]

        B4 --> B7["Delegate: scribe<br/>implement from spec"]
        B5 --> B7
        B6 --> B7

        B7 --> B8{"Seed data agreed<br/>in Design?"}
        B8 -->|Yes| B9["Add seed data"]
        B8 -->|No| B10["Skip seed data"]
        B9 --> B11["Add placeholder stubs<br/>(future features)"]
        B10 --> B11

        B11 --> B12["Verify dev server works"]
        B12 --> B13["Parallel: delegate<br/>verifier + tester"]

        B13 --> B14{"All green?"}
        B14 -->|No| B15["Delegate: debugger<br/>→ fixer → rerun"]
        B15 --> B13
        B14 -->|Yes| B16["Delegate: doc-updater<br/>mark Build complete"]
        B16 --> EXIT2["→ Phase Exit Gate"]
    end

    %% ═══════════════════════════════════════
    %% REFINEMENT PHASE
    %% ═══════════════════════════════════════

    subgraph REFINE["8. REFINEMENT PHASE"]
        EXIT2 -->|"next phase"| R1["🟢 REFINEMENT column<br/>phase-refinement skill"]

        R1 --> R2["Read refinement_type<br/>from frontmatter"]

        R2 --> R3{"Type(s)?"}
        R3 -->|frontend| R4["☐ Desktop Approved<br/>☐ Mobile Approved"]
        R3 -->|backend| R5["☐ E2E Tests Approved"]
        R3 -->|cli| R6["☐ CLI Behavior Approved"]
        R3 -->|database| R7["☐ Migration Verified<br/>☐ Data Integrity Approved"]
        R3 -->|infrastructure| R8["☐ Deployment Verified"]
        R3 -->|custom| R9["☐ User-defined checks<br/>(from Design phase)"]
        R3 -->|"multiple"| R10["Combined checklist:<br/>all types required"]

        R4 --> R11["Run type-specific testing"]
        R5 --> R11
        R6 --> R11
        R7 --> R11
        R8 --> R11
        R9 --> R11
        R10 --> R11

        R11 --> R12["🟠 AWAITING REFINEMENT<br/>column"]
        R12 --> R13["🧑 USER: Formal approval<br/>per checklist item"]

        R13 --> R14{"Code changed<br/>during refinement?"}
        R14 -->|Yes| R15["🔴 RESET ALL approvals<br/>ALL types<br/>NO EXCEPTIONS"]
        R15 --> R2
        R14 -->|No| R16{"All items<br/>approved?"}
        R16 -->|No| R17["Address feedback<br/>delegate: debugger/fixer"]
        R17 --> R14
        R16 -->|Yes| R18["Mark Refinement complete"]

        R18 --> R19["Add regression items<br/>to ticket regression.md"]
        R19 --> R20["☐ Regression Items Added"]
        R20 --> EXIT3["→ Phase Exit Gate"]
    end

    %% ═══════════════════════════════════════
    %% FINALIZE PHASE
    %% ═══════════════════════════════════════

    subgraph FINAL["9. FINALIZE PHASE"]
        EXIT3 -->|"next phase"| F1["⬛ FINALIZE column<br/>phase-finalize skill"]

        F1 --> F2["Delegate: code-reviewer<br/>(Opus) pre-test review"]
        F2 --> F3["Implement ALL review<br/>suggestions via fixer/scribe<br/>(mandatory — all severities)"]

        F3 --> F4{"Tests written<br/>in Build phase?"}
        F4 -->|No| F5["Delegate: test-writer"]
        F4 -->|Yes| F6["Skip test-writer"]
        F5 --> F7["Delegate: tester<br/>run all tests"]
        F6 --> F7

        F7 --> F8{"Implementation code<br/>changed after review<br/>suggestions?"}
        F8 -->|Yes| F9["Delegate: code-reviewer<br/>(Opus) post-test review"]
        F8 -->|"No — only<br/>new test files"| F10["Skip second review"]
        F9 --> F11["Implement post-test<br/>review suggestions"]
        F11 --> F12["Continue"]
        F10 --> F12

        F12 --> F13{"Complex or<br/>public-facing?"}
        F13 -->|Yes| F14["Delegate: doc-writer"]
        F13 -->|No| F15["doc-writer-lite<br/>or skip"]
        F14 --> F16["Delegate: doc-updater<br/>write changelog entry"]
        F15 --> F16

        F16 --> F17["Create implementation commit<br/>(specific file paths<br/>NEVER git add -A)"]

        F17 --> F18{"WORKFLOW_<br/>REMOTE_MODE?"}
    end

    %% ═══════════════════════════════════════
    %% LOCAL MODE
    %% ═══════════════════════════════════════

    subgraph LOCAL["9a. LOCAL MODE"]
        F18 -->|false| L1["Merge to main"]
        L1 --> L2["Commit changelog<br/>(specific file)"]
        L2 --> L3["Commit tracking files<br/>(specific files)"]
        L3 --> L4["Set status: Complete"]
        L4 --> EXIT4["→ Phase Exit Gate"]
    end

    %% ═══════════════════════════════════════
    %% REMOTE MODE
    %% ═══════════════════════════════════════

    subgraph REMOTE["9b. REMOTE MODE"]
        F18 -->|true| RM1["Push worktree branch<br/>to remote"]

        RM1 --> RM2{"WORKFLOW_<br/>GIT_PLATFORM?"}
        RM2 -->|github| RM3["gh pr create"]
        RM2 -->|gitlab| RM4["glab mr create"]
        RM2 -->|auto| RM5["Detect from<br/>remote URL"]
        RM5 --> RM3
        RM5 --> RM4

        RM3 --> RM6["Build MR/PR description"]
        RM4 --> RM6

        RM6 --> RM7{"Ticket has<br/>jira_key?"}
        RM7 -->|Yes| RM8["Include Jira ticket link<br/>in MR description"]
        RM7 -->|No| RM9["Standard description"]
        RM8 --> RM10{"Epic has<br/>jira_key?"}
        RM9 --> RM10
        RM10 -->|Yes| RM11["Reference Jira epic<br/>in MR description"]
        RM10 -->|No| RM12["Continue"]
        RM11 --> RM12

        RM12 --> RM13{"Ticket has<br/>jira_key?"}
        RM13 -->|Yes| RM14{"WORKFLOW_<br/>JIRA_CONFIRM?"}
        RM14 -->|false| RM15["Auto: Jira →<br/>In Review / In Testing"]
        RM14 -->|true| RM16["🧑 USER: Confirm<br/>Jira transition"]
        RM13 -->|No| RM17["Skip Jira transition"]
        RM15 --> RM17
        RM16 --> RM17

        RM17 --> RM18{"WORKFLOW_<br/>SLACK_WEBHOOK<br/>set?"}
        RM18 -->|Yes| RM19["POST Slack notification<br/>MR/PR link + title +<br/>summary + Jira key"]
        RM18 -->|No| RM20["Skip Slack"]
        RM19 --> RM21["Set status:<br/>Awaiting Merge"]
        RM20 --> RM21

        RM21 --> RM22["🟠 AWAITING MERGE<br/>column"]
    end

    %% ═══════════════════════════════════════
    %% REVIEW CYCLE
    %% ═══════════════════════════════════════

    subgraph REVIEW["10. REVIEW CYCLE"]
        RM22 --> RV1["🧑 TEAM: Review MR/PR<br/>on GitHub/GitLab"]

        RV1 --> RV2{"Comments<br/>to address?"}
        RV2 -->|Yes| RV3["review-cycle skill<br/>invoked"]
        RV3 --> RV4["Fetch comments via<br/>gh pr view --comments /<br/>glab mr notes list"]
        RV4 --> RV5["Parse: actionable<br/>vs discussion"]
        RV5 --> RV6["For each actionable comment:<br/>delegate fixer/scribe"]
        RV6 --> RV7["Run verification<br/>(tests + lint)"]
        RV7 --> RV8["Push updated branch"]
        RV8 --> RV9["Post reply comments<br/>on MR/PR"]
        RV9 --> RV1

        RV2 -->|"No — approved"| RV10["MR/PR merged"]
        RV10 --> RV11["Set status: Complete"]
        RV11 --> EXIT4
    end

    %% ═══════════════════════════════════════
    %% PHASE EXIT GATE (shared)
    %% ═══════════════════════════════════════

    subgraph EXITGATE["11. PHASE EXIT GATE"]
        EXIT4 --> EG1["Update stage file<br/>(mark phase complete)"]
        EG1 --> EG2["Update ticket file<br/>(stage status table)"]
        EG2 --> EG3["Update epic file<br/>(ticket status)"]
        EG3 --> EG4["kanban-cli sync<br/>(update SQLite cache)"]
        EG4 --> EG5["Invoke lessons-learned<br/>(if triggers apply:<br/>multiple attempts ·<br/>user correction ·<br/>unexpected friction ·<br/>undocumented pattern ·<br/>process violation)"]
        EG5 --> EG6["Invoke journal<br/>(ALWAYS — mandatory)"]

        EG6 --> EG7{"Unanalyzed learnings<br/>> WORKFLOW_<br/>LEARNINGS_THRESHOLD?"}
        EG7 -->|Yes| EG8["Auto-invoke<br/>meta-insights<br/>(analyze patterns ·<br/>generate improvement<br/>prompts)"]
        EG7 -->|No| EG9["Continue"]
        EG8 --> EG9
    end

    %% ═══════════════════════════════════════
    %% COMPLETION CASCADE
    %% ═══════════════════════════════════════

    subgraph COMPLETE["12. COMPLETION CASCADE"]
        EG9 --> CC1{"Was this the<br/>Finalize phase?"}
        CC1 -->|"No — more<br/>phases remain"| CC2["Route to next phase:<br/>Design → Build<br/>Build → Refinement<br/>Refinement → Finalize"]
        CC2 --> OL14

        CC1 -->|Yes| CC3["🟢 DONE column<br/>Stage complete"]
        CC3 --> CC4["Clean up worktree<br/>(git worktree remove)"]
        CC4 --> CC5{"All stages in<br/>ticket complete?"}

        CC5 -->|No| CC6["Ticket stays<br/>In Progress"]
        CC6 --> CC9["Scheduler picks<br/>next ready stage"]
        CC9 --> OL1

        CC5 -->|Yes| CC7["Ticket status:<br/>Complete"]
        CC7 --> CC8{"Ticket has<br/>jira_key?"}
        CC8 -->|Yes| CC10{"WORKFLOW_<br/>JIRA_CONFIRM?"}
        CC10 -->|false| CC11["Auto: Jira ticket<br/>→ Done"]
        CC10 -->|true| CC12["🧑 USER: Confirm<br/>Jira → Done"]
        CC8 -->|No| CC13["Skip Jira"]
        CC11 --> CC13
        CC12 --> CC13

        CC13 --> CC14{"All tickets in<br/>epic complete?"}
        CC14 -->|No| CC15["Epic stays<br/>In Progress"]
        CC15 --> CC9
        CC14 -->|Yes| CC16["Epic status:<br/>Complete"]
        CC16 --> CC9
    end

    %% ═══════════════════════════════════════
    %% STYLING
    %% ═══════════════════════════════════════

    %% Entry points
    style E1 fill:#3498db,stroke:#333,color:#fff
    style E2 fill:#3498db,stroke:#333,color:#fff
    style E3 fill:#3498db,stroke:#333,color:#fff
    style E4 fill:#3498db,stroke:#333,color:#fff

    %% Human intervention (red)
    style MG4 fill:#e74c3c,stroke:#333,color:#fff
    style MG6 fill:#e74c3c,stroke:#333,color:#fff
    style TC4 fill:#e74c3c,stroke:#333,color:#fff
    style D11 fill:#e74c3c,stroke:#333,color:#fff
    style D16 fill:#e74c3c,stroke:#333,color:#fff
    style R13 fill:#e74c3c,stroke:#333,color:#fff
    style RM16 fill:#e74c3c,stroke:#333,color:#fff
    style RV1 fill:#e74c3c,stroke:#333,color:#fff
    style CC12 fill:#e74c3c,stroke:#333,color:#fff

    %% Awaiting/paused (orange)
    style TC1 fill:#e67e22,stroke:#333,color:#fff
    style D10 fill:#e67e22,stroke:#333,color:#fff
    style R12 fill:#e67e22,stroke:#333,color:#fff
    style RM22 fill:#e67e22,stroke:#333,color:#fff
    style OL4 fill:#e67e22,stroke:#333,color:#fff
    style DEP2 fill:#95a5a6,stroke:#333,color:#fff

    %% Active columns (green)
    style DEP3 fill:#2ecc71,stroke:#333,color:#fff
    style CC3 fill:#27ae60,stroke:#333,color:#fff
    style CC7 fill:#27ae60,stroke:#333,color:#fff
    style CC16 fill:#27ae60,stroke:#333,color:#fff
    style L4 fill:#27ae60,stroke:#333,color:#fff
    style RV11 fill:#27ae60,stroke:#333,color:#fff

    %% Phase columns
    style D1 fill:#9b59b6,stroke:#333,color:#fff
    style B1 fill:#2ecc71,stroke:#333,color:#fff
    style R1 fill:#1abc9c,stroke:#333,color:#fff
    style F1 fill:#34495e,stroke:#333,color:#fff

    %% Reset rule
    style R15 fill:#c0392b,stroke:#333,color:#fff

    %% Error
    style JI2 fill:#7f8c8d,stroke:#333,color:#fff
    style OL10 fill:#c0392b,stroke:#333,color:#fff
```

## Node Count Summary

| Section | Nodes | Decision Points |
|---------|-------|-----------------|
| Entry Points | 4 | 0 |
| Creation | 12 | 2 |
| Ticket Conversion | 8 | 0 |
| Dependency Resolution | 4 | 1 |
| Orchestration Loop | 14 | 3 |
| Design Phase | 18 | 4 |
| Build Phase | 16 | 3 |
| Refinement Phase | 20 | 3 |
| Finalize Phase | 18 | 3 |
| Local Mode | 4 | 0 |
| Remote Mode | 22 | 5 |
| Review Cycle | 11 | 1 |
| Phase Exit Gate | 9 | 1 |
| Completion Cascade | 16 | 5 |
| **Total** | **~176** | **~31** |

## Legend

| Symbol | Meaning |
|--------|---------|
| 🧑 | Human intervention required |
| 📋 | Kanban column |
| 📥 | External import |
| 🔗 | Read-only link |
| 🔄 | Migration/conversion |
| ☐ | Checklist item |
| 🔴 | Mandatory reset |
| ❌ | Error/unavailable |
| ✅ | Ready/resolved |
| ⏸️ | Paused/waiting |
| 🟣 | Design phase |
| 🟢 | Build/completion |
| 🟠 | Awaiting state |
| ⬛ | Finalize phase |
