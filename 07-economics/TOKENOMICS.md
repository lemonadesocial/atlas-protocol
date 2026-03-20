# Atlas Protocol Tokenomics

**Phased Token Economics — Adoption-Triggered, Not Calendar-Based**

> This document defines the complete token strategy for Atlas Protocol across four phases.
> Each phase unlocks only when adoption metrics are met. No token launches without proven demand.

---

## 1. Design Philosophy

### Core principles

1. **Tokens earn their place through utility, not speculation.** If a phase's token does not make the protocol measurably better for participants, it does not launch.

2. **Adoption triggers, not calendar dates.** Phase 1 launches when monthly GMV hits $100K — whether that takes 3 months or 3 years. No roadmap pressure to ship a token.

3. **USDC remains the payment currency always.** Tokens are for governance, staking, and loyalty — never for buying tickets. An organizer should never need to acquire a token to use Atlas.

4. **Each phase is independently viable.** If the protocol never leaves Phase 0, it still works. If it never leaves Phase 1, it still works. Tokens are additive, not load-bearing.

5. **Regulatory clarity over speed.** Every token decision is evaluated against securities law before implementation. If a mechanism looks like a security, it gets redesigned or dropped.

---

## 2. Phase 0: USDC Only (Launch)

**Trigger:** Protocol goes live.

### How it works

| Aspect | Details |
|--------|---------|
| Payment currency | USDC on Tempo + USD via Stripe SPTs |
| Rewards currency | USDC cashback (see FEE-STRUCTURE.md) |
| Governance | Lemonade makes all protocol decisions |
| Token | None |

### Why no token at launch

- **Friction kills adoption.** Organizers will not buy a token to list events. Attendees will not acquire a token to purchase tickets. The cold-start problem is hard enough without adding a token barrier.
- **No utility to justify it.** At low volume, governance is unnecessary (Lemonade can decide faster). Staking is pointless without enough participants to make ranking meaningful. A token at this stage would be pure speculation.
- **Regulatory risk.** Launching a token before the protocol has users and revenue invites securities scrutiny. A functioning protocol with real revenue is the strongest defense against Howey.

### What success looks like at Phase 0

- $100K+ monthly GMV
- 500+ active organizers
- 10+ integrated platforms
- Cashback rewards distributed to real users
- Operational treasury covering infrastructure costs

---

## 3. Phase 1: LMC — Lemonade Credits

**Trigger:** $100K sustained monthly GMV (3 consecutive months above threshold).

### What is LMC

LMC (Lemonade Credits) is a TIP-20 token on Tempo, backed 1:1 by USDC. It is a loyalty mechanism, not a speculative asset.

| Property | Value |
|----------|-------|
| Standard | TIP-20 (Tempo token standard) |
| Backing | 1 LMC = 1 USDC, always redeemable |
| Mint | Deposit USDC into Atlas LMC contract → receive LMC |
| Burn | Redeem LMC at Atlas LMC contract → receive USDC |
| Supply | Elastic — minted on deposit, burned on redemption. No fixed supply. |
| Issuer | Atlas Protocol Treasury smart contract |

### LMC utility

| Use Case | Benefit | Mechanism |
|----------|---------|-----------|
| Pay Atlas fee in LMC | **20% fee discount** (2% → 1.6% effective) | At settlement, if organizer elects LMC payment, fee is 1.6% |
| Receive rewards in LMC | **25% reward boost** (cashback * 1.25) | Opt-in: receive cashback as LMC instead of USDC, get 25% more |
| Referral bonuses in LMC | **50% referral boost** | Referral rewards paid in LMC are 1.5x the USDC equivalent |

### Economic analysis: Why would anyone use LMC over USDC?

The honest answer: **only for the fee discount.** LMC is a wrapped stablecoin — it has no price appreciation potential and no speculative value. That is by design.

| Scenario | USDC Cost | LMC Cost | Savings |
|----------|-----------|----------|---------|
| $10,000/mo GMV organizer | $200/mo fee | $160/mo fee | $40/mo ($480/yr) |
| $50,000/mo GMV organizer | $1,000/mo fee | $800/mo fee | $200/mo ($2,400/yr) |
| $250,000/mo GMV organizer | $5,000/mo fee | $4,000/mo fee | $1,000/mo ($12,000/yr) |

