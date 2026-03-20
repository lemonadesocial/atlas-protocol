# Adversarial Audit Fix Checklist

**Source:** Audit session (2026-03-19)
**Status:** All 5 IMPLs audited. None are ready for implementation routing without fixes.

## How to Use

- [ ] Fix ALL Critical and High issues before routing ANY IMPL to implementing agents
- [ ] Medium issues should be fixed but are not blockers if documented as known limitations
- [ ] Fix each issue IN the respective IMPL document — do not create separate files
- [ ] Check off each item as fixed
- [ ] After all fixes, re-read each IMPL end-to-end to verify consistency

---

## Phase 2 — Atlas Protocol (Fix FIRST — everything depends on this)

### Critical

- [ ] **P2-C1: `mppx` SDK does not exist.** The IMPL imports from `'mppx/koa'` which is not a real npm package. The codebase uses `@x402/core`, `@x402/evm`, `@x402/express`. Fix: Remove all mppx references. The purchase controller already manually builds 402 responses and verifies payments. Hand-roll the 402 challenge/verification without any SDK. Define the verification logic explicitly using `@x402/core` patterns or pure custom code.

- [ ] **P2-C2: Duplicate `$inc` key — ticket_count never incremented.** Lines 1166-1173 have two `$inc` keys in the same object literal. JavaScript silently drops the first. `ticket_count` is NEVER incremented → ticket overselling and data corruption. Fix:
  ```javascript
  // WRONG (current):
  { $inc: { ticket_count: count }, $inc: { [`ticket_count_map.atlas_${agentId}`]: count } }
  // CORRECT:
  { $inc: { ticket_count: count, [`ticket_count_map.atlas_${agentId}`]: count } }
  ```

- [ ] **P2-C3: `payment-verify.ts` referenced but never defined.** This is the most critical security function. The IMPL must include full implementation for: (1) Stripe SPT: Verify PaymentIntent status via Stripe API using the SPT credential. (2) Base USDC: Verify EVM transaction on-chain — tx hash, recipient, amount, confirmations. (3) Tempo USDC: Same as Base but on Tempo chain. (4) Check tx hash uniqueness against existing NewPayment records to prevent replay. (5) Return verified amount for comparison against hold price.

### High

- [ ] **P2-H1: `NewPayment.account` is required but can be undefined.** `validation.ticketType.prices?.[0]?.payment_accounts?.[0]` may be undefined for many ticket types. Fix: If no payment account found on ticket type, fall back to Space's default payment account. If still none, return 422 error "Event not configured for Atlas payments."

- [ ] **P2-H2: Re-validation uses current price, not held price.** Phase 2 must verify the payment amount against `hold.total_price_usd`, NOT re-query the ticket type. The hold IS the price lock. If the price changed between Phase 1 and Phase 2, the hold price wins.

- [ ] **P2-H3: Holds don't actually reserve inventory.** Holds are created but `ticket_count` isn't decremented. Other agents see "available" and also try to buy. Fix: Add `AtlasTicketHold.countDocuments({ event_ticket_type_id, consumed: false })` to the availability check. Availability = `ticket_limit - ticket_count - active_holds_count`.

- [ ] **P2-H4: No body parser for POST routes.** `ctx.request.body` will be `undefined` on all POST endpoints. Fix: Add `koa-bodyparser` middleware to the atlas router:
  ```javascript
  import bodyParser from 'koa-bodyparser';
  atlasRouter.use(bodyParser());
  ```

- [ ] **P2-H5: All currencies treated as USD.** The schema mapper hardcodes `currency: 'USD'` throughout. Lemonade supports EUR, GBP, etc. Fix: Use `event.currency` (not hardcoded 'USD'). For non-USD events, include the actual ISO 4217 currency code. The cents→dollars conversion (divide by 100) is still valid regardless of currency.

### Medium

