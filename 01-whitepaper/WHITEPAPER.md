# Atlas Protocol

### An Open Protocol for Agent-Driven Event Discovery, Ticketing, and Settlement

**Version 0.1 — March 2026**

**Authors:** Lemonade Social Events

---

## Abstract

Atlas is an open protocol that makes every event on the internet discoverable, bookable, and settleable by software agents. It achieves this through a three-layer architecture: an organizer layer that imports existing inventory via OAuth, a platform layer that enables both integration of existing platforms and construction of new ones, and a protocol core that standardizes discovery, listing, purchase, and settlement using existing web standards and stablecoin payments. Atlas does not require platforms to opt in first. Like Plaid, it starts with the user: organizers authorize access to their events, and the network grows from there. The protocol settles in USDC on Tempo with sub-cent fees, charges a flat 2% protocol fee, and returns value to participants through USDC cashback, not speculative tokens.

---

## 1. The Problem

### 1.1 The Event Discovery Crisis

There are over 500 million ticketed events held globally each year. They are listed across dozens of incompatible platforms: Eventbrite, Lu.ma, Meetup, Dice, Partiful, Splash, Universe, and hundreds of regional and vertical platforms. Each platform maintains its own proprietary API, its own data format, its own ticketing system, and its own payment rails.

This fragmentation creates a three-sided problem that worsens as the ecosystem grows.

**Agents cannot search.** A user who asks an AI agent to "find me a jazz event in Brooklyn this weekend" gets an incomplete answer. The agent can scrape Google, but it cannot query Eventbrite's inventory, cross-reference it with Dice's, check availability on Lu.ma, and purchase a ticket within a single interaction. There is no standard protocol for event discovery, no standard schema for event data, and no standard purchase flow that agents can execute programmatically. Every platform is a walled garden, and agents are locked out.

**Platforms cannot reach agents.** Event platforms have spent years optimizing for human browsers: SEO, social sharing, email marketing. But the next generation of distribution is agent-mediated. When a user delegates event discovery to an AI assistant, the platform that is not agent-accessible is invisible. Yet no platform has an incentive to build agent access unilaterally, because the value of agent access depends on agents actually being built to consume it, and agents will not be built for a single platform's proprietary API.

**Attendees get incomplete results.** The person asking for a jazz event in Brooklyn receives whatever their agent can find through web scraping and general search: a partial, unreliable, often stale picture of what is actually available. The best event might be on a platform the agent has never heard of. The attendee does not know what they are missing.

### 1.2 Why This Has Not Been Solved

Event discovery is not a new problem. Google Events, Facebook Events, and Songkick all attempted aggregation. Each failed to become a standard because they were proprietary aggregators, not open protocols. Platforms had no reason to enrich a competitor's product. Organizers had no incentive to manually cross-post.

The missing piece is not aggregation. It is a protocol. A neutral, open standard that any platform can implement, any agent can consume, and any organizer can participate in without switching platforms.

### 1.3 The Agent Inflection Point

The rise of AI agents makes this problem urgent. Agents are becoming the primary interface through which users discover and book experiences. An agent that cannot access event inventory is fundamentally limited. But building bespoke integrations with every event platform is not viable. There are too many platforms, their APIs change too often, and the long tail of small platforms has no API at all.

What agents need is what browsers needed in 1993: a standard protocol.

---

## 2. The Atlas Vision

Atlas is an open protocol that standardizes how events are discovered, listed, purchased, and settled. Every platform. Every agent. Every payment method.

**What DNS did for domain names, Atlas does for events.**

DNS did not require every computer to agree on a single naming authority. It defined a standard resolution protocol and a federated registry. Any machine could register a name. Any client could resolve one. The network grew because participation was cheap, the standard was simple, and the value was immediate.

Atlas follows the same pattern. It defines:

- A **discovery** mechanism (well-known endpoints and a federated registry)
- A **listing** format (JSON-LD extending Schema.org)
- A **purchase** flow (HTTP 402 + ticket holds)
- A **settlement** layer (USDC on Tempo, sub-cent fees)
- A **receipt** standard (cryptographic proof of purchase)

These five primitives are sufficient to make any event agent-accessible.

### 2.1 Three Simultaneous Layers

Atlas is not a single product. It is three layers that operate simultaneously, each serving a different participant while reinforcing the others.

| Layer | Participant | Value Proposition |
|-------|-----------|-------------------|
| **Layer 3 — Organizer (B2C)** | Individual event organizers | Connect existing platform accounts via OAuth. Events become Atlas-discoverable instantly. Earn USDC rewards per ticket sold. |
| **Layer 2 — Platform (B2B)** | Existing and new event platforms | Existing platforms integrate `@atlas/sdk` to become Atlas-compliant. New platforms build ON Atlas as infrastructure. |
| **Layer 1 — Protocol Core** | Agents, developers, the network | Discovery, listing, purchase, settlement. The standard itself. |

### 2.2 Bottom-Up AND Top-Down

Most protocol efforts choose a strategy: either convince platforms from the top down, or build grassroots adoption from the bottom up. Atlas does both simultaneously, and each strategy accelerates the other.

**Bottom-up:** Organizers connect their accounts today. No platform approval needed. Like Plaid, Atlas starts with user-authorized access.

**Top-down:** As Atlas-sourced traffic grows, platforms notice. Integration becomes a business decision, not an act of faith. Platforms that integrate get first-class agent access; those that do not lose discoverability.

The two strategies compound. Bottom-up creates inventory. Top-down creates trust. Together, they create a standard.

---

## 3. Design Principles

Atlas is governed by six design principles. Every protocol decision is evaluated against these. When principles conflict, the ordering below determines priority.

### 3.1 Open

The protocol specification, reference implementation, and core SDK are open source. No entity controls access to the protocol. Any agent, platform, or organizer can participate without permission, licensing, or fees beyond the protocol's settlement layer.

### 3.2 Organizer-First

The protocol exists to serve event organizers. Design decisions that benefit platforms or agents at the expense of organizers are rejected. Organizers control their data, choose their platforms, set their prices, and receive their revenue. The protocol is a distribution channel, not a landlord.

### 3.3 Payment-Agnostic at the Edge

The protocol core settles in USDC on Tempo for efficiency and finality. But attendees can pay with credit cards, Apple Pay, Google Pay, or any method supported by Stripe Stablecoin Payment Tokens (SPTs). The complexity of payment conversion is hidden from both organizers and attendees.

### 3.4 Privacy-Preserving

Attendee data belongs to attendees. The protocol transmits the minimum information required to complete a purchase. Organizers receive what they need for check-in and legal compliance, nothing more. The registry stores event metadata, not attendee data.

### 3.5 Incrementally Adoptable

A platform can become Atlas-compliant in an afternoon by serving a `/.well-known/atlas.json` file and implementing a subset of the listing format. Full compliance (including purchase and settlement) can follow. The protocol rewards partial adoption. It does not demand all-or-nothing commitment.

### 3.6 Backward-Compatible

Atlas listings extend Schema.org's `Event` type. Any system that already consumes Schema.org can parse an Atlas listing. Atlas adds fields for agent interaction (availability, purchase endpoints, settlement details) but does not break existing structured data consumers.

