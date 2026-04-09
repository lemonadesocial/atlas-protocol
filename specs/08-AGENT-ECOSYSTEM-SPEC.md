# 08: Agent Ecosystem Specification

**ATLAS Protocol Technical Specification**

**Status:** Draft | **Version:** 0.1 | **Date:** April 2026

---

## 1. Overview

The ATLAS agent layer is two-sided. Guest agents discover and book events. Organizer agents create events, manage guest relationships, and run promotions. Both sides share the same infrastructure: MCP tools, the lemonade-cli, and the `@atlas/client` SDK.

The protocol does not distinguish between a human and an agent calling the same endpoint. A `lemonade event create` command produces the same result whether typed by an organizer or invoked by an AI assistant. Agent identity is tracked separately via the `X-Atlas-Agent-Id` header for referral attribution and reputation.

Three interface layers expose all agent capabilities:

1. **MCP server** for LLM agents (Claude, ChatGPT, Gemini) in MCP-compatible environments. Tools are registered per MCP specification with Zod schemas for input validation.
2. **lemonade-cli** for terminal-based agents (Claude Code, Cursor, GitHub Copilot) and human developers. Every command accepts `--format json`.
3. **@atlas/client SDK** (TypeScript) for programmatic integration with pluggable payment handlers per chain.

---

## 2. Guest-Side MCP Tools

Guest agents use four tools to discover events and complete purchases.

### 2.1 atlas_search_events

Queries the ATLAS registry for events matching geographic, temporal, and categorical filters.

**Input parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| lat | number | yes | Latitude of search center |
| lng | number | yes | Longitude of search center |
| radius | string | no | Search radius (e.g., `"10km"`). Default: `"25km"` |
| category | string | no | Event category filter (e.g., `"music"`, `"tech"`) |
| start_after | ISO 8601 | no | Earliest event start date |
| start_before | ISO 8601 | no | Latest event start date |

**Output:** Array of `AtlasEvent` records, ranked by relevance. Promoted results are flagged with `promoted: true` and include the bid amount for transparency.

### 2.2 atlas_get_event

Retrieves full details for a single event, including all ticket types and availability.

**Input parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| event_id | string | yes | ATLAS event identifier (e.g., `"evt_abc123"`) |

**Output:** Complete `AtlasEvent` object with `atlas:ticketTypes` array. Each ticket type includes name, price, currency, available quantity, and `atlas:purchaseUrl`.

### 2.3 atlas_hold_ticket

Places a temporary hold on ticket inventory. Returns a payment challenge following the HTTP 402 flow.

**Input parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| event_id | string | yes | ATLAS event identifier |
| ticket_type | string | yes | Ticket type identifier (e.g., `"ga"`, `"vip"`) |
| quantity | integer | yes | Number of tickets to hold (min: 1) |

**Output:** `hold_id` (string) and a payment challenge object containing accepted payment methods, USDC amount, settlement chain options, and the hold TTL (minimum 300 seconds). The hold locks inventory. Automatic release occurs on expiration.

### 2.4 atlas_complete_purchase

Submits payment proof to finalize a held ticket purchase.

**Input parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| hold_id | string | yes | Hold identifier from `atlas_hold_ticket` |
| payment_proof | object | yes | On-chain USDC: `{tx_hash, chain_id}`. MPP via SPT: `{payment_intent_id}` |

**Output:** A receipt credential (W3C Verifiable Credential) containing the event ID, ticket type, quantity, settlement chain, and IPFS CID of the receipt. The receipt is published to IPFS and can be independently verified.

---

## 3. Organizer-Side MCP Tools

Organizer agents use five tools to create events, manage audiences, and run promotions.

### 3.1 atlas_create_event

Creates an event, publishes the listing to IPFS, and registers it with the ATLAS registry.

**Input parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| space_id | string | yes | Space identifier (e.g., `"bjc_abc123"`) |
| title | string | yes | Event title |
| date | ISO 8601 | yes | Event start date and time |
| location | object | yes | `{name, address}` or `{lat, lng}` for geo-coordinates |
| pricing | array | yes | Array of `{ticket_type, price, currency, capacity}` |