- [ ] **P2-M1:** Controller/service `generateManifest` name collision — rename controller to `handleManifestRequest`
- [ ] **P2-M2:** `created_at` doesn't exist on Event model — use `_id.getTimestamp()` or remove the field
- [ ] **P2-M3:** Hold not bound to agent_id — add `agent_id` verification in `consumeTicketHold` (reject if different agent tries to consume another agent's hold)
- [ ] **P2-M4:** `ATLAS_ENABLED` feature flag never checked — add check in router middleware, return 404 if disabled
- [ ] **P2-M5:** `custom_domain` not on Space model — remove from internal endpoint projection, use `Space.slug` for URL construction

---

## Phase 1 — Connectors (Fix in parallel with Phase 2)

### Critical

- [ ] **P1-C1: `slugify` does NOT add nanoid suffixes — slug collisions will occur.** Two events with the same title produce identical slugs → unique index violation. Fix: After slugifying, append `-${nanoid(8)}` to ensure uniqueness. Or use `findOneAndUpdate` with `$setOnInsert` and retry on duplicate key error.

- [ ] **P1-C2: Agenda job pattern is completely wrong.** The codebase uses per-file job definitions in `src/app/jobs/`. A `connector-sync.ts` job ALREADY EXISTS at `src/app/jobs/connector-sync.ts`. Do NOT modify `agenda.ts` directly. Fix: Either extend the existing `connector-sync.ts` to handle event source connectors, or create a new `connector-event-sync.ts` job file following the same pattern. Register the schedule in the job file, not in `agenda.ts`.

### High

- [ ] **P1-H1: No `executeAction` dispatch implementation shown.** The core method that routes `sync-events`/`sync-attendees`/`sync-ticket-types` calls is never shown. Fix: Add the `executeAction` method body with `if (actionId === 'sync-events')` / `if (actionId === 'sync-attendees')` dispatch for each connector. Follow the pattern from Google Sheets (line 219 of `google-sheets/index.ts`) and Airtable (line 298 of `airtable/index.ts`).

- [ ] **P1-H2: No `fetchConfigOptions` for Eventbrite organization selector.** The manifest declares `configSchema` with `fetchOptions: 'listOrganizations'` but the method is never implemented. Fix: Implement `fetchConfigOptions('listOrganizations', credentials, config)` that calls `GET /v3/users/me/organizations/` and returns `SelectOption[]`.

- [ ] **P1-H3: Race condition on concurrent sync — duplicate events.** Two simultaneous sync calls (manual + scheduled) can create duplicate events. Fix: Add a distributed lock per connection before syncing. Use Redis `SET connectionId:sync NX EX 300` as a mutex. If lock exists, skip sync (already in progress).

- [ ] **P1-H4: `installedBy` string used as ObjectId for `hostUserId`.** Type mismatch will cause runtime error. Fix: Convert explicitly: `new Types.ObjectId(conn.installedBy)`. Add validation that `installedBy` is a valid ObjectId string before conversion.

### Medium

- [ ] **P1-M1:** `marked` not in package.json — add `marked` to the dependencies list in the modified files section
- [ ] **P1-M2:** Lu.ma pagination not specified — add cursor loop with `has_more` + `next_cursor` until all events fetched
- [ ] **P1-M3:** Sync overwrites manual edits — add `lastModifiedLocally` timestamp on synced events, skip sync update if local edit is newer than last sync
- [ ] **P1-M4:** Webhook support in Eventbrite manifest but not implemented — remove `webhookEvents` from manifest until actually implemented. Don't advertise capabilities that don't work.

---

## Phase 3 — Registry (Fix after Phase 2 — depends on internal endpoint)

### Critical

- [ ] **P3-C1: `batch` variable undefined in `fanOutSearch`.** The refactored parallel code still references `batch[j]` from the old sequential loop. This will crash at runtime with `ReferenceError: batch is not defined`. Fix: Replace error-handling loop to use `spaces[j]` or index into the `settled` results array directly. Also remove the orphaned closing brace from the old batching loop.

- [ ] **P3-C2: `searchSpace` called with 3 args, defined with 2 — timeout ignored.** The third argument `PER_SPACE_TIMEOUT` is silently ignored. The function body uses the global `searchTimeoutMs` (3000ms), NOT the 1500ms per-space timeout. The <2s SLA fix is broken. Fix: Update function signature to accept timeout: `searchSpace(space, queryString, timeoutMs: number)`. Inside the function, use `timeoutMs` parameter. Set `PER_SPACE_TIMEOUT = 1500` and pass it in the fan-out call.

### High

- [ ] **P3-H1: No agent authentication middleware.** Any client can spoof any `Atlas-Agent-Id`. Fix: Add API key validation — agent sends `Authorization: Bearer <api_key>`, middleware verifies against hashed key in `agent_registrations` table. Unauthenticated agents get lower rate limits (public tier).

- [ ] **P3-H2: Federated search trusts downstream data blindly.** A malicious Space can inject fake verified status, phishing purchase URLs, XSS payloads, inflated relevance scores. Fix: Add response schema validation (verify required fields exist), sanitize HTML in `name`/`description` (strip tags or escape), cap downstream `relevance_score` to [0, 1], validate `purchase_endpoint` is HTTPS URL.

- [ ] **P3-H3: Auth hook doesn't short-circuit in Fastify.** Sends 401 but continues to route handler → `ERR_HTTP_HEADERS_SENT` double response error. Fix: Use `return reply.code(401).send(...)` with explicit `return`, or throw a Fastify error.

- [ ] **P3-H4: `atlas_get_event` searches all spaces sequentially.** With 50 spaces at 3s timeout each = 150s worst case. Fix: Use parallel fan-out with early termination on first match. Or require `space_base_url` as a required parameter (agents know which Space an event came from via search results).

- [ ] **P3-H5: `atlas_list_ticket_types` uses wrong endpoint path.** Uses `/tickets` but protocol spec defines `/ticket-types`. Fix: Change to `/atlas/v1/events/{event_id}/ticket-types` (with hyphen).

- [ ] **P3-H6: `recordReferral()` is never called.** Defined but no mechanism triggers it. Fix: Add a callback endpoint `POST /v1/referrals` that Spaces call when a purchase completes with an `atlas_ref` query param. The atlas_ref traces back to a Registry-mediated search.

- [ ] **P3-H7: Downstream pagination — only fetches page 1 (max 100 results per Space).** Fix: Add pagination loop — if Space's `total_results > per_page`, fetch subsequent pages up to a cap (e.g., 500 results per Space max).

### Medium

- [ ] **P3-M1:** Admin API key comparison not timing-safe — use `crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))`
- [ ] **P3-M2:** SSRF via `base_url` — validate URL scheme (https only), resolve DNS and check against private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x, ::1, fc00::/7) before fetching manifest
- [ ] **P3-M3:** Deleted Spaces persist in index forever — add cleanup: if Space not returned by internal endpoint on next indexing cycle, set status to `removed`
- [ ] **P3-M4:** External platforms never re-indexed — add periodic manifest re-fetch during health check (update capabilities, payment_methods, signing_keys)
- [ ] **P3-M5:** Health checks run sequentially with 200 spaces × 10s = 33 min — use `Promise.allSettled()` with concurrency limit (e.g., 10 parallel checks)
- [ ] **P3-M6:** Upsert on `lemonade_space_id` fails for external platforms (NULL != NULL in PostgreSQL) — use `base_url` as conflict target for external platforms, or use a composite conflict target
- [ ] **P3-M7:** No geo-spatial pre-filtering — add `primary_lat`, `primary_lng` columns to `spaces_index` for coarse geographic filtering before fan-out (skip spaces >500km from query center)
- [ ] **P3-M8:** MCP output strips protocol-required fields — include `availability`, `payment_methods`, `end_date`, `currency` in the simplified MCP output
- [ ] **P3-M9:** Query logging unbatched — buffer logs in memory, batch-insert to PostgreSQL every 5 seconds or every 100 records (whichever comes first)

