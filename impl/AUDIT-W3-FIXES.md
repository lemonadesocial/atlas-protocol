# Wave 3 IMPL Audit Fixes — Phase 6 (AI) + Phase 7 (Frontend)

**Source:** Audit session (2026-03-19)
**Status:** Both IMPLs need rework before routing to implementing agents.
**Key decision:** Payment flow uses Option A (checkout URL) — user clicks a link, pays on existing checkout page, agent gets webhook and delivers ticket in chat. No in-chat payment UI for launch.

---

## PRODUCT DECISION: Payment Flow (Option A — Checkout URL)

This decision simplifies both IMPLs significantly. Apply throughout:

**Phase 6 (AI) flow:**
1. Agent calls Atlas purchase endpoint → gets 402 challenge
2. Agent generates a one-time checkout URL (backend creates a checkout session with the hold ID)
3. Agent presents the URL in chat: "Click here to pay $25.50 for 2x Early Bird tickets"
4. User clicks → existing Lemonade checkout page handles Stripe Elements / crypto wallet
5. Payment completes → backend fires webhook/event
6. Agent receives completion signal → delivers ticket receipt in chat

**Phase 7 (Frontend) flow:**
1. AI chat shows a "Pay Now" button/link (not Stripe Elements in chat)
2. Button opens existing checkout page in new tab or modal
3. After payment, chat updates with receipt card
4. No PurchaseConfirmPane with payment form needed — just a PaymentLinkCard

**What this eliminates:**
- No payment credential handling in MCP tools (Phase 6 issue 1.1 — resolved)
- No Stripe Elements in chat pane (Phase 7 issue 6 — resolved)
- No `X-Payment-Credential` header complexity
- No "who generates the credential" question

**What this requires:**
- Phase 2 backend: A new endpoint to create a checkout session from an Atlas hold (`POST /atlas/v1/holds/:id/checkout`)
- Phase 6: MCP tool returns checkout URL instead of payment credential
- Phase 7: A simple PaymentLinkCard component instead of PurchaseConfirmPane

---

## Phase 6 Fixes (AI Integration — lemonade-ai)

### Critical

- [ ] **6-C1: Replace payment credential flow with checkout URL pattern.**
  Remove all references to `payment_credential`, `X-Payment-Credential` header, and two-phase tool call pattern. Instead:
  - `atlas_purchase` tool Phase 1: Call purchase endpoint → get 402 challenge → call new checkout session endpoint → return checkout URL
  - `atlas_purchase` tool Phase 2: NOT a second tool call. Instead, the agent polls or receives a webhook when payment completes, then fetches the receipt.
  - Update tool inputSchema: remove `payment_credential` field. Add `hold_id` for polling receipt after payment.
  - Update tool outputSchema: add `checkout_url` to challenge phase output.
  - The tool flow becomes: `challenge` (with checkout_url) → agent waits → `receipt` (after payment webhook).
  - **This also requires a new Phase 2 endpoint:** `POST /atlas/v1/holds/:id/checkout` that creates a Stripe checkout session or generates a crypto payment page URL. Document this as a Phase 2 dependency — add to PENDING-FIXES.md if Phase 2 is already merged.

- [ ] **6-C2: Fix Self.xyz verification field.**
  The `self_verified` field does NOT exist on the User GraphQL type. The actual verification data is in `UserSelfDisclosureModel` (separate collection). Fix:
  - Read `lemonade-backend/src/app/models/user-self-disclosure.ts` to find the actual model structure
  - Read `lemonade-backend/src/app/models/user-self-request.ts` for the `nullifier` field (verified identity)
  - The atlas://verification resource should query `UserSelfDisclosureModel.findOne({ user: userId })` directly via a backend endpoint, NOT via a non-existent GraphQL field
  - OR: Add a new GraphQL field to the User resolver that checks disclosure status. Document which approach.
  - Reference actual field names from the codebase, not guessed names.

- [ ] **6-C3: Cross-reference 402 challenge schema to Phase 2.**
  The `Atlas402Challenge` type must match Phase 2's actual response. Fix:
  - Read `lemonade-backend/src/app/services/atlas/purchase.ts` (on the Phase 2 branch) to get the exact 402 response structure
  - Update `Atlas402Challenge` interface to match exactly
  - Add a comment: "This type must match Phase 2 purchase.ts line X"
  - If Phase 2 doesn't include a `checkout_url` field yet (it won't — this is new from 6-C1), document the Phase 2 endpoint addition needed.

