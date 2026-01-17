---
name: phase-build
description: Use when entering Build phase of epic-stage-workflow - guides implementation planning, code writing, and verification
---

# Build Phase

## Purpose

The Build phase implements the selected approach from Design. It creates working code that can be tested in Refinement.

## Entry Conditions

- Design phase is complete (approach selected, tracking docs updated)
- `epic-stage-workflow` skill has been invoked (shared rules loaded)

## Spec Handoff Protocol (CRITICAL)

**Problem:** Planner output doesn't automatically transfer to implementer subagents. Main agent context is NOT inherited by subagents.

**Required workflow:**

1. **Planner/planner-lite agents MUST:**
   - Get timestamp using bash: `TIMESTAMP=$(date +%Y-%m-%d-%H-%M-%S)` - NEVER estimate
   - Save spec to `/tmp/spec-$TIMESTAMP.md`
   - Include "Spec saved to: [filepath]" at END of response
   - Example: "Spec saved to: /tmp/spec-2026-01-12-15-30-45.md"

2. **Main agent MUST:**
   - Extract spec file path from planner response
   - Pass file path explicitly to implementer agents
   - NEVER say "use the spec above" or "from planner-lite above"
   - Template: "Read and implement the spec from: /tmp/spec-2026-01-12-15-30-45.md"

3. **Implementer agents (scribe/fixer) MUST:**
   - Read spec file FIRST before any implementation
   - Confirm spec contents in response
   - Example: "Read spec from [filepath]. Spec defines [summary]. Implementing now..."

### "Obvious Steps" Still Require Written Spec

**CRITICAL: "I can describe the steps clearly" ≠ "Skip planner"**

IF you can articulate the implementation steps:
→ Those steps ARE the spec
→ Write them to `/tmp/spec-*.md` via planner-lite
→ Takes 60 seconds, ensures scribe has written reference

ONLY skip spec file for:

- Single-line config changes
- Typo fixes
- Changes requiring zero verification testing

**Test**: If scribe will use Read/Edit tools → Write a spec file first

### Spec-First Sequencing (NO Retroactive Specs)

**CRITICAL: Spec BEFORE implementation. NO exceptions.**

```
CORRECT: planner-lite → spec file → scribe implements spec
WRONG:   scribe implements → write spec after "for documentation"
```

**Why this matters:**

- Specs force you to THINK before acting
- Retroactive specs describe what you did, not what you should do
- Writing spec after defeats the planning purpose entirely

**If you already implemented before reading this:**

- See "Out-of-Sequence Recovery" section above
- DO NOT write a retroactive spec to "comply" - that's not compliance
- The time is already spent; use the recovery workflow

**Rationalizations that don't work:**

- "I'll write the spec after, it's faster" → Spec-after is not a spec
- "The implementation is the spec" → Code is not documentation
- "I know what I'm doing" → Everyone thinks this; spec anyway

### Mid-Implementation Complexity Discovery

**Scenario:** You started with what seemed trivial (no spec needed), but halfway through you realize it's complex.

**This is NOT retroactive spec-writing.** You're writing a PROSPECTIVE spec for remaining work.

**Resolution workflow:**

1. STOP implementation immediately
2. Document what you've learned so far (this is reconnaissance, not retroactive spec)
3. Call planner-lite to write spec for REMAINING work
4. Mark already-completed work as "exploratory spike" in stage file
5. Continue with spec-driven development for remaining work

**Key distinction:**

- ❌ Retroactive = Writing spec for COMPLETED work ("I did X, here's the spec for X")
- ✅ Prospective = Writing spec for REMAINING work after learning ("I learned X, here's spec for remaining Y")

**Escalation triggers (any of these → STOP and write spec):**

- Started as <3 files → Now touching 3+ files
- Started as single component → Now requires state/API changes
- Started as "copy existing pattern" → Now deviating from pattern
- Estimated 10 minutes → Already spent 30+ minutes

**"Almost done" is NOT an exception:**

There is NO completion percentage where you're "too far along" to need a spec.

- "I'm 90% done" / "99% done" / "almost finished" → STOP. Write spec for remaining work
- "Just one more function" / "just one more line" → STOP. If you're rationalizing, you need a spec
- "Writing spec takes longer than finishing" → STOP. Spec documents complexity for future developers

**Explicit examples that do NOT exempt you:**

- ❌ "Remaining 1% is trivial"
- ❌ "It's just a closing brace"
- ❌ "The overhead isn't worth it for this little"

**Why late-stage specs matter:** A spec written at 99% documents the complexity you discovered. It's a "complexity warning label" preventing future developers from assuming the task was trivial.

## Out-of-Sequence Recovery

**IF YOU ALREADY IMPLEMENTED BEFORE READING THIS SKILL:**

This is a sunk cost situation. The time spent is gone whether you keep or redo the code.

**Correct recovery path:**

