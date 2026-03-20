# Adversarial Audit Round 2 — Exploit Prevention + Product Decisions

**Source:** Audit session (2026-03-19), Round 2
**Prerequisite:** All R1 fixes (AUDIT-FIXES.md) have been applied and verified (78/78 clean).
**Focus:** 15 newly identified exploits + 2 product decisions resolved.

## How to Use

- [ ] Fix ALL items in the respective IMPL documents
- [ ] Mark each fix with `> **AUDIT FIX R2 [E{N}]:**` tag for traceability
- [ ] After all fixes, verify no R1 fixes were broken by R2 changes

---

## Product Decisions (RESOLVED — apply as stated)

### PD-1: Anti-Fraud Rules for Referral Program → Apply to Phase 4

All three measures. Apply in Phase 4 IMPL:

- [ ] **Min account age: 7 days** before a referral code can be CREATED. Check `user.created_at` vs `Date.now()`. If account is < 7 days old, `createReferralCode` mutation returns error "Account must be at least 7 days old to create a referral code."
- [ ] **Min 1 published event with at least 1 non-self attendee** before earning referral REWARDS. The referral code can be shared, but milestone rewards are withheld until: `EventModel.countDocuments({ host: userId, state: 'published' }) >= 1` AND at least 1 ticket on that event was purchased by a different user (`ticket.assigned_to !== event.host`). Track as `referral_rewards_eligible: boolean` on the referral model.
- [ ] **Max 3 referral code applications per hour per IP.** Rate limit the `atlasApplyReferralCode` mutation. Use Redis sliding window: `atlas:referral:ip:{ip}` with TTL 3600, increment on each application, reject if count > 3.

### PD-2: Tax Compliance → Stripe Connect Handles It

Stripe Connect collects W-9/W-8BEN, handles KYC, and files 1099-K automatically for connected accounts. Lemonade does NOT build its own tax collection infrastructure.

Apply in Phase 4 IMPL:

- [ ] **Remove `AtlasTaxInfo` model entirely.** Stripe Connect handles tax info collection during onboarding. Lemonade does not need a separate model.
- [ ] **Require Stripe Connect as primary payout method.** Organizers MUST have an active Stripe Connected Account (`charges_enabled: true`) to receive any payout (USDC or fiat). Gate: if no Stripe Connect → payouts accumulate but do not disburse. Dashboard shows "Connect Stripe to receive your rewards."
- [ ] **Crypto wallet is OPTIONAL secondary destination.** Organizers who want crypto payouts must ALSO have Stripe Connect (so tax info is captured). Crypto payout is an additional destination, not a bypass of tax reporting. In `AtlasPayoutSettings`: `stripe_connect_account_id` (REQUIRED for any payout), `crypto_wallet_address` + `crypto_wallet_chain` (OPTIONAL, for splitting payouts).
- [ ] **Lemonade tracks cumulative annual payouts** for internal records only (not for tax filing — Stripe does that). Add `cumulative_annual_usd` field to `AtlasRewardBalance`, reset on Jan 1.
- [ ] **Remove the P4-C4 tax compliance section** that described W-9/W-8BEN collection UI and payout gating at $600. Replace with: "Tax compliance is handled by Stripe Connect. See PD-2 in AUDIT-R2-FIXES.md."

---

## Exploit Fixes (Apply to respective IMPL phases)

### E1: Same external account connected to multiple Spaces → triple rewards, search pollution, inventory desync

**Phase:** 1 (Connectors)
**Severity:** CRITICAL
**Attack:** User creates Spaces A, B, C. Connects same Eventbrite account to all three. Same events sync as 3 separate Lemonade events. Triple rewards, search result pollution, inventory desync across copies.

- [ ] **Add `externalAccountId` field to Connection model.** Populated during OAuth callback by fetching the platform user ID:
  - Eventbrite: `GET /v3/users/me/` → `response.id`
  - Lu.ma: From API key ownership (the API key itself is unique per user)
  - Meetup (Phase 5): From OAuth token user info
