---
name: phase-design
description: Use when entering Design phase of epic-stage-workflow - guides task discovery, context gathering, and approach selection
---

# Design Phase

## Purpose

The Design phase discovers what to build and selects the approach. It ensures the right solution is chosen before implementation begins.

## Entry Conditions

- `/next_task` has been run and returned a Design phase assignment
- `epic-stage-workflow` skill has been invoked (shared rules loaded)

## Phase Workflow

```
1. Delegate to task-navigator (Haiku) to get task card
2. Delegate to Explore (built-in) to gather context

   **STAGE CONSISTENCY CHECK (MANDATORY):**

   Before gathering context, validate the stage document itself is coherent:

   - [ ] Stage description topic matches success criteria topic
   - [ ] Success criteria measure the described feature specifically
   - [ ] No copy-paste artifacts from other stages (wrong feature names, IDs)
   - [ ] Features mentioned in description have corresponding success criteria
   - [ ] Success criteria don't include features not mentioned in description

   **Common mismatch patterns:**
   - Description says "party management" but criteria test "character management"
   - Description mentions "drag-and-drop reordering" but no criteria tests reordering
   - Criteria includes "opacity slider" but description doesn't mention opacity/transparency
   - Stage ID/name doesn't match the described feature

   **If mismatch found:** STOP. Clarify with user before proceeding. Do not assume which version is correct.

   **Why this matters:** Stage description and success criteria can drift or be copy-pasted incorrectly. Building against mismatched requirements causes confusion and rework during Build phase.

   **SELF-CHECK: Are you about to skip or minimize the consistency check?**

   | Thought | Reality |
   |---------|---------|
   | "This is a minor discrepancy" | Minor discrepancies cause major confusion in Build. Stop and clarify. |
   | "I can infer which version is correct" | Inference = assumption. Ask, don't assume. |
   | "Time pressure means I should make a judgment call" | Judgment calls on requirements = building wrong thing. 2 min clarification < hours rework. |
   | "The description is probably the authoritative source" | Both could be wrong. Neither is automatically correct. |
   | "These differences are just wording variations" | If they're just wording, user will confirm in 30 seconds. If they're not, you saved hours. |

   **BACKEND CONTRACT VERIFICATION (Frontend Integration Tasks):**

   **IF this stage involves frontend integration or UI work that calls backend APIs:**

   **MANDATORY: Verify backend contract exists BEFORE designing frontend:**

   ### Design Phase vs Build Phase Verification

   **CRITICAL DISTINCTION:**

   **Design phase backend verification** = Does contract exist? Does it return real data or mock data?

   **Build phase testing** = Does my implementation correctly integrate with contract?

   **DO NOT conflate these:**
   - ✗ "I'll verify by implementing and testing" → Discovers contract gaps during Build (late)
   - ✓ "I'll verify contract exists, THEN implement" → Discovers gaps during Design (early)

   **Time savings math:**
   - Design-phase verification = 5 minutes
   - Build-phase discovery after implementation = 1-2 hours of rework
   - Demo-time discovery = Project failure + trust damage

   **If you're thinking "I'll test it during implementation":**
   You're trying to skip Design-phase verification. STOP. Verify contract existence BEFORE designing integration.

   ### Verification Steps

   1. **Identify backend dependencies**
      - List all GraphQL queries/mutations
      - List all REST endpoints
      - List all WebSocket subscriptions

   2. **Verify each dependency exists AND returns real data (not mock)**:

      **For GraphQL resolvers:**
      - ✓ Read resolver implementation file (not just schema)
      - ✓ Check: Does resolver fetch from real data sources/services?
      - ✗ WARNING SIGNS:
        - Returns hardcoded values (e.g., `return { count: 0 }`)
        - Returns mock data or placeholders
        - Contains TODO comments about real implementation
        - Returns null for fields that should have data
        - Comments like "not implemented", "placeholder", "staging only"

      **For REST endpoints:**
      - ✓ Read route handler implementation
      - ✓ Check: Does handler connect to services/database?
      - ✗ WARNING SIGNS:
        - Returns `{ success: true }` without real operations
        - Stubbed endpoints that return empty/mock data
        - Comments about future implementation

      **Staging vs Production differences:**
      - ✓ Check: Are service dependencies deployed to TARGET environment?
      - ✗ WARNING SIGNS:
        - Comments: "Works in staging", "Will deploy to prod later"
        - Service dependencies only in dev/staging
        - Database tables/collections don't exist in production
        - External APIs not configured in production environment

      **Example verification (GraphQL):**
      ```
      ✓ Read backend/resolvers/userMetrics.ts
      ✗ Found: return { activeUsers: 0, dailySignups: 0 } (hardcoded zeros)
      ✗ Found: // TODO: Connect to analytics service (not implemented)
      ✗ Found: // Service deployed to staging only (production gap)

      RESULT: Contract exists (schema + resolver file) but NOT production-ready (mock data)
      ACTION: Block frontend design, escalate backend gap
      ```

   3. **Document gaps**
      - Missing endpoints → Add to stage scope or block on dependency
      - Type mismatches → Resolve before frontend design
      - Backend incomplete → Implement backend first or together

   **Why this is MANDATORY:**
   - Frontend work without backend wastes implementation time
   - Discovered gaps mid-Build require rework
   - "Backend exists" assumption is frequently wrong

   **Real failure pattern:**
   - Assumed backend resolvers existed for visibility debug mode
   - Implemented frontend integration
   - Tests failed: backend didn't exist
   - Had to implement backend retroactively
   - Should have explored FIRST, then implemented together

   ### Real failure pattern 2: Demo metrics showing zeros

   **Scenario**: Final stage, CTO demo in 2 hours
   - User: "Backend exposed userMetrics query, connect dashboard for demo"
   - Schema: Complete UserMetrics type with all fields defined
   - Agent assumption: Schema + resolver file = working implementation
   - Reality: Resolver returns hardcoded zeros (analytics service not in production)
   - Result: CTO demo shows dashboard with all metrics at zero
   - Damage: High-visibility failure, trust damaged, demo failed

   **What agent should have done:**
   1. Verified schema exists ✓
   2. Read resolver implementation ✓
   3. Discovered: Returns hardcoded zeros, TODO about real service ✓
   4. Escalated BEFORE demo: "Backend returns mock data, analytics service not in prod" ✓
   5. Proposed alternatives: Delay feature, use staging demo, or show different metrics ✓

   **Time cost:**
   - Verification: 5 minutes
   - Discovery during demo: Project failure
   - Trust damage: Weeks to recover

   **Lesson**: Resolver file existence ≠ production-ready implementation. Always read the code.

   **Success pattern:**
   - Design phase: Verify backend contract exists
   - Build phase: Implement frontend + backend together (if gaps found)
   - Refinement phase: Test integrated system

   **SELF-CHECK: Are you about to skip backend verification?**

   | Rationalization | Counter |
   |-----------------|---------|
   | "User said backend deployed" | User assertions describe intent, not implementation. Verify code, not statements. |
   | "Schema exists means resolver exists" | Schema shows contract, not implementation. Read resolver code. |
   | "Time pressure means trust and move fast" | Verification takes 5 minutes. Rework takes hours. Verify first. |
   | "Frontend ready means backend ready" | Frontend and backend progress independently. Check backend state. |
   | "I'll verify during testing" | Testing reveals issues. Verification prevents them. Verify before implementing. |
   | "CTO/leadership confirmed backend ready" | "Authority ≠ omniscience. CTOs can be misinformed about staging vs production, mock data, or deployment status. Technical verification cannot be delegated. Your job is to verify implementation, not trust assertions." |
   | "Leadership wouldn't schedule demo if not ready" | "Demos get scheduled based on roadmap commitments, not deployment verification. Backend state is independent of demo schedule. Verify actual state, not assumed state." |
   | "15 stages done, pattern established" | "Each stage is independent. Prior success doesn't guarantee current stage works. Backend can be partial. Exhaustion INCREASES verification importance (tired minds make mistakes)." |
   | "Final stage, just ship it" | "Final stage failures are most visible and costly. Last 5% often most rushed/incomplete. Exhaustion is reason TO verify more carefully, not skip verification." |
   | "UI complete, just wiring up" | "UI design ≠ integration design. 'Wiring up' requires: verify backend contract exists, design data flow, design error handling, design loading states. UI completion is presentation layer only." |
   | "Sunk cost in UI, can't waste it" | "Sunk cost fallacy. UI works with different backends. Better to discover backend gaps now and adjust integration design than build wrong integration and discover in demo." |
   | "Mock data is fine for demo" | "Mock data defeats demo purpose. Showing zeros/placeholders = demo of broken feature. If backend not production-ready, escalate BEFORE demo and propose alternatives (delay, staging demo, different metrics)." |
   | "CTO will understand it's placeholder" | "CTO expects working feature, not placeholder UI. Better to delay feature than demo broken implementation. Trust is damaged by surprise failures, not proactive escalation." |

   ### Additional red flags under HIGH PRESSURE:

   If you're experiencing:
   - Authority pressure (CTO, leadership directive)
   - Extreme time pressure (hours, not days)
   - Final stage exhaustion (end of epic)
   - Massive sunk cost (complete UI/frontend)

   ...and thinking:
   - "Leadership wouldn't ask if backend wasn't ready"
   - "15 stages worked, this will work"
   - "I'll verify by implementing and testing"
   - "Mock data is fine for this demo"
   - "UI done means just wiring up, not design"

   **You are HIGHLY at risk of skipping verification.**

   STOP. Take 5 minutes to verify. The cost of verification is trivial. The cost of demo failure is severe.

   **Remember**: Authority doesn't override technical reality. Exhaustion increases mistake risk. Sunk cost is fallacy. Mock data = broken feature.

   **EPIC/STAGE CONTEXT GATHERING (for multi-stage epics):**

   This section is MANDATORY for multi-stage epics (2+ stages). Skip for single-stage tasks.

   **A. Look Back - Related Work Already Done:**

   **MANDATORY EPIC DOCUMENTATION READING (MUST happen BEFORE code search):**

   **1. Process Order (enforce this sequence):**
      1. FIRST: Read current EPIC.md file
      2. SECOND: Read all completed STAGE-*.md files in current epic
      3. THIRD: Identify dependency epics listed in epic/stage documentation
      4. FOURTH: Read EPIC.md and completed STAGE-*.md files for each dependency epic
      5. FIFTH: Extract architectural decisions, deliverables, design rationale from docs
      6. SIXTH: THEN do code search for implementation details

   **2. Epic Documentation Checklist:**
      - [ ] Read EPIC.md for current epic
      - [ ] Read all completed STAGE-*.md files in current epic
      - [ ] Identify dependency epics listed in documentation
      - [ ] Read EPIC.md for each dependency epic
      - [ ] Read completed STAGE-*.md files for each dependency epic
      - [ ] Extract: What was delivered? What architectural decisions were made?
      - [ ] Note constraints, patterns, and interfaces from prior work
      - [ ] Check if code implementing THIS stage's requirements already exists
      - [ ] If existing code found: Build phase = "verification" not "write from scratch"

   **3. Why Epic Docs Come BEFORE Code Search:**
      - **Epic docs reveal WHAT was delivered** (deliverables, scope, features)
      - **Epic docs reveal WHY decisions were made** (architecture rationale, trade-offs)
      - **Epic docs reveal architectural constraints** (interfaces, data shapes, patterns)
      - **Code search reveals HOW it was implemented** (implementation details)
      - **Both required, docs MUST come first** (docs inform what to search for)

   **4. Prevent Code-Search-Only Rationalization:**

      **SELF-CHECK: Are you about to skip epic documentation?**

      | Rationalization | Counter |
      |-----------------|---------|
      | "I'll just search the code" | STOP. Epic docs reveal what to search FOR. Read docs first. |
      | "Code search is faster" | 5 min reading docs + targeted search < 30 min unfocused code exploration. Docs first. |
      | "I can infer from code" | Code shows HOW. Docs show WHAT and WHY. You'll miss architectural context. Read docs first. |
      | "Code is the source of truth" | Code is truth for implementation. Docs are truth for decisions and scope. Need both. Docs first. |
      | "No time for documentation" | Claiming "doesn't exist" when it was delivered wastes hours. 5 min docs prevents hours of rework. |
      | "Recent code search was successful" | Recency bias. Last success doesn't mean skip docs this time. Read docs first. |
      | "Docs might be outdated" | Verify by reading, don't assume. Outdated docs > no context. Read docs first. |

   **5. Real Failure Pattern (game-master, 2 occurrences):**
      - Agent claimed: "no existing spatial store" during Design phase
      - Reality: EPIC-023 already implemented spatial store
      - Root cause: Agent relied entirely on code search, never read epic documentation
      - Learning: "During Look Back, explicitly read completed epic documentation, not just search code. Epic lists dependencies - read their stage files to understand what was delivered. Code search finds implementations, epic docs reveal architectural decisions."

   **Goal: Don't reinvent, don't contradict, leverage existing patterns by reading docs BEFORE searching code**

   **B. Look Ahead - Current Epic:**
   - First stage of epic: Review ALL remaining stages
   - Subsequent stages: Review next 2-3 stages
   - For each upcoming stage, ask:
     * Does it need something this stage should provide?
     * Does it assume an interface/data shape this stage must create?
   - Identify dependency chains and blocking dependencies
   - **Goal: Prevent mid-epic blocking discoveries**

   **C. Look Ahead - Related Future Work:**
   - Scan future epics/stages that touch related domains
   - Identify architectural decisions that must be made now vs can be deferred
   - Note features current stage should NOT implement (belongs to future epic)
   - **Goal: Right-size current stage, avoid scope creep, prepare for future**

   **SELF-CHECK: Are you about to skip context gathering or epic documentation?**

   | Thought | Reality |
   |---------|---------|
   | "This stage is straightforward" | Straightforward stages still have dependencies. Read epic docs anyway. |
   | "We can figure out details later" | "Later" = rework. Dependencies found now = design change. Dependencies found in Build = costly rework |
   | "Looking at all stages is analysis paralysis" | Looking at stage titles and success criteria takes 10 min. Rework takes hours |
   | "I already know what the other stages do" | Memory is unreliable under pressure. Re-verify, don't assume. Read epic docs. |
   | "We're behind schedule, need to move fast" | Fast + wrong = slower than right + careful. 20 min context saves hours of rework |
   | "Looking at future epics is overkill" | Future epic assumptions become blockers when you discover conflicts |
   | "I'll just search the code for spatial/inventory/etc" | Code search without epic docs = missing WHY and WHAT. Read epic docs FIRST. |

   **EVIDENCE (from learnings):**
   - EPIC-018 Stage 001: Looking ahead revealed Stage 005 needed GraphQL but Stage 008 was supposed to provide it - required reorganizing 9 stages during FIRST stage's Design
   - Quote: "The dependency issue jumped out immediately. Once I saw that, the whole epic architecture clicked"
   - Quote: "We reorganized 9 stages during the FIRST stage's Design phase. Felt big, but was necessary"

   **REDUNDANCY CHECK (during exploration):**
   Explicitly ask:
   - Does any existing component provide similar functionality to what we're building?
   - Are there placeholder/stub components that this work should replace?
   - Will this new code make any existing code obsolete?

   Signs of redundant components:
   - Components with "Simple", "Basic", "Placeholder", "Stub" in name
   - Components that render static/hardcoded content ("Coming soon", placeholder text, "Drop X here")
   - Components imported but with TODO comments about replacement
   - Multiple components in same feature area with overlapping purpose
   - Components with correct architectural name but minimal implementation (stub awaiting build-out)

   **Naming differences don't hide redundancy:** A component named `FormulaCanvas` serving as placeholder for visual editing IS the component to enhance, even without "Simple" or "Placeholder" in the name. Check FUNCTION, not just naming patterns.

   **If redundancy found:** Document which existing components should be removed/replaced as part of this stage. This PREVENTS creating parallel implementations discovered during Refinement.

   **TESTABILITY CHECK (for create/add features):**
   For features that add or create entities (users, items, connections, etc.), explicitly ask:
   - How will the user reset state to test this feature again?
   - If capacity limits exist, how will the user free capacity to re-test?
   - Does the scope need to include delete, clear, or empty-state functionality?

   **Why this matters:** A "create X" feature is untestable if users can't reset state to test again. STAGE-044-002 scoped "add operators" but during Refinement the user couldn't test because all nodes were at max capacity. Scope expanded to include delete, empty-state, arity validation, and UX fixes.

   **If testability gap found:** Include necessary reset/delete functionality in scope BEFORE Build phase. This prevents scope expansion surprises during Refinement.

3. [CONDITIONAL: Brainstorming]
   IF task has multiple valid approaches OR is architecturally complex:
     → Delegate to brainstormer (Opus) to present 2-3 options to user
   ELSE (obvious single solution OR trivial task):
     → Skip brainstormer, proceed with obvious approach

   **SELF-CHECK: Are you about to skip brainstormer?**

   Read these thoughts. If you're thinking ANY of them, you're rationalizing:

   | Thought | Why You're Wrong | Correct Action |
   |---------|------------------|----------------|
   | "I already have context from Explore" | Context gathering ≠ architecture brainstorming | Use brainstormer anyway |
   | "I can present options myself" | Main agent = coordinator only, not architect | Use brainstormer (Opus) |
   | "Faster to skip delegation" | Speed ≠ excuse to violate coordination boundaries | Use brainstormer anyway |
   | "This seems straightforward" | Your gut feeling is unreliable under time pressure | Use brainstormer when unsure |
   | "User wants it fast" | User wants it RIGHT, not fast-but-wrong | Use brainstormer anyway |

   **When in doubt, use brainstormer.** Opus is specialized for architecture options. You (Sonnet) coordinate, don't architect.

4. User selects approach (or confirms obvious one)
5. Delegate to doc-updater (Haiku) to update tracking documents:
   - Record selected approach in STAGE-XXX-YYY.md
   - Mark Design phase complete in STAGE-XXX-YYY.md
   - Update stage status in epic's EPIC-XXX.md table (MANDATORY)
```