For a mid-size organizer doing $50K/month, saving $2,400/year is meaningful. The friction of holding LMC (deposit USDC, receive LMC, elect LMC payment) must be less than 10 minutes per month for the savings to be worth it. The UX must make this a one-click toggle, not a manual process.

### Risks and mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Nobody uses LMC because USDC is simpler | High | Make LMC opt-in toggle in dashboard. Auto-convert savings visible in real-time. |
| LMC breaks its peg (depegs from USDC) | Critical | Impossible by design — 1:1 backed, instant redemption, no fractional reserve. Contract holds 100% USDC reserves, auditable on-chain. |
| Regulatory classification as money transmission | Medium | LMC is a prepaid credit backed by USDC. Legal opinion required before launch. Similar to gift cards / store credits. |
| Users confuse LMC with a speculative token | Medium | All messaging: "LMC is USDC with a loyalty discount. It cannot go up or down in value." No exchange listings. |

### Phase 1 revenue impact

At $500K monthly GMV, assuming 30% of organizers opt into LMC:

| Metric | Without LMC | With LMC (30% adoption) |
|--------|-------------|------------------------|
| Gross fee revenue | $10,000/mo | $9,400/mo (-6%) |
| Organizer retention | Baseline | +15-20% (estimated — loyalty stickiness) |
| Net revenue (accounting for retention) | $10,000/mo | $10,800/mo (+8%) |

The fee discount costs 6% of revenue but is projected to improve retention enough to more than offset. If retention improvement is less than 6%, the discount is net negative and should be reduced.

---

## 4. Phase 2: $LEMON Governance Token

**Trigger:** $1M sustained monthly GMV (3 consecutive months) AND 25+ integrated platforms.

### Why Phase 2 exists

At $1M GMV with 25+ platforms, Lemonade unilateral governance becomes a liability. Platforms want a voice. Organizers want predictability. A governance token aligns incentives and decentralizes decision-making.

### Token parameters

| Property | Value |
|----------|-------|
| Name | LEMON |
| Symbol | $LEMON |
| Standard | TIP-20 on Tempo (bridgeable to EVM chains via Tempo bridge) |
| Total supply | 1,000,000,000 (1 billion) — fixed, no inflation |
| Decimals | 18 |

### Distribution

| Allocation | Share | Tokens | Vesting |
|------------|-------|--------|---------|
| Community Treasury | 35% | 350,000,000 | Governed by DAO. Released via governance proposals. |
| Ecosystem Grants | 20% | 200,000,000 | 5-year linear release. For platform integrations, developer grants, hackathons. |
| Staking Rewards | 15% | 150,000,000 | 10-year emission schedule (front-loaded: 30% year 1, declining). |
| Team & Contributors | 20% | 200,000,000 | 4-year vesting, 1-year cliff. |
| Early Contributors & Advisors | 5% | 50,000,000 | 4-year vesting, 1-year cliff. |
| Liquidity & Market Making | 5% | 50,000,000 | 6-month cliff, then as needed for exchange listings. |

### Vesting schedules

**Team & Contributors (20%):**
```
Month 0-12:  Cliff — 0 tokens unlocked
Month 12:    25% unlocked (50,000,000)
Month 13-48: Linear unlock — ~4,166,667/month
Month 48:    100% unlocked
```

**Early Contributors & Advisors (5%):**
```
Month 0-12:  Cliff — 0 tokens unlocked
Month 12:    25% unlocked (12,500,000)
Month 13-48: Linear unlock — ~1,041,667/month
Month 48:    100% unlocked
```

**Staking Rewards (15%):**
```
Year 1:  30% of pool (45,000,000 tokens) — 3,750,000/month
Year 2:  20% of pool (30,000,000 tokens) — 2,500,000/month
Year 3:  15% of pool (22,500,000 tokens) — 1,875,000/month
Year 4:  10% of pool (15,000,000 tokens) — 1,250,000/month
Year 5-10: 25% of pool (37,500,000 tokens) — 625,000/month
```

Front-loaded emission rewards early stakers who take on more risk. Declining emission prevents dilution as the protocol matures.