- [ ] **Add unique compound index: `(connectorType, externalAccountId)` with `sparse: true`** on Connection model. This prevents the same platform account from connecting to multiple Spaces.
- [ ] **During OAuth callback**, before storing credentials: check if a Connection with the same `(connectorType, externalAccountId)` already exists. If yes, reject with error: "This {platform} account is already connected to another Space. Disconnect it there first."
- [ ] **Phase 3 (Registry) secondary defense:** When indexing events, hash `(externalPlatform, externalEventId)` globally. If the same external event appears in multiple Spaces (shouldn't happen with the primary defense, but belt + suspenders), only index the FIRST one. Log duplicate for investigation.

### E2: Syncing cancelled/deleted events as live listings

**Phase:** 1 (Connectors)
**Severity:** HIGH
**Attack:** Eventbrite event is cancelled or deleted. Sync doesn't check status. Cancelled event appears as active Atlas listing. Agents try to purchase tickets to dead events.

- [ ] **Eventbrite connector: Check event status field during sync.** Eventbrite events have `status` field: `draft`, `live`, `started`, `ended`, `completed`, `canceled`. Only sync events with status `live` or `started`. Skip all others.
- [ ] **On re-sync: If a previously synced event is now cancelled/deleted on Eventbrite**, update the Lemonade event state to `cancelled`. Update the `ExternalEventMapping` with `status: 'source_cancelled'`. The Atlas Registry health check will stop returning cancelled events.
- [ ] **Lu.ma connector: Check event status.** Lu.ma events have an `end_date` — skip events where `end_date < now` (past events). Check for any cancellation indicator in the API response.

### E3: Price manipulation between syncs

**Phase:** 1 (Connectors) + Phase 2 (Atlas Protocol)
**Severity:** HIGH
**Attack:** Organizer syncs $10 event. Changes to $100 on Eventbrite. Atlas still shows $10 until next sync. If Atlas Direct Ticketing is enabled, tickets sell at stale price.

- [ ] **Phase 1: Add `lastSyncedAt` timestamp to AtlasEvent schema mapping.** Agents and the Registry can see how fresh the data is.
- [ ] **Phase 2: Atlas 402 challenge must include `price_valid_until` timestamp.** Set to `min(hold_expires_at, next_scheduled_sync)`. This tells agents the price is guaranteed until that time.
- [ ] **Phase 2: For Atlas Direct Ticketing events that are ALSO synced from an external platform**, always re-fetch the current price from the source platform before building the 402 challenge. Do NOT use cached/synced price for purchase flow. Use synced price only for discovery/listing.

### E4: Connecting someone else's platform account (OAuth token theft)

**Phase:** 1 (Connectors)
**Severity:** MEDIUM
**Attack:** Attacker obtains another organizer's OAuth token (phishing, token theft). Connects it to their own Space. Collects rewards on that organizer's events.

- [ ] **Log the connecting user's identity alongside the `externalAccountId`.** If the same `externalAccountId` was previously connected by a different Lemonade user and then disconnected, flag for review.
- [ ] **Rate limit `connectPlatform` mutation** to 5 attempts per hour per user. Prevents rapid credential testing.
- [ ] **Email notification to the platform account owner** (if email is available from the platform API) when their account is connected to a Lemonade Space. "Your Eventbrite account was connected to Space X on Lemonade. If this wasn't you, disconnect it at {link}."

### E5: Micropayment dust attack (operational cost > fee revenue)

**Phase:** 2 (Atlas Protocol) + Phase 4 (Rewards)
**Severity:** MEDIUM
**Attack:** Create thousands of $0.01 events. Bots purchase tickets. Each transaction costs more to process (DB writes, reward calculations, payout overhead) than the 2% fee ($0.0002) collected.

- [ ] **Phase 2: Set a minimum ticket price for Atlas Direct Ticketing.** Minimum: $0.50 USD. Events with ticket prices below this are not eligible for Atlas purchase flow (discovery is still fine). Return 422 "Ticket price below Atlas minimum ($0.50)" on purchase attempt.
- [ ] **Phase 4: Set minimum reward accrual threshold.** If the reward amount for a single transaction is < $0.01 USDC (i.e., ticket price < $0.50), do not create a reward record. Log the dust amount to a `dust_pool` counter for periodic sweep to treasury.

### E6: Hold exhaustion as competitive weapon (inventory DoS)

**Phase:** 2 (Atlas Protocol)
**Severity:** HIGH
**Attack:** Competing organizer creates thousands of holds on your event. Never completes Phase 2. Event appears available but real purchases fail because holds consume phantom inventory.

- [ ] **Limit holds per agent per event:** Max 5 active holds per `Atlas-Agent-Id` per event. Reject with 429 if exceeded.
- [ ] **Limit total active holds per event:** Max `ticket_limit * 0.2` (20% of total inventory) can be held simultaneously. Prevents more than 20% of inventory being locked by uncommitted holds.
- [ ] **Reduce hold TTL for repeated non-completion.** If an agent creates holds but never completes Phase 2, reduce their hold TTL from 300s to 60s after 3 abandoned holds. Track `abandoned_hold_count` per agent.
- [ ] **Require payment proof deposit for high-volume holds** (future — document as enhancement, don't implement now).

### E7: Receipt forgery / credential reuse across events

**Phase:** 2 (Atlas Protocol)
**Severity:** MEDIUM
**Attack:** Present a legitimate Verifiable Credential from Event A to check into Event B if check-in system doesn't validate event_id.

- [ ] **Ticket verification endpoint (`/atlas/v1/tickets/:id/verify`) MUST validate `event_id` in the credential matches the event being checked into.** The verify request should include `event_id` as a required parameter. Return 403 if credential's `event_id` doesn't match.
- [ ] **Each VC includes `event_id` in the `credentialSubject`** (already in the spec — verify it's enforced in the VC issuance code).

### E8: Search result manipulation via Space flooding

**Phase:** 3 (Registry)
**Severity:** HIGH
**Attack:** Create 50 Spaces with near-duplicate events ("Berlin Techno Night", "Techno Night Berlin", etc.). Flood search results. Push competitors down.

- [ ] **Registry deduplication during search merge.** After merging results from all Spaces, deduplicate by: fuzzy title match (Levenshtein distance < 3 on normalized title) + same date + same venue/location (within 100m). Keep the result from the Space with the highest reliability score. Mark others as duplicates (excluded from results, logged for investigation).
- [ ] **Rate limit Space creation** if not already limited. Max 3 Spaces per user. Enforced at the Lemonade backend level.
- [ ] **Flag accounts creating many Spaces with similar events** for manual review.

### E9: Referral fee laundering (self-referral through own Space)

**Phase:** 3 (Registry) + Phase 4 (Rewards)
**Severity:** HIGH
**Attack:** Agent operator controls both the agent AND the Space. Agent searches via Registry (gets `atlas_ref`). Purchase goes through their own Space. They collect organizer reward AND referral fee.

- [ ] **Phase 3: No referral fee when the purchasing agent's registered owner matches the Space owner.** When recording a referral, check: if `agent_registration.owner_user_id === space.owner_user_id`, set referral fee to $0. Log as "self-referral blocked."
- [ ] **Phase 4: Referral rewards require the referred purchase to be from a DIFFERENT user than the referrer AND the Space owner.** Triple-check: `referrer !== attendee !== space_owner`.

### E10: Refund timing attack (cashback-then-refund)

**Phase:** 4 (Rewards)
**Severity:** CRITICAL
**Attack:** Buy ticket → cashback credited to balance → refund ticket → keep cashback because payout already happened or clawback window passed.

- [ ] **Cashback is NOT available for payout until 14-day hold period.** After purchase, reward is created with status `pending_hold`. After 14 days with no refund, status moves to `available`. Only `available` rewards are included in weekly payout batches.
- [ ] **If refund occurs during hold period:** reward is cancelled (status `cancelled`, not clawed back from balance).
- [ ] **If refund occurs AFTER payout:** clawback from next payout cycle (existing clawback logic in R1 fix P4-M4). The 14-day hold prevents most refund timing attacks since most refunds happen within 14 days.
- [ ] **Add `hold_expires_at` field to `AtlasRewardBalance` or individual reward records.** Payout service filters: `status === 'available' AND hold_expires_at < now`.

### E11: Volume tier manipulation (bulk self-purchase at month-end, refund next month)

**Phase:** 4 (Rewards)
**Severity:** HIGH
**Attack:** Organizer self-purchases tickets in bulk at month-end to hit Platinum tier. All legitimate sales that month retroactively earn higher rate. Next month, refund self-purchases.

- [ ] **Self-purchase exclusion (from P4-C1) already prevents this.** Self-purchases don't count toward GMV (organizerId === attendeeUserId → cashback = 0, and should ALSO exclude from GMV calculation).
- [ ] **Verify P4-C1 implementation also excludes self-purchases from `AtlasOrganizerMonthlyGmv` calculation.** If not, add: "Self-purchase transactions (organizerId === attendeeUserId) are excluded from monthly GMV aggregation."
- [ ] **Volume tier is calculated on SETTLED GMV only** (not pending/refundable). A transaction only counts toward GMV after the 14-day hold period (from E10).

### E12: Wash trading between colluding organizers

**Phase:** 4 (Rewards)
**Severity:** MEDIUM
**Attack:** Organizer A and B create events. A buys B's tickets, B buys A's. Both earn cashback. Self-purchase check only catches `organizerId === attendeeId`, not cross-collusion.

- [ ] **Document as a known limitation.** Cross-organizer wash trading is hard to detect programmatically without ML-based fraud detection.
- [ ] **Add basic heuristics:** Flag transactions where two organizers exclusively buy each other's tickets and no one else's. Query: if > 80% of Space A's Atlas revenue comes from Space B's owner, and vice versa, flag both for manual review.
- [ ] **Add monthly automated report** of suspicious transaction patterns (circular purchasing, single-buyer concentration) for manual review. Don't block automatically — too many false positives.

### E13: Dual-ticketing overselling (platform + Atlas Direct simultaneously)

**Phase:** 1 (Connectors) + Phase 2 (Atlas Protocol)
**Severity:** CRITICAL
**Attack:** Event synced from Eventbrite. Atlas Direct Ticketing enabled. Tickets sold on BOTH Eventbrite AND Atlas. Inventory isn't shared. 100-seat event sells 200 tickets.

- [ ] **Atlas Direct Ticketing and platform ticketing are MUTUALLY EXCLUSIVE per event.** When an organizer enables Atlas Direct Ticketing for a synced event, the sync connector STOPS syncing ticket inventory for that event. A clear warning is shown: "Enabling Atlas Direct Ticketing will disconnect ticket sales from {platform}. Tickets will only be sold through Atlas."
- [ ] **Alternatively (simpler for Phase 1):** Atlas Direct Ticketing is ONLY available for native Lemonade events (not synced events). Synced events are discovery-only — the purchase redirects to the source platform's checkout URL. This eliminates the dual-ticketing problem entirely.
- [ ] **Recommend the simpler approach for launch.** Synced events = discovery + redirect. Native events = Atlas Direct Ticketing. Dual-mode can be added in a future phase with proper inventory sync.

### E14: Shadow Space impersonation

**Phase:** 3 (Registry)
**Severity:** HIGH
**Attack:** Attacker creates a Space mimicking a legitimate organizer (same name, logo). Lists fake tickets at lower prices. Agents find the shadow Space first.

- [ ] **Registry: Verified organizer badge.** Organizers who connect real platform accounts (Eventbrite OAuth proves ownership) get a `verified: true` flag. The relevance scoring already weights verified organizers higher (from R1 fix). Agents should prefer verified results.
- [ ] **Registry: Report mechanism.** API endpoint `POST /v1/report` for agents or users to flag suspicious Spaces. After N reports, Space is temporarily de-listed pending manual review.
- [ ] **Naming collision detection.** When indexing a new Space, check if another Space already exists with a very similar name (Levenshtein distance < 2) in the same geographic region. If so, flag the new Space for review before indexing.

### E15: Reward drain via subscription cycling

**Phase:** 5 (Expansion) + Phase 4 (Rewards)
**Severity:** MEDIUM
**Attack:** Sign up for Enterprise (unlimited connectors). Connect 50 accounts across 50 Spaces. Sync thousands of events. Earn rewards. Downgrade to Free. Grace period keeps connections alive.

- [ ] **Phase 5: On downgrade, connections beyond the new tier limit are DISABLED immediately** (not just blocked from creating new ones). `status: 'suspended_tier_limit'`. Events from disabled connections are removed from Atlas Registry.
- [ ] **Phase 4: Rewards only accrue for events on ACTIVE connections.** If a connection is suspended (any reason), Atlas transactions on events from that connection do not generate rewards.
- [ ] **No grace period for connector limits.** Subscription tier limits are enforced immediately on downgrade. This overrides the R1 fix P5 which specified a grace period. Grace period is for other features (themes, page generations), NOT for connectors.

---

## Cross-Phase Consistency Checks

After applying all exploit fixes:

- [ ] Verify E1 (unique external account) doesn't conflict with E13 (dual-ticketing) — they're complementary: E1 prevents same account on multiple Spaces, E13 prevents dual-ticketing on single events
- [ ] Verify E10 (14-day hold) doesn't conflict with E11 (settled GMV for tier calculation) — they reinforce each other: both use the same 14-day window
- [ ] Verify PD-2 (Stripe Connect required) doesn't conflict with E5 (minimum ticket price) — Stripe Connect is for payouts, minimum price is for purchases. Independent.
- [ ] Verify E6 (hold limits) works with P2-H3 (holds count against availability) from R1 — they stack: holds count against availability AND are limited per agent/event
- [ ] Verify E15 (no grace period for connectors) explicitly overrides the grace period mentioned in Phase 5 WP-10 — update the Phase 5 IMPL to reflect this

---

## Verification After All Fixes

- [ ] All R1 AUDIT FIX tags still present and intact (137 tags)
- [ ] All R2 AUDIT FIX R2 tags traceable
- [ ] No mppx references
- [ ] No custom token references
- [ ] `AtlasTaxInfo` model removed (replaced by Stripe Connect requirement)
- [ ] Self-purchase exclusion applies to BOTH cashback AND GMV calculation
- [ ] 14-day reward hold period consistently applied across all reward types
- [ ] Stripe Connect is required for ANY payout (fiat or crypto)
- [ ] Unique external account constraint added to Connection model
- [ ] Synced events are discovery-only (no Atlas Direct Ticketing on synced events for launch)
