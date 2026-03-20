# Adversarial Audit Round 3 — Breaking the Fixes

**Source:** Audit session (2026-03-19), Round 3
**Prerequisite:** All R1 (78 fixes) and R2 (122 tags) applied and verified clean.
**Focus:** Bugs introduced by R1/R2 fixes, money math errors, anti-fraud bypasses, phantom functions, cross-phase contract mismatches.

## How to Use

- [ ] Fix ALL Critical and High issues in the respective IMPL documents
- [ ] Mark each fix with `> **AUDIT FIX R3 [F{N}]:**` or `> **AUDIT FIX R3 [CC-{N}]:**` tag
- [ ] After all fixes, verify no R1 or R2 fixes were broken
- [ ] Medium issues: fix if straightforward, document as known limitations if not

---

## CRITICAL (7 — all must fix before routing)

### F3: E13 discovery-only check is dead code — field name mismatch [Phase 2]

Phase 1 model uses `lemonadeEventId` (camelCase Mongoose property). Phase 2 purchase controller queries `lemonade_event_id` (snake_case). Mongoose uses the JavaScript property name. Query always returns null. Every synced event is purchasable through Atlas. The entire dual-ticketing protection doesn't work.

- [ ] **Fix in Phase 2 IMPL:** Change ALL references from `lemonade_event_id` to `lemonadeEventId` in the purchase controller's ExternalEventMapping query. Search for every occurrence of `lemonade_event_id` in Phase 2 and replace with `lemonadeEventId`.
- [ ] **Verify in Phase 1 IMPL:** Confirm the ExternalEventMapping model field is `lemonadeEventId` (camelCase). If Phase 1 uses snake_case, fix there instead — but be consistent across both phases.

### F8: Fees displayed but never charged [Phase 2]

The schema mapper computes 2% protocol fee + platform fee + processing fee for display in ticket listings. But `validatePurchase` calculates `totalDollars` from base price only. The 402 challenge charges $25.00, not $26.38. The fees are cosmetic — never actually collected.

- [ ] **Fix in Phase 2 IMPL:** Add fee calculation to `validatePurchase`. After computing `subtotalCents`, calculate:
  ```
  protocolFeeCents = subtotalCents * 200n / 10000n  // 2%
  totalCents = subtotalCents + protocolFeeCents
  totalDollars = centsToDollars(totalCents.toString())
  ```
- [ ] **Store `protocolFeeCents` on the AtlasTicketHold** so Phase 4 can extract it without recalculating.
- [ ] **The 402 challenge `total_price_usd` must include fees.** Buyer pays base + fees. Organizer receives base only. Protocol fee goes to Atlas treasury/rewards.
- [ ] **Update the payment verification** to check against the fee-inclusive total, not base price.
- [ ] **Platform fee and payment processing fee:** Decide whether these are ALSO charged to the buyer or absorbed. For launch, recommend: only charge the 2% protocol fee. Platform fee = 0 (Lemonade absorbs). Payment processing fee = passed through by Stripe/chain (not our concern). Simplify the fee display to show only the protocol fee.

### F2: Hold limits meaningless — agent IDs are free [Phase 2]

`Atlas-Agent-Id` is self-asserted (any non-empty string). Per-agent hold limits (5 per event) are bypassed by generating unlimited agent IDs. The 20% inventory cap is the only real protection.

- [ ] **Fix in Phase 2 IMPL:** Add IP-based hold rate limiting alongside per-agent limits:
  - Max 10 active holds per IP address across ALL events (not per event). Use Redis: `atlas:holds:ip:{ip}` counter with TTL 300s.
  - Max 20 hold CREATIONS per IP per hour (sliding window). Prevents rapid hold cycling.
- [ ] **Keep the 20% inventory cap** — it's the real defense. The per-agent limit is supplementary.
- [ ] **Document that agent registration with approval/cost is a Phase 2+ enhancement** — don't block launch, but note it as the proper long-term fix.

### CC-2: `$inc` on string BigInt fields — MongoDB can't increment strings [Phase 4]