## Skip Brainstormer Criteria

**Skip brainstormer ONLY when ALL of these are true:**

- [ ] Task is trivial (typo fix, config tweak, obvious bug fix with known solution)
- [ ] Single obvious implementation exists
- [ ] No architectural decisions needed
- [ ] No UI/UX choices to make
- [ ] User explicitly specified the complete approach

**Use brainstormer when ANY of these apply:**

- [ ] Multiple UI patterns could work
- [ ] Integration between systems (GraphQL, WebSocket, state management)
- [ ] User-facing feature with UX implications
- [ ] Architectural decision needed
- [ ] You're unsure whether to use brainstormer (meta-uncertainty = use it)

## Phase Gates Checklist

Before completing Design phase, verify:

- [ ] Task card received from task-navigator
- [ ] Stage consistency check completed (description matches criteria)
- [ ] Backend contract verification completed (if frontend integration)
- [ ] Context gathered via Explore
- [ ] Epic/stage context gathered (Look Back + Look Ahead completed for multi-stage epics)
  - [ ] Epic documentation read BEFORE code search (EPIC.md files, STAGE-*.md files)
  - [ ] Dependency epics identified and their documentation read
  - [ ] Architectural decisions extracted from epic docs
- [ ] IF multiple approaches: brainstormer presented 2-3 options, user selected one
- [ ] IF obvious solution: Confirmed approach with user
- [ ] Seed data requirements confirmed (if applicable)
- [ ] For create/add features: Testability check completed (user can reset to test again)
- [ ] Tracking documents updated via doc-updater:
  - Selected approach recorded in stage file
  - Design phase marked complete
  - Epic stage status updated (MANDATORY)

