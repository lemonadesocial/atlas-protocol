# Adversarial Audit Round 4 — Free Ticket Abuse Prevention + Self.xyz Identity Verification

**Source:** Audit session (2026-03-19), Round 4
**Prerequisite:** R1 (78 fixes), R2 (122 tags), R3 (89 tags) — all clean. Zero ship-blockers.
**Focus:** Free ticket abuse vectors + Self.xyz verified identity as trust tier + reward boost system.
**Note:** Self.xyz is ALREADY integrated in Lemonade. This round adds it to the Atlas reward system.

## How to Use

- [ ] Apply all fixes in the respective IMPL documents
- [ ] Mark each fix with `> **AUDIT FIX R4 [FT-{N}]:**` (free ticket) or `> **AUDIT FIX R4 [SV-{N}]:**` (Self verification) tag
- [ ] After all fixes, verify no R1/R2/R3 fixes were broken
- [ ] This round resolves the 2 "known limitations" from R3 (F1 multi-account bypass, F-2 self-referral bypass)

---

## Part 1: Free Ticket Abuse Prevention

### FT-1: Referral milestones must count only PAID tickets [Phase 4]

**Attack:** Create free event, refer 25 fake accounts to claim free tickets, earn $5 referral milestone. Cost: $0. Profit: $5.

- [ ] **Fix in Phase 4 IMPL:** In the referral milestone evaluation logic, add a filter: only count tickets where the associated `NewPayment.amount > "0"` (non-zero payment). Free ticket claims (no payment) do NOT count toward any referral milestone.
- [ ] **Update the referral milestone documentation** to explicitly state: "Milestones count PAID ticket purchases only. Free ticket claims do not contribute to milestone progress."

### FT-2: Free events are NOT eligible for Atlas Direct Ticketing [Phase 1 + Phase 2]

**Attack:** Create free events on Atlas, bots claim millions of free tickets, each creating Ticket documents, EventJoinRequests, receipts, and Verifiable Credentials in MongoDB. Pure database flooding with no payment needed.

- [ ] **Fix in Phase 2 IMPL:** In the purchase controller, before creating a hold, check: if `validation.totalDollars === 0` (free ticket), return a redirect response instead of a 402 challenge. Free tickets are claimed on the source platform or via the existing Lemonade free-ticket flow — NOT through the Atlas MPP purchase path.
  ```javascript
  if (validation.totalDollars === 0) {
    return ctx.body = {
      type: 'free_ticket_redirect',
      message: 'Free tickets are claimed directly, not through Atlas payment flow.',
      redirect_url: event.url || `${config.FRONTEND_URL}/event/${event._id}`,
    };
    ctx.status = 200; // Not 402 — no payment needed
  }
  ```
- [ ] **Fix in Phase 1 IMPL:** Synced free events are still discoverable via Atlas (search results include them), but the `atlas:purchaseEndpoint` in the schema mapper should be null/omitted for free events. Agents see the event but are directed to the source platform for claiming.
- [ ] **Document clearly:** "Atlas Direct Ticketing is for PAID events only. Free events are discovery-only with redirect to the source platform or Lemonade event page for claiming."

### FT-3: Rate limit free ticket claims per IP [Phase 2]

**Attack:** Even with FT-2 (redirect for free tickets), bots could still flood the redirect endpoint to scrape event data.

- [ ] **Fix in Phase 2 IMPL:** Add IP-based rate limiting on the Atlas search and event detail endpoints: max 60 requests per minute per IP for unauthenticated requests (no `Atlas-Agent-Id`), max 200 per minute for authenticated agents. These limits already exist in the manifest — verify they're actually enforced in the router middleware.

### FT-4: Registry penalizes free-only Spaces in relevance scoring [Phase 3]

**Attack:** Create 100 free events with popular keywords. High "attendance" (free claims are easy to inflate) boosts Space reliability score. Paid events get pushed down.

- [ ] **Fix in Phase 3 IMPL:** In the relevance scoring algorithm, add a `paid_event_ratio` factor:
  - If > 50% of a Space's events are paid → no penalty
  - If > 80% are free → 0.5x relevance multiplier on that Space's results
  - If 100% are free → 0.3x relevance multiplier
- [ ] **Add `paid_event_count` and `total_event_count` to the `spaces_index` table.** Updated during indexing. Used by relevance scoring.

