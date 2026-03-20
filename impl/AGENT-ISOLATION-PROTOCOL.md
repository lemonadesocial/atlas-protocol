# Agent Isolation Protocol

Mandatory rules for all implementing agents. Prevents cross-contamination, enforces audit-first PR workflow, and maintains code hygiene.

**Incident:** Wave 1 Phase 1 branch contained 24 Phase 2 files because Agents A and B shared a single lemonade-backend checkout. The linter auto-staged Phase 2 files into Phase 1's commit. This protocol prevents recurrence.

---

## Rule 0: Audit-First PR Workflow (NON-NEGOTIABLE)

No PRs are created without explicit audit clearance. The workflow is:

```
Agent writes code → pushes branch → reports status to Lead
  ↓
Lead reports to KC (pastes to audit session)
  ↓
Audit session reads actual code on branches, runs adversarial checks
  ↓
If issues found → KC sends fixes back to implementation session
If clean → KC tells implementation session "create PRs"
  ↓
Agent creates PR (following PR hygiene below)
  ↓
Karen reviews → approves
  ↓
Report to KC with: PR link, completion checklist, Karen verdict
  ↓
KC approves merge (or doesn't). Agents WAIT.
```

**Agents must NEVER:**
- Create a PR before audit clearance from KC
- Request Karen review before audit clearance from KC
- Merge any PR without KC's explicit approval
- Assume Karen approval = merge approval (it is necessary but not sufficient)

---

## Rule 1: Separate worktrees for shared repos

When multiple agents work in the same repo, each agent MUST use a separate git worktree. Never share a checkout.

```bash
# Before deploying agents, create worktrees from the main repo:
cd /Users/kc/Documents/Lemonade\ Repos/lemonade-backend
git fetch origin master

# Agent A (Phase 1):
git worktree add ../lemonade-backend-phase1 -b feat/atlas-phase-1-connectors origin/master

# Agent B (Phase 2):
git worktree add ../lemonade-backend-phase2 -b feat/atlas-phase-2-protocol origin/master

# Wave 2 (later):
git worktree add ../lemonade-backend-phase4 -b feat/atlas-phase-4-rewards origin/master
git worktree add ../lemonade-backend-phase5 -b feat/atlas-phase-5-expansion origin/master
```

Each agent's prompt specifies their worktree path, NOT the shared lemonade-backend directory. Agents that work in their own repo (e.g., atlas-registry) do not need worktrees.

---

## Rule 2: Pre-commit file audit

Before EVERY commit, the agent runs:

```bash
git diff --cached --name-only
```

And verifies EVERY staged file belongs to their phase. Cross-reference against the IMPL's "New Files" and "Modified Files" lists. If ANY file is not in the IMPL's file list, unstage it immediately:

```bash
git reset HEAD <wrong-file>
```

---

## Rule 3: No global git add

NEVER use `git add .` or `git add -A`. Always add specific files by name:

```bash
# CORRECT:
git add src/connectors/eventbrite/index.ts src/connectors/luma/index.ts

# WRONG:
git add .
git add -A
git add src/
```

---

## Rule 4: Post-commit verification

After every commit, verify the diff against master contains ONLY this phase's files:

```bash
git diff master --name-only | sort
```

Compare against the IMPL's file list. If extra files appear, the commit is contaminated. Reset and redo:

```bash
git reset HEAD~1  # undo the commit, keep files staged
# Remove contaminating files from staging
git reset HEAD <wrong-files>
# Re-commit with only correct files
git commit -m "feat: original message"
```

---

## Rule 5: No amending pushed commits

- If a commit has been pushed to remote, create a NEW commit to fix issues. Never `git commit --amend` on pushed commits.
- Only amend unpushed local commits, and only when necessary.
- Never use `--no-verify` to skip pre-commit hooks.

---

## Rule 6: Branch verification before every git operation

```bash
git branch --show-current
```

Run this before: `git add`, `git commit`, `git push`, `git checkout`. Every time. No exceptions. If the branch name does not match the expected phase branch, STOP.

---

## Rule 7: Clean worktree teardown

After a phase is complete and PR is submitted:

```bash
cd /Users/kc/Documents/Lemonade\ Repos/lemonade-backend
git worktree remove ../lemonade-backend-phase1
```

Do NOT leave stale worktrees. They cause confusion and disk bloat.

---

## Rule 8: Linter and formatter scope

If a linter or formatter auto-modifies files, it MUST be scoped to only the files being changed in this phase. Never run a global lint/format that touches files outside the phase scope.

```bash
# WRONG — touches every file in the repo:
yarn lint --fix
yarn prettier --write .

# RIGHT — scoped to this phase's files only:
yarn lint --fix src/connectors/eventbrite/ src/connectors/luma/ src/app/models/external-event-mapping.ts
yarn prettier --write src/connectors/eventbrite/ src/connectors/luma/
```

If the CI pipeline runs a global lint check, that's fine (it's read-only). But no agent should run a global lint FIX that writes to files outside their scope.

---

## Rule 9: No source code references to internal docs

Source code (committed to any repo) must NEVER contain:

- `AUDIT FIX` tags or references to audit rounds (R1, R2, R3, R4)
- References to IMPL files, session IDs, or prompt text
- References to Claude, Anthropic, AI, GPT, or any AI tool
- `Co-Authored-By` lines mentioning AI in commit messages
- Overly explanatory comments ("This function handles the processing of...")