- [ ] **6-C4: Add free ticket handling to atlas_purchase tool.**
  Phase 2 returns HTTP 200 with `{ type: 'free_ticket_redirect', redirect_url: ... }` for free tickets. The tool must handle this:
  ```
  if response.status === 200 and response.data.type === 'free_ticket_redirect':
    return { phase: 'redirect', redirect_url: response.data.redirect_url, message: 'Free event — claim your ticket here' }
  ```
  Update outputSchema to include `redirect` phase alongside `challenge` and `receipt`.

- [ ] **6-C5: Show complete atlasRequest() implementation.**
  The HTTP client must be fully specified:
  - Default headers: `Atlas-Agent-Id: agent:lemonade-ai`, `Atlas-Version: 1.0`
  - 402 responses returned (not thrown) — `{ status: 402, data: challengePayload }`
  - 200 responses returned — `{ status: 200, data: responsePayload }`
  - 4xx errors thrown with status + message
  - 5xx errors: retry once after 1s, then throw
  - Network errors: throw with descriptive message
  - Timeout: 5s for backend calls, 10s for registry search

- [ ] **6-C6: Verify auth header extraction.**
  Confirm how the MCP transport populates `raw.requestInfo.headers.authorization`. Read the actual MCP plugin in `lemonade-ai/src/app/plugins/mcp.ts` and document:
  - Which transport is used (SSE? HTTP?)
  - How the user's auth token reaches the tool handler
  - If it doesn't, propose the fix (extract from session, inject via context, etc.)

- [ ] **6-C7: Add Atlas-Version header to all requests.**
  Show in the atlasRequest() implementation that every request includes `Atlas-Version: 1.0` header.

- [ ] **6-C8: Add MCP registration guard for both env vars.**
  Gate on `ATLAS_REGISTRY_URL` AND `ATLAS_BACKEND_URL` (or equivalent). If either is missing, log a warning and skip registration. Each tool should also validate its own dependency at call time.

- [ ] **6-C9: Add AUDIT-R4 dependency checklist.**
  Add a section listing which upstream audit fixes Phase 6 depends on (FT-2, FT-3, SV-1, SV-4). These are Phase 2/4 responsibilities but Phase 6 must verify they're in place.

### High

- [ ] **6-H1: Fix request() function call documentation.** Show explicit parameter names in examples to prevent positional mistakes.
- [ ] **6-H2: Auto-generate idempotency key.** Tool should generate a deterministic key from `(event_id, ticket_type_id, quantity, agent_id)` instead of accepting user input.
- [ ] **6-H3: Define error handling for registry timeout.** Specify: 5s timeout, return empty results with warning message (not throw).
- [ ] **6-H4: Add receipt structure cross-reference to Phase 2.** Verify field names match.
- [ ] **6-H5: Fix LangChain metadata key.** Explain why `new_new_photos_expanded` is used (legacy compatibility) or use a clearer key.
- [ ] **6-H6: Document verification status freshness.** Re-check on each tool call? Cache for 60s? Specify.

### Medium

- [ ] **6-M1: Use `lemonade://atlas/` URI scheme for resources** (consistent with existing `lemonade://` pattern).
- [ ] **6-M2: Document pagination cursor format** (opaque string, null = last page).
- [ ] **6-M3: Add test fixtures** for 402 challenge, receipt, redirect responses.
- [ ] **6-M4: Add pre-deployment checklist** verifying Phase 2 + Phase 3 are live.

---

## Phase 7 Fixes (Frontend — web-new)

### Critical

- [ ] **7-C1: Fix provider state design.**
  Two options:
  - **(a) Recommended:** Use the existing generic `data?: unknown` field. Discriminate by a `type` field at runtime. No new top-level state fields. No reducer changes.
  - **(b) Alternative:** Add Atlas state as a single `atlas?: AtlasChatState` nested object (not 5 separate fields). One new action kind: `SET_ATLAS_STATE`. Simpler reducer change.
  Whichever option: show the complete reducer implementation, not just field names.