---

## Phase 4 — Rewards (Fix LAST — needs product decisions on anti-fraud + tax)

### Critical

- [ ] **P4-C1: Self-purchase cashback farming.** Organizer buys own tickets, pays 2% fee, gets back 2.2% (cashback + volume bonus at Platinum tier). They PROFIT from buying their own tickets. Fix: If `organizerId === attendeeUserId`, set BOTH organizer cashback AND attendee cashback to 0 for that transaction. Log as suspicious activity.

- [ ] **P4-C2: Sybil referral attack.** Create fake accounts, self-refer, self-purchase 25 tickets, earn $15+ referral bonus per fake account. Fix: (1) Referral code cannot be applied if referrer and referee share the same IP, email domain, or wallet address. (2) Referral milestones only count tickets purchased by UNIQUE attendees (not self-purchases). (3) Add manual review queue for referral payouts above $20.

- [ ] **P4-C3: No `partially_refunded` state in NewPayment.** Backend only has binary `refunded` state. Fix: Track partial refunds in a SEPARATE `AtlasRefund` model (additive, no change to NewPayment enum). Fields: `payment_id`, `refund_amount_usdc`, `refund_percent`, `created_at`. Leave NewPayment state machine unchanged.

- [ ] **P4-C4: Zero tax compliance.** No 1099-K/1099-MISC reporting for US organizers over $600/yr. Fix: Add to IMPL as REQUIREMENTS before payout launch: (1) Collect W-9 (US) or W-8BEN (international) before any cumulative payout exceeding $600. (2) Block payouts until tax info submitted. (3) Track cumulative annual payouts per organizer for 1099-K threshold. (4) Add data model: `AtlasTaxInfo` with `user_id`, `tax_form_type`, `submitted_at`, `verified`. (5) Add payout gate: if cumulative_annual >= $600 AND no verified tax info → hold payout, notify organizer.

