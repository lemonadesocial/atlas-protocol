# 09 Fee Economics Spec

**Status:** Draft | **Version:** 0.1 | **Date:** April 2026

**References:** WHITEPAPER-CHAIN-AGNOSTIC.md (Sections 8, 9), ARCHITECTURE.md (FeeRouter.sol, RewardLedger.sol, PromotionSettlement.sol), 04-SMART-CONTRACTS-SPEC.md

---

## 1. Protocol Fee

ATLAS charges a flat **0.5% fee on every ticket transaction** (50 bps). This is a deliberate reduction from the 2% rate of earlier draft phases — the protocol is competing with native-chain swap fees, not with legacy ticketing platforms, and a thinner protocol fee leaves more room for stacked platform fees while still funding the treasury, reward pools, and infrastructure subsidies (mint gas, IPFS pinning).

The fee applies to:

- Ticket purchases via the 402 payment flow (agent-initiated)
- Ticket purchases via ATLAS Direct Ticketing (organizer-hosted)

The following actions are free. No fee, no hidden cost, no rate limit surcharge:

- Event listing and publishing
- Search queries and discovery
- Account creation (organizer, platform, agent)
- SDK integration and API access
- Receipt-issuance IPFS pinning (subsidized by the 0.5% fee)
- Mint gas for ATLAS-managed mint endpoints (subsidized by the 0.5% fee)

On a $50 ticket, the protocol fee is $0.25. The organizer receives $49.75 before any platform-fee deductions and reward distributions. On a $25 ticket, the protocol fee is $0.125.

---

## 2. Stacked Platform Fees

ATLAS supports a stacked fee model: multiple platforms in the issuance chain can each take their own fee on top of the protocol fee. Concretely, a Lemonade-hosted Space settlement layers:

1. **ATLAS protocol fee** — 0.5%, fixed, paid to the ATLAS treasury.
2. **Lemonade meta-fee** — configurable per Space's plan (e.g. 1% on the standard tier; 0% on enterprise tiers that pay a SaaS subscription instead).
3. **Space platform fee** — configurable per organizer (the Space's own service fee on top of the organizer's ticket price).
4. **Organizer net** — what remains.

For an external platform (e.g. Eventbrite served via the connector), the Lemonade meta-fee is omitted and the array reduces to: protocol fee + the platform's own service fee + organizer net. The on-chain representation is a `FeeSplit[]` array of `{recipient, amount, retain_on_refund}` passed to `FeeRouter.settle()` (see [04-SMART-CONTRACTS-SPEC §3](./04-SMART-CONTRACTS-SPEC.md#3-feeroutersol)).

Constraints enforced on-chain:

- `MAX_TOTAL_PLATFORM_FEES_BPS = 2000` (20%) — sum of all FeeSplit entries (excluding the protocol fee) MUST NOT exceed 20% of the ticket price.
- `MIN_ORGANIZER_BPS = 7000` (70%) — organizer's share of the gross MUST be at least 70%.

These caps protect organizers from runaway fee-stacking by intermediaries.

### 2.1 Three Checkout Modes

Platforms choose how stacked fees are presented to the buyer. The protocol does not mandate any one mode — each is valid and each maps to the same `FeeSplit[]` structure on-chain.

| Mode | Buyer sees | Organizer behaviour | Example |
|------|------------|---------------------|---------|
| **(A) Organizer absorbs** | Listed price = total. Fees come out of the organizer's net. | "Lu.ma style." Buyer pays $25; organizer nets $25 minus all fees. | $25 listed → buyer pays $25 → organizer nets ~$23.50 |
| **(B) Buyer pays on top** | Listed price + itemized fees at checkout. | "Eventbrite style." Buyer pays $25 + fees. Organizer nets the listed price. | $25 listed → buyer pays $26.50 → organizer nets ~$25 |
| **(C) Configurable per-fee split** | Listed price + only the fees the organizer chose to pass through. | "Stripe Connect style." Each FeeSplit entry is independently absorbed-or-passed. | Organizer absorbs the 0.5% protocol fee; passes platform fees on to buyer. |