---

## 4. Protocol Overview

An Atlas interaction follows five stages. Each stage is independent. A platform can implement discovery and listing without implementing purchase, and agents can discover and display events without executing transactions.

```
┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│ Discovery │ →  │  Listing  │ →  │ Purchase  │ →  │Settlement │ →  │  Receipt  │
│           │    │           │    │           │    │           │    │           │
│ Find the  │    │ Read the  │    │ Hold +    │    │ Move the  │    │ Prove the │
│ event     │    │ details   │    │ pay for   │    │ money     │    │ purchase  │
│           │    │           │    │ a ticket  │    │           │    │           │
└───────────┘    └───────────┘    └───────────┘    └───────────┘    └───────────┘
```

### 4.1 Discovery

An agent discovers Atlas-compliant events through two mechanisms:

**Well-Known Endpoint.** Any domain can serve `/.well-known/atlas.json`, declaring its Atlas capabilities and linking to its event feed. Think of it as the DNS TXT record of Atlas: lightweight, self-serve, federated.

```json
{
  "atlas": "1.0",
  "name": "Brooklyn Jazz Collective",
  "events_url": "https://bjc.events/atlas/events",
  "capabilities": ["listing", "purchase", "settlement"],
  "settlement": {
    "methods": ["tempo-usdc"],
    "fee_model": "inclusive"
  }
}
```

**Atlas Registry.** A federated registry aggregates well-known endpoints, OAuth-imported events, and platform-provided feeds into a searchable index. Agents query the registry for geographic, temporal, and categorical search. The registry is a convenience layer, not a gatekeeper. Any agent can crawl well-known endpoints directly.

### 4.2 Listing

Events are described using JSON-LD extending `schema.org/Event` with Atlas-specific fields:

```json
{
  "@context": ["https://schema.org", "https://atlas.events/v1"],
  "@type": "Event",
  "name": "Late Night Jazz at Nublu",
  "startDate": "2026-04-15T21:00:00-04:00",
  "location": {
    "@type": "Place",
    "name": "Nublu",
    "address": "151 Avenue C, New York, NY 10009"
  },
  "atlas:availability": "available",
  "atlas:ticketTypes": [
    {
      "name": "General Admission",
      "price": { "amount": "25.00", "currency": "USD" },
      "available": 47,
      "atlas:purchaseUrl": "https://bjc.events/atlas/purchase/evt_abc123"
    }
  ],
  "atlas:settlement": {
    "chain": "tempo",
    "token": "USDC"
  }
}
```

The listing format is designed so that:
- Existing Schema.org consumers see a valid Event object
- Atlas-aware agents see availability, pricing, and purchase endpoints
- The data is sufficient to present to a user and execute a purchase without visiting a website

### 4.3 Purchase (The 402 Flow)

Atlas uses HTTP status code 402 (Payment Required) as the foundation of its purchase flow. The HTTP specification reserved this status code for exactly this purpose. The web never used it. Atlas does.

**Step 1: Hold Request.** The agent sends a POST to the purchase URL with ticket type and quantity. The server responds with `402 Payment Required`, including a payment envelope:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "atlas:holdId": "hold_xyz789",
  "atlas:holdExpires": "2026-04-14T21:10:00Z",
  "atlas:payment": {
    "amount": "25.00",
    "currency": "USDC",
    "destination": "0x...tempo_address",
    "chain": "tempo",
    "stripe_spt_intent": "spt_intent_abc123"
  }
}
```

**Step 2: Payment.** The agent (or the agent's payment service) either:
- Sends USDC directly on Tempo to the specified address, or
- Completes the Stripe SPT intent (enabling credit card, Apple Pay, etc.)

**Step 3: Confirmation.** Once payment is detected (on-chain confirmation or Stripe webhook), the server releases the ticket and responds with a receipt.

The hold mechanism prevents double-selling. Holds expire automatically. The 402 flow is stateless from the agent's perspective: no session, no cookies, no OAuth token required for the purchase itself.

### 4.4 Settlement

Settlement occurs on **Tempo** (Stellar-based) using **USDC** (Circle's stablecoin). Tempo was selected for three properties:

1. **Sub-cent fees.** A ticket purchase incurs < $0.001 in network fees, regardless of ticket price. The protocol works for $5 community events and $500 conference passes alike.
2. **Sub-second finality.** Settlement confirms in under 5 seconds. Organizers receive funds immediately, not in 7-14 business days.
3. **USDC native support.** No bridging, no wrapping, no exotic token pairs. USDC on Tempo is a first-class asset.

For attendees who pay with credit cards or digital wallets, **Stripe Stablecoin Payment Tokens (SPTs)** handle the conversion. The attendee pays in their local currency. Stripe converts to USDC. Atlas settles on Tempo. The organizer receives USDC. The entire flow is invisible to the attendee.

### 4.5 Receipt

After settlement, the ticket holder receives a cryptographic receipt: a signed attestation containing the event ID, ticket type, holder identifier, and settlement transaction hash. The receipt serves as the ticket. It can be verified offline, does not require the issuing platform to be online at check-in time, and cannot be forged.

---

## 5. The Three Layers

### 5.1 Layer 3 — The Organizer Layer (B2C)

The organizer layer is Atlas's growth engine. It is designed around a single insight: **organizers will not switch platforms, but they will connect them.**

#### 5.1.1 OAuth Connection

An organizer visits Atlas (or a Lemonade-powered interface) and connects their existing event platform accounts via OAuth:

- Eventbrite
- Lu.ma
- Meetup
- Partiful
- And others as integrations are built

Once connected, Atlas imports their events: title, description, date, location, ticket types, pricing, availability. The organizer's events are now Atlas-discoverable. Agents can find them. The organizer did nothing except click "Connect."

This is the Plaid model. Plaid did not wait for banks to build APIs. Users authorized access. Banks followed because the demand was undeniable. Atlas does not wait for platforms. Organizers authorize access. Platforms follow.

#### 5.1.2 Event Import and Sync

Imported events are synced on a configurable interval (default: 15 minutes). Availability, pricing, and event details update automatically. When a ticket is purchased through Atlas, the purchase is reflected on the source platform. The organizer sees a unified view.

#### 5.1.3 Atlas Direct Ticketing

Organizers who want lower fees and faster settlement can use **Atlas Direct Ticketing**, powered by Lemonade's existing infrastructure. Instead of connecting an external platform, they create and manage events directly within Atlas. Benefits:

- **Lower fees:** 2% protocol fee vs. 5-10% on most platforms
- **Instant settlement:** USDC arrives in seconds, not days
- **Full agent access:** Native Atlas listings with complete purchase flow
- **No platform lock-in:** The event data is portable. If the organizer leaves, they take their data.

Atlas Direct Ticketing is not required. It is an option that demonstrates the protocol's capabilities and serves organizers who want the best possible economics.

#### 5.1.4 Organizer Rewards

Every ticket sold through Atlas, whether from an imported event or Atlas Direct Ticketing, earns the organizer USDC cashback. This is not a promotional gimmick. It is a structural incentive: the protocol returns a portion of its fee to the participants who make the network valuable.

The reward rate is detailed in Section 9.

### 5.2 Layer 2 — The Platform Layer (B2B)

The platform layer serves two audiences: existing platforms that want agent access, and entrepreneurs building new platforms on Atlas infrastructure.

#### 5.2.1 Existing Platform Integration

An existing event platform integrates Atlas by:

1. **Serving `/.well-known/atlas.json`** — declares Atlas compliance and links to event feeds
2. **Implementing the listing format** — extends their existing Schema.org markup with Atlas fields
3. **Optionally implementing the 402 purchase flow** — enables direct agent purchasing

The `@atlas/sdk` (Node.js, with Python and Go planned) provides middleware that handles format conversion, hold management, and settlement integration. A platform engineer can add Atlas compliance to an existing Express or Fastify server in under a day.

```typescript
import { atlasMiddleware } from '@atlas/sdk'