The hold-expiry job uses `$inc: { pending_usdc: orgReward.toString() }`. But `pending_usdc` is stored as a string (`@prop({ default: '0' })`). MongoDB `$inc` does not work on string fields — it will either throw or produce garbage.

- [ ] **Fix in Phase 4 IMPL:** Replace ALL raw `$inc` operations on string BigInt fields with aggregation pipeline updates. The refund clawback already uses the correct pattern with `$toLong`. Apply the same pattern everywhere:
  ```javascript
  await AtlasRewardBalanceModel.updateOne(
    { user_id, space_id },
    [{ $set: {
      pending_usdc: { $toString: { $add: [{ $toLong: '$pending_usdc' }, NumberLong(amount) ] } }
    }}]
  );
  ```
- [ ] **Audit every `$inc` in Phase 4** — search for all `$inc` operations on monetary fields (`pending_usdc`, `accrued_usdc`, `paid_out_usdc`, `clawed_back_usdc`, `negative_balance_usdc`). Replace ALL with pipeline updates.
- [ ] **Add a code comment** explaining why `$inc` cannot be used on string BigInt fields, so implementing agents don't revert to `$inc`.

### XP-1: Fire-and-forget fee processing loses money on failure [Phase 4]

The fee processing hook uses `.catch(err => logger.error(...))`. If MongoDB is temporarily down or the process crashes, the fee is silently lost. No retry, no reconciliation.

- [ ] **Fix in Phase 4 IMPL:** Replace fire-and-forget with an Agenda job:
  ```javascript
  // In Phase 2 purchase success handler:
  await agenda.now('atlas-process-fee', {
    paymentId: payment._id,
    eventId: event._id,
    spaceId: space._id,
    organizerId: event.host,
    attendeeId: buyerUserId,
    grossAmountUsdc: totalCents.toString(),
    currency: event.currency,
  });
  ```
- [ ] **Create `src/app/jobs/atlas-process-fee.ts`** job definition. The job calls `processAtlasFee()`. Agenda handles retry on failure (default: 3 retries with backoff).
- [ ] **Add a reconciliation job** (`atlas-fee-reconciliation`) that runs daily. It scans for `NewPayment` documents with `state: 'succeeded'` and `metadata.atlas_purchase: true` that have no corresponding `AtlasFeeDistribution`. For any found, it creates the missing fee distribution. This is the safety net.

### M-2: Dust threshold boundary allows document flooding at minimum price [Phase 4]

$0.50 tickets pass the dust check (`< "500000"` means exactly $0.50 passes). Each creates a full AtlasFeeDistribution + AtlasRewardBalance update for $0.003 organizer cashback. Bots buying 1000 tickets at $0.50 create 1000 documents for $3 total cashback.

- [ ] **Fix in Phase 4 IMPL:** Raise dust threshold to $1.00:
  ```javascript
  if (grossAmountUsdc < "1000000") { // < $1.00
    // Log dust amount to treasury counter, do NOT create individual reward records
    await AtlasDustPoolModel.updateOne(
      { month: currentMonth },
      { $inc: { total_dust_usdc: protocolFee.toString() } },
      { upsert: true }
    );
    return; // Skip individual fee distribution
  }
  ```
- [ ] **Keep the E5 minimum ticket price at $0.50** — tickets between $0.50 and $1.00 are valid purchases, they just don't generate individual reward records. The protocol fee is still collected (it's part of the payment amount from F8 fix), it just goes to a consolidated dust pool instead of individual distributions.

### F1: E1 bypass via new platform accounts [Phase 1]

The `(connectorType, externalAccountId)` unique constraint is bypassed by creating a new Eventbrite account. One person, multiple accounts, multiple Spaces.

- [ ] **Document as a known limitation in Phase 1 IMPL.** This is not solvable at the connector level without identity verification (KYC). Add a note:
  > **Known limitation:** The `externalAccountId` uniqueness check prevents the same platform account from connecting to multiple Spaces, but does not prevent the same person from creating multiple platform accounts. Mitigation: (1) Self-purchase exclusion (P4-C1) prevents reward gaming through own events. (2) Registry dedup (E8) prevents search flooding from duplicate events. (3) Rate limiting on Space creation (max 3 per user) limits scale of attack. Full mitigation requires identity verification, deferred to future phase.