### High

- [ ] **P4-H1: Wallet lookup path is wrong.** Conflates Space payment accounts (for receiving ticket revenue) with personal wallets (for receiving reward payouts). Fix: Create new `AtlasPayoutSettings` model per user with `wallet_address`, `wallet_chain`, `stripe_connect_account_id`. Let organizers configure payout destination in Space dashboard settings.

- [ ] **P4-H2: `formatUsdc` is mathematically wrong.** `formatUsdc("1999999")` produces "$1.100" instead of "$1.99". Fix:
  ```typescript
  function formatUsdc(microUnits: string): string {
    const total = BigInt(microUnits);
    const dollars = total / 1_000_000n;
    const cents = Number((total % 1_000_000n) / 10_000n);
    return `$${dollars}.${cents.toString().padStart(2, '0')}`;
  }
  ```

- [ ] **P4-H3: No payout job idempotency.** Duplicate job execution = double payouts. Fix: Add unique compound index on `AtlasPayoutBatch`: `{ period_start: 1, period_end: 1 }, { unique: true }`. Job checks for existing batch before creating. Catch duplicate key error gracefully.

- [ ] **P4-H4: Attendee Stripe payout undefined.** Attendees who paid via Stripe accrue rewards that can never be paid out. Fix: Accumulate as platform credit. Display in user dashboard. Allow redemption as discount on next ticket purchase OR withdrawal to a connected wallet once configured.

- [ ] **P4-H5: Payment success hook can break payment flow.** `await processAtlasFee(...)` in the critical path means Atlas fee errors roll back the payment. Fix: Change to fire-and-forget:
  ```typescript
  processAtlasFee(...).catch(err => logger.error('Atlas fee processing failed', err));
  ```
  Or use an Agenda job triggered by payment success event.

- [ ] **P4-H6: Volume bonus can exceed treasury share.** At Platinum tier (1.2% of gross), volume bonus exceeds treasury income (0.8% of gross) on that transaction. Fix: Cap volume bonus at `min(calculatedBonus, treasuryShareForThisTransaction)`. Treasury cannot go negative on any single transaction.

- [ ] **P4-H7: `payment.amount` assumed USDC — no currency guard.** ETH/EUR payments passed as `grossAmountUsdc`. Fix: Assert `payment.currency === 'usd' || payment.currency === 'usdc'` before processing. For non-USD payments, skip Atlas fee processing gracefully with a log warning.

### Medium

- [ ] **P4-M1:** Referral pool accumulates with no disbursement — add monthly sweep of unused referral pool funds to treasury
- [ ] **P4-M2:** Cross-month refund GMV — decrement the ORIGINAL month's GMV, not the current month
- [ ] **P4-M3:** Discovery bonus $500/month cap — clarify: when cap is hit mid-month, subsequent attendees get $0 discovery bonus (not partial). Document clearly.
- [ ] **P4-M4:** Negative balance atomicity — use `findOneAndUpdate` with a pipeline update: `[{ $set: { pending_usdc: { $max: [{ $subtract: ['$pending_usdc', clawbackAmount] }, '0'] }, negative_balance_usdc: { $max: [{ $subtract: [clawbackAmount, '$pending_usdc'] }, '0'] } } }]`
- [ ] **P4-M5:** No notification for organizers without payout method — add "Set up your payout wallet to receive $X.XX in rewards" banner in Space dashboard
- [ ] **P4-M6:** Fee deduction from settlement underspecified — for Stripe: use `application_fee_amount` on PaymentIntent creation. For crypto: deduct 2% before transfer to organizer wallet. Specify exact file paths and integration points.
- [ ] **P4-M7:** No retry logic for failed payout items — add max 3 retries with exponential backoff (1h, 6h, 24h). Separate Agenda job picks up `failed` items.

