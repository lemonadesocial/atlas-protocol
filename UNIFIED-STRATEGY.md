# Lemonade + Atlas: Unified Product Strategy

## The One-Liner

**Lemonade Spaces become agent-discoverable event platforms — powered by Atlas Protocol, funded by USDC rewards, and connected to every event source via the existing connector framework.**

---

## What Already Exists

Lemonade Spaces are already white-label event platforms:

| Capability | Status | Where |
|---|---|---|
| Own branding + custom domain | Built | Space model, page configs |
| Own Stripe account (payouts) | Built | Space.payment_accounts, Stripe connected accounts |
| Event creation + management | Built | Event model, 100+ GraphQL resolvers |
| Multi-tier ticketing | Built | EventTicketType, pricing, holds, limits |
| Crypto payments | Built | Ethereum, Solana, escrow, relay, stake |
| Subscription tiers (Free/Pro/Plus/Max/Enterprise) | Built | SubscriptionRecord, SubscriptionItem |
| Member management | Built | Space members, roles, followers |
| Data connectors (Google Sheets, Airtable) | Built | ConnectorPlugin system, OAuth+PKCE, action executor |
| AI agents + MCP server | Built | lemonade-ai, tool system, credit billing |
| x402 payment middleware | Built | a2a.ts, paymentMiddleware, facilitatorClient |

**What's missing:** Event source connectors (Eventbrite/Lu.ma/Meetup), MPP 402 endpoints, Atlas discovery protocol, USDC rewards.

---

## The Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    LEMONADE SPACE                        │
│              (a community event platform)                │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │            CONNECTOR FRAMEWORK                   │    │
│  │  (existing plugin system — ConnectorPlugin)      │    │
│  │                                                  │    │
│  │  EXISTING        NEW (same interface)            │    │
│  │  ├── Google Sheets  ├── Eventbrite               │    │
│  │  └── Airtable       ├── Lu.ma                    │    │
│  │                     ├── Meetup                    │    │
│  │                     ├── Dice                      │    │
│  │                     └── Any platform with API     │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐     │
│  │  Events  │  │ Tickets  │  │ Payments           │     │
│  │ (native +│  │ (Lemonade│  │ ├── Stripe (own)   │     │
│  │  synced) │  │  engine) │  │ ├── Tempo USDC     │     │
│  └──────────┘  └──────────┘  │ └── Crypto (ETH..) │     │
│                              └───────────────────┘     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              ATLAS PROTOCOL LAYER                │    │
│  │  ├── /.well-known/atlas.json (auto-generated)   │    │
│  │  ├── /atlas/v1/search (events from all sources)  │    │
│  │  ├── /atlas/v1/events/:id/tickets               │    │
│  │  ├── /atlas/v1/events/:id/purchase (MPP 402)    │    │
│  │  └── /atlas/v1/receipts/:id (Verifiable Cred)   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              AGENT ACCESS                        │    │
│  │  ├── MCP tools (existing)                        │    │
│  │  ├── MPP 402 payment (new)                       │    │
│  │  └── Atlas discovery (new)                       │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Own branding │ Own domain │ Own Stripe │ Own fees       │
└─────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
   Atlas Registry                  AI Agents
   (federated search              (Claude, GPT,
    across all Spaces)             Gemini, custom)
