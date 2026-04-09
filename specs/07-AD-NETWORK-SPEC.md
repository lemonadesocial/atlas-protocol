# ATLAS Ad-Network Specification

**Version 0.1 | April 2026**

**Authors:** Lemonade

---

## 1. Overview

The ATLAS ad-network connects organizers who want new guests with AI agents that serve event recommendations. It is the protocol's second revenue stream alongside the 2% transaction fee on every ticket sale.

The model is pay-per-sale. Organizers set a USDC bid per ticket sold through a promoted listing. They never pay for impressions or clicks. Settlement is on-chain through `PromotionSettlement.sol`, using the same contract infrastructure as the core fee split.

The "ad surface" is not a banner or a feed. It is every AI agent on the internet that queries the ATLAS registry. When a guest asks an agent to find an event, the agent receives both organic and promoted results. The agent decides what to surface. The organizer pays only when a ticket sells.

---

## 2. Campaign Data Model

A promotion campaign is a JSON object stored in the ATLAS registry alongside the event listing.

### 2.1 Schema

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | string | Unique identifier, prefixed `camp_` |
| `event_id` | string | ATLAS event identifier for the promoted event |
| `bid_per_sale` | string (decimal) | USDC amount paid per ticket sale |
| `currency` | string | Always `"USDC"` |
| `total_budget` | string (decimal) | Maximum USDC the organizer will spend |
| `spent` | string (decimal) | USDC spent so far |
| `remaining` | string (decimal) | USDC remaining (`total_budget - spent`) |
| `status` | enum | One of: `active`, `paused`, `exhausted`, `expired`, `cancelled` |
| `targeting` | object | Audience targeting constraints (see below) |
| `start_date` | ISO 8601 | Campaign activation date |
| `end_date` | ISO 8601 | Campaign expiration date |
| `created_at` | ISO 8601 | Timestamp of campaign creation |

### 2.2 Targeting Object

| Field | Type | Description |
|-------|------|-------------|
| `categories` | string[] | Event categories to target (e.g., `["music", "jazz"]`) |
| `geography` | object | `{ lat, lng, radius_km }` center point and radius |
| `age_range` | object | `{ min, max }` age bounds for audience |

### 2.3 Complete JSON Example

```json
{
  "campaign_id": "camp_abc123",
  "event_id": "evt_xyz789",
  "bid_per_sale": "2.00",
  "currency": "USDC",
  "total_budget": "100.00",
  "spent": "12.00",
  "remaining": "88.00",
  "status": "active",
  "targeting": {
    "categories": ["music", "jazz"],
    "geography": {
      "lat": 40.7128,
      "lng": -74.006,
      "radius_km": 50
    },
    "age_range": {
      "min": 21,
      "max": 45
    }
  },
  "start_date": "2026-04-01T00:00:00Z",
  "end_date": "2026-04-15T21:00:00Z",
  "created_at": "2026-03-25T10:00:00Z"
}
```

---

## 3. Campaign Lifecycle

Campaigns follow a strict state machine. Each transition has a single trigger.

### 3.1 State Machine

```
created --> active --> paused --> expired
              |          |
              |          +--> cancelled
              |
              +--> exhausted --> expired
```

### 3.2 State Transition Rules

| From | To | Trigger |
|------|----|---------|
| `created` | `active` | `start_date` reached and budget > 0 |
| `active` | `paused` | Organizer manually pauses via CLI or API |
| `active` | `exhausted` | `remaining` reaches 0 after a sale settlement |
| `active` | `expired` | `end_date` passes |
| `active` | `cancelled` | Organizer cancels the campaign |
| `paused` | `active` | Organizer resumes and `remaining` > 0 and `end_date` not passed |
| `paused` | `expired` | `end_date` passes while paused |
| `paused` | `cancelled` | Organizer cancels while paused |
| `exhausted` | `expired` | `end_date` passes (terminal confirmation) |

Campaigns in `expired` or `cancelled` states are terminal. No transitions out. Unspent budget in `cancelled` campaigns is returned to the organizer's wallet.

---

## 4. Registry Integration

Promoted listings live in the same index as organic listings. The registry adds two fields to promoted events:

