# 09 Fee Economics Spec

**Status:** Draft | **Version:** 0.1 | **Date:** April 2026

**References:** WHITEPAPER-CHAIN-AGNOSTIC.md (Sections 8, 9), ARCHITECTURE.md (FeeRouter.sol, RewardLedger.sol, PromotionSettlement.sol), 04-SMART-CONTRACTS-SPEC.md

---

## 1. Protocol Fee

ATLAS charges a flat **2% fee on every ticket transaction**. The fee applies to:

- Ticket purchases via the 402 payment flow (agent-initiated)
- Ticket purchases via ATLAS Direct Ticketing (organizer-hosted)

The following actions are free. No fee, no hidden cost, no rate limit surcharge:

- Event listing and publishing
- Search queries and discovery
- Account creation (organizer, platform, agent)
- SDK integration and API access

On a $50 ticket, the protocol fee is $1.00. The organizer receives $49.00 before reward distributions. On a $25 ticket, the fee is $0.50.

---

## 2. Fee Distribution

The 2% protocol fee splits into five allocations. `FeeRouter.sol` executes the split on-chain at settlement time. Percentages are stored in the contract and updatable via governance (see Section 8).

| Allocation | Share | Effective Rate (of ticket price) | Purpose |
|---|---|---|---|
| Organizer rewards | 30% | 0.6% | USDC cashback to event organizers |
| Attendee rewards | 20% | 0.4% | USDC cashback to ticket purchasers |
| Referral rewards | 10% | 0.2% | Acquisition incentives for organizers, platforms, agents |
| Protocol development | 25% | 0.5% | Engineering, infrastructure, security audits |
| Reserve | 15% | 0.3% | Governance transition fund, contingencies |

**Dollar example.** A $100 ticket generates a $2.00 protocol fee. That $2.00 splits as: $0.60 organizer rewards, $0.40 attendee rewards, $0.20 referral rewards, $0.50 protocol development, $0.30 reserve.

---

## 3. Organizer Reward Tiers

Organizer cashback scales with monthly ticket volume. Higher volume unlocks a larger share of the 30% organizer allocation.

| Monthly Tickets Sold | Cashback Rate (of protocol fee) | Effective Rate (of GMV) |
|---|---|---|
| 1 to 100 | 20% | 0.4% |
| 101 to 500 | 25% | 0.5% |
| 501 to 2,000 | 30% | 0.6% |
| 2,000+ | 35% | 0.7% |

**Payout mechanics:**

- Payouts occur weekly in USDC to the organizer's configured wallet.
- No minimum threshold. An organizer who sells one $10 ticket receives their reward.
- No claim process. `RewardLedger.sol` accrues the reward automatically, and a relay service triggers `claimFor()` on the organizer's behalf.
- No token conversion. Rewards arrive as USDC.

**Dollar example.** An organizer sells 600 tickets at $30 each in a month ($18,000 GMV). They fall in the 501-to-2,000 tier (30% cashback rate). Protocol fee: $360. Organizer reward: $360 x 30% = $108. Effective cost to the organizer: 2% - 0.6% = 1.4% of GMV.

---

## 4. Attendee Rewards

Attendees who purchase tickets through ATLAS-aware agents receive USDC cashback.

**Standard rate:** 0.2% of the ticket price. On a $50 ticket, the attendee receives $0.10 in USDC.

**First purchase bonus:** 1% of the ticket price, capped at $5. A new attendee buying a $200 ticket receives $2.00 standard + a $5.00 bonus = $7.00 total on their first transaction.

**Referral bonus:** 0.5% of the ticket price when a referred friend makes their first purchase. If the friend buys a $40 ticket, the referrer receives $0.20.

Attendee rewards are optional for agents to surface. Agents choose whether to display reward information during the purchase flow. Rewards accrue to a lightweight ATLAS wallet tied to the attendee's email. Accrued USDC can be applied toward future ticket purchases or withdrawn to an external wallet.

---

## 5. Referral Program

All referral payouts are in USDC, sourced from the 10% referral allocation of the protocol fee.

**Organizer referrals.** An organizer who refers another organizer to ATLAS earns 5% of the referred organizer's protocol fees for 12 months. If the referred organizer generates $10,000 in monthly GMV, the protocol fee is $200 and the referrer earns $10/month.

**Platform referrals.** A platform that onboards organizers earns 10% of those organizers' protocol fees for 12 months. Platforms that bring supply-side liquidity receive double the organizer referral rate.

**Agent referrals.** An agent implementation that drives ticket purchases earns 5% of those transactions' protocol fees perpetually. The agent retains the referral as long as it remains the transaction source. Agents register via the ATLAS registry and receive an `X-Atlas-Agent-Id` header for attribution tracking.

---

## 6. Promotion Revenue (Ad-Network)

The ATLAS ad-network creates a second revenue stream. Promotion revenue is separate from the 2% transaction fee. It is additive. An organizer who promotes an event pays the 2% protocol fee plus the promotion bid.

