# Epic/Stage Workflow - CLAUDE.md Templates

These sections should be added to a project's CLAUDE.md when bootstrapping the workflow.

---

## Development Workflow

### Hierarchy

- **Epic** = Feature (Dashboard, Map, Timeline, etc.)
- **Stage** = Single component or interaction within that feature
- **Phase** = Design | Build | Refinement | Finalize

### Phase Cycle Per Stage

Each stage goes through 4 phases, typically each in a separate session:

```
1. DESIGN PHASE
   → Present 2-3 UI options with descriptions
   → User picks preferred approach
   → Confirm seed data requirements
   → Record decisions in stage tracking doc

2. BUILD PHASE
   → Implement chosen UI + backend support
   → Add agreed seed data
   → Add placeholder stubs for future features
   → Dev server running for immediate testing

3. REFINEMENT PHASE
   → User tests on dev site
   → User provides feedback
   → Iterate until user satisfied
   → Dual sign-off: Desktop AND Mobile approval required

4. FINALIZE PHASE (all via subagents)
   → Code review (pre-tests)
   → Write full test coverage
   → Code review (post-tests)
   → Update documentation
   → Commit with detailed message
   → Add CHANGELOG entry
```

---

## Session Protocols

### Session Start Protocol

Every new conversation MUST:

1. **Run `/next_task`** to understand current state
2. **Confirm phase**: "We're in [Phase] for [Stage] of [Epic]"
3. **State goal**: "This session's goal is to [phase-specific goal]"
4. **Proceed or clarify**: Start work or ask questions if context is missing

### Session End Protocol

Before ending any session:

1. **Update tracking doc** (via doc-updater subagent)
2. **State progress**: "Completed [X], next session will [Y]"
3. **If phase complete**: Run `/finish_phase`

---

## Commands

| Command         | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `/next_task`    | Find next work by scanning epic/stage hierarchy |
| `/finish_phase` | Mark current phase complete and advance         |
| `/epic-stats`   | Calculate progress across epics                 |

---

## Stage Tracking Documents

### Location

```
epics/EPIC-XXX-name/STAGE-XXX-YYY.md
```

### Status Values

- `Not Started` - Work not yet begun
- `Design` - In design phase
- `Build` - In build phase
- `Refinement` - In refinement phase
- `Finalize` - In finalize phase
- `Complete` - All phases done
- `Skipped` - Intentionally skipped

---

## Responsive Testing Protocol

### Design Phase

When presenting UI options, include explicit descriptions for both views:

```
Option N: [Name]
- Desktop: [layout/behavior description]
- Mobile: [layout/behavior description]
```

### Refinement Phase - Dual Sign-off Gate

Both views must be explicitly approved before advancing to Finalize:

1. **Test Desktop view** → collect feedback → iterate until approved
2. **Test Mobile view** → collect feedback → iterate until approved
3. **Any code change resets the other view's approval**
4. **After both approved** → add items to regression checklist

The stage doc tracks this with:

- `[ ] Desktop Approved`
- `[ ] Mobile Approved`
- `[ ] Regression Items Added`

All three must be checked before `/finish_phase` advances from Refinement.

### Approval Reset Rule

During Refinement, if code changes:

- Layout/styling changes → reset both Desktop and Mobile approval
- Logic-only changes → agent asks if re-test is needed

Always announce: "Change detected — [Desktop/Mobile] approval reset, re-test required"

---

## Regression Checklist

### Location

`docs/REGRESSION-CHECKLIST.md`

### When to Add Items

After BOTH Desktop and Mobile are approved in Refinement:

1. Agent prompts: "Both views approved. What items should be added to the regression checklist?"
2. User provides items (or agent suggests based on what was built)
3. Agent adds items to checklist via doc-updater subagent
4. Agent marks `[x] Regression Items Added` in stage doc

### Item Format

```
- [ ] [EPIC-XXX] [D][M] Description (STAGE-XXX-YYY)
```

- `[D]` = test on desktop
- `[M]` = test on mobile
- `[D][M]` = test on both

---

## Seed Data Protocol

Before adding ANY seed data:

1. **Agent describes** what data will be added
2. **User confirms** the seed data is acceptable
3. **Agent adds** seed data to seed script
4. **Agent documents** in stage tracking file what was seeded

---

## CHANGELOG Format

```
YYYY-MM-DD HH:MM [commit-hash] Epic/Stage: brief description
```

Examples:

```
2025-01-15 14:32 [abc1234] EPIC-001/STAGE-001-002: Campaign selector - chose modal over dropdown
2025-01-15 15:45 [def5678] EPIC-001/STAGE-001-002: User requested larger cards
2025-01-15 16:20 [ghi9012] EPIC-001/STAGE-001-002: Finalize - tests passing, docs updated
```