```json
{
  "atlas:promoted": true,
  "atlas:bid_amount": "2.00"
}
```

Guest agents receive both organic and promoted results in a single API response. The response format does not change. Promoted results carry the two extra fields. Agents that do not understand promotion fields ignore them and treat the listing as organic.

### 4.1 Query Flow

```
Guest agent calls atlas_search_events(query)
        |
        v
Registry scores organic results by relevance, geography, temporal proximity
        |
        v
Registry appends promoted results that match the query's targeting criteria
        |
        v
Single response: organic results + promoted results (flagged)
```

The registry does not rank promoted results above organic results. It returns them in the same response with the promotion flag. Ranking decisions belong to the agent.

---

## 5. Agent-Side Mechanics

The agent is the gatekeeper. It decides whether to surface a promoted listing to the user.

### 5.1 Relevance Scoring

The agent's relevance model scores promoted results against the user's query using three signals:

1. **Query match.** Does the event match what the user asked for? A jazz event promotion shown to someone asking for hip-hop concerts is irrelevant.
2. **Event quality.** Organizer reputation, ticket availability, pricing relative to similar events.
3. **Agent policy.** The agent's own rules: frequency caps, user preference history, promotion fatigue limits.

### 5.2 Output Labeling

Promoted results surfaced to users carry a `"promoted"` label in the agent's output. The label is mandatory per ATLAS protocol rules. Agents that omit the label violate the protocol specification.

### 5.3 Market-Driven Quality

No central authority enforces relevance. The mechanism is market pressure. Agents that surface irrelevant promotions degrade their recommendations. Users stop querying agents that give bad suggestions. Agents lose traffic and referral revenue. The incentive structure aligns quality with profit.

Agents that surface only relevant promotions earn user trust, attract more queries, and collect more referral fees from `PromotionSettlement.sol`. The best agents earn the most. The worst agents earn nothing.

---

## 6. Settlement

### 6.1 Contract: PromotionSettlement.sol

When a promoted ticket sells, `PromotionSettlement.sol` receives the bid amount in USDC and splits it three ways.

| Recipient | Share | Rationale |
|-----------|-------|-----------|
| Referring agent | 60% | Incentive to surface relevant promotions |
| Protocol treasury | 30% | Protocol revenue stream |
| Registry node | 10% | Incentive to operate registry infrastructure |

### 6.2 Settlement Flow

```
Guest purchases promoted ticket
        |
        v
FeeRouter.sol executes standard 2% fee split (unchanged)
        |
        v
PromotionSettlement.sol executes bid split:
  - 60% of bid_per_sale --> referring agent wallet
  - 30% of bid_per_sale --> protocol treasury
  - 10% of bid_per_sale --> registry node that served the query
        |
        v
Campaign budget decremented: remaining -= bid_per_sale
        |
        v
If remaining == 0: campaign status --> "exhausted"
```

### 6.3 Contract Interface

```solidity
function settlePromotion(
    bytes32 campaignId,
    address referringAgent,
    address registryNode,
    uint256 bidAmount
) external {
    require(campaigns[campaignId].remaining >= bidAmount, "Budget exhausted");

    uint256 agentShare = bidAmount * 60 / 100;
    uint256 treasuryShare = bidAmount * 30 / 100;
    uint256 nodeShare = bidAmount - agentShare - treasuryShare;

    USDC.transfer(referringAgent, agentShare);
    USDC.transfer(treasury, treasuryShare);
    USDC.transfer(registryNode, nodeShare);

    campaigns[campaignId].remaining -= bidAmount;
    campaigns[campaignId].spent += bidAmount;

    if (campaigns[campaignId].remaining == 0) {
        campaigns[campaignId].status = Status.Exhausted;
    }
}
```

The two settlements (transaction fee and promotion bid) are independent. A promoted ticket sale triggers both. A non-promoted ticket sale triggers only the transaction fee.

---

## 7. Economics Comparison

What does $100 buy on ATLAS vs. Meta/Instagram?