app.use('/atlas', atlasMiddleware({
  eventsSource: async () => fetchEventsFromDB(),
  onPurchase: async (hold) => processTicketSale(hold),
  settlement: { chain: 'tempo', token: 'USDC' }
}))
```

Platforms that integrate Atlas gain:
- **Agent distribution:** Every Atlas-aware agent can now find and sell their events
- **Cross-platform visibility:** Their events appear alongside inventory from every other Atlas platform
- **Settlement efficiency:** USDC settlement with sub-cent fees and instant finality

#### 5.2.2 Building ON Atlas

Atlas is not only an integration layer for existing platforms. It is **infrastructure for new ones.**

Consider an entrepreneur who wants to build a platform for underground electronic music events in Berlin. Today, they must build: event management, ticketing, payments, discovery, SEO, marketing tools, check-in systems, and more. That is 18-24 months of engineering before the first event is listed.

With Atlas, they build: a curated frontend and community features. Atlas provides:
- **Discovery:** Events are automatically agent-discoverable
- **Ticketing:** The 402 purchase flow handles holds, payments, and settlement
- **Payments:** Tempo + Stripe SPTs, no payment integration to build
- **Data format:** JSON-LD listings are the canonical data model

The entrepreneur ships in weeks, not years. Their platform is agent-accessible from day one. Their events are discoverable across the entire Atlas network. They compete on curation and community, not infrastructure.

#### 5.2.3 The Lemonade CLI

Lemonade provides an open-source CLI (`lemonade-cli`) that wraps every platform API into shell commands. Developers and AI agents can create communities, manage events, sell tickets, and deploy sites from the terminal. The CLI outputs structured JSON for machine consumption, making it native to any AI coding assistant.

```bash
# Create a community
lemonade community create --name "Brooklyn Jazz Collective" --type music

# Create an event with ticketing
lemonade event create \
  --community bjc_abc123 \
  --title "Late Night Jazz at Nublu" \
  --date 2026-04-15T21:00 \
  --location "151 Avenue C, New York, NY 10009" \
  --ticket-type "General Admission" \
  --price 25.00

# List events (JSON output, pipeable)
lemonade event list --community bjc_abc123 --format json

# Deploy an event page
lemonade page deploy --event evt_xyz789
```

The CLI collapses the barrier between "idea" and "live event" to a single terminal session. A developer building on Atlas can scaffold an entire event platform without writing a line of application code. An AI coding agent (Cursor, Claude Code, GitHub Copilot) can call `lemonade-cli` directly, treating event operations as shell primitives alongside `git`, `npm`, and `docker`.

Atlas grows the supply side by making it radically cheap to create new event platforms for every niche, genre, city, and community.

### 5.3 Layer 1 — The Agent Layer

The agent layer is not a product Atlas builds. It is a capability Atlas enables. Any AI agent (ChatGPT, Claude, Gemini, open-source agents, custom enterprise assistants) can become Atlas-aware.

#### 5.3.1 Agent Discovery

An agent discovers Atlas events by:

1. **Querying the Atlas Registry** — geographic, temporal, categorical search
2. **Crawling well-known endpoints** — for platforms the agent already knows about
3. **Receiving MCP tool calls** — for agents running in MCP-compatible environments

The registry API is RESTful, paginated, and requires no authentication for read access. Rate limits apply.

```
GET https://registry.atlas.events/v1/search?
  lat=40.7128&lng=-74.0060&radius=10km&
  start_after=2026-04-15&start_before=2026-04-22&
  category=music
```

#### 5.3.2 Agent Purchase

An agent executes a purchase through the 402 flow described in Section 4.3. The agent needs:

1. A payment method (USDC wallet or Stripe SPT capability)
2. User authorization (the attendee approves the purchase)
3. A delivery address for the receipt (email or wallet)

No API key. No OAuth token. No platform-specific SDK. The purchase flow is the same regardless of which platform hosts the event. This is the key insight: **agents should not need to know which platform an event is on.**

#### 5.3.3 MCP Integration

For agents running in Model Context Protocol (MCP) environments, Atlas provides an MCP server that exposes event discovery and purchase as tool calls:

- `atlas_search_events` — find events by location, date, category
- `atlas_get_event` — retrieve full event details
- `atlas_hold_ticket` — initiate a ticket hold
- `atlas_complete_purchase` — settle payment and receive receipt

MCP integration means that any LLM with tool-calling capability can interact with Atlas natively, without custom HTTP client logic.

#### 5.3.4 CLI for Agents

The open-source `lemonade-cli` (Section 5.2.3) doubles as an agent interface. Every command accepts `--format json` and returns structured output that AI coding assistants can parse, chain, and act on. An agent running in a terminal environment (Claude Code, Cursor, GitHub Copilot Workspace) can call CLI commands directly without an SDK dependency:

```bash
# Agent searches for events, pipes JSON into its context
lemonade event search --near "40.7128,-74.006" --radius 10km --category music --format json

# Agent holds a ticket
lemonade ticket hold --event evt_abc123 --type "General Admission" --quantity 2 --format json

# Agent completes purchase
lemonade ticket purchase --hold hold_xyz789 --method stripe-spt --format json
```

The CLI treats event operations as shell primitives. Agents that already orchestrate `git`, `npm`, and cloud CLIs gain event capabilities with zero new abstractions.

#### 5.3.5 Client SDK

For agent developers who prefer a programmatic interface, `@atlas/client` provides a typed SDK:

```typescript
import { Atlas } from '@atlas/client'

const atlas = new Atlas()

const events = await atlas.search({
  near: { lat: 40.7128, lng: -74.006 },
  radius: '10km',
  after: '2026-04-15',
  category: 'music'
})

const hold = await atlas.holdTicket(events[0].ticketTypes[0], {
  quantity: 2
})