### $LEMON utility

#### 1. Platform staking (registry ranking)

Platforms stake $LEMON to boost their ranking in the Atlas Registry. Higher-ranked platforms appear first when agents query for events.

| Staking Tier | Minimum Stake | Ranking Boost | Lockup Period |
|-------------|---------------|---------------|---------------|
| Bronze | 10,000 $LEMON | 1.2x | 30 days |
| Silver | 50,000 $LEMON | 1.5x | 90 days |
| Gold | 250,000 $LEMON | 2.0x | 180 days |
| Platinum | 1,000,000 $LEMON | 3.0x | 365 days |

Ranking is a composite score: `base_score * staking_boost * quality_score`. Quality score is derived from event completion rate, refund rate, and attendee satisfaction. Staking amplifies quality — it cannot compensate for bad service.

#### 2. Agent staking (verified agent status)

AI agents stake $LEMON to receive verified status, higher rate limits, and priority access.

| Agent Tier | Minimum Stake | Rate Limit | Lockup |
|-----------|---------------|------------|--------|
| Standard (no stake) | 0 | 100 queries/min | -- |
| Verified | 5,000 $LEMON | 1,000 queries/min | 30 days |
| Premium | 50,000 $LEMON | 10,000 queries/min | 90 days |
| Enterprise | 500,000 $LEMON | Unlimited | 180 days |

Verified agents get a badge in Atlas responses, increasing user trust. Enterprise agents can also access bulk data feeds and real-time inventory.

#### 3. Governance voting

$LEMON holders vote on protocol changes.

| Decision Type | Quorum Required | Voting Period | Implementation Delay |
|--------------|-----------------|---------------|---------------------|
| Fee rate changes | 10% of circulating supply | 7 days | 30 days |
| Fee distribution changes | 10% of circulating supply | 7 days | 30 days |
| Treasury spending (< $50K) | 5% of circulating supply | 5 days | 14 days |
| Treasury spending (>= $50K) | 15% of circulating supply | 14 days | 30 days |
| Protocol upgrades | 20% of circulating supply | 14 days | 60 days |
| Emergency changes (security) | 5% of circulating supply | 48 hours | Immediate |

Voting power: 1 $LEMON = 1 vote. Staked tokens vote with 1.5x weight (rewards long-term commitment). Maximum voting power per entity: 5% of circulating supply (prevents plutocracy).

#### 4. Protocol fee buyback

**15% of all protocol fee revenue** is used to buy $LEMON from the open market.

Bought-back tokens are split:
- 50% burned (deflationary pressure)
- 50% distributed to stakers (staking yield)

| Monthly GMV | Monthly Fees | Buyback Budget (15%) | Annual Buyback |
|------------|-------------|---------------------|----------------|
| $1,000,000 | $20,000 | $3,000 | $36,000 |
| $5,000,000 | $100,000 | $15,000 | $180,000 |
| $10,000,000 | $200,000 | $30,000 | $360,000 |
| $50,000,000 | $1,000,000 | $150,000 | $1,800,000 |

Adjusted fee distribution at Phase 2:

| Pool | Phase 0 Share | Phase 2 Share | Change |
|------|--------------|---------------|--------|
| Treasury | 40% | 25% | -15% (redirected to buyback) |
| Organizer Cashback | 30% | 30% | Unchanged |
| Attendee Cashback | 20% | 20% | Unchanged |
| Referral Pool | 10% | 10% | Unchanged |
| $LEMON Buyback | 0% | 15% | New |

### Anti-manipulation measures

| Mechanism | Purpose |
|-----------|---------|
| Staking lockup periods (30-365 days) | Prevents stake-and-dump manipulation of rankings |
| Slashing (10% of stake) | Platforms/agents caught gaming rankings or spoofing inventory lose 10% of staked tokens |
| Voting power cap (5% per entity) | Prevents whale governance capture |
| Gradual unstaking (7-day cooldown) | Prevents flash-stake governance attacks |
| Sybil detection | On-chain identity verification for governance participants (platforms must KYB, agents must register) |

---

## 5. Phase 3: Dual-Token Economy