```

---

## How It Works: Three User Journeys

### Journey 1: Organizer (B2C — growth engine)

1. Organizer creates a Lemonade account (or already has one)
2. Joins or creates a Space (community)
3. Goes to Space Settings → Connectors
4. Clicks "Connect Eventbrite" (same UI pattern as Google Sheets/Airtable)
5. OAuth into Eventbrite → events sync into the Space
6. Events are now:
   - Visible on the Space's branded page
   - Discoverable by AI agents via Atlas
   - Purchasable via MPP 402 (Atlas Direct Ticketing)
7. Organizer earns USDC rewards per ticket sold via Atlas
8. Organizer sees agent-driven traffic in Space dashboard

**Key insight:** The organizer doesn't know or care about "Atlas Protocol." They connected their Eventbrite account to their Lemonade Space. Atlas works behind the scenes.

### Journey 2: Community Leader (platform builder — ecosystem engine)

1. Community leader creates a Lemonade Space (e.g., "Berlin Techno Collective")
2. Configures: custom domain, branding, Stripe account for payouts
3. Connects Eventbrite + Resident Advisor via connectors
4. Events from all connected sources appear on their branded site
5. They also create native events directly on Lemonade
6. Their Space IS "Berlin Techno Collective" — a full event platform
7. All events are Atlas-discoverable — agents drive ticket sales
8. Space owner earns from:
   - Subscription tier (Pro/Plus/Max for advanced features)
   - Ticket sales (own Stripe account)
   - USDC rewards from Atlas protocol
   - Optional fee markup on Atlas Direct Ticketing

**Key insight:** This is the "build a niche event platform" pitch, but it's just "create a Space and connect your sources." No code needed.

### Journey 3: AI Agent (demand side)

1. Agent (Claude/GPT/Gemini) receives: "Find me a techno event in Berlin this Saturday"
2. Agent queries Atlas Registry (federated search across all Spaces)
3. Gets results from:
   - Berlin Techno Collective Space (synced from Eventbrite + native)
   - Another Space that synced from Resident Advisor
   - Lemonade-native events
4. Agent presents options with transparent pricing
5. User picks one → agent purchases via MPP 402
6. Payment settles in USDC on Tempo (sub-cent fees)
7. Agent receives Verifiable Credential ticket
8. Organizer gets paid, earns USDC reward, sees sale in dashboard

---

## Implementation: What to Build (in order)

### Phase 1: Event Source Connectors (Week 1-2)

**What:** Add Eventbrite, Lu.ma, Meetup as connector plugins in the existing framework.

**How:** Same architecture as Google Sheets/Airtable. Each connector implements `ConnectorPlugin`:

```typescript
// src/connectors/eventbrite/index.ts
const EventbriteConnector: ConnectorPlugin = {
  manifest: {
    id: 'eventbrite',
    name: 'Eventbrite',
    category: 'events',
    authType: 'oauth2',
    oauthConfig: {
      authorizationUrl: 'https://www.eventbrite.com/oauth/authorize',
      tokenUrl: 'https://www.eventbrite.com/oauth/token',
      scopes: [],
      pkce: false,
    },
    capabilities: ['canImport', 'canSync'],
    configSchema: [],
  },
  actions: [
    {
      id: 'sync-events',
      name: 'Sync Events',
      triggerTypes: ['manual', 'scheduled', 'ai'],
    },
    {
      id: 'sync-attendees',
      name: 'Sync Attendees',
      triggerTypes: ['manual', 'scheduled'],
    },
  ],
  // ... OAuth methods, executeAction, etc.
};
```

**New actions (vs existing guest import/export):**
- `sync-events`: Import events from platform → create as Lemonade events in the Space
- `sync-attendees`: Import RSVPs/ticket holders → create as EventJoinRequests
- `sync-ticket-types`: Import ticket tiers → create as EventTicketTypes
- `push-updates`: Sync changes back to source platform (where API allows)

**New models needed:**
- `ExternalEventMapping`: Maps external event ID → Lemonade event ID per connector
- `SyncState` already exists for cursor/pagination tracking

**Frontend:** Identical UI — ConnectorCard, ConnectorDetail, action modals. Just new icons in CONNECTOR_ICON_MAP.

**Effort:** 2-3 days per connector (agent-built). The plugin architecture handles all the boilerplate.

### Phase 2: Atlas Protocol Layer (Week 2-3)

**What:** Add Atlas REST endpoints to lemonade-backend. Every Space automatically gets Atlas-compliant endpoints.

**How:** New Koa router that wraps existing resolvers:

```
GET  /.well-known/atlas.json        → Auto-generated from Space config
GET  /atlas/v1/search               → Wraps aiSearchEvents
GET  /atlas/v1/events/:id           → Wraps aiGetEvent
GET  /atlas/v1/events/:id/tickets   → Wraps aiListEventTicketTypes
POST /atlas/v1/events/:id/purchase  → Wraps aiBuyTickets + MPP 402
GET  /atlas/v1/receipts/:txn_id     → New receipt lookup
GET  /atlas/v1/tickets/:id/verify   → New credential verification
```

**MPP integration:** Use `mppx` middleware on purchase endpoint. Builds on existing x402 infrastructure in lemonade-ai.

**Verifiable Credentials:** Issue W3C VCs for tickets. DID:web based on Space's custom domain.

**Effort:** 3-4 days (agent-built). Most logic already exists in ai-tool resolvers.

### Phase 3: Atlas Registry (Week 3-4)

**What:** Federated search service that aggregates events across all Spaces.

**How:** Lightweight Fastify service (or new endpoints on existing backend):
- Indexes all Atlas-compliant Spaces
- Federated search fans out to Space endpoints
- Caches results, ranks by relevance
- Exposes MCP tools for agent integration

**Effort:** 3-4 days (agent-built).

### Phase 4: USDC Rewards (Week 3-4, parallel with Phase 3)

**What:** Tempo stablecoin integration + reward distribution.

**How:**
- Add Tempo as payment provider (extends existing chain config)
- 2% protocol fee on Atlas transactions
- USDC cashback to organizers and attendees
- Reward tracking in Space dashboard

**Effort:** 3-4 days (agent-built). Builds on existing payment infrastructure.

### Phase 5: Scaling Connectors (Week 5+)

**What:** Add more event source connectors based on demand.

**Priority order:**
1. Eventbrite (largest, most organizers)
2. Lu.ma (AI/tech community, high-value events)
3. Meetup (massive recurring event inventory)
4. Dice / Resident Advisor (music/nightlife niche)
5. Generic webhook connector (any platform with webhooks)
6. Generic API connector (configurable REST/GraphQL adapter)

---

## Revenue Model

### Existing Revenue (unchanged)
- Space subscription tiers (Free/Pro/Plus/Max/Enterprise)
- Ticket sales via Stripe (platform fee)
- AI credits (per-query billing)

### New Revenue from Atlas
| Source | How | Amount |
|---|---|---|
| Protocol fee | 2% on all Atlas MPP transactions | Scales with GMV |
| Connector premium | Advanced connectors on higher subscription tiers | Subscription upgrade driver |
| Agent API access | MPP-gated API calls from external agents | Per-request micropayments |
| Registry referral | Cross-Space discovery referral fee | 2% on cross-Space sales |

### Fee Flow for a $25 Ticket Sold via Atlas

```
Attendee pays: $25.00 USDC on Tempo
  Tempo network fee:     -$0.001  (sub-cent)
  Atlas protocol fee:    -$0.50   (2%)
    → Treasury:           $0.20   (40% of protocol fee)
    → Organizer cashback: $0.15   (30% of protocol fee)
    → Attendee cashback:  $0.10   (20% of protocol fee)
    → Referral pool:      $0.05   (10% of protocol fee)
  Space owner keeps:     $24.50   (via their Stripe or Tempo wallet)