`PromotionSettlement.sol` executes the bid split on-chain when a promoted ticket sells.

**Promotion split:**

| Recipient | Share | Role |
|---|---|---|
| Referring agent | 60% | Surfaced the promoted event to the buyer |
| Protocol treasury | 30% | Funds protocol operations |
| Registry node | 10% | Served the discovery query |

### 6.1 Revenue Stream Comparison

| Revenue Stream | Source | Frequency | Split |
|---|---|---|---|
| Transaction fee (2%) | Every ticket sale | Every transaction | 30% organizer, 20% attendee, 10% referral, 25% dev, 15% reserve |
| Promotion bid (variable) | Promoted ticket sales only | Subset of transactions | 60% agent, 30% treasury, 10% node |

**Dollar example.** A $25 ticket with a $2.00 promotion bid generates: $0.50 protocol fee (standard 2%) plus $2.00 promotion bid. The agent receives $1.20 from the bid. The protocol treasury receives $0.60. The registry node receives $0.20.

### 6.2 Projected Protocol Revenue

Assumes 20% of events run promotions at an average bid of $1.50 per ticket sold.

| Monthly GMV | Transaction Fee (2%) | Ad-Network Revenue | Combined |
|---|---|---|---|
| $100K | $2,000 | $600 | $2,600 |
| $1M | $20,000 | $6,000 | $26,000 |
| $10M | $200,000 | $60,000 | $260,000 |

The ad-network adds approximately 30% to base protocol revenue once activated.

---

## 7. Fee Comparison vs Competitors

All calculations use a $25 base ticket price.

| Platform | Fee Structure | Organizer Net (on $25 ticket) |
|---|---|---|
| ATLAS (USDC direct) | 2% protocol fee | $24.49 (after cashback at Tier 1) |
| ATLAS (card via Stripe SPT) | 2% protocol + ~1.5% Stripe processing | $24.11 (after cashback at Tier 1) |
| Eventbrite | 3.7% + $1.79 per ticket + 2.9% payment processing | ~$21.50 to $22.50 |
| Ticketmaster | 20-30% service fees | ~$17.50 to $20.00 |

ATLAS organizers keep 97-98% of ticket revenue at baseline. With cashback rewards at higher tiers, the effective cost drops below 1.5%. Eventbrite organizers lose 10-14% to fees. Ticketmaster organizers lose 20-30%.

---

## 8. Governance and Fee Adjustments

The 2% rate and allocation percentages are stored in `FeeRouter.sol` as governance-updatable parameters.

**Stage 1 (launch):** Lemonade multi-sig controls fee parameters.
**Stage 3 (federation):** 3-of-5 multi-sig with Lemonade, organizer representatives, and platform representatives.
**Stage 4 (decentralization):** DAO governance via $LEMON token holders votes on fee changes.

No fee change takes effect without a 7-day timelock. The contract emits events for every parameter update, creating a public audit trail.

---

## 9. Token Phases (Summary)

Full specification in `23-TOKEN-PHASES-SPEC.md`. ATLAS launches without a custom token. Token phases activate at adoption milestones, not calendar dates.

**Phase 0: USDC Only** (launch to $100K monthly GMV). All fees, rewards, and settlements in USDC. No custom token exists.

**Phase 1: LMC Wrapper** (triggered at $100K monthly GMV). LMC (Lemonade Coin) wraps USDC at a 1:1 ratio. LMC holders receive priority listing placement, a 1.5x reward multiplier, and platform staking capability. LMC is always redeemable for USDC at par.

**Phase 2: $LEMON Governance** (triggered at $1M monthly GMV). $LEMON is a governance token distributed to active protocol participants based on historical contribution. Holders vote on fee adjustments, reward allocation changes, registry federation policies, and grant disbursements from the reserve.

**Phase 3: Dual-Token + Foundation** (triggered at $10M monthly GMV). LMC handles utility and staking (stable, USDC-backed). $LEMON handles governance and ecosystem growth (floating, market-determined). A non-profit ATLAS Foundation stewards the protocol, funded by the reserve allocation.

---

## 10. Contract Reference

| Contract | Function | Deployment Stage |
|---|---|---|
| `FeeRouter.sol` | Receives USDC, splits to organizer + treasury + rewards + referral | Stage 1 (launch) |
| `RewardLedger.sol` | Tracks reward accrual, enforces 14-day timelock, identity-boosted rates | Stage 3 (federation) |
| `PromotionSettlement.sol` | Splits ad-network bids per 60/30/10 rule | Phase 1 ($500K GMV) |

`RewardLedger.sol` supports identity-boosted rewards. Participants with a verified on-chain attestation (World ID, Self.xyz, Civic, or Polygon ID) receive a 1.5x multiplier on all reward accruals. The multiplier is governance-adjustable after Phase 2.