**Output:** `event_id` (string), IPFS `cid` (content-addressed hash of the JSON-LD listing), and a registry confirmation timestamp. The event is immediately discoverable by all ATLAS agents.

### 3.2 atlas_manage_guests

Queries the organizer's local CRM for guest records matching a segment expression.

**Input parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| space_id | string | yes | Space identifier |
| segment_query | string | yes | Segment expression (e.g., `"attended_jazz AND spent_over_100"`) |

**Output:** Array of guest records. Each record includes a guest identifier, XMTP channel status, purchase history summary, check-in count, and opt-in/opt-out status. Guest PII is never transmitted to the registry. All data originates from the organizer's local CRM.

### 3.3 atlas_send_message

Sends an XMTP-encrypted message to a guest segment.

**Input parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| space_id | string | yes | Space identifier |
| segment | string | yes | Target segment expression |
| body | string | yes | Message content |

**Output:** Delivery confirmation with `message_id`, recipient count, and delivery status. Messages are end-to-end encrypted. Only guests with active opt-in consent receive messages. The organizer holds the XMTP identity keys.

### 3.4 atlas_promote_event

Submits a promotion campaign to the ATLAS ad-network with a USDC pay-per-sale bid.

**Input parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| event_id | string | yes | Event to promote |
| bid | string | yes | USDC bid per sale (e.g., `"2.00"`) |
| budget | string | yes | Total campaign budget in USDC (e.g., `"100.00"`) |
| targeting | object | no | `{categories, geography: {lat, lng, radius_km}, age_range: {min, max}}` |

**Output:** `campaign_id` (string) and campaign status. The campaign distributes promoted listings to guest agents that query matching categories and geographies. Settlement occurs via `PromotionSettlement.sol`: 60% to referring agent, 30% to protocol treasury, 10% to registry node.

### 3.5 atlas_get_analytics

Retrieves performance data for an event or space.

**Input parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| event_id | string | conditional | Event identifier (one of event_id or space_id required) |
| space_id | string | conditional | Space identifier for aggregate metrics |

**Output:** Object containing `views`, `conversions`, `revenue` (USDC), and `demographics` (anonymized attendee distribution by geography and category affinity). Space-level queries aggregate across all events in the space.

---

## 4. lemonade-cli Reference

The CLI is published to Homebrew, npm, and PyPI. All commands accept `--format json` for machine consumption. Terminal-based agents treat these commands as shell primitives alongside `git`, `npm`, and `docker`.

### 4.1 Space Commands

```bash
lemonade space create --name "Brooklyn Jazz Collective" --domain bjc.events --type music
```

Creates a space. A space is an event platform: it gets its own domain, event feed, `/.well-known/atlas.json` endpoint, and agent-discoverable inventory. No code required.

### 4.2 Event Commands

```bash
# Create an event with ticketing
lemonade event create \
  --space bjc_abc123 \
  --title "Late Night Jazz at Nublu" \
  --date 2026-04-15T21:00 \
  --location "151 Avenue C, New York, NY 10009" \
  --ticket-type "General Admission" \
  --price 25.00 \
  --chain base \
  --format json

# List events in a space
lemonade event list --space bjc_abc123 --format json

# Search events by location
lemonade event search --near "40.7128,-74.006" --radius 10km --category music --format json
```

### 4.3 Guest and Messaging Commands

```bash
# Query CRM for a guest segment
lemonade guests list --space bjc_abc123 --segment "attended_jazz AND spent_over_100" --format json

# Send a message to a segment
lemonade message send --space bjc_abc123 --segment "attended_jazz" --body "New jazz night: April 15." --format json
```

### 4.4 Promotion Commands

```bash
# Create a promotion campaign
lemonade promote create --event evt_xyz789 --bid-per-sale 2.00 --budget 100.00 --format json

# Check campaign performance
lemonade promote stats --campaign camp_abc123 --format json
```

### 4.5 Ticket Commands

```bash
# Hold tickets
lemonade ticket hold --event evt_abc123 --type "General Admission" --quantity 2 --format json

# Complete purchase
lemonade ticket purchase --hold hold_xyz789 --method mpp --format json
```