Compare Eventbrite:
  Attendee pays: $25.00
  Eventbrite fee: -$2.73  (6.95% + $0.99 + payment processing)
  Organizer keeps: $22.27

Atlas saves the organizer $2.23 per ticket (8.9% more revenue).
```

---

## Subscription Tier Integration

Connectors fit naturally into the existing subscription model:

| Feature | Free | Pro | Plus | Max | Enterprise |
|---|---|---|---|---|---|
| Native events | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited |
| Google Sheets connector | 1 | 1 | 1 | 1 | Unlimited |
| Airtable connector | - | 1 | 1 | 1 | Unlimited |
| Eventbrite connector | - | 1 | 1 | 1 | Unlimited |
| Lu.ma connector | - | - | 1 | 1 | Unlimited |
| Meetup connector | - | - | 1 | 1 | Unlimited |
| Total connectors | 1 | 2 | 4 | 6 | Unlimited |
| Atlas Direct Ticketing | - | Yes | Yes | Yes | Yes |
| USDC rewards | - | Yes | Yes | Yes | Yes |
| Custom fee markup | - | - | Yes | Yes | Yes |
| Atlas analytics | Basic | Basic | Advanced | Advanced | Custom |

This drives subscription upgrades: "Want to connect your Eventbrite AND get USDC rewards? Upgrade to Pro."

---

## Branding

- **Product:** Lemonade Spaces (with connectors + Atlas)
- **Protocol:** Atlas Protocol (the open spec that makes Spaces agent-discoverable)
- **Positioning:** "Lemonade is a founding contributor to Atlas" — not "Atlas is a Lemonade product"
- **When to separate:** If/when existing platforms (Eventbrite, Lu.ma) want to integrate, spin Atlas out as neutral brand. Until then, it's a Lemonade feature.
- **Tokens:** None at launch. Future: ATC (Atlas Credits) at $100K GMV, $ATLAS governance at $1M GMV.

---

## What This Replaces

The organizer-first + Spaces model simplifies the original 10-workstream Atlas repo:

| Original Atlas Workstream | Now becomes |
|---|---|
| 01-whitepaper | Still relevant — protocol spec for agent interoperability |
| 02-protocol-core | Still relevant — schemas, purchase flow, discovery |
| 03-organizer-layer | **= Space connector framework** (already built, extend it) |
| 04-platform-layer | **= Lemonade Spaces** (already built, add Atlas endpoints) |
| 05-platform-builder | **= Create a Space** (already built, no new product needed) |
| 06-agent-layer | Still relevant — MCP tools, client SDK |
| 07-economics | Simplified — USDC only, protocol fee on Atlas transactions |
| 08-marketing | Refocused — organizer acquisition, Space creation |
| 09-governance | Deferred — Lemonade controls until scale justifies separation |
| 10-competitive-intel | Still relevant — market positioning |

---

## Timeline (Agent-Built)

| Week | What | Outcome |
|---|---|---|
| 1 | Eventbrite connector plugin | Spaces can sync Eventbrite events |
| 1-2 | Lu.ma + Meetup connector plugins | Three major platforms connected |
| 2-3 | Atlas REST endpoints on backend | Every Space is Atlas-compliant |
| 2-3 | MPP 402 integration (builds on x402) | Agents can purchase tickets |
| 3-4 | Atlas Registry service | Federated search across all Spaces |
| 3-4 | Tempo USDC integration | Sub-cent payment fees + rewards |
| 4-5 | USDC reward distribution | Organizer + attendee cashback |
| 5-6 | Dashboard updates | Agent traffic, rewards, Atlas analytics |
| 6+ | More connectors (Dice, RA, generic) | Expanding event sources |

**Total: ~6 weeks from start to full Atlas-powered Lemonade Spaces.**

---

## The Flywheel

```
Organizer connects Eventbrite to their Space (free, 30 seconds)
  → Space has more events
  → Atlas Registry indexes them
  → Agents find better results
  → Agents drive ticket sales
  → Organizer earns USDC rewards
  → Organizer connects more platforms / creates native events
  → Organizer invites other organizers (referral bonus)
  → More Spaces, more events, more agents, more sales...

Meanwhile:
  Community leaders create Spaces as niche platforms
  → Berlin Techno, Yoga NYC, Corporate Events London
  → Each Space connects multiple event sources
  → Each Space is a node in the Atlas network
  → Network effects compound across Spaces
```

---

## Key Decisions Made

1. **Lemonade-branded** (not separate Atlas brand) — until platform integration demands neutrality
2. **USDC only** (no custom token at launch) — tokens when adoption justifies it
3. **Spaces = platform builder** — no separate product needed
4. **Existing connector framework** — extend, don't rebuild
5. **Organizer-first** — bottom-up growth, not top-down platform partnerships
6. **Protocol spec stays open** — Atlas Protocol is the interoperability layer, Lemonade is the implementation
