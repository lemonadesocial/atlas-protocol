# Atlas Protocol Fee Structure & Reward Mechanics

**Phase 0 — USDC Only**

> This document defines the complete fee structure, reward mechanics, and revenue projections
> for Atlas Protocol at launch (Phase 0). All values are in USDC unless stated otherwise.

---

## 1. Protocol Fee: 2% on Transactions

Atlas charges a flat **2% protocol fee** on every ticket transaction processed through the protocol.

### What the fee applies to

| Action | Fee | Rationale |
|--------|-----|-----------|
| Ticket purchase via MPP 402 | 2% of ticket price | Core protocol monetization |
| Ticket purchase via Atlas Direct Ticketing | 2% of ticket price | Same treatment regardless of channel |
| Multi-ticket order | 2% of total order value | Single fee calculation per settlement |

### What is free

| Action | Fee | Rationale |
|--------|-----|-----------|
| Event listing on Atlas Registry | Free | Friction-free supply growth |
| Search queries (agent or human) | Free | Discovery drives the flywheel |
| Event discovery / browsing | Free | Network effects require open access |
| Organizer account creation | Free | Zero barrier to entry |
| Platform SDK integration | Free | Platform adoption drives supply |

### Collection mechanics

- **Tempo transactions (USDC):** 2% deducted at settlement. Organizer receives 98% of ticket price (before rewards). Tempo network fee (<$0.001) paid by buyer as a separate gas-like cost — not part of the 2%.
- **Stripe SPT transactions (card/wallet):** 2% deducted from payout. Stripe processing fee (~2.9% + $0.30) is a separate cost borne by the organizer (standard Stripe connected account model). Atlas fee is calculated on the gross ticket price, not the net-of-Stripe amount.

---

## 2. Fee Distribution

The 2% protocol fee is split across four pools:

| Pool | Share | Effective Rate | Purpose |
|------|-------|----------------|---------|
| Atlas Treasury | 40% | 0.80% | Operations, development, registry hosting, infrastructure |
| Organizer Cashback | 30% | 0.60% | USDC reward to event organizer per ticket sold |
| Attendee Cashback | 20% | 0.40% | USDC reward to buyer per ticket purchased |
| Referral Pool | 10% | 0.20% | Organizer-invites-organizer acquisition rewards |

### Rationale for the split

- **Treasury at 40%** — Protocol must be self-sustaining. At $1M monthly GMV, treasury receives $8,000/month — enough to cover Tempo node costs (~$500/mo), registry hosting (~$200/mo), and reserve the rest for development grants.
- **Organizer cashback at 30%** — Largest reward goes to supply-side. Organizers are the hardest to acquire and the most valuable. A $50 ticket generates $0.30 cashback to the organizer — small per ticket, meaningful at volume.
- **Attendee cashback at 20%** — Demand-side incentive. Makes Atlas purchases measurably cheaper than buying direct. A $50 ticket saves the attendee $0.20 — symbolic at low prices, material at high volume or premium events.
- **Referral at 10%** — Viral growth fuel. Capped at 10% to prevent the referral tail from eating treasury.

---

## 3. Fee Comparison Table

### Platform fee comparison

| Platform | Platform Fee | Payment Processing | Total Fee (excl. processing) | Notes |
|----------|-------------|-------------------|------------------------------|-------|
| **Atlas (Tempo/USDC)** | 2.0% | <$0.001 flat | **2.0%** | Lowest total cost |
| **Atlas (Stripe/card)** | 2.0% | ~2.9% + $0.30 | **~4.9% + $0.30** | Card payments cost more everywhere |
| **Eventbrite** | 6.95% + $0.99/ticket | Included | **6.95% + $0.99** | Plus 2.9% if using Eventbrite Payments |
| **Lu.ma** | 0% (free events) / 2% (paid) | Stripe ~2.9% + $0.30 | **~4.9% + $0.30** | Similar to Atlas+Stripe, but no rewards |
| **Meetup** | $0 platform fee (organizer subscription) | Stripe ~2.9% + $0.30 | **$16.49/mo + processing** | Subscription model, not per-ticket |
| **Dice** | 0% to organizer (charges attendee) | Included | **~10-15% to attendee** | Service fee model — hidden from organizer |
| **Ticketmaster** | Varies, ~15-25% total | Included | **~15-25%** | Opaque, heavily burdened |

### Total cost to organizer per ticket (Atlas via Tempo/USDC)

Net cost = Atlas fee - organizer cashback. Effective organizer cost = 2.0% - 0.6% = **1.4% net**.