ATLAS is an MPP-compliant service. MPP (Machine Payments Protocol) is the open payment standard co-authored by Stripe and Tempo, launched March 18, 2026. MPP supports two payment rails: direct on-chain USDC for crypto settlement, and Shared Payment Tokens (SPTs) for fiat settlement via Stripe. The `--method mpp` flag accepts either rail. The CLI selects the rail based on the hold's accepted payment methods and the agent's configured wallet.

### 4.6 Page Commands

```bash
# Deploy an event page (generates and publishes a landing page)
lemonade page deploy --event evt_xyz789
```

---

## 5. @atlas/client SDK

TypeScript library for programmatic agent integration. Designed for agent developers who need typed methods and pluggable payment handling.

### 5.1 Core Interface

```typescript
import { ATLAS } from '@atlas/client'

const atlas = new ATLAS()

// Search for events
const events = await atlas.search({
  near: { lat: 40.7128, lng: -74.006 },
  radius: '10km',
  after: '2026-04-15',
  category: 'music'
})

// Get full event details
const event = await atlas.getEvent('evt_abc123')

// Hold tickets
const hold = await atlas.holdTicket(event.ticketTypes[0], { quantity: 2 })

// Complete payment
const receipt = await atlas.pay(hold, {
  method: 'mpp',
  returnUrl: 'https://myagent.app/confirmation'
})
```

### 5.2 Payment Handler Interface

Each supported chain implements a `PaymentHandler`. The SDK ships with handlers for all ATLAS settlement chains. Custom handlers can be registered for new chains.

```typescript
interface PaymentHandler {
  chainId: string
  name: string
  preparePayment(hold: Hold): Promise<PaymentIntent>
  executePayment(intent: PaymentIntent): Promise<PaymentProof>
  verifySettlement(proof: PaymentProof): Promise<boolean>
}

class BasePaymentHandler implements PaymentHandler {
  chainId = 'base'
  name = 'Base (USDC)'
  // ...implementation
}

class MegaETHPaymentHandler implements PaymentHandler {
  chainId = 'megaeth'
  name = 'MegaETH (USDC)'
  // ...implementation
}
```

Register a custom handler:

```typescript
const atlas = new ATLAS({
  paymentHandlers: [new BasePaymentHandler(), new MegaETHPaymentHandler()]
})
```

The SDK selects a handler based on the chain specified in the hold's payment challenge. If the hold offers multiple chains, the SDK picks the first handler that matches.

---

## 6. @atlas/server-sdk

Server-side middleware for existing platforms integrating ATLAS. The `@atlas/server-sdk` wraps event listing, purchase flow, and settlement into a single middleware function.

### 6.1 Core Middleware

```typescript
import { atlasMiddleware } from '@atlas/server-sdk'

app.use('/atlas', atlasMiddleware({
  eventsSource: async () => fetchEventsFromDB(),
  onPurchase: async (hold) => processTicketSale(hold),
  settlement: { chains: ['base', 'megaeth', 'worldchain'], token: 'USDC' }
}))
```

The middleware automatically:
- Serves `/.well-known/atlas.json` with the platform's capabilities
- Exposes an event feed endpoint in AtlasEvent JSON-LD format
- Handles the HTTP 402 hold-and-pay flow for ticket purchases
- Routes settlement to the organizer's chosen chain via FeeRouter.sol

### 6.2 Framework Adapters

The middleware is framework-agnostic. Adapters ship for Express, Fastify, and Koa.

```typescript
import { atlasExpress } from '@atlas/server-sdk/express'
import { atlasFastify } from '@atlas/server-sdk/fastify'
import { atlasKoa } from '@atlas/server-sdk/koa'
```

Each adapter wraps the core middleware to match the framework's request/response conventions. A platform engineer can add ATLAS compliance to an existing server in under a day.

---

## 7. Agent Identity

Every agent interacting with ATLAS carries an identity.

### 7.1 Registration

Agents register with the ATLAS registry and receive a unique identifier. Registration requires a name, a callback URL, and a capability declaration (which MCP tools or CLI commands the agent uses).