The mode is declared per-event in the listing's `atlas:fee_model` field (`inclusive`, `additive`, or `mixed:<config>`). The 402 challenge response itemizes every component fee so the buyer's agent can present the math truthfully.

---

## 3. Treasury Split (of the 0.5% Protocol Fee)

The 0.5% protocol fee splits into five allocations within the protocol treasury. Percentages are stored in `FeeRouter.sol` and updatable via governance (see Section 8). Note: the bps refer to the protocol fee, not the ticket price.

| Allocation | Share of protocol fee | Effective rate (of ticket price) | Purpose |
|---|---|---|---|
| Organizer rewards | 30% | 0.15% | Stablecoin cashback to event organizers |
| Attendee rewards | 20% | 0.10% | Stablecoin cashback to ticket purchasers |
| Referral rewards | 10% | 0.05% | Acquisition incentives for organizers, platforms, agents |
| Protocol development | 25% | 0.125% | Engineering, infrastructure, security audits, mint-gas subsidy, IPFS pinning |
| Reserve | 15% | 0.075% | Governance transition fund, contingencies |

**Dollar example.** A $100 ticket generates a $0.50 protocol fee. That $0.50 splits as: $0.15 organizer rewards, $0.10 attendee rewards, $0.05 referral rewards, $0.125 protocol development, $0.075 reserve.

