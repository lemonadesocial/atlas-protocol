# Pending Fixes

Tracked items that are not yet implemented. Each must be resolved before final merge.

---

## Phase 1 — Connector Resolver Integration (3 items)

**Status:** Database-level safety nets (unique indexes) are in place. Application-level enforcement in the shared `connectPlatform` resolver needs work.

**Branch:** feat/atlas-phase-1-connectors
**PR:** be#1991
**Commit needed:** `fix: add application-level connector uniqueness checks`

### P1-PENDING-1: R2-E4 application-level externalAccountId check
- **What:** Before inserting a new Connection, the `connectPlatform` resolver should check if a Connection with the same `(connectorType, externalAccountId)` already exists and return a clear error message: "This {platform} account is already connected to another Space."
- **Current state:** The unique compound index on Connection model will reject duplicates at the DB level with a cryptic Mongoose duplicate key error.
- **Fix:** Add a `ConnectionModel.findOne({ connectorType, externalAccountId })` check in the `connectPlatform` resolver before creating the Connection document. Return a user-friendly error if found.
- **File:** `src/graphql/resolvers/connector.ts` (connectPlatform mutation)

### P1-PENDING-2: R3-F18 exclude current connection from duplicate check
- **What:** During OAuth callback, when checking for existing connections with the same externalAccountId, the query must exclude the current connection being set up (`_id: { $ne: currentConnectionId }`). Without this, the check may self-match.
- **Current state:** The OAuth callback stores externalAccountId but the duplicate check may false-positive on the connection being created.
- **Fix:** Add `_id: { $ne: connection._id }` to the duplicate check query in the OAuth callback handler.
- **File:** `src/connectors/eventbrite/index.ts` (handleCallback), `src/graphql/resolvers/connector.ts` (if check is there)

### P1-PENDING-3: R4-SV-2 selfVerifiedIdentityId enforcement in resolver
- **What:** When a Self-verified user connects a platform, the `connectPlatform` resolver should check if another Connection exists with the same `(connectorType, selfVerifiedIdentityId)` and reject with: "Your verified identity already has a connected {platform} account on another Space."
- **Current state:** The unique compound index on `(connectorType, selfVerifiedIdentityId)` will reject at DB level. Application-level check with clear error message is missing.
- **Fix:** Look up the user's Self verification status. If verified, query `ConnectionModel.findOne({ connectorType, selfVerifiedIdentityId })`. Return user-friendly error if found.
- **File:** `src/graphql/resolvers/connector.ts` (connectPlatform mutation)

---

## Phase 5 -- Post-Merge (1 item)

**Status:** Cross-branch dependency. Must be applied after both Phase 1 and Phase 5 are merged.

**Branch:** N/A (applied to main after merge)

### P5-POST-1: Add 'meetup' to connector-event-sync-scheduler filter

- **What:** The Phase 1 scheduler only filters to `['eventbrite', 'luma']`. After the Meetup connector (Phase 5) lands, `'meetup'` must be added to the allowed list.
- **File:** `src/app/jobs/connector-event-sync-scheduler.ts`
- **Change:** `connectorType: { $in: ['eventbrite', 'luma'] }` -> `connectorType: { $in: ['eventbrite', 'luma', 'meetup'] }`
- **Also:** Add `'dice'`, `'resident-advisor'` when those connectors are production-ready.

---

## Phase 2 — Checkout URL Endpoint (1 item)

**Status:** Required by Wave 3 (Phase 6 AI integration). Must be added to Phase 2 branch before Phase 6 can work.

**Branch:** feat/atlas-phase-2-protocol
**PR:** be#1992

### P2-NEW-1: Atlas checkout session endpoint

- **What:** `POST /atlas/v1/holds/:hold_id/checkout` — Creates a checkout session (Stripe or crypto payment page) from an existing Atlas ticket hold.
- **Why:** The AI agent cannot handle payment credentials directly in chat. Instead, it generates a checkout URL that the user clicks to pay on the existing Lemonade checkout page.
- **Input:** `hold_id` from the 402 challenge response
- **Behavior:** Creates a Stripe checkout session (or crypto payment page URL) using the hold's amount, currency, and accepted payment methods. The checkout page handles payment. On success, the hold is consumed and tickets are issued (same fulfillment flow as Phase 2).
- **Returns:** `{ checkout_url: string, expires_at: string }`
- **Auth:** Requires Atlas agent auth (`Atlas-Agent-Id` header)
- **File:** `src/app/controllers/atlas/checkout.ts` (new), `src/app/routers/atlas.ts` (add route)
- **Depends on:** Existing Phase 2 hold and purchase fulfillment services

---

## Atlas Registry — CI Pipeline (pre-publication)

**Status:** Required before atlas-registry repo goes public.

### REG-1: Add build script, linter, and test runner

- **What:** atlas-registry has no `yarn build`, no lint config, no CI pipeline. Before publishing as a public repo, it needs:
  1. `tsconfig.json` with strict mode
  2. ESLint config matching lemonade-backend conventions
  3. `yarn build` script (tsc)
  4. `yarn lint` script (eslint)
  5. `yarn test` script (vitest or jest — already has test files)
  6. GitHub Actions CI workflow: lint + build + test on every PR
- **File:** `atlas-registry/package.json`, `atlas-registry/tsconfig.json`, `atlas-registry/.eslintrc.*`, `atlas-registry/.github/workflows/ci.yml`
- **When:** Before flipping repo to public. Not blocking current merge.

### REG-2: Pre-publication cleanup per PRE-PUBLICATION-CHECKLIST.md

- **What:** Before going public, follow `atlas-protocol/PRE-PUBLICATION-CHECKLIST.md` for atlas-registry. Scrub git history, verify zero AI artifacts, clean README.
- **When:** Before flipping repo to public.

---

## Lemonade-AI — Lint Check

### AI-1: Verify and fix lint errors in Phase 6 files

- **What:** Phase 6 added 5 new files + modified 2 in lemonade-ai. Need to verify these pass `yarn lint` and fix any errors before pushing to remote.
- **Files:** `src/app/services/atlas-http-client.ts`, `src/app/plugins/mcp-atlas-tools.ts`, `src/app/plugins/mcp-atlas-resources.ts`, `src/app/plugins/mcp-atlas-prompts.ts`, `src/app/services/langchain/tools/atlas.ts`, `src/app/plugins/mcp.ts`, `src/app/services/langchain/tools.ts`
- **When:** Before pushing lemonade-ai master to remote.

---

## Tracking

- [x] P1-PENDING-1 fixed
- [x] P1-PENDING-2 fixed
- [x] P1-PENDING-3 fixed
- [x] All 3 committed on feat/atlas-phase-1-connectors branch
- [x] PR be#1991 updated with completed checklist items
- [x] P2-NEW-1 checkout endpoint added to Phase 2 branch
- [ ] P5-POST-1 applied after Phase 1 + Phase 5 merge
- [ ] REG-1 CI pipeline added to atlas-registry
- [ ] REG-2 Pre-publication cleanup for atlas-registry
- [ ] AI-1 Lint check on lemonade-ai Phase 6 files