---

## Phase 5 — Expansion (Quick fixes — mostly renumbering)

### Critical (all renumbering from Meetup insertion)

- [ ] **P5-C1:** WP-10 sub-sections labeled `9a-9d` — renumber to `10a-10d`
- [ ] **P5-C2:** WP-11 sub-sections labeled `10a-10e` — renumber to `11a-11e`
- [ ] **P5-C3:** Dependency graph uses old WP numbers throughout — update all: Meetup=WP-4, Dice=WP-5, RA=WP-6, Webhook=WP-7, API=WP-8, Register=WP-9, Tier=WP-10, Frontend=WP-11
- [ ] **P5-C4:** WP-9 connector registration omits MeetupConnector — add `import { MeetupConnector } from '../meetup'` and `register(MeetupConnector)` call
- [ ] **P5-C5:** Overview lists 4 connectors — update to 5 (include Meetup)
- [ ] **P5-C6:** Add Meetup to: dependency graph, parallelization note, new files summary, existing files modification count ("5 new connectors" not 4), migration checklist ("7 connectors total" not 6), and testing requirements

### High

- [ ] **P5-H1: ZKSync USDC address may be bridged USDC.e, not native USDC.** Verify against https://www.circle.com/en/usdc-multichain. Native USDC on ZKSync Era is `0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4`. Update the address in the migration spec.

- [ ] **P5-H2: Solana verification uses `confirmed` not `finalized`.** Payments verified at `confirmed` commitment can be reverted. Fix: Change Connection commitment from `'confirmed'` to `'finalized'` for payment verification. This matches the `safe_confirmations: 32` in the chain document.

- [ ] **P5-H3: Solana verification has no replay protection.** Same tx signature could be submitted for multiple ticket purchases. Fix: Before accepting a Solana payment, check the tx signature against existing `AtlasReceipt` records (or `NewPayment.transfer_metadata.tx_hash`). Reject if already used.

- [ ] **P5-H4: `getFeatureLimit` returns -1 for disabled features.** Current check `if (maxSlots > 0)` treats -1 (disabled) as "don't enforce" = unlimited. Fix: Add explicit check: `if (maxSlots === -1) throw new ForbiddenError('Connectors are disabled for this subscription tier')`.

### Medium

- [ ] **P5-M1:** Generic webhook `field_mapping` — add JSON path sanitization (block `__proto__`, `constructor`, `prototype`), add payload size limit (1MB max)
- [ ] **P5-M2:** Generic API connector SSRF — resolve DNS first, check against private IP ranges, https only, reject redirects to private ranges
- [ ] **P5-M3:** Webhook `timingSafeEqual` throws on mismatched buffer lengths — wrap in try/catch: if lengths differ, return false immediately
- [ ] **P5-M4:** Meetup duration unit — verify from Meetup API docs whether `duration` is seconds or minutes. If seconds: use `duration * 1000` not `duration * 60000`
- [ ] **P5-M5:** Meetup not added to scheduled sync job filter — add `'meetup'` to the `connectorType.$in` array in the sync job
- [ ] **P5-M6:** RA reverse-engineering approach needs legal review — flag as a prerequisite before implementing RA connector

---

## Fix Execution Order

1. **Phase 2 + Phase 1** — fix in parallel (no dependencies between them)
2. **Phase 5 numbering** — quick mechanical fix, can be done alongside Phase 2/1
3. **Phase 3** — fix after Phase 2 (depends on Phase 2's internal endpoint being correctly specified)
4. **Phase 4** — fix last (depends on Phase 2's purchase flow, needs product decisions on anti-fraud rules + tax compliance)

## Verification

After all fixes are applied:
- [ ] Re-read each IMPL end-to-end for internal consistency
- [ ] Verify all code examples compile (no duplicate keys, correct imports, matching function signatures)
- [ ] Verify all file path references still point to correct locations
- [ ] Verify all cross-phase dependencies are documented (Phase 2 internal endpoint → Phase 3, Phase 2 purchase hook → Phase 4)
- [ ] Verify no `mppx` references remain anywhere
- [ ] Verify no custom token references (ATC, $ATLAS, $LEMON, LMC) exist
- [ ] Verify all WP numbers in Phase 5 are consistent