const receipt = await atlas.pay(hold, {
  method: 'stripe-spt',
  returnUrl: 'https://myagent.app/confirmation'
})
```

---

## 6. The Atlas Registry

The registry is the protocol's coordination layer. It is not the protocol itself (Atlas works without it, via direct well-known endpoint crawling) but it makes the protocol practical at scale.

### 6.1 What the Registry Stores

The registry indexes:

- **Event metadata** — title, date, location, categories, availability, pricing
- **Source provenance** — which platform or organizer provided the listing
- **Capability declarations** — which stages of the protocol the source supports (listing only? listing + purchase? full settlement?)
- **Freshness timestamps** — when the listing was last synced

The registry does NOT store:
- Attendee data
- Payment credentials
- Ticket holder identities
- Purchase history

### 6.2 Federation

The initial registry is operated by Lemonade as the reference implementation. The registry protocol is designed for federation. Any entity can operate a registry node that:

1. Crawls well-known endpoints on its own schedule
2. Accepts direct submissions from organizers and platforms
3. Syncs with other registry nodes via a gossip protocol
4. Serves the same RESTful search API

Federation ensures that no single entity controls event discovery. If Lemonade's registry goes offline, other nodes continue serving. If a regional operator wants to run a registry focused on events in Southeast Asia, they can, and their data automatically propagates to the global network.

### 6.3 Aggregation Across Layers

The registry aggregates events from all three layers:

- **Organizer-imported events** — synced from connected platform accounts via OAuth
- **Platform-published events** — read from well-known endpoints of Atlas-compliant platforms
- **Atlas Direct events** — created natively within Atlas infrastructure

From an agent's perspective, there is no difference. An event is an event. The registry abstracts away the source.

---

## 7. Payment and Settlement

### 7.1 Why USDC

Atlas settles in USDC. Not a custom token, not ETH, not fiat rails.

**Stability.** Event organizers need predictable revenue. A ticket sold for $25 must deliver $25 (minus fees) to the organizer. Volatile tokens are incompatible with this requirement.

**Liquidity.** USDC is the most liquid stablecoin, available on every major exchange, with reliable on/off ramps in most jurisdictions. Organizers can hold USDC or convert to local currency easily.

**Composability.** USDC on Tempo is programmable. Reward distributions, fee splits, multi-party settlement, and escrow can all be expressed as on-chain logic without intermediaries.

**No speculative overhead.** A custom protocol token would require organizers to understand token economics, manage price risk, and navigate regulatory uncertainty. USDC eliminates all of this. The protocol is useful on day one, not after a token appreciates.

### 7.2 Why Tempo

Tempo (built on Stellar) provides the settlement properties Atlas requires:

| Property | Tempo | Ethereum L1 | Solana | Stripe (fiat) |
|----------|-------|-------------|--------|----------------|
| Transaction fee | < $0.001 | $2-50 | $0.01 | 2.9% + $0.30 |
| Finality | ~5 sec | ~12 min | ~0.4 sec | 7-14 days |
| USDC native | Yes | Yes | Yes | N/A |
| Programmable splits | Yes | Yes | Yes | Limited |

Tempo's combination of sub-cent fees and fast finality makes it uniquely suited for event ticketing, where transaction values range from $5 to $500 and organizers expect prompt access to funds.

### 7.3 Stripe Stablecoin Payment Tokens (SPTs)

Most attendees will not hold USDC. They will pay with credit cards, Apple Pay, or Google Pay. Stripe SPTs bridge this gap:

1. Attendee initiates payment via familiar UI (card form, wallet button)
2. Stripe processes the charge in the attendee's local currency
3. Stripe mints a stablecoin payment token representing the settled amount
4. Atlas receives the SPT and completes settlement on Tempo
5. Organizer receives USDC

The attendee experience is identical to any online purchase. The organizer receives USDC with instant finality. The protocol operates entirely on-chain. Stripe handles the fiat complexity at the edge.

### 7.4 Fee Structure

| Component | Fee | Recipient |
|-----------|-----|-----------|
| Atlas protocol fee | 2% of transaction | Protocol treasury |
| Tempo network fee | < $0.001 per tx | Network validators |
| Stripe SPT fee (if applicable) | ~1.5% of transaction | Stripe |

For a $25 ticket purchased via credit card:
- Attendee pays: $25.00
- Stripe takes: ~$0.38 (1.5%)
- Atlas protocol takes: $0.50 (2%)
- Tempo network: < $0.001
- **Organizer receives: ~$24.12**

Compare this to the current Eventbrite model where the organizer receives roughly $21.50-$22.50 after platform fees, payment processing, and service charges.

For a $25 ticket purchased via USDC directly:
- Atlas protocol takes: $0.50 (2%)
- Tempo network: < $0.001
- **Organizer receives: $24.50**

---

## 8. Reward Economics

Atlas does not extract maximum value from participants. It returns value to the participants who make the network valuable.

### 8.1 Protocol Revenue

The 2% protocol fee generates revenue that is distributed as follows:

| Allocation | Share | Purpose |
|------------|-------|---------|
| Organizer rewards | 30% | USDC cashback to event organizers |
| Attendee rewards | 20% | USDC cashback to ticket purchasers |
| Referral rewards | 10% | Incentive for organizer and platform acquisition |
| Protocol development | 25% | Engineering, infrastructure, security |
| Reserve | 15% | Governance transition, contingencies |

### 8.2 Organizer Rewards

Organizers earn USDC cashback on every ticket sold through Atlas. The reward rate scales with volume:

| Monthly Ticket Sales | Cashback Rate (of protocol fee) | Effective Rate |
|---------------------|-------------------------------|----------------|
| 1-100 tickets | 20% | 0.4% of GMV |
| 101-500 tickets | 25% | 0.5% of GMV |
| 501-2,000 tickets | 30% | 0.6% of GMV |
| 2,000+ tickets | 35% | 0.7% of GMV |

Rewards are distributed weekly in USDC to the organizer's configured wallet. There is no minimum threshold, no claim process, no token conversion. USDC arrives automatically.

### 8.3 Attendee Rewards

Attendees who purchase through Atlas-aware agents receive a smaller but consistent cashback:

- **Standard rate:** 0.2% of ticket price in USDC
- **First purchase bonus:** 1% of ticket price (up to $5)
- **Referral bonus:** 0.5% when a referred friend makes their first purchase

Attendee rewards are optional. Agents can choose whether to surface them. The rewards accrue to a lightweight Atlas wallet (claimable via email verification) and can be used toward future ticket purchases or withdrawn.

### 8.4 Referral Program

Organizers, attendees, and platforms each have referral mechanisms:

- **Organizer referrals:** An organizer who refers another organizer earns 5% of the referred organizer's protocol fees for 12 months
- **Platform referrals:** A platform that brings organizers onto Atlas earns 10% of those organizers' protocol fees for 12 months
- **Agent referrals:** An agent implementation that drives purchases earns 5% of those transactions' protocol fees perpetually (as long as the agent remains the referral source)

These are not token rewards. They are USDC payments sourced from the referral allocation of the protocol fee.

---

## 9. Future Token Economics

Atlas launches without a custom token. This is deliberate. Protocol tokens introduced before product-market fit create misaligned incentives, attract speculators rather than users, and distract from the work of building a useful network.

A protocol of Atlas's ambition may eventually benefit from a token for governance, staking, and ecosystem coordination. Atlas defines a phased approach with adoption-based triggers, not calendar dates.

### Phase 0 — USDC Only (Launch)

No custom token. All fees, rewards, and settlements in USDC. This phase lasts until the protocol achieves $100K monthly GMV through organic usage.

**Rationale:** Prove that the protocol is useful. Prove that organizers join for economic benefit, not token speculation. Prove that agents use Atlas because it is the best way to find events, not because of airdrop farming.

### Phase 1 — LMC Wrapper ($100K Monthly GMV Trigger)

Introduction of **LMC (Lemonade Coin)**, a wrapped utility token backed 1:1 by USDC in the protocol treasury. LMC is used for:

- **Priority listing:** Events staked with LMC appear higher in registry search results
- **Premium rewards:** Organizers who opt into LMC rewards receive a 1.5x multiplier
- **Platform staking:** Platforms stake LMC to guarantee listing quality

LMC is always redeemable for USDC at par. It is not speculative. It is a coordination mechanism.

### Phase 2 — $LEMON Governance ($1M Monthly GMV Trigger)

Introduction of **$LEMON**, a governance token for protocol decision-making. $LEMON holders vote on:

- Protocol fee adjustments
- Reward allocation changes
- Registry federation policies
- SDK standard changes
- Grant disbursements from the reserve

$LEMON is distributed to active protocol participants (organizers, platforms, agents) based on historical contribution, not purchased in a token sale. Governance power resides with the stakeholders who built the network.

### Phase 3 — Dual-Token + Foundation ($10M Monthly GMV Trigger)

At sufficient scale, the protocol transitions to a dual-token model:

- **LMC** — utility and staking (stable, USDC-backed)
- **$LEMON** — governance and ecosystem growth (floating, market-determined)

A non-profit **Atlas Foundation** is established to steward the protocol, funded by the reserve allocation. The foundation operates the reference registry, funds protocol development grants, and manages the governance process.

### Why Adoption Triggers

Calendar-based token launches create artificial urgency. They force token issuance before the protocol has proven its value, attract participants optimizing for launch dynamics rather than network health, and create governance structures before there are meaningful decisions to govern.

Adoption triggers ensure that each phase of tokenization corresponds to real demand. $100K GMV means real organizers selling real tickets. $1M GMV means meaningful platform adoption. $10M GMV means the protocol is infrastructure, not an experiment.

---

## 10. Network Effects

Atlas is a three-sided network connecting organizers, platforms/agents, and attendees. Each side's participation increases the value for the other two. Atlas's network effects are not merely additive. They compound through a flywheel that accelerates with each rotation.

### 10.1 The Flywheel

```
Organizers join (free, earns rewards)
        │
        ▼