- [ ] **Add max 3 Spaces per user** enforcement if not already present. This limits the blast radius of multi-account attacks.

---

## HIGH (10)

### F6: `textScore` sort crashes without `$text` query [Phase 2]

Default sort is `'relevance'` which uses `{ score: { $meta: 'textScore' } }`. When no `q` parameter is provided (geo/date-only search), there's no `$text` query, and MongoDB throws an error.

- [ ] **Fix in Phase 2 IMPL:** If no `q` parameter, default sort to `{ start: 1 }` (date ascending):
  ```javascript
  const defaultSort = query.$text ? { score: { $meta: 'textScore' } } : { start: 1 };
  ```

### F10: Missing imports in Eventbrite connector [Phase 1]

`ConnectionModel` used in OAuth callback but never imported. `sendPlatformConnectedNotification` called but never defined anywhere.

- [ ] **Fix in Phase 1 IMPL:** Add `import { ConnectionModel } from '../../app/models/connection';` to Eventbrite connector imports.
- [ ] **Remove `sendPlatformConnectedNotification` call** — it's a phantom function. Replace with a TODO comment: `// TODO: Add email notification when platform account is connected (future enhancement)`. Do NOT call undefined functions.

### F11: Missing `redis` import in both connectors [Phase 1]

Both connector `executeAction` methods use `redis` for distributed locking but never import it.

- [ ] **Fix in Phase 1 IMPL:** Add Redis import to both connectors. Follow existing backend pattern — check how other services import Redis (likely from a shared `src/app/services/redis.ts` or `src/config/redis.ts`). Add the import path.

### F14: TTL auto-deletes holds, abandoned-hold count is always 0 [Phase 2]

The TTL index `{ expires_at: 1 }, { expireAfterSeconds: 0 }` auto-deletes expired holds. The abandoned-hold count query looks for `status: 'expired'` holds — but they've been deleted. Progressive TTL reduction (E6 fix) is dead code.

- [ ] **Fix in Phase 2 IMPL:** Two options:
  - **(a) Preferred:** Don't count abandoned holds from the holds collection. Instead, increment a counter on `AtlasAgentRegistration`: `abandoned_hold_count`. When a hold expires (detected by the purchase flow returning "hold expired"), increment the counter. The hold limit check reads this counter. Holds are still TTL-deleted (that's fine).
  - **(b) Alternative:** Change TTL behavior — instead of auto-delete, use a status-update cron job that marks expired holds as `status: 'expired'` without deleting them. Then periodically clean up old expired holds (e.g., after 24h). More complex but preserves the data.
- [ ] **Recommend option (a)** — simpler, less data retention.

### F-1: Search dedup insufficient for real-world duplicates [Phase 3]

Levenshtein distance < 3 misses word reordering ("Berlin Techno Night" vs "Techno Night Berlin"), synonyms, and is O(n^2) at scale.

- [ ] **Fix in Phase 3 IMPL:** Replace Levenshtein with token-based Jaccard similarity:
  - Normalize: lowercase, remove punctuation, split into word tokens, sort alphabetically
  - Jaccard coefficient = |intersection| / |union| of token sets
  - Threshold: Jaccard > 0.7 AND same date AND same location (within 200m)
  - This catches word reordering automatically (sorted tokens match)
  - Performance: hash-based, O(n) per comparison vs O(n*m) for Levenshtein
- [ ] **Add result cap before dedup:** Max 200 results per Space fed into merge (not 500). With 50 Spaces × 200 = 10,000 results max. Jaccard dedup on 10K results is fast.

### F-2: Self-referral check bypassed with second Lemonade account [Phase 3]

`agent_owner_user_id !== space_owner_user_id` check is trivially bypassed with two accounts.

- [ ] **Document as known limitation in Phase 3 IMPL.** Add heuristic flags:
  - If agent and Space owner share the same IP at registration time, flag the referral for manual review
  - If agent and Space owner registered within 1 hour of each other, flag
  - Monthly automated report of top referral-earning agents for manual review