| Ticket Price | Gross Fee (2%) | Organizer Cashback (0.6%) | Net Cost to Organizer | Organizer Receives |
|-------------|----------------|---------------------------|----------------------|-------------------|
| $5.00 | $0.10 | $0.03 | $0.07 | $4.93 |
| $25.00 | $0.50 | $0.15 | $0.35 | $24.65 |
| $50.00 | $1.00 | $0.30 | $0.70 | $49.30 |
| $100.00 | $2.00 | $0.60 | $1.40 | $98.60 |
| $500.00 | $10.00 | $3.00 | $7.00 | $493.00 |

### Total cost to attendee per ticket (Atlas via Tempo/USDC)

Net cost = ticket price + Tempo gas (<$0.001) - attendee cashback (0.4%).

| Ticket Price | Attendee Cashback (0.4%) | Net Premium/(Savings) | Attendee Pays (Effective) |
|-------------|--------------------------|----------------------|--------------------------|
| $5.00 | $0.02 | -$0.02 | $4.98 |
| $25.00 | $0.10 | -$0.10 | $24.90 |
| $50.00 | $0.20 | -$0.20 | $49.80 |
| $100.00 | $0.40 | -$0.40 | $99.60 |
| $500.00 | $2.00 | -$2.00 | $498.00 |

### Comparison: $50 ticket across platforms

| Platform | Organizer Receives | Attendee Pays | Total Friction |
|----------|-------------------|---------------|----------------|
| **Atlas (USDC)** | $49.30 (+$0.30 cashback) | $49.80 (-$0.20 cashback) | **$0.50 net** |
| **Atlas (Card)** | $47.25 (+$0.30 cashback) | $50.00 | **$2.45 net** |
| **Eventbrite** | $45.04 | $50.00 | **$4.96** |
| **Lu.ma (paid)** | $47.55 | $50.00 | **$2.45** |
| **Dice** | $50.00 | $55.00-$57.50 | **$5.00-$7.50** |

---

## 4. Organizer Rewards

### 4.1 Base Cashback

Every ticket sold through Atlas earns the organizer **0.6% of ticket price** in USDC.

| Monthly Sales Volume | Tickets at $50 avg | Monthly Cashback |
|---------------------|--------------------|--------------------|
| $1,000 | 20 | $6.00 |
| $5,000 | 100 | $30.00 |
| $25,000 | 500 | $150.00 |
| $100,000 | 2,000 | $600.00 |
| $500,000 | 10,000 | $3,000.00 |

### 4.2 Volume Bonuses

Organizers who exceed monthly thresholds earn boosted cashback rates. The bonus applies retroactively to all tickets in that calendar month.

| Monthly GMV | Cashback Rate | Boost | Effective Net Cost |
|------------|---------------|-------|--------------------|
| $0 — $10,000 | 0.60% (base) | -- | 1.40% |
| $10,001 — $50,000 | 0.80% | +33% | 1.20% |
| $50,001 — $250,000 | 1.00% | +67% | 1.00% |
| $250,001+ | 1.20% | +100% | 0.80% |

Volume bonus funding: At high tiers, the organizer cashback pool (0.6%) is supplemented by treasury allocation. Treasury absorbs the difference — justified because high-volume organizers are the protocol's most valuable participants.

### 4.3 Referral Program

When Organizer A invites Organizer B to Atlas:

- **Referral reward:** Organizer A earns **$5 USDC** when Organizer B sells their first **25 tickets** through Atlas.
- **Second milestone:** Organizer A earns an additional **$10 USDC** when Organizer B reaches **$5,000 cumulative GMV**.
- **Cap:** Maximum **$50 USDC** per referred organizer (prevents gaming).
- **Mutual benefit:** Organizer B receives a **$2 USDC welcome bonus** credited after their first ticket sale.

Referral pool budget at $1M monthly GMV = $2,000/month. At an average $7.50 per successful referral chain, this funds ~267 new organizer acquisitions per month.

### 4.4 Payout Mechanics