### FT-5: Connector sync limits for free events [Phase 1]

**Attack:** Connect Eventbrite account with 500 free "test" events. All sync to Atlas. Search results polluted.

- [ ] **Fix in Phase 1 IMPL:** During event sync, apply a soft cap: max 50 free events synced per connection. Paid events have no cap. If > 50 free events exist on the connected platform, sync the 50 most recent. Log a warning for the organizer in the connector dashboard: "Only the 50 most recent free events are synced. Paid events are always synced."

---

## Part 2: Self.xyz Verified Identity Integration

### Context

Self.xyz is a self-sovereign identity protocol already integrated in Lemonade. Users can prove they are unique humans without revealing personal data. This solves the two "known limitations" from R3:

- **F1 (multi-account bypass):** Self verification = one verified identity per person. Can't create multiple verified Spaces.
- **F-2 (self-referral bypass):** Self verification = one verified identity. Can't have two verified accounts for self-referral.

### SV-1: Verification-Tiered Reward System [Phase 4]

**Core design:** Self verification unlocks higher reward rates and features unavailable to unverified users.

- [ ] **Add to Phase 4 IMPL — new reward tier table:**

  | Feature | Unverified | Self-verified |
  |---|---|---|
  | Paid ticket attendee cashback | 0.4% of protocol fee | 0.8% of protocol fee |
  | Paid ticket organizer cashback | 0.6% of protocol fee | 1.0% of protocol fee |
  | Free ticket attendee rewards | Not eligible | 0.4% equivalent (from treasury, fixed per-claim amount) |
  | Free ticket organizer rewards | Not eligible | 0.6% equivalent (from treasury, fixed per-claim amount) |
  | Referral program | Not eligible | Eligible |
  | Discovery bonus (first N attendees) | Not eligible | 2x cashback |
  | Volume tier progression | Normal rate | 1.5x GMV multiplier for tier calculation |

- [ ] **Update fee split calculation in `processAtlasFee`:** Check `user.selfVerified` (or equivalent field from existing Self.xyz integration). Apply boosted rates for verified users. The EXTRA cashback (boosted - base) comes from the treasury share, not from increasing the protocol fee. Treasury share decreases for verified user transactions:
  - Unverified: Treasury 40%, Organizer 30%, Attendee 20%, Referral 10%
  - Verified: Treasury 25%, Organizer 35%, Attendee 25%, Referral 15%

- [ ] **The implementing agent must read the existing Self.xyz integration** in lemonade-backend to understand: (1) where verification status is stored on the User model, (2) how to check it, (3) what the field name is. Add a note: "Agent MUST grep for `self` or `selfxyz` or `self_xyz` or `verified` in the User model to find the existing integration point."

### SV-2: Self Verification Resolves "Known Limitations" [Phase 1 + Phase 3]

- [ ] **Fix F1 (multi-account bypass) in Phase 1 IMPL:** Add to the `connectPlatform` mutation: if user is Self-verified, enforce a GLOBAL limit of 1 Space with event connectors per verified identity (not per Lemonade account). Store `selfVerifiedIdentityId` on Connection model. Unique index: `(connectorType, selfVerifiedIdentityId)` with `sparse: true` (only applies to verified users). Unverified users keep the existing `externalAccountId` constraint (weaker but still functional).

- [ ] **Fix F-2 (self-referral bypass) in Phase 3 IMPL:** When recording a referral, if BOTH the agent owner AND the Space owner are Self-verified, compare their `selfVerifiedIdentityId`. If same → block referral (same person). If different → allow. For unverified users, keep the existing heuristic (IP/email flag for review).

### SV-3: Free Ticket Rewards for Verified Users Only [Phase 4]

Free events generate no protocol fee ($0 payment). But verified users can earn a fixed per-claim reward funded by the treasury.

- [ ] **Add to Phase 4 IMPL:** When a Self-verified user claims a free ticket via Atlas:
  - Attendee reward: fixed $0.01 USDC per free ticket claim (funded from treasury)
  - Organizer reward: fixed $0.02 USDC per free ticket claimed on their event (funded from treasury)
  - Cap: max 100 free ticket rewards per user per month (prevents farming)
  - Cap: max 500 free ticket rewards per event (prevents single-event flooding)
  - Total treasury exposure: max $0.03 × 500 = $15 per event, $0.03 × 100 = $3 per user per month