- [ ] **Do NOT block automatically** — too many false positives. Flag and review.

### F-5: Orphaned tickets on suspended connections [Phase 5]

When connections are suspended on downgrade, tickets already sold remain valid. But the spec doesn't address what happens to attendees.

- [ ] **Fix in Phase 5 IMPL:** Add explicit documentation:
  > Events from suspended connections remain valid in lemonade-backend. Existing tickets are NOT affected. The event is only removed from Atlas Registry search results. Attendees can still check in. The organizer can still manage the event via Lemonade dashboard. Only NEW Atlas discovery and purchase is blocked.
- [ ] **AtlasFeeDistribution records for suspended connections are NOT retroactively affected.** Rewards already earned are kept.

### E15-2: `deIndexConnectionEvents` is phantom function [Phase 5]

Called but never defined. Phase 3 schema has no `connection_id` on the event index.

- [ ] **Fix in Phase 5 IMPL:** Replace phantom function call with implementable approach:
  - When suspending a connection, query `ExternalEventMappingModel.find({ connectionId })` to get all Lemonade event IDs from that connection
  - For each event, set a flag `atlas_searchable: false` on the Event document (new field, additive)
  - Phase 2 Atlas search controller filters: `atlas_searchable: { $ne: false }` (default is undefined/true, so existing events are unaffected)
  - Phase 3 Registry naturally stops returning events with `atlas_searchable: false` because they won't appear in Space search results
- [ ] **Add `atlas_searchable` field to the Event model modification list** in Phase 2 IMPL (additive boolean field, optional, defaults to undefined which is truthy)

### PD2-3: No maximum unredeemed balance [Phase 4]

Users without Stripe Connect accumulate rewards indefinitely. No cap.

- [ ] **Fix in Phase 4 IMPL:** Add maximum unredeemed balance of $500. When `accrued_usdc` exceeds $500 and user has no active Stripe Connect:
  - New rewards above the cap are redirected to treasury
  - Dashboard shows: "You've earned $500+ in rewards. Connect Stripe to receive payouts. New rewards above $500 go to the Atlas treasury until you connect."
  - Once Stripe is connected, the cap is removed (no limit for users with active Stripe Connect)

### XP-2: Phase 3 float math vs Phase 4 BigInt — accounting mismatch [Phase 3]

Registry's `recordReferral` uses JavaScript float multiplication for fee calculations. Phase 4 uses BigInt. They produce different results for non-round amounts.

- [ ] **Fix in Phase 3 IMPL:** Replace float math in `recordReferral` with integer math. Store `transaction_amount` as integer micro-units (same as Phase 4). Calculate splits using integer arithmetic:
  ```javascript
  const amountMicro = Math.round(params.transaction_amount * 1_000_000);
  const protocolFee = Math.floor(amountMicro * 200 / 10000);
  const treasury = Math.floor(protocolFee * 4000 / 10000);
  // etc.
  ```
  Or better: accept `transaction_amount_micro` as an integer from the calling Space, avoiding the float conversion entirely.

---

## MEDIUM (12)

### Phase 1
- [ ] **F18:** E1 OAuth check may self-match current connection. Add `_id: { $ne: currentConnectionId }` to the duplicate check query.

### Phase 2
- [ ] **F5:** Possible double body-parser if global bodyparser exists. Add comment: "Verify no global bodyparser in app/index.ts before adding router-level bodyparser. If global exists, remove the router-level one."
- [ ] **F9:** `centsToDollars` claims "BigInt compat" but uses `Number()`. Fix the comment to say "Works for amounts up to $90 trillion. Not true BigInt." Or convert to actual BigInt arithmetic.
- [ ] **F12:** `_meta` on TokenSet return may not compile. Define a separate return type or use the `credentialVault.store()` to handle `externalAccountId` separately from the TokenSet.
- [ ] **F13:** `generateDeterministicUuid` skips hex positions 12 and 16. Use all 24 hex chars. Rewrite to: take full ObjectId hex, SHA-256 hash it, format first 16 bytes as UUID v5-style with proper version/variant nibbles.