**Trigger:** $10M sustained monthly GMV (3 consecutive months) AND 100+ integrated platforms.

### The two-token model

| Token | Role | Price Behavior | Primary Users |
|-------|------|---------------|---------------|
| **LMC** | Payment & loyalty | Stable (1:1 USDC) | Organizers, attendees |
| **$LEMON** | Governance & staking | Market-priced (value accrual) | Platforms, agents, governance participants |

### Why two tokens

A single token cannot be both a stable medium of exchange and a governance asset with value accrual. Organizers need price stability. Governance participants need upside potential. Dual-token separates these concerns cleanly.

### Token interaction model

```
Ticket Sale ($100)
  │
  ├─→ 2% Atlas Fee ($2.00)
  │     ├─→ 25% Treasury ($0.50)
  │     ├─→ 30% Organizer Cashback in LMC ($0.60)
  │     ├─→ 20% Attendee Cashback in LMC ($0.40)
  │     ├─→ 10% Referral Pool ($0.20)
  │     └─→ 15% Buyback ($0.30)
  │           ├─→ 50% $LEMON burned ($0.15)
  │           └─→ 50% $LEMON to stakers ($0.15)
  │
  └─→ 98% to Organizer ($98.00 in USDC)
```

### Foundation structure

At Phase 3, protocol governance transitions to an independent foundation.

| Entity | Role | Control |
|--------|------|---------|
| Atlas Foundation | Holds community treasury (35% of $LEMON). Governs protocol. | Board elected by $LEMON holders. |
| Lemonade | Founding contributor. Builds reference implementation. | Retains team tokens (20%) subject to vesting. No special governance power beyond token holdings. |
| Platform Council | Advisory body of top 10 integrated platforms. | Non-binding recommendations. Formal input on protocol changes. |

Foundation jurisdiction: Likely Singapore or Switzerland (Zug). Both have clear frameworks for protocol foundations. US incorporation is too risky for a governance token entity.

### Phase 3 governance changes

| Change | Phase 2 | Phase 3 |
|--------|---------|---------|
| Protocol fee changes | DAO vote, Lemonade can veto | DAO vote, no veto |
| Treasury allocation | DAO vote, Lemonade executes | DAO vote, Foundation executes |
| Emergency changes | Lemonade multisig | Foundation multisig (5-of-9, elected) |
| Protocol upgrades | Lemonade implements, DAO approves | Any contributor implements, DAO approves, Foundation deploys |

---

## 6. Economic Modeling

### Token value drivers by phase

| Phase | Value Driver | Mechanism |
|-------|-------------|-----------|
| Phase 0 | N/A | No token |
| Phase 1 | LMC has no market value | 1:1 USDC peg. Value is the fee discount, not the token price. |
| Phase 2 | $LEMON value = f(GMV, staking demand, buyback) | More GMV → more fees → more buyback → more demand → higher price |
| Phase 3 | $LEMON value = f(GMV, staking, buyback, governance power) | Same as Phase 2, plus governance over growing treasury |

### $LEMON theoretical valuation model

Using a discounted cash flow model based on buyback revenue (the only reliable value accrual mechanism):

**Assumptions:**
- Monthly GMV at Phase 2 launch: $1M
- GMV growth: 20% month-over-month for first year, then 10% MoM
- Buyback allocation: 15% of protocol fees
- Discount rate: 25% (high-risk protocol token)
- Terminal growth: 5% annually after year 3

| Year | Annual GMV | Annual Fees | Annual Buyback | Cumulative Buyback |
|------|-----------|-------------|----------------|-------------------|
| 1 | $44M | $880,000 | $132,000 | $132,000 |
| 2 | $137M | $2,740,000 | $411,000 | $543,000 |
| 3 | $300M | $6,000,000 | $900,000 | $1,443,000 |
| 4 | $400M | $8,000,000 | $1,200,000 | $2,643,000 |
| 5 | $500M | $10,000,000 | $1,500,000 | $4,143,000 |

**5-year NPV of buyback flow at 25% discount rate: ~$2.8M**

With 1B token supply (but only ~300M circulating by year 2 after vesting): **implied token price ~$0.009**

This is deliberately conservative. The actual value would also include governance premium and staking demand, which are harder to model.