The development bucket is the source of mint-gas subsidies (Section 4.5 of [04-SMART-CONTRACTS-SPEC](./04-SMART-CONTRACTS-SPEC.md)) and the ATLAS-operated IPFS pinning service ([05-IPFS-DATA-LAYER §6.2](./05-IPFS-DATA-LAYER.md#62-atlas-operated-pinning-service)).

---

## 4. Organizer Reward Tiers

Organizer cashback scales with monthly ticket volume. Higher volume unlocks a larger share of the 30% organizer allocation (which is itself 30% of the 0.5% protocol fee).

| Monthly Tickets Sold | Cashback Rate (of protocol fee) | Effective Rate (of GMV) |
|---|---|---|
| 1 to 100 | 20% | 0.10% |
| 101 to 500 | 25% | 0.125% |
| 501 to 2,000 | 30% | 0.15% |
| 2,000+ | 35% | 0.175% |

**Payout mechanics:**

- Payouts occur weekly in USDC on the canonical reward chain (Base in v1) to the organizer's configured wallet. See [03-SETTLEMENT-SPEC §1](./03-SETTLEMENT-SPEC.md#1-design-principle).
- No minimum threshold. An organizer who sells one $10 ticket receives their reward.
- No claim process. `RewardLedger.sol` accrues the reward automatically, and a relay service triggers `claimFor()` on the organizer's behalf.
- No token conversion. Rewards arrive as USDC.

**Dollar example.** An organizer sells 600 tickets at $30 each in a month ($18,000 GMV). They fall in the 501-to-2,000 tier (30% cashback rate). Protocol fee: $90 (0.5% of $18,000). Organizer reward: $90 × 30% = $27. Effective cost to the organizer at the protocol layer: 0.5% − 0.15% = 0.35% of GMV (excluding any platform-fee stack).

---

## 5. Attendee Rewards

Attendees who purchase tickets through ATLAS-aware agents receive USDC cashback.

**Standard rate:** 0.05% of the ticket price (effective rate after the protocol-fee subdivision; see Section 3). On a $50 ticket, the attendee receives ~$0.025 in USDC.

**First purchase bonus:** 1% of the ticket price, capped at $5. A new attendee buying a $200 ticket receives the standard rate + a $2.00 bonus on their first transaction. The first-purchase bonus is funded out of the development bucket, not from the attendee-rewards subdivision.

**Referral bonus:** 0.05% of the referred friend's first purchase. If the friend buys a $40 ticket, the referrer receives $0.02.

Attendee rewards are optional for agents to surface. Agents choose whether to display reward information during the purchase flow. Rewards accrue on the canonical reward chain (Base + USDC, v1; see [04-SMART-CONTRACTS-SPEC §5](./04-SMART-CONTRACTS-SPEC.md#5-rewardledgersol)). Accrued USDC can be applied toward future ticket purchases or withdrawn to an external wallet.

---

## 6. Referral Program

All referral payouts are in USDC, sourced from the 10% referral allocation of the 0.5% protocol fee.

**Organizer referrals.** An organizer who refers another organizer to ATLAS earns 5% of the referred organizer's protocol fees for 12 months.

**Platform referrals.** A platform that onboards organizers earns 10% of those organizers' protocol fees for 12 months. Platforms that bring supply-side liquidity receive double the organizer referral rate.

**Agent referrals.** An agent implementation that drives ticket purchases earns 5% of those transactions' protocol fees perpetually. The agent retains the referral as long as it remains the transaction source. Agents register via the ATLAS registry and receive an `X-Atlas-Agent-Id` header for attribution tracking.

### 6.1 Fee Retention on Refund

Refunds use `FeeRouter.reverseSettle(holdId)`. Retention rules per fee category:

| Fee category | Retained on refund? | Notes |
|---|---|---|
| ATLAS protocol fee (0.5%) | **Always retained** | Cancelled events still consumed protocol resources. Funds reward-pool / treasury / dev / reserve as normal. |
| Lemonade meta-fee | Configurable per platform | Set by `retainOnRefund` flag in the FeeSplit entry. Default: refunded. |
| Space platform fee | Configurable per platform | Set by `retainOnRefund` flag. Default: refunded. |
| Organizer share | Always reversed | Buyer is made whole on the organizer's portion. |
| Reward accruals | Reversed via `RewardLedger.reverseRewards(holdId)` | Unclaimed accruals: deleted. Already-claimed accruals: clawback debit. See [04-SMART-CONTRACTS-SPEC §5](./04-SMART-CONTRACTS-SPEC.md#5-rewardledgersol). |

The protocol fee retention is non-configurable: it underwrites the cost of running the registry, the IPFS pin, the mint, and the dispute infrastructure regardless of whether the sale ultimately stuck.

---

## 7. Promotion Revenue (Ad-Network)

The ATLAS ad-network creates a second revenue stream. Promotion revenue is separate from the 0.5% transaction fee. It is additive. An organizer who promotes an event pays the 0.5% protocol fee plus the promotion bid.

`PromotionSettlement.sol` executes the bid split on-chain when a promoted ticket sells.

**Promotion split:**

| Recipient | Share | Role |
|---|---|---|
| Referring agent | 60% | Surfaced the promoted event to the buyer |
| Protocol treasury | 30% | Funds protocol operations |
| Registry node | 10% | Served the discovery query |

### 7.1 Revenue Stream Comparison

| Revenue Stream | Source | Frequency | Split |
|---|---|---|---|
| Transaction fee (0.5%) | Every ticket sale | Every transaction | 30% organizer, 20% attendee, 10% referral, 25% dev, 15% reserve |
| Promotion bid (variable) | Promoted ticket sales only | Subset of transactions | 60% agent, 30% treasury, 10% node |

**Dollar example.** A $25 ticket with a $2.00 promotion bid generates: $0.125 protocol fee (0.5%) plus $2.00 promotion bid. The agent receives $1.20 from the bid. The protocol treasury receives $0.60. The registry node receives $0.20.

### 7.2 Projected Protocol Revenue

Assumes 20% of events run promotions at an average bid of $1.50 per ticket sold. Base transaction-fee column is 0.5% of GMV.

| Monthly GMV | Transaction Fee (0.5%) | Ad-Network Revenue | Combined |
|---|---|---|---|
| $100K | $500 | $600 | $1,100 |
| $1M | $5,000 | $6,000 | $11,000 |
| $10M | $50,000 | $60,000 | $110,000 |

At higher GMVs the ad-network exceeds base transaction-fee revenue. The 0.5% protocol fee is intentionally thin: most protocol revenue at scale comes from the ad-network, not from siphoning ticket-price percentage points.

---

## 8. Fee Comparison vs Competitors

All calculations use a $25 base ticket price. ATLAS rows show the protocol fee only — platform fees are stacked on top per the chosen FeeSplit, but they go to the platform recipient, not to ATLAS.

| Platform | Fee Structure | Organizer Net (on $25 ticket, protocol layer only) |
|---|---|---|
| ATLAS (USDC direct, 0.5%) | 0.5% protocol fee | $24.875 before any platform stack |
| ATLAS (card via Stripe SPT) | 0.5% protocol + ~1.5% Stripe processing | $24.50 before any platform stack |
| Eventbrite | 3.7% + $1.79 per ticket + 2.9% payment processing | ~$21.50 to $22.50 |
| Ticketmaster | 20-30% service fees | ~$17.50 to $20.00 |

The ATLAS protocol fee is competitive with native-chain swap fees, not with legacy ticketing. Stacked platform fees (Lemonade meta-fee, Space platform fee, etc.) are organizer-configurable and go to the platforms providing the value, not to the ATLAS treasury.

---

## 9. Governance and Fee Adjustments

The 0.5% rate and allocation percentages are stored in `FeeRouter.sol` as governance-updatable parameters.

**Stage 1 (launch):** Lemonade multi-sig controls fee parameters.
**Stage 3 (federation):** 3-of-5 multi-sig with Lemonade, organizer representatives, and platform representatives.
**Stage 4 (decentralization):** DAO governance via $LEMON token holders votes on fee changes.

No fee change takes effect without a 7-day timelock. The contract emits events for every parameter update, creating a public audit trail.

---

## 10. Token Phases (Summary)

Full specification in `23-TOKEN-PHASES-SPEC.md`. ATLAS launches without a custom token. Token phases activate at adoption milestones, not calendar dates.

**Phase 0: USDC Only** (launch to $100K monthly GMV). All fees, rewards, and settlements in USDC. No custom token exists.

**Phase 1: LMC Wrapper** (triggered at $100K monthly GMV). LMC (Lemonade Coin) wraps USDC at a 1:1 ratio. LMC holders receive priority listing placement, a 1.5x reward multiplier, and platform staking capability. LMC is always redeemable for USDC at par.

**Phase 2: $LEMON Governance** (triggered at $1M monthly GMV). $LEMON is a governance token distributed to active protocol participants based on historical contribution. Holders vote on fee adjustments, reward allocation changes, registry federation policies, and grant disbursements from the reserve.

**Phase 3: Dual-Token + Foundation** (triggered at $10M monthly GMV). LMC handles utility and staking (stable, USDC-backed). $LEMON handles governance and ecosystem growth (floating, market-determined). A non-profit ATLAS Foundation stewards the protocol, funded by the reserve allocation.

---

## 11. Contract Reference

| Contract | Function | Deployment Stage |
|---|---|---|
| `FeeRouter.sol` | Receives stablecoin, executes 0.5% protocol-fee split + stacked FeeSplit array, supports `reverseSettle` | Stage 1 (launch); v2 in Phase 5 |
| `RewardLedger.sol` | Tracks reward accrual on canonical chain (Base + USDC, v1), enforces 14-day timelock, identity-boosted rates, supports `reverseRewards` | Stage 3 (federation) |
| `PromotionSettlement.sol` | Splits ad-network bids per 60/30/10 rule | Phase 1 ($500K GMV) |

`RewardLedger.sol` supports identity-boosted rewards. Participants with a verified on-chain attestation (World ID, Self.xyz, Civic, or Polygon ID) receive a 1.5x multiplier on all reward accruals. The multiplier is governance-adjustable after Phase 2.