### 7.2 Request Attribution

All requests include the `X-Atlas-Agent-Id` header. The registry logs which agent initiated each transaction. Attribution data feeds two systems: referral rewards (Section 8) and reputation tracking.

### 7.3 Reputation

The registry tracks agent behavior over time: successful transactions, failed holds, user complaints, and promotion relevance scores. Agents with higher reputation scores receive priority rate limits and appear earlier in the referral attribution chain when multiple agents participate in a discovery flow.

Reputation data is public. Any participant can query an agent's track record before trusting its recommendations.

---

## 8. Agent Referral Rewards

Agents that drive ticket sales earn 5% of the protocol fee on each referred transaction. The reward is perpetual: as long as the referring agent's ID is recorded in the transaction, the reward accrues.

**Calculation:** ATLAS charges a 2% protocol fee on each ticket sale. The referral share is 5% of that fee. On a $100 ticket, the protocol fee is $2.00, and the referring agent earns $0.10.

**On-chain tracking:** The `RewardLedger.sol` contract records each accrual with the agent's address, the transaction hash, and the reward amount. A 14-day timelock applies before the agent can claim. Verified agents (with on-chain identity attestation) receive a 1.5x multiplier on their referral rewards.

**Promotion rewards are separate.** When a promoted ticket sells, the referring agent earns both the referral reward (from RewardLedger) and 60% of the promotion bid (from PromotionSettlement.sol). The two reward streams stack.

---

## 9. Space as Platform

The `lemonade space create` command collapses the distance between "organizer" and "platform builder."

A space gets its own brand, its own domain, its own event feed, and its own `/.well-known/atlas.json` endpoint. Under the hood, the space inherits full ATLAS infrastructure: ticketing, settlement, agent access, CRM, and promotion tools.

```bash
lemonade space create --name "Brooklyn Jazz Collective" --domain bjc.events --type music
```

After this single command, the space is live. Guest agents can discover its events. The 402 purchase flow is active. Settlement routes through FeeRouter.sol on the organizer's chosen chain. XMTP messaging is available for guest communication.

A community leader with 500 Instagram followers and a passion for jazz can create an event platform in one terminal command. The space competes on curation and community, not infrastructure. A developer who needs deeper control uses the CLI and SDK for full programmatic access. Both paths produce the same ATLAS-compliant output.

---

## 10. End-to-End Flow Example

Two agents interact through the protocol. No platform mediates the exchange.

**Organizer agent** creates a jazz event and promotes it:

```bash
lemonade event create --space bjc_abc123 --title "Late Night Jazz" \
  --date 2026-04-15T21:00 --price 25.00 --chain base --format json
# Output: {"event_id": "evt_xyz789", "cid": "bafy...abc", "status": "live"}

lemonade promote create --event evt_xyz789 --bid-per-sale 2.00 --budget 100.00 --format json
# Output: {"campaign_id": "camp_abc123", "status": "active"}
```

**Guest agent** discovers, holds, and purchases:

```bash
lemonade event search --near "40.7128,-74.006" --radius 10km --category music --format json
# Returns ranked results including evt_xyz789 (flagged as promoted)

lemonade ticket hold --event evt_xyz789 --type ga --quantity 2 --format json
# Output: {"hold_id": "hold_abc", "amount": "50.00", "chain": "base", "ttl": 300}

lemonade ticket purchase --hold hold_abc --method mpp --format json
# Output: {"receipt_cid": "bafy...xyz", "tickets": 2, "settled": true}
```

Settlement flows through FeeRouter.sol on Base. The organizer receives $49.00. The protocol fee ($1.00) splits into treasury, rewards, and referral. The promotion bid ($2.00 per sale, $4.00 total) splits 60/30/10 via PromotionSettlement.sol. The organizer's CRM records two new guests via XMTP (with consent). The guest agent earned both a referral reward and a promotion payout.

---

*Related specifications: PROTOCOL-SPEC.md (API contracts), SCHEMAS.md (AtlasEvent, AtlasCredential formats), ARCHITECTURE.md Section 7 (agent ecosystem architecture), FEE-STRUCTURE.md (fee math and reward rates).*