Inventory grows
        │
        ▼
Agents find better results
        │
        ▼
Agents drive sales
        │
        ▼
Platforms notice traffic
        │
        ▼
Platforms integrate
        │
        ▼
New platforms build ON Atlas
        │
        ▼
More inventory, more categories, more cities
        │
        └──────────── loops back ────────────┘
```

### 10.2 Why This Flywheel is Defensible

Most marketplace flywheels can be replicated by a well-funded competitor. Atlas's flywheel has three structural defenses:

**Open standard lock-in.** Once agents are built to consume the Atlas format, the cost of switching to an alternative standard is borne by every agent developer simultaneously. Standards have enormous inertia. HTTP did not get replaced by a better protocol. It got extended. Atlas is designed to be extended, not replaced.

**Organizer multi-homing.** Organizers do not leave their existing platform to join Atlas. They connect them. Atlas can grow without asking anyone to abandon anything. Competitors that require exclusive commitment face a structural disadvantage.

**Platform builder ecosystem.** Every platform built ON Atlas adds inventory that benefits every other Atlas participant. These platforms are not Atlas's customers. They are Atlas's co-creators. The more platforms that exist, the harder it is for a competing protocol to replicate the ecosystem.

### 10.3 Cross-Side Network Effects

| When this grows... | ...this benefits |
|--------------------|------------------|
| More organizers | Agents find more events, attendees get better recommendations |
| More agents | Organizers sell more tickets, attendees have more ways to discover |
| More attendees | Organizers earn more, platforms see more traffic, agents get more queries |
| More platforms | More diverse inventory, more niche coverage, more geographic reach |
| More platform builders | Entirely new event categories become Atlas-discoverable |

---

## 11. The Platform Builder Opportunity

Section 5.2.2 introduced the concept of building ON Atlas. This section expands on why this matters and who it serves.

### 11.1 The Current Platform Tax

Building an event platform today requires:

- Payment processing integration (Stripe, PayPal, etc.)
- Ticketing logic (holds, releases, refunds, transfers)
- Discovery and SEO infrastructure
- Check-in and verification systems
- Fraud prevention
- Financial compliance and reporting

This infrastructure is table stakes. It does not differentiate your platform. It simply must exist before you can focus on what makes your platform unique: curation, community, brand, user experience.

The result is that only well-funded companies can launch event platforms. The long tail of communities (underground music scenes, local food festivals, academic conferences, niche sports leagues) are forced onto generic platforms that do not understand their needs.

### 11.2 The Atlas Platform Stack

Atlas provides the undifferentiated infrastructure as protocol primitives:

| You build | Atlas provides |
|-----------|---------------|
| Community and curation | Discovery and agent access |
| Brand and UX | Listing format and data model |
| Content and editorial | Purchase flow and holds |
| Moderation and trust | Payment and settlement |
| Unique features | Receipt and verification |

A new platform built on Atlas ships with:
- Agent discoverability from day one
- USDC settlement with sub-cent fees from day one
- Cross-platform visibility from day one
- Credit card and wallet acceptance (via Stripe SPTs) from day one

### 11.3 Who Builds on Atlas

- **Community organizers** who outgrow Facebook Events but do not need a full platform
- **Vertical SaaS founders** building for specific industries (conferences, weddings, fitness)
- **Regional operators** serving markets where global platforms have weak presence
- **Web3-native communities** who want on-chain ticketing without building the infrastructure
- **Media companies** adding events to their content business

Each of these builders creates inventory that benefits the entire Atlas network. Their success is the protocol's success.

---

## 12. Governance Evolution

Atlas begins as a Lemonade project and evolves toward decentralized governance as the network matures. This evolution is not aspirational. It is structurally encoded in the protocol's token phases.

### Phase 0: Lemonade Stewardship (Launch — $100K GMV)

Lemonade operates the reference implementation, the initial registry, and the SDK. Protocol decisions are made by the Lemonade team with input from early adopters. The protocol specification is open source and accepts community contributions via RFC process.

### Phase 1: Advisory Board ($100K — $1M GMV)

An advisory board of 5-7 members is formed, including:
- 2 organizer representatives (elected by active organizers)
- 2 platform representatives (nominated by integrated platforms)
- 1 agent developer representative
- 1-2 Lemonade representatives

The advisory board reviews and approves protocol changes, fee adjustments, and reward structure modifications. Lemonade retains operational control but commits to following advisory recommendations.

### Phase 2: Steering Committee ($1M — $10M GMV)

Governance transitions to a steering committee with binding authority over:
- Protocol specification changes
- Fee structure and reward allocation
- Registry federation policies
- Grant disbursements

$LEMON token holders elect steering committee members. Lemonade holds a diminishing share of $LEMON, ensuring governance decentralizes as the network grows.

### Phase 3: Atlas Foundation ($10M+ GMV)

A legally independent non-profit foundation assumes stewardship. The foundation:
- Employs protocol developers
- Operates the reference registry
- Manages the grant program
- Coordinates with regulatory bodies
- Stewards the protocol specification

Lemonade becomes one participant among many. The original builder, but not the permanent owner.

---

## 13. Adoption Strategy

### 13.1 Organizer Acquisition (B2C — Viral)

**Target:** Independent organizers running 2-20 events per year on Eventbrite, Lu.ma, or Meetup.

**Value proposition:** "Connect your account. Your events become discoverable by AI agents. You earn USDC on every ticket sold. It takes 30 seconds."

**Channels:**
- Direct outreach to prolific organizers (top 1,000 by event volume on Eventbrite)
- Partnerships with organizer communities and creator economy platforms
- Content marketing: "How AI agents are changing event discovery"
- Referral program: organizers inviting organizers

**Success metric:** 1,000 connected organizers within 6 months of launch.

### 13.2 Platform Partnerships (B2B — Credibility)

**Target:** Mid-tier platforms (10K-500K events/year) seeking differentiation.

**Value proposition:** "Add Atlas compliance in one sprint. Your events become discoverable by every AI agent. Your organizers get USDC rewards. Your competitors who do not integrate become invisible to agents."

**Channels:**
- Direct BD to platform engineering teams
- Conference talks and developer relations
- Open source SDK with excellent documentation and examples
- Early adopter program with dedicated integration support

**Success metric:** 5 platform integrations within 12 months of launch.

### 13.3 Builder Ecosystem (B2B-New — Long Term)

**Target:** Entrepreneurs and developers who want to build niche event platforms.

**Value proposition:** "Build an event platform in weeks, not years. Atlas handles payments, discovery, and agent access. You focus on your community."

**Channels:**
- Developer documentation and tutorials
- Hackathons and builder grants (funded from reserve allocation)
- Template platforms (open source starting points for common use cases)
- Showcase of successful Atlas-built platforms

**Success metric:** 20 platforms built on Atlas within 24 months of launch.

### 13.4 Agent Ecosystem (Developer — Parallel)

**Target:** AI agent developers, LLM application builders, personal assistant platforms.

**Value proposition:** "Give your agent the ability to find and book events. One SDK. Every event. Every platform."

**Channels:**
- Open-source `lemonade-cli` published to Homebrew, npm, and PyPI, with structured JSON output for AI coding assistants
- MCP server listing in agent tool registries
- Client SDK published to npm, PyPI
- Integration guides for major agent frameworks (LangChain, CrewAI, AutoGen)
- Partnership with agent platforms (OpenAI, Anthropic, Google) for featured integration

**Success metric:** 50 agent implementations using Atlas within 12 months of launch.

---

## 14. Progressive Decentralization

Atlas launches as a centralized service. This is the right call.

New protocols face a cold-start problem: decentralized systems must bootstrap network effects, iterate on design, and fix critical bugs, all under the constraints of consensus mechanisms designed for stability, not speed. Ethereum launched with a single client implementation and a small foundation making rapid decisions. Bitcoin had Satoshi. Every successful protocol earned decentralization. None started with it.

Atlas follows the same arc. At launch, Lemonade operates every component: the registry, the settlement coordination, the ticket issuance, the reward distribution. Users trust Lemonade. This is honest and explicit. But it is also temporary.

The long-term vision is a protocol that does not require trust in any single operator, including Lemonade. Atlas achieves this through **progressive decentralization**: a staged migration of trust-critical components on-chain, where each stage removes one category of trust dependency while preserving the performance and usability that made the system worth using in the first place.

The five stages below cover the migration, what stays centralized and why, and how decentralization maps to the governance evolution described in Section 12.

### 14.1 The Principle: Decentralize Trust, Not Performance

Not every system component benefits from decentralization. Search ranking is a competitive advantage. Putting it on-chain would make it gameable and slow. AI agent inference requires sub-second latency. Consensus mechanisms would make it unusable. Frontend UX is a design problem, not a trust problem.

The components that *do* benefit from decentralization share a common trait: they involve **promises that a central operator could break**. Fee splits are a promise. Ticket validity is a promise. Reward payouts are a promise. Event permanence is a promise. When these promises live on a server, they require trust. When they live on-chain, they require only verification.

HTTPS made eavesdropping technically impossible, not merely against policy. On-chain settlement does the same for event finance. It converts social trust ("Lemonade says they will pay you") into cryptographic certainty ("the contract paid you, and anyone can verify it").

Atlas decentralizes along this boundary: **trust-critical components move on-chain; performance-critical components remain centralized.** Each stage moves one component, proves it works, and creates the foundation for the next.

### 14.2 The Five Stages

```
PROGRESSIVE DECENTRALIZATION ROADMAP
=====================================================================

  STAGE 0          STAGE 1           STAGE 2          STAGE 3          STAGE 4
  Launch           Fee Splits        Tickets          Rewards          Registry
  (Centralized)    (On-Chain)        (On-Chain)       (On-Chain)       (On-Chain)

  +-----------+    +-----------+    +-----------+    +-----------+    +-----------+
  |           |    |           |    |   . . .   |    |   . . .   |    |   . . .   |
  | Payments  |    | Payments  |    |  Tickets  |    |  Tickets  |    |  Tickets  |
  | on-chain  |    | on-chain  |    |  on-chain |    |  on-chain |    |  on-chain |
  |           |    |           |    |           |    |           |    |           |
  | All else  |    | Fee split |    | Fee split |    | Fee split |    | Fee split |
  | on server |    | on-chain  |    | on-chain  |    | on-chain  |    | on-chain  |
  |           |    |           |    |           |    |           |    |           |
  |           |    | All else  |    | All else  |    | Rewards   |    | Rewards   |
  |           |    | on server |    | on server |    | on-chain  |    | on-chain  |
  |           |    |           |    |           |    |           |    |           |
  |           |    |           |    |           |    | All else  |    | Registry  |
  |           |    |           |    |           |    | on server |    | on-chain  |
  +-----------+    +-----------+    +-----------+    +-----------+    +-----------+

  TRUST:          TRUST:           TRUST:          TRUST:           TRUST:
  Lemonade        Fee math is      Your ticket     Your rewards     Events are
  handles all     verifiable       exists even     are yours —      permanent
                  by anyone        if Lemonade     no payout        public goods
                                   goes offline    dependency

  GOVERNANCE:     GOVERNANCE:      GOVERNANCE:     GOVERNANCE:      GOVERNANCE:
  Lemonade        Lemonade         Lemonade        Multi-sig        Token holder
  stewardship     controls         controls        governance       governance
                  contracts        contracts