### Sensitivity analysis

**What if GMV is 50% below target?**

| Metric | Base Case | 50% Below |
|--------|-----------|-----------|
| Year 1 Annual GMV | $44M | $22M |
| Year 1 Annual Buyback | $132,000 | $66,000 |
| Year 3 Annual GMV | $300M | $150M |
| Year 3 Annual Buyback | $900,000 | $450,000 |
| 5-year NPV of buyback | $2.8M | $1.4M |
| Impact | Baseline | Token price ~50% lower; protocol still operational (Phase 0/1 still work) |

**What if GMV is 2x above target?**

| Metric | Base Case | 2x Above |
|--------|-----------|----------|
| Year 1 Annual GMV | $44M | $88M |
| Year 3 Annual GMV | $300M | $600M |
| 5-year NPV of buyback | $2.8M | $5.6M |
| Impact | Baseline | Accelerates Phase 3 timeline. Foundation formation sooner. |

**Key insight:** The protocol works at any GMV level. Tokens add value at scale but are not required for the protocol to function. This is the critical difference between Atlas and protocols that need token value to survive.

### Comparison to similar protocol tokens

| Protocol | Token | Mechanism | FDV at Launch | Revenue Multiple |
|----------|-------|-----------|---------------|-----------------|
| Uniswap | UNI | Governance only (no fee switch yet) | $6.4B | N/A (no revenue to token) |
| Aave | AAVE | Governance + safety module staking | $1.2B | ~50x revenue |
| Lido | LDO | Governance + treasury | $1.5B | ~30x revenue |
| **Atlas (projected)** | **$LEMON** | **Governance + staking + buyback** | **TBD** | **Target: 15-25x buyback revenue** |

Atlas is more comparable to Aave (governance + staking) than Uniswap (governance only). The buyback mechanism provides concrete value accrual that UNI lacks.

---

## 7. Regulatory Considerations

### LMC (Phase 1): Utility token / prepaid credit

**Securities analysis (Howey Test):**

| Howey Prong | Analysis | Risk Level |
|-------------|----------|------------|
| Investment of money | Users deposit USDC for LMC — but it is always redeemable 1:1. No money is "invested." | Low |
| Common enterprise | LMC value does not depend on Atlas's success. 1 LMC = 1 USDC regardless. | Low |
| Expectation of profits | LMC cannot appreciate in value. It is a discount coupon, not an investment. | Very Low |
| Efforts of others | The fee discount is protocol-defined, not dependent on Lemonade's efforts. | Low |

**Conclusion:** LMC is likely NOT a security. It functions as a prepaid credit or loyalty point. Analogous to airline miles, Starbucks Stars, or Amazon credits. Key requirement: LMC must never be listed on exchanges or marketed as having appreciation potential.

**Regulatory path:**
- US: May require money transmitter license depending on state (LMC → USDC conversion could be money transmission). Legal counsel required.
- EU: MiCA classification as an e-money token (EMT). Requires authorization as an electronic money institution or credit institution. Significant compliance burden.
- Singapore: Payment Services Act — may fall under e-money classification. MAS licensing required.

### $LEMON (Phase 2): Governance token

**Securities analysis (Howey Test):**

| Howey Prong | Analysis | Risk Level |
|-------------|----------|------------|
| Investment of money | Users buy or earn $LEMON. Stakers lock tokens for rewards. | Medium |
| Common enterprise | $LEMON value tied to protocol GMV (buyback mechanism). Holders share a common fate. | High |
| Expectation of profits | Buyback creates value accrual. Staking earns yield. Governance can redirect treasury. | High |
| Efforts of others | At Phase 2, Lemonade still does most development. Decentralization is incomplete. | High |

**Conclusion:** $LEMON has meaningful securities risk under US law. The buyback mechanism in particular creates expectation of profits tied to protocol revenue.

**Mitigation strategies:**

1. **Sufficient decentralization before launch.** By Phase 2 (25+ platforms, $1M GMV), the protocol should have meaningful third-party contributors. Follow the "Hinman framework" — if the network is sufficiently decentralized, the token may not be a security.

2. **No US token sale.** $LEMON should not be sold to US persons in any public offering. Distribution via staking rewards, ecosystem grants, and airdrops (not sales).