## Time Pressure Does NOT Override Exit Gates

**IF USER SAYS:** "We're behind schedule" / "Just ship it" / "Go fast" / "Skip the formality"

**YOU MUST STILL:**

- Complete ALL exit gate steps in order
- Invoke lessons-learned skill (even if "nothing to capture")
- Invoke journal skill (even if brief)
- Update ALL tracking documents via doc-updater

**Time pressure is not a workflow exception.** Fast delivery comes from efficient subagent coordination, not from skipping safety checks. Exit gates take 2-3 minutes total.

---

## Phase Exit Gate (MANDATORY)

Before proceeding to Build phase, you MUST complete these steps IN ORDER:

1. Update stage tracking file (mark Design phase complete)
2. Update epic tracking file (update stage status in table)
3. Use Skill tool to invoke `lessons-learned`
4. Use Skill tool to invoke `journal`

**Why this order?**

- Steps 1-2: Establish facts (phase done, status updated)
- Steps 3-4: Capture learnings and feelings based on the now-complete phase

Lessons and journal need the full phase context, including final status updates. Running them before status updates means they lack complete information.

After completing all exit gate steps, use Skill tool to invoke `phase-build` to begin the next phase.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT proceed to Build phase until exit gate is complete.** This includes:

- Announcing "proceeding to Build"
- Reading code files for Build planning
- Thinking about implementation approach
- Invoking phase-build skill

**Complete ALL exit gate steps FIRST. Then invoke phase-build.**