Comments in code say WHY, not WHAT. If the code is clear, no comment is needed.

---

## Rule 10: Commit message standards

```bash
# GOOD — short, imperative, human-style:
git commit -m "add eventbrite connector"
git commit -m "fix hold expiry query"
git commit -m "add federated search to registry"

# BAD — AI-style, overly descriptive:
git commit -m "Implement comprehensive Eventbrite connector with OAuth2 flow and event synchronization"
git commit -m "feat: add robust federated search functionality with parallel fan-out"
```

No em dashes in messages. No "robust/seamless/comprehensive/innovative". Lowercase unless starting with a conventional commit prefix (`feat:`, `fix:`, `chore:`).

---

## Pre-Push Checklist (run before reporting "ready for audit")

```
[ ] git branch --show-current → correct phase branch
[ ] git diff master --name-only → only this phase's files (zero extras)
[ ] grep -r "AUDIT FIX" src/ → zero results
[ ] grep -r "Co-Authored-By" .git/COMMIT_EDITMSG → zero results
[ ] grep -r "claude\|anthropic\|mppx" src/ → zero results
[ ] grep -rn "em dash" src/ && grep -r '—' src/ → zero em dashes in source
[ ] git log master..HEAD --format="%s" → all messages are human-style
[ ] No git add . or git add -A in shell history for this session
[ ] Worktree is isolated (ls ../ shows separate phase directories)
[ ] Build passes: yarn build (or equivalent)
[ ] Lint passes (scoped to this phase's files only)
[ ] Tests pass (existing + new tests for this phase)
```

---

## PR Hygiene Rules (enforced AFTER audit clearance is given)

Only create PRs after KC confirms audit is complete and gives the go-ahead.

### PR Title
- Starts with a verb: `feat: add ...`, `fix: correct ...`, `chore: update ...`
- Under 70 characters
- No AI language ("implement comprehensive", "add robust")
- Examples: `feat: add eventbrite and luma connectors`, `feat: add atlas REST endpoints with 402 purchase flow`

### PR Description
```markdown
## Summary
- [1-3 bullet points, concrete, no fluff]

## Changes
- [List of new files and modified files]

## Test plan
- [ ] [Specific test scenarios, not vague "test thoroughly"]
```
- No em dashes
- No "This PR implements...", "This ensures...", "This enables..."
- No references to IMPL files, audit rounds, sessions, or AI tools
- No "Co-Authored-By" lines

### PR Completion Checklist (first comment on the PR)
Map every IMPL task to implemented code:
```
Task 1: ExternalEventMapping model
  ✅ src/app/models/external-event-mapping.ts:1-85

Task 2: Eventbrite connector
  ✅ src/connectors/eventbrite/index.ts:1-320

...

Audit Fix R2-E1: externalAccountId uniqueness
  ✅ src/app/models/connection.ts:47 (new field + index)
```
Every IMPL task and every audit fix tag must appear. If anything is not implemented, flag it explicitly: `❌ NOT IMPLEMENTED: [reason]`.

### PR Review Flow
```
PR created → Karen reviews
  ↓
Karen CHANGES_REQUESTED → agent fixes → pushes new commit (not amend) → Karen re-reviews
Karen APPROVES → Lead reports to KC: PR link + checklist summary + Karen verdict
  ↓
KC approves merge → merge in dependency order
KC does not approve → agent addresses KC's feedback → cycle repeats
```

### PR Stack and Merge Order

PRs are stacked. Merge order matters. Do NOT merge out of order.

```
master
  ├── feat/atlas-phase-1-connectors (be#1991) — base: master
  ├── feat/atlas-phase-2-protocol (be#1992) — base: master
  │     ├── feat/atlas-phase-4-rewards (be#1993) — base: phase-2
  │     └── feat/atlas-phase-5-expansion (be#1994) — base: phase-2
  └── atlas-registry main (registry#1) — separate repo
```

**Merge order:** P1 → P2 → P4 → P5 → P3 (registry last, after backend is deployed).

**Rebase rule:** If fixes to Phase 2 change the branch point, Phase 4 and Phase 5 MUST be rebased onto the updated Phase 2 before their PRs can be merged. After rebase, verify no conflicts and re-run tests.

**Post-merge tasks:** After all 5 are merged, apply items from `PENDING-FIXES.md` (Meetup sync filter, checkout endpoint, etc.) as separate commits on master.

### Wave 3 PR Stack (when implemented)

```
master (with Waves 1+2 merged)
  ├── feat/atlas-phase-6-ai-integration — lemonade-ai repo
  └── feat/atlas-phase-7-frontend — web-new repo
```

Wave 3 branches from master AFTER Waves 1+2 are merged. They do NOT stack on feature branches.

### What a PR must NOT contain
- Files from other phases
- Changes to files not listed in the IMPL
- Debugging code, console.logs, commented-out blocks
- Placeholder values that should have been resolved (e.g., `0xTEMPO_PLACEHOLDER`)
- TODO comments referencing internal docs ("TODO: see IMPL Phase 2 Task 4")
- Any string containing: "audit", "IMPL", "Claude", "Anthropic", "session", "prompt", "subagent"