3. **Governance-first framing.** All communications emphasize governance utility, not investment returns. Never reference "price," "returns," or "appreciation."

4. **Buyback as protocol maintenance, not dividends.** Frame buyback as deflationary tokenomics (reducing supply for protocol health), not as distributing profits to holders.

5. **Foundation in favorable jurisdiction.** Singapore (clear MAS framework for digital payment tokens) or Switzerland (FINMA token guidance). Avoid US incorporation for the token-issuing entity.

### Jurisdiction summary

| Jurisdiction | LMC Risk | $LEMON Risk | Notes |
|-------------|----------|-------------|-------|
| United States | Medium (money transmission) | High (securities) | No $LEMON sale to US persons. LMC needs MTL analysis. |
| European Union | Medium (MiCA EMT) | Medium (MiCA utility token) | MiCA provides clearer framework. Requires whitepaper filing. |
| Singapore | Low-Medium (PSA e-money) | Low-Medium (DPT) | Most favorable. MAS has published clear guidance on payment and governance tokens. |
| Switzerland | Low (FINMA payment token) | Low (FINMA asset token) | Strong legal precedent. Foundation setup well-established. |

**Recommendation:** Incorporate Atlas Foundation in Singapore. Issue $LEMON under MAS Digital Payment Token framework. Obtain Singapore legal opinion before Phase 2 launch. Engage US securities counsel (not for offering, but for compliance in excluding US purchasers).

---

## 8. Phase Transition Decision Framework

### How transitions are decided

| Transition | Who Decides | Required Evidence |
|-----------|-------------|-------------------|
| Phase 0 → 1 | Lemonade (sole governance) | 3 months above $100K GMV. Legal opinion on LMC. |
| Phase 1 → 2 | Lemonade + Platform Advisory Board | 3 months above $1M GMV, 25+ platforms, $LEMON legal opinion, foundation incorporated. |
| Phase 2 → 3 | DAO vote ($LEMON holders) | 3 months above $10M GMV, 100+ platforms, foundation operational, quorum vote passes. |

### What if triggers are met but conditions are not right?

Hitting the GMV threshold is necessary but not sufficient. Each transition also requires:

- Legal opinions completed and favorable
- Technical infrastructure ready (smart contracts audited, governance UI built)
- Community readiness (enough participants to make governance meaningful)
- No active security incidents or protocol instabilities

The protocol can stay in any phase indefinitely. There is no obligation to advance.

### Rollback provisions

If a phase is launched and fails (e.g., LMC adoption is <5% after 6 months), the protocol can:

- **Phase 1 → 0:** Discontinue LMC. All LMC redeemable for USDC (1:1 guaranteed). Fee discounts end.
- **Phase 2 → 1:** $LEMON governance suspended. Lemonade resumes governance. Staked tokens unlock on normal schedule. Buyback ceases.
- **Phase 3 → 2:** Foundation dissolves. Treasury returns to DAO control. Dual-token simplifies to $LEMON only.

---

## 9. Summary: Token Lifecycle

```
PHASE 0                    PHASE 1                    PHASE 2                    PHASE 3
Launch                     $100K GMV/mo               $1M GMV/mo                 $10M GMV/mo
                           3 mo sustained             25+ platforms              100+ platforms
────────────────────────── ────────────────────────── ────────────────────────── ──────────────────────
Payment: USDC              Payment: USDC              Payment: USDC              Payment: USDC
Rewards: USDC              Rewards: USDC or LMC       Rewards: USDC or LMC       Rewards: LMC
Governance: Lemonade       Governance: Lemonade       Governance: $LEMON DAO     Governance: $LEMON DAO
Staking: None              Staking: None              Staking: $LEMON            Staking: $LEMON
Buyback: None              Buyback: None              Buyback: 15% of fees       Buyback: 15% of fees
Token: None                Token: LMC (stable)        Token: LMC + $LEMON        Token: LMC + $LEMON
Foundation: None           Foundation: None           Foundation: Forming         Foundation: Independent
```

Each phase adds a layer. No phase removes what worked before. USDC is always the backbone. Tokens are always optional. The protocol works at every stage.