- [ ] **7-C2: Fix env var names.**
  Use `NEXT_PUBLIC_LMD_BE` (existing) for Atlas backend calls, NOT `NEXT_PUBLIC_LEMONADE_BACKEND_URL` (doesn't exist). Add only `NEXT_PUBLIC_ATLAS_REGISTRY_URL` as new env var.

- [ ] **7-C3: Split atlas-client.ts into server and client modules.**
  - `lib/services/atlas-client.ts` — fetch functions (no `'use client'`, usable from server components and hooks)
  - `lib/hooks/useAtlasSearch.ts` — client hook (`'use client'`, imports from atlas-client)
  - `lib/hooks/useAtlasTickets.ts` — client hook (`'use client'`, imports from atlas-client)

- [ ] **7-C4: Fix card rendering location.**
  Atlas card `.with()` cases go in `CardList.tsx`, NOT `Messages.tsx`. Messages delegates to CardList. Update the IMPL to show the exact code in CardList.tsx with the correct line numbers. Also update `utils.ts` CardItem union type FIRST, then add the `.with()` cases.

- [ ] **7-C5: Replace PurchaseConfirmPane with PaymentLinkCard.**
  Per the checkout URL decision (Option A):
  - Remove PurchaseConfirmPane (no Stripe Elements in chat)
  - Add PaymentLinkCard: simple component showing event name, price, and a "Pay Now" button that opens checkout URL in new tab
  - Add AtlasReceiptCard: shows after payment completes (ticket details, QR code data, cashback earned, Self.xyz verification CTA if unverified)
  - The AI chat flow: EventSearchPane → TicketComparePane → PaymentLinkCard → (user pays in new tab) → AtlasReceiptCard

### High

- [ ] **7-H1: Verify Phase 4 GraphQL schema field names.**
  Read the Phase 4 branch (`feat/atlas-phase-4-rewards`) to get exact resolver field names for reward balance. Reference actual field names, not guessed ones. If Phase 4 hasn't added reward resolvers to GraphQL yet, document it as a dependency.

- [ ] **7-H2: Locate exact reward dashboard integration point.**
  Search web-new for the Space management layout. Provide exact file path + line number where RewardDashboard tab should be added. If the structure doesn't support tabs yet, document what needs to change.

- [ ] **7-H3: Handle missing Phase 4 resolvers gracefully.**
  Since Phase 4 and Phase 7 may deploy at different times, the reward dashboard should check if the resolver exists and show "Rewards coming soon" if not available. Use a try-catch on the GraphQL query.

- [ ] **7-H4: Clarify comparison data flow.**
  Does `TicketComparePane` receive pre-fetched data from the AI agent (via chat metadata) or fetch it client-side? If from agent: show the metadata structure. If client-side: show how multiple concurrent `useAtlasTickets` calls work.

### Medium

- [ ] **7-M1: Verify Tailwind tokens** (`bg-accent-400`, `text-quaternary`) exist in the design system.
- [ ] **7-M2: Clarify Self.xyz verification page** — does `/settings/verification` exist? If not, scope it out of Phase 7.
- [ ] **7-M3: Add sample test file** showing the mocking pattern for `fetch()` in jsdom.
- [ ] **7-M4: Address partial deployment** — feature flag or conditional rendering when Phase 4 isn't ready.

---

## New Phase 2 Dependency (from checkout URL decision)

The checkout URL pattern requires a new endpoint on lemonade-backend:

- [ ] **P2-NEW: `POST /atlas/v1/holds/:hold_id/checkout`**
  - Input: hold_id (from 402 challenge)
  - Behavior: Creates a Stripe checkout session or crypto payment page using the hold's amount, currency, and payment methods
  - Returns: `{ checkout_url: string, expires_at: string }`
  - The checkout page handles payment. On success, the hold is consumed and tickets are issued (same as the current Phase 2 fulfillment flow).
  - Add to PENDING-FIXES.md as a Phase 2 addition needed before Phase 6 can work.

---

## Cross-Phase Consistency

After all fixes:
- [ ] Payment flow is checkout URL everywhere (no payment credential references remain)
- [ ] `self_verified` replaced with actual codebase field path
- [ ] Env vars use `NEXT_PUBLIC_LMD_BE` (not `NEXT_PUBLIC_LEMONADE_BACKEND_URL`)
- [ ] Card rendering in CardList.tsx (not Messages.tsx)
- [ ] PurchaseConfirmPane replaced with PaymentLinkCard
- [ ] Atlas-Version header in all HTTP requests
- [ ] Free ticket redirect handled in atlas_purchase tool
- [ ] Phase 4 GraphQL fields verified against actual resolver code