=====================================================================
```

#### Stage 0: Centralized with On-Chain Payments (Launch)

At launch, Atlas payments settle on-chain in USDC on Tempo, as described in Section 7. Every transaction is verifiable. Anyone can look at the blockchain and confirm that a payment was made, for what amount, at what time.

But everything else (fee distribution, ticket issuance, reward calculation, event listing) runs on Lemonade's servers. Users trust that Lemonade will split fees honestly, deliver valid tickets, calculate rewards correctly, and keep event listings available.

This is a reasonable starting point. Lemonade has shipped event infrastructure for years. The codebase is battle-tested. Moving fast on a centralized stack means the protocol can iterate on its core value proposition (agent-driven event discovery) without being constrained by the pace of smart contract development and audit cycles.

The on-chain payments are not decoration. They establish a critical precedent: Atlas money moves on a public ledger from day one. An audit trail from the start makes the transition to trustless components natural rather than disruptive.

**What users must trust:** That Lemonade splits fees correctly, issues valid tickets, calculates rewards honestly, and keeps the registry available.

**What users can verify:** That payments were made, for the correct amounts, to the correct addresses.

#### Stage 1: The Fee Split Contract

The first component to move on-chain is the one where trust matters most: money.

Today, when a ticket is purchased through Atlas, the payment arrives at a Lemonade-controlled address. Lemonade then distributes the funds: the organizer's share, the protocol treasury's share, the reward pool's share. Users trust that these splits are correct.

In Stage 1, a smart contract on Base (or Tempo, depending on contract capability maturation) replaces this process. The contract receives all Atlas payments and executes the split automatically according to rules encoded in its logic:

- The organizer receives their share, sent directly to their wallet
- The protocol treasury receives 2%, no more, no less
- The reward pool receives its designated allocation
- The referral share routes to the referring party

The split percentages are readable by anyone. The contract's execution is deterministic and public. Lemonade cannot take 3% when the contract says 2%. Lemonade cannot delay an organizer's payment. Lemonade cannot redirect reward pool funds. The contract does what it says, and what it says is visible to everyone.

This is the single most important trust removal in the entire roadmap. Financial integrity is the foundation on which every other form of trust is built. An organizer who can verify that fee splits are automatic and tamper-proof will trust the rest of the system far more readily. A platform that integrates Atlas can point its organizers to the contract and say: "See for yourself."

**What changes:** Fee distribution becomes trustless and verifiable.

**What users must still trust:** Ticket validity, reward calculations, registry availability.

**What users can now verify:** That every dollar is split exactly as promised, in real time, with no human intervention.

#### Stage 2: On-Chain Tickets

In Stage 1, payments are trustless but tickets are not. If Lemonade's servers go down on the day of an event, ticket verification fails. The attendee has a receipt, but no check-in system can validate it without calling Lemonade's API.

Stage 2 fixes this by making tickets tangible, permanent, and independently verifiable.

When an attendee purchases a ticket, an ERC-721 token (an NFT) is minted on Base. The token encodes the event, the ticket type, and the holder's wallet. It is owned by the attendee, not by Lemonade, not by the organizer, not by the platform.

This has three immediate consequences.

**Offline verification.** Any check-in application can verify a ticket by checking the blockchain. If Lemonade is offline, the ticket is still valid. If the organizer's platform is offline, the ticket is still valid. The attendee's proof of purchase is as durable as the blockchain itself.

**Trustless resale.** Today, ticket resale is plagued by fraud, platform restrictions, and opaque pricing. An on-chain ticket can be transferred wallet-to-wallet with cryptographic proof of authenticity. No intermediary needed. No counterfeit possible. Organizers can encode resale rules directly in the token contract: maximum markup, royalty on resale, or no resale at all. The rules are transparent and self-enforcing.

**Composability with existing infrastructure.** Lemonade already supports POAPs (Proof of Attendance Protocol) and NFT integrations. On-chain tickets extend this infrastructure naturally. Attendees accumulate a verifiable history of events they have attended, useful for loyalty programs, community membership, and reputation systems that no single platform controls.

The key insight is that a ticket is a claim: a claim that the holder has the right to attend an event. Claims should not depend on the availability of the system that issued them. On-chain tickets make this claim permanent and self-verifiable.

**What changes:** Tickets become attendee-owned assets that exist independently of any server.

**What users must still trust:** Reward calculations, registry availability.

**What users can now verify:** Fee splits (Stage 1) and ticket validity (Stage 2).

#### Stage 3: On-Chain Rewards

Atlas rewards, described in Section 8, are designed to return value to the participants who grow the network. At launch, reward balances are tracked on Lemonade's servers. Weekly payouts are processed in batches. The 14-day hold on new rewards (to prevent gaming) is enforced by application logic.

This works, but it concentrates trust in a single point. If Lemonade miscalculates a reward, the organizer has no independent verification. If Lemonade delays a payout, there is no recourse. If Lemonade modifies the hold period, organizers discover it only when their payout schedule changes.

Stage 3 moves reward mechanics on-chain. A smart contract tracks reward accrual, enforces the hold period as a timelock, and allows direct claims.

The 14-day hold becomes a timelock in the contract. When a reward accrues, it enters the timelock. After 14 days, the recipient can claim it directly. No batch process, no Stripe dependency for crypto-native users, no intermediary. The claim is a blockchain transaction: the user calls the contract, the contract verifies the timelock has expired, and the USDC transfers.

For users who prefer automatic payouts, a relay service (operated by Lemonade or any third party) can trigger claims on the user's behalf. The key difference: the relay has no discretion. It can trigger a claim or not trigger it. It cannot redirect funds, modify amounts, or extend hold periods. The contract is the source of truth.

Self.xyz identity verification (which enables boosted reward rates for verified attendees) is checked on-chain. The verification attestation lives in the user's wallet. The reward contract checks the attestation and applies the appropriate rate. No server-side decision. No possibility of selective rate application.

**What changes:** Rewards become self-custodied. Users claim directly from contracts, not from Lemonade.

**What users must still trust:** Registry availability (event listings).

**What users can now verify:** Fee splits, ticket validity, and reward integrity.

#### Stage 4: The Decentralized Registry

The first three stages decentralize the financial and transactional components of Atlas. Stage 4 addresses the last remaining centralized dependency: the event registry itself.

In Stages 0-3, event listings live on Lemonade's servers. If Lemonade removes an event, it disappears. If Lemonade's infrastructure fails, discovery stops. The protocol's core function (making events findable) depends on a single operator.

Stage 4 changes the architecture of the registry. Events are published to IPFS (InterPlanetary File System), a decentralized, content-addressed storage network. Each event listing gets a permanent, immutable URL derived from its content. The listing cannot be altered or removed by any single party.

On-chain pointers (smart contract entries on Base) link event identifiers to their IPFS content hashes. An agent resolving an event queries the contract, retrieves the IPFS hash, and fetches the listing from any IPFS node.

Anyone can run a registry node. Lemonade operates the primary node, with the best performance, the most complete index, and the most sophisticated search ranking. But the protocol functions without it. A community operator in Buenos Aires can run a node focused on Latin American events. A university can run a node for academic conferences. An open-source project can run a node as a public service.

At this stage, Atlas becomes a true public good. Like HTTP, it is infrastructure that anyone can build on and no one can shut down. The event data is permanent. The financial primitives are trustless. The network is permissionless.

**What changes:** Event data becomes permanent and censorship-resistant.

**What users must trust:** Nothing. Every critical component is verifiable on-chain or on IPFS.

**What users can verify:** Everything.

### 14.3 What Stays Centralized

Progressive decentralization does not mean total decentralization. Some components are better served by centralized infrastructure, not because decentralization is impossible, but because it would degrade the user experience without meaningful trust benefits.

**Search ranking.** How events are ranked in search results is a competitive advantage, not a trust-critical function. Lemonade's ranking algorithm considers freshness, relevance, organizer reputation, and dozens of other signals. Putting ranking on-chain would make it slow, expensive, and gameable. Anyone can build their own ranking on top of the decentralized registry data. That is a feature, not a limitation.

**Connector sync.** The OAuth connectors that import events from external platforms (Eventbrite, Lu.ma, Meetup) are internal plumbing. They run on schedules, handle API rate limits, and manage credential refresh. There is no trust dimension. The imported data is verifiable against the source platform.

**Frontend UX.** Lemonade provides the primary Atlas frontend, but it is one implementation among potentially many. Anyone can build a frontend that reads from the decentralized registry. The frontend is a presentation layer, not a trust layer.

**AI agent infrastructure.** Agent inference, natural language processing, and recommendation models require low-latency computation that is incompatible with consensus mechanisms. These systems are performance-critical, not trust-critical. Their outputs (search results, recommendations) are suggestions, not commitments.

The principle is consistent: if a component involves a promise that could be broken, it moves on-chain. If it involves a computation that benefits from speed and flexibility, it stays centralized. If in doubt, ask: "Would a user's financial or participatory rights be harmed if this component acted dishonestly?" If yes, decentralize it. If no, optimize it.

### 14.4 Governance Alignment

Each stage of technical decentralization corresponds to a stage of governance decentralization, as described in Section 12. This alignment is deliberate. The people who govern the protocol should match the trust model the protocol operates under.

| Decentralization Stage | Governance Model | Rationale |
|----------------------|-----------------|-----------|
| Stage 0: Centralized | Lemonade stewardship | Lemonade controls all components. Lemonade governs. Simple, fast, accountable. |
| Stage 1: Fee splits on-chain | Lemonade controls contracts | The fee split contract is deployed by Lemonade. Contract upgrades require Lemonade's key. Governance is still centralized, but the contract's behavior is publicly verifiable, a check on governance power. |
| Stage 2: Tickets on-chain | Advisory board input | With tickets and fees on-chain, the protocol has significant assets under smart contract control. An advisory board provides oversight. Contract upgrades require advisory review. |
| Stage 3: Rewards on-chain | Multi-sig governance | Three major financial components are now on-chain. No single entity should control upgrade keys. A multi-sig (3-of-5 or similar) distributes control across Lemonade, organizer representatives, and platform representatives. |
| Stage 4: Registry on-chain | Token holder governance | The protocol is fully decentralized. Governance transitions to $ATLAS token holders (see Section 9 on token economics). Lemonade is one participant, the original builder, but no longer the sole authority. |

This progression is not symbolic. At each stage, the governance model is *appropriate* to the trust model. It would be premature to hand governance to token holders when Lemonade controls every server. It would be irresponsible for Lemonade to maintain unilateral control when the protocol's financial infrastructure is trustless and community-governed.

### 14.5 Migration Mechanics

Each stage transition follows a consistent process:

1. **Build and audit.** The smart contract (or decentralized component) is developed, tested, and audited by independent security firms. Atlas will not move financial infrastructure on-chain with unaudited code.

2. **Parallel operation.** The new on-chain component runs alongside the existing centralized component. Both produce results. Discrepancies are investigated and resolved. This period lasts a minimum of 90 days.

3. **Gradual migration.** Traffic shifts incrementally: 10%, 25%, 50%, 100%. At each threshold, the system is monitored for edge cases, performance degradation, and user experience impact.

4. **Cutover.** The centralized component is retired. The on-chain component becomes canonical. The centralized version may continue as a cache or fallback, but the blockchain is the source of truth.

5. **Governance update.** The governance model updates to match the new trust architecture, per the alignment table above.

This process is deliberately conservative. Moving financial infrastructure on-chain is not a feature launch. It is a trust transfer. The cost of a bug in a fee split contract is not a degraded user experience; it is lost money. Every stage earns the right to proceed to the next.

### 14.6 The End State

When Stage 4 is complete, Atlas is no longer a product. It is a protocol.

Events are permanent, stored on IPFS with on-chain pointers that no entity can revoke. Fee splits are automatic, governed by audited contracts that execute deterministically. Tickets are attendee-owned assets that survive the failure of any server. Rewards are self-custodied, claimable directly from contracts without intermediary approval. Discovery is federated across registry nodes that anyone can operate.

Lemonade, in this end state, is the best implementation of Atlas: the fastest registry node, the most polished frontend, the most sophisticated search ranking, the most capable AI agents. But it is not the only implementation. And it is not required.

If Lemonade disappeared tomorrow in Stage 4, Atlas would continue. Events would still be discoverable. Tickets would still be valid. Fee splits would still execute. Rewards would still be claimable. The protocol persists because its critical components live on infrastructure that no single entity controls.

This is the promise of progressive decentralization: **start fast and centralized; earn trust by shipping; then remove the need for trust, one component at a time.** The end state is a protocol that is as durable and permissionless as the blockchains it settles on, not because it launched that way, but because it earned its way there.

---

*The technical architecture of each decentralization stage (contract specifications, IPFS integration patterns, migration tooling) is detailed in the separate Atlas Architecture Document. This section describes the vision and rationale; the architecture document describes the implementation.*

---

## 15. Conclusion

The event industry is the last major consumer category without a universal discovery and booking protocol. Travel has IATA and GDS. Restaurants have OpenTable and Google Reserve. Accommodation has OTA standards. Events have nothing. Hundreds of walled gardens and millions of invisible listings.

Atlas changes this.

For **organizers**: Connect your accounts today. Your events become discoverable by every AI agent on the internet. You earn USDC rewards on every ticket sold. You change nothing about how you run events. You simply expand where they can be found.

For **platforms**: Integrate the SDK. Your events gain agent distribution. Your organizers gain rewards. You gain a competitive advantage that compounds as the agent ecosystem grows. The cost is one sprint of engineering. The cost of not integrating is invisibility.

For **builders**: Build the event platform your community deserves. Atlas provides payments, discovery, and agent access as protocol primitives. You ship in weeks. Your platform is connected to the entire Atlas network from day one.

For **agent developers**: Give your users the ability to discover and book any event, on any platform, in any city. One protocol. One SDK. One purchase flow. No platform-specific integrations. No web scraping. No incomplete results.

Atlas is not a product. It is infrastructure. Like HTTP, DNS, and SMTP, it is a protocol that becomes more valuable as more participants adopt it. Its value accrues to the participants, not the protocol operator.

The event discovery problem is not a technology problem. It is a coordination problem. Atlas is the coordination layer.

**Build with us: [atlas.events](https://atlas.events)**

---

*Atlas Protocol is created by Lemonade Social Events. The protocol specification is open source. This whitepaper is a living document — version updates will be published as the protocol evolves.*