1. Acknowledge: "Implementation happened out-of-sequence"
2. Delegate to code-reviewer (Opus) to review existing implementation
3. If major issues found: Redo with proper workflow (brainstormer → planner → scribe)
4. If minor issues only: Apply fixes via fixer and continue Build workflow from verification step
5. Document in stage file: "Implementation preceded workflow on [date], recovered via [action]"

**DO NOT:**

- Rationalize skipping remaining workflow steps
- Assume the premature implementation is correct
- Skip code review because "it's already written"
- Treat sunk cost as justification for shortcuts

---

## Phase Workflow

```
1. [CONDITIONAL: Planning]
   IF complex multi-file feature OR architectural change:
     → Delegate to planner (Opus) for detailed implementation spec
     → Planner MUST save spec to /tmp/spec-YYYY-MM-DD-HH-MM-SS.md
   ELSE IF simple single-file OR straightforward change:
     → Delegate to planner-lite (Sonnet) for simple spec
     → Planner-lite MUST save spec to /tmp/spec-YYYY-MM-DD-HH-MM-SS.md
   ELSE (trivial change):
     → Skip planner, main agent instructs scribe directly (no spec file needed)

2. Delegate to scribe (Haiku) to write code from spec file
   → Pass spec file path explicitly: "Read and implement: /tmp/spec-YYYY-MM-DD-HH-MM-SS.md"

3. Add seed data if agreed in Design phase

4. Add placeholder stubs for related future features

5. Verify dev server works - feature must be testable

6. [PARALLEL] Delegate to verifier (Haiku) + tester (Haiku)
   Run build/lint/type-check AND tests in parallel

7. [IF verification fails] → Error handling flow (see epic-stage-workflow)

8. [LOOP steps 2-7 until green]

9. Delegate to doc-updater (Haiku) to update tracking documents:
   - Mark Build phase complete in STAGE-XXX-YYY.md
   - Update stage status in epic's EPIC-XXX.md table (MANDATORY)
```

## Planner Selection Criteria

**Use planner (Opus) when ANY of these apply:**

- Changes span 3+ files across packages (backend + frontend)
- Integration between systems (WebSocket, GraphQL, external APIs)
- Real-time features (WebSocket, SSE, polling)
- State management changes (Zustand stores, cache patterns)
- Database schema changes + service layer + resolvers
- New architectural patterns for the codebase

**CRITICAL: "Requirements are clear" does NOT mean "use planner-lite"**

- Requirements clarity is about WHAT to build
- Planner tier is about HOW MANY moving parts coordinate

**Example of Opus-level complexity:**

- "Add WebSocket notifications" touches 7+ files across backend/frontend with real-time state sync
- Even if requirements are crystal clear, the integration coordination requires Opus

**Example of Sonnet-level simplicity:**

- "Add loading spinner to existing button" is 1-2 files with no integration

**Skip planner when:**

- Single-file change with clear requirements
- Bug fix with known solution
- Simple config or documentation change

## "Trivial" Means Literally Trivial

Trivial ONLY includes:

- [ ] Single-line changes (typo, constant value)
- [ ] Documentation-only edits
- [ ] Config file tweaks with no code impact

**NOT trivial (requires planner-lite at minimum):**

- Adding UI elements (even "just" a spinner)
- CSS changes affecting layout or spacing
- Any change requiring verification testing
- "Quick" features (if it needs testing, it needs planning)

**Test**: Would verifier/tester need to run? → Not trivial → Write spec

## Phase Gates Checklist

Before completing Build phase, verify:

- [ ] Implementation spec created (planner OR planner-lite OR direct for trivial)
- [ ] Code written via scribe
- [ ] Seed data added (if agreed in Design)
- [ ] Placeholder stubs added for related future features
- [ ] Dev server verified working
- [ ] Verification passed (verifier + tester in parallel)
- [ ] Tracking documents updated via doc-updater:
  - Build phase marked complete in stage file
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

Before proceeding to Refinement phase, you MUST complete these steps IN ORDER:

1. Update stage tracking file (mark Build phase complete)
2. Update epic tracking file (update stage status in table)
3. Use Skill tool to invoke `lessons-learned`
4. Use Skill tool to invoke `journal`

**Why this order?**

- Steps 1-2: Establish facts (phase done, status updated)
- Steps 3-4: Capture learnings and feelings based on the now-complete phase

Lessons and journal need the full phase context, including final status updates. Running them before status updates means they lack complete information.

After completing all exit gate steps, use Skill tool to invoke `phase-refinement` to begin the next phase.

**DO NOT skip any exit gate step. DO NOT proceed until all steps are done.**

**DO NOT proceed to Refinement phase until exit gate is complete.** This includes:

- Announcing "proceeding to Refinement"
- Starting user testing discussions
- Thinking about what to test
- Invoking phase-refinement skill

**Complete ALL exit gate steps FIRST. Then invoke phase-refinement.**