- [ ] **Unverified users get NO rewards on free tickets.** This is the incentive to verify.
- [ ] **Create a new model `AtlasFreeTicketReward`** (separate from `AtlasFeeDistribution` which is for paid tickets):
  - `user_id`, `event_id`, `space_id`
  - `role`: 'attendee' | 'organizer'
  - `amount_usdc`: string BigInt
  - `self_verified`: boolean (always true — unverified users don't get these)
  - `status`: 'pending_hold' | 'available' | 'paid_out' | 'cancelled'
  - `hold_expires_at`: Date (same 14-day hold as paid ticket rewards)
- [ ] **Include free ticket rewards in the weekly payout batch.** Same Stripe Connect requirement. Same 14-day hold. Same payout flow.

### SV-4: Verification Prompt UX [Phase 2 + Phase 4]

- [ ] **Phase 2 IMPL:** In the Atlas receipt response, include a `verification_prompt` field for unverified users:
  ```json
  {
    "verification_prompt": {
      "message": "Verify your identity with Self to earn 2x cashback on future purchases",
      "verify_url": "https://lemonade.social/settings/verify",
      "benefits": ["2x cashback", "Referral rewards", "Free event rewards", "Discovery bonus"]
    }
  }
  ```
  Only include this field if the user is NOT Self-verified. Verified users get `"verification_prompt": null`.

- [ ] **Phase 4 IMPL:** In the Space dashboard rewards section, show a verification CTA for unverified organizers:
  - "You're earning 0.6% cashback. Verify with Self to earn 1.0% — that's an extra $X.XX based on your last month's sales."
  - Calculate the actual dollar difference based on their real GMV to make it tangible.

### SV-5: Anti-Gaming Rules for Verified Users [Phase 4]

Even verified users can game the system (just harder). Add safeguards:

- [ ] **Self-purchase exclusion still applies to verified users.** Verification doesn't override P4-C1. `organizerId === attendeeUserId` → zero cashback regardless of verification status.
- [ ] **Boosted rates have a monthly cap per user.** Max $100/month in boosted rewards (the difference between boosted and base rate). After the cap, verified users earn at base rate. This limits the upside of any gaming strategy.
- [ ] **Free ticket reward caps are hard limits.** 100 per user per month, 500 per event. No exceptions for any verification tier.

---

## Cross-Phase Consistency Checks

After applying all R4 fixes:

- [ ] Phase 2 purchase flow correctly rejects free tickets from Atlas Direct (FT-2) while still allowing free ticket discovery
- [ ] Phase 1 schema mapper omits `purchaseEndpoint` for free events (FT-2)
- [ ] Phase 3 relevance scoring includes `paid_event_ratio` factor (FT-4)
- [ ] Phase 4 `processAtlasFee` checks Self verification status before applying reward rates (SV-1)
- [ ] Phase 4 free ticket rewards are separate model from paid ticket fee distributions (SV-3)
- [ ] Phase 4 weekly payout includes BOTH `AtlasFeeDistribution` (paid) and `AtlasFreeTicketReward` (free, verified only) records
- [ ] Self-purchase exclusion applies regardless of verification status (SV-5)
- [ ] All R1 (114 tags), R2 (122 tags), R3 (89 tags) preserved
- [ ] No phantom function calls introduced
- [ ] No new `$inc` on string BigInt fields

---

## Verification After All Fixes

- [ ] Free events return redirect (not 402) from Atlas purchase endpoint
- [ ] Free events have no `purchaseEndpoint` in Atlas schema mapper output
- [ ] Referral milestones count only paid tickets
- [ ] Free event sync capped at 50 per connection
- [ ] Registry relevance penalizes free-heavy Spaces
- [ ] Reward tier table matches SV-1 specification
- [ ] `selfVerifiedIdentityId` field added to Connection model (Phase 1)
- [ ] Self verification comparison added to referral recording (Phase 3)
- [ ] `AtlasFreeTicketReward` model defined (Phase 4)
- [ ] Free ticket reward caps enforced (100/user/month, 500/event)
- [ ] Monthly cap on boosted rewards ($100 difference cap)
- [ ] Verification prompt in receipt response for unverified users
- [ ] Verification CTA in dashboard with real dollar calculation
- [ ] All previous audit tags (325) intact