### Phase 3
- [ ] **CC-5:** SSRF check only resolves IPv4 via `dns.resolve()`. Add `dns.resolve6()` for IPv6 private range checking (`fc00::/7`, `fe80::/10`, `::1`).

### Phase 4
- [ ] **CC-4:** `pending_usdc` never incremented at accrual time, only by hold-expiry job. If hold-expiry job crashes between status transition and balance update, balance is permanently wrong. Wrap the hold-expiry job's per-record processing in `withTransaction`.
- [ ] **CC-3:** Aggregate `$toLong` produces MongoDB Long, not BigInt. `?? 0n` will cause TypeError. Use `?? 0` (regular number) or convert explicitly: `BigInt(result[0]?.total_pool ?? 0)`.
- [ ] **F-3:** 14-day hold insufficient for long-horizon refunds. Add per-organizer negative balance cap of $1000. If negative balance exceeds $1000, block new reward accrual for that organizer until balance recovers.
- [ ] **M-3:** "Split payout" language but model only supports one destination. Clarify in IMPL: payout goes to ONE destination (Stripe Connect OR crypto wallet, based on `preferred_method`). Remove "split payout" language. Split support is a future enhancement.

### Phase 5
- [ ] **CC-6:** Webhook signature verification ignores configured algorithm. Add a switch on `config.signature_algorithm`: `'hmac-sha256'` → SHA-256, `'hmac-sha1'` → SHA-1, `'none'` → skip verification entirely. Default to SHA-256 if not set.
- [ ] **CC-7:** `suspended_tier_limit` not in ConnectionStatus enum. Add it to the enum in the "Existing files to modify" section: `ConnectionStatus.suspended_tier_limit = 'suspended_tier_limit'`. Or use an existing status like `expired` with a different mechanism.

---

## Cross-Phase Consistency Checks

After applying all R3 fixes:

- [ ] **Field name consistency:** Verify `lemonadeEventId` is used everywhere in Phase 1 AND Phase 2 (zero `lemonade_event_id` references)
- [ ] **Fee math consistency:** Verify Phase 2 `validatePurchase` now adds protocol fee to total. Verify Phase 4 `processAtlasFee` receives the correct gross amount (base price, not fee-inclusive).
- [ ] **Phase 4 `processAtlasFee` input:** Must receive BASE price as `grossAmountUsdc` (not fee-inclusive total). The protocol fee was already charged to the buyer in Phase 2. Phase 4 calculates the split of that fee. Verify Phase 2 passes `subtotalCents` (base) not `totalCents` (base + fee) to the Agenda job.
- [ ] **All monetary `$inc` replaced:** Search all 5 IMPL files for `$inc` on any field ending in `_usdc`. Every occurrence must use aggregation pipeline update, not raw `$inc`.
- [ ] **All R1 tags preserved** (114 expected)
- [ ] **All R2 tags preserved** (122 expected)
- [ ] **No phantom function calls** — search all 5 files for function names that are called but never defined in any IMPL. Flag any found.
- [ ] **`atlas_searchable` field** added to Phase 2 Event model modifications AND used in Phase 2 search controller AND set by Phase 5 connection suspension

---

## Verification After All Fixes

- [ ] Zero `lemonade_event_id` (snake_case) references in any IMPL
- [ ] Zero raw `$inc` on string BigInt fields in any IMPL
- [ ] Zero phantom function calls (every function called is either defined in the IMPL or exists in the codebase)
- [ ] Fee calculation includes protocol fee in purchase total
- [ ] Agenda job replaces fire-and-forget for fee processing
- [ ] Reconciliation job defined for missed fee distributions
- [ ] IP-based hold rate limiting added alongside per-agent limits
- [ ] Dust threshold raised to $1.00 for individual reward records
- [ ] Max unredeemed balance ($500) for users without Stripe Connect
- [ ] Phase 3 fee math uses integer arithmetic (not float)
- [ ] `atlas_searchable` field defined in Phase 2, used by Phase 5
- [ ] Token-based Jaccard dedup replaces Levenshtein in Phase 3
- [ ] All R1 + R2 audit fix tags intact