| Parameter | Value |
|-----------|-------|
| Minimum payout threshold | $5.00 USDC |
| Payout frequency | Weekly (every Monday, for prior week's earnings) |
| Payout method | USDC to organizer's connected Tempo wallet |
| Alternative payout | USD via Stripe Connect (if organizer prefers fiat) |
| Cashback accrual | Real-time (visible in dashboard), payout batched weekly |
| Unclaimed rewards | Expire after 12 months, return to treasury |

Organizers must have a connected Tempo wallet OR Stripe Connect account to receive payouts. Wallet setup is part of the organizer onboarding flow (OAuth connect step).

---

## 5. Attendee Rewards

### 5.1 Base Cashback

Every ticket purchased through Atlas earns the attendee **0.4% of ticket price** in USDC.

### 5.2 Discovery Bonus

To incentivize early ticket purchases for newly-listed events:

| Position | Bonus | Example ($50 ticket) |
|----------|-------|---------------------|
| First 10 attendees | 2x cashback (0.8%) | $0.40 instead of $0.20 |
| Attendees 11-50 | 1.5x cashback (0.6%) | $0.30 instead of $0.20 |
| Attendees 51+ | Base rate (0.4%) | $0.20 |

Discovery bonus funded from treasury allocation (capped at $500/month total across all events during Phase 0). This rewards early adopters who trust new events and drives word-of-mouth.

### 5.3 Reward Claim Mechanics

| Method | How it works | Target user |
|--------|-------------|-------------|
| **Tempo wallet (direct)** | Cashback auto-deposited to buyer's Tempo wallet. Zero friction if they paid with USDC. | Crypto-native attendees |
| **Custodial balance** | Cashback credited to Atlas account balance. Can be applied to next ticket purchase or withdrawn to Tempo wallet. | Casual attendees who paid via card |
| **Stripe payout** | If attendee has no wallet and requests withdrawal, paid via Stripe (minimum $10, monthly). | Fiat-only attendees |

Default behavior: If attendee paid via USDC/Tempo, rewards go to their Tempo wallet. If paid via card/Stripe SPT, rewards accrue as Atlas custodial balance.

---

## 6. Platform Fees (B2B — Existing Platforms)

Existing platforms (Eventbrite, Lu.ma, etc.) that integrate the Atlas SDK.

### Fee model

| Scenario | Atlas Fee | Platform's Own Fee | Who Pays Atlas Fee |
|----------|-----------|-------------------|-------------------|
| Ticket sold via Atlas discovery | 2% | Platform keeps 100% of their own fee | Organizer (deducted from payout) |
| Ticket sold via platform's native channel | 0% | Platform keeps 100% | N/A — Atlas not involved |
| Atlas Registry drives discovery to platform | 2% referral fee | Platform keeps 100% of their own fee | Platform (invoiced monthly) |

### Key principle

Atlas never double-dips. If a platform integrates and a ticket is sold through Atlas-originated discovery, the 2% protocol fee applies once. The platform's own fee structure is untouched — Atlas does not take a cut of the platform's margin.

### Referral attribution

When an Atlas agent discovers an event on Platform X and sends the user to purchase:
- Atlas tracks the referral via `atlas-ref` parameter in the purchase URL
- Platform reports the conversion via SDK webhook
- 2% referral fee invoiced to the platform monthly (net 30)
- If the platform disputes attribution, Atlas provides agent session logs as evidence

---

## 7. Platform Builder Fees (B2B-new — Built on Atlas)

New platforms that use Atlas as their infrastructure layer.

### Fee model

| Component | Rate | Example |
|-----------|------|---------|
| Atlas protocol fee | 2% (non-negotiable) | $1.00 on a $50 ticket |
| Platform's own markup | Set by platform (any amount) | $1.50 on a $50 ticket (3%) |
| **Total to attendee** | Atlas + platform markup | $2.50 (5% total) |

### Settlement flow

```
Attendee pays $50.00
  → Atlas deducts 2% ($1.00) → Atlas fee pools
  → Platform deducts 3% ($1.50) → Platform's Tempo wallet
  → Organizer receives $47.50 → Organizer's Tempo wallet
  → Attendee cashback: $0.20 (0.4% of $50) → Attendee's wallet
  → Organizer cashback: $0.30 (0.6% of $50) → Organizer's wallet
```

Atlas fee ($1.00) is distributed per the standard 40/30/20/10 split. The platform's $1.50 goes entirely to the platform — Atlas takes no revenue share on the platform's own margin.

### Builder incentive

Platforms built on Atlas in the first 12 months receive a **50% Atlas fee rebate** for their first $100K in GMV. Effective Atlas fee = 1% instead of 2%. This lowers the barrier for new niche platforms (conference platforms, music venue apps, community event tools).

---

## 8. Revenue Projections

### Monthly revenue at various GMV levels

| Monthly GMV | Gross Fee (2%) | Treasury (0.80%) | Organizer Cashback (0.60%) | Attendee Cashback (0.40%) | Referral Pool (0.20%) |
|------------|----------------|-------------------|---------------------------|--------------------------|----------------------|
| $100,000 | $2,000 | $800 | $600 | $400 | $200 |
| $500,000 | $10,000 | $4,000 | $3,000 | $2,000 | $1,000 |
| $1,000,000 | $20,000 | $8,000 | $6,000 | $4,000 | $2,000 |
| $5,000,000 | $100,000 | $40,000 | $30,000 | $20,000 | $10,000 |
| $10,000,000 | $200,000 | $80,000 | $60,000 | $40,000 | $20,000 |

### Annual projections (assuming steady-state monthly GMV)

| Monthly GMV | Annual GMV | Annual Gross Revenue | Annual Treasury | Annual Rewards Distributed |
|------------|-----------|---------------------|-----------------|---------------------------|
| $100,000 | $1.2M | $24,000 | $9,600 | $14,400 |
| $500,000 | $6M | $120,000 | $48,000 | $72,000 |
| $1,000,000 | $12M | $240,000 | $96,000 | $144,000 |
| $5,000,000 | $60M | $1,200,000 | $480,000 | $720,000 |
| $10,000,000 | $120M | $2,400,000 | $960,000 | $1,440,000 |

### Fixed cost base (estimated)

| Cost Item | Monthly | Annual |
|-----------|---------|--------|
| Tempo node operation | $500 | $6,000 |
| Atlas Registry hosting (AWS/Cloudflare) | $200 | $2,400 |
| Monitoring & alerting | $100 | $1,200 |
| Domain, DNS, SSL | $25 | $300 |
| **Total fixed infrastructure** | **$825** | **$9,900** |

### Break-even analysis

- **Infrastructure break-even:** Treasury receives 0.80% of GMV. At $825/month fixed cost, break-even at **$103,125 monthly GMV**.
- **Including 1 full-time engineer ($12,000/mo):** Break-even at **$1,603,125 monthly GMV**.
- **Including 3 full-time engineers + 1 ops ($48,000/mo):** Break-even at **$6,103,125 monthly GMV**.

Treasury revenue scales linearly. The protocol is infrastructure-break-even almost immediately and team-break-even at modest scale.

### Sensitivity: Revenue impact of fee changes

| Fee Rate | Monthly Revenue at $1M GMV | Treasury Share | Trade-off |
|----------|---------------------------|----------------|-----------|
| 1.0% | $10,000 | $4,000 | More competitive, slower treasury growth |
| 1.5% | $15,000 | $6,000 | Middle ground |
| **2.0% (current)** | **$20,000** | **$8,000** | **Balanced — competitive vs Eventbrite, sustainable** |
| 2.5% | $25,000 | $10,000 | Risk: organizers compare to Lu.ma at ~2% |
| 3.0% | $30,000 | $12,000 | Risk: approaches Lu.ma + Stripe territory |

**2% is the Schelling point.** Lower than legacy platforms, higher than free alternatives, and the cashback mechanism returns nearly a third of it to participants.

---

## 9. Edge Cases & Policy

### Refunds
- Full refund: Atlas fee is refunded to the protocol, organizer cashback and attendee cashback are clawed back. Net zero for all parties.
- Partial refund: Atlas fee adjusted proportionally. Cashback clawed back proportionally.
- If cashback was already withdrawn: Negative balance on next payout cycle. If organizer/attendee has no future activity, written off after 90 days.

### Free events
- $0 ticket price = $0 fee. Free events are truly free on Atlas.
- Free events still count toward organizer volume (for referral milestones and activity metrics), but generate no cashback.

### Donations / tips
- If an event has a "donation" or "tip" component above ticket price, Atlas fee applies to the full transaction amount. Donation is part of the settlement.

### Currency conversion
- Atlas fee always calculated on the USDC-equivalent value at time of settlement.
- For Stripe card transactions: Fee calculated on the USD charge amount.

### Disputes
- If an attendee disputes a charge (chargeback via Stripe), Atlas fee is refunded to the protocol and cashback is reversed. Organizer bears the Stripe chargeback fee per standard Stripe terms.

---

## 10. Phase 0 Parameters Summary

| Parameter | Value |
|-----------|-------|
| Protocol fee | 2% flat |
| Fee currency | USDC (Tempo) or USD (Stripe) |
| Treasury share | 40% of fee (0.80% of GMV) |
| Organizer cashback | 30% of fee (0.60% of GMV) |
| Attendee cashback | 20% of fee (0.40% of GMV) |
| Referral pool | 10% of fee (0.20% of GMV) |
| Volume bonus tiers | 4 tiers ($0-$10K, $10K-$50K, $50K-$250K, $250K+) |
| Referral reward | $5 at 25 tickets, $10 at $5K GMV, $50 cap |
| Payout frequency | Weekly (Monday) |
| Minimum payout | $5.00 USDC |
| Reward expiry | 12 months |
| Builder fee rebate | 50% for first $100K GMV (first 12 months) |
| Infrastructure break-even | ~$103K monthly GMV |