| Metric | Meta/Instagram | ATLAS Ad-Network |
|--------|---------------|-----------------|
| Model | Pay-per-click | Pay-per-sale |
| $100 buys | 11-20 clicks ($5-9 CPC) | 50 ticket sales ($2 bid) |
| Conversion to sale | 2-5% of clicks = 0.4-1 sale | 100% (paid only on sale) |
| Revenue at $25/ticket | $10-25 | $1,250 |
| ROI | -75% to -90% | 1,150% |

Pay-per-sale eliminates the conversion funnel. The organizer never pays for attention that does not convert. A $25 ticket with a $2 promotion bid generates $0.50 (2% fee) + $2.00 (promotion bid) = $2.50 in total protocol-adjacent revenue per sale.

---

## 8. Scale Projections

US event promotion spend is $56 billion annually (EventVesta, 2024). A fraction migrating to ATLAS creates significant protocol revenue.

| Scenario | Promotion Volume | Protocol Treasury (30%) | Referring Agents (60%) | Registry Nodes (10%) |
|----------|-----------------|------------------------|----------------------|---------------------|
| 0.01% of US market | $5.6M | $1.68M | $3.36M | $560K |
| 0.1% of US market | $56M | $16.8M | $33.6M | $5.6M |
| 1% of US market | $560M | $168M | $336M | $56M |

At 0.1% market capture, the ad-network alone generates $16.8M in annual protocol treasury revenue, independent of transaction fees. The ad-network adds approximately 30% to base protocol revenue once activated.

---

## 9. Phased Rollout

The ad-network activates in stages tied to protocol GMV, not calendar dates.

| Phase | GMV Trigger | Capabilities |
|-------|------------|--------------|
| Phase 0 | Launch to $500K | No ad-network. Organic discovery only. The agent ecosystem matures before promotions add value. |
| Phase 1 | $500K to $5M | Basic promotion bids. Flat per-sale model. CLI campaign creation: `lemonade promote create --event evt_xyz --bid-per-sale 2.00 --budget 100.00`. |
| Phase 2 | $5M+ | Automated bidding. Agent-side relevance scoring. Real-time bid optimization. Campaign analytics dashboard for organizers. |

Phase 0 is deliberate. Promotions are only valuable when enough agents exist to surface them. Launching the ad-network before the agent ecosystem has density would produce zero conversions and waste organizer budgets.

Phase 1 keeps the model simple. One bid amount, one settlement per sale, one CLI command. Complexity arrives in Phase 2 after the protocol has data on bidding patterns, agent behavior, and conversion rates.

---

## 10. Analytics

Organizers track campaign performance through the CLI or dashboard.

```bash
lemonade promote stats --campaign camp_abc123 --format json
```

### 10.1 Metrics

| Metric | Definition |
|--------|-----------|
| Impressions | Number of agents that received the promoted listing in a query response |
| Surfaces | Number of agents that showed the promoted listing to a user |
| Conversions | Ticket sales attributed to the promotion |
| Spend | Total USDC spent on the campaign so far |
| Cost per sale | `spend / conversions` |
| ROI vs. organic | Conversion rate and revenue of promoted sales compared to organic sales for the same event |

Surface tracking relies on agents reporting back to the registry when they display a promoted result. Agents that do not report still trigger settlement on sale, but surface metrics will be incomplete for those agents.

---

## 11. Anti-Spam and Quality Enforcement

The ATLAS ad-network has no central arbiter of promotion quality. No review board approves campaigns. No algorithm penalizes "low-quality" promotions.

The enforcement mechanism is agent reputation. Agents choose what to show. An agent that floods users with irrelevant promotions loses queries. An agent that loses queries loses referral revenue. The cost of spam falls on the spammer.

Organizers who bid on irrelevant categories waste budget. Their promotions reach agents whose users have no interest. The agents filter them out. Zero conversions, zero ROI, budget exhausted with nothing to show for it. The pay-per-sale model already penalizes poor targeting: no sale means no charge, but it also means no distribution.

The protocol does not need to define "relevance." Each agent defines it for its own user base. Competition between agents produces better filtering than any centralized review process could.

---

**Related specifications:** ARCHITECTURE.md Section 6 (ad-network architecture), WHITEPAPER Section 11.3 (ad-network rationale), WHITEPAPER Section 8.5 (promotion revenue projections), 03-SETTLEMENT-SPEC.md (on-chain settlement contracts).
