# Atlas Organizer Experience (B2C Layer)

> The growth engine of Atlas. Organizers connect their existing platform accounts, events become agent-discoverable, and they earn USDC rewards on every ticket sold through Atlas.

## Table of Contents

1. [Onboarding Flow](#1-onboarding-flow)
2. [Platform Connectors](#2-platform-connectors)
3. [Atlas Direct Ticketing](#3-atlas-direct-ticketing)
4. [Organizer Dashboard](#4-organizer-dashboard)
5. [Reward Mechanics](#5-reward-mechanics)
6. [Migration Path: Platform to Atlas Direct](#6-migration-path-platform-to-atlas-direct)
7. [Trust and Verification](#7-trust-and-verification)

---

## 1. Onboarding Flow

The onboarding is designed for zero friction. An organizer goes from sign-up to agent-discoverable events in under two minutes.

### Step-by-Step Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                    atlas.events — Sign Up                       │
│                                                                 │
│   ┌──────────────┐    ┌──────────────────┐                      │
│   │  Email/Pass  │ OR │  Connect Wallet  │                      │
│   └──────┬───────┘    └────────┬─────────┘                      │
│          └──────────┬──────────┘                                 │
│                     ▼                                            │
│          ┌─────────────────────┐                                 │
│          │  Organizer Profile  │                                 │
│          │  - Display name     │                                 │
│          │  - Avatar (opt.)    │                                 │
│          │  - Payout wallet    │                                 │
│          └─────────┬───────────┘                                 │
│                    ▼                                             │
│   ┌────────────────────────────────────────────────────────┐    │
│   │         "Connect your event platforms"                  │    │
│   │                                                         │    │
│   │  ┌────────────┐ ┌────────┐ ┌────────┐ ┌────────────┐  │    │
│   │  │ Eventbrite │ │ Lu.ma  │ │ Meetup │ │ + Manual   │  │    │
│   │  │  Connect   │ │Connect │ │Connect │ │  Create    │  │    │
│   │  └─────┬──────┘ └───┬────┘ └───┬────┘ └─────┬──────┘  │    │
│   │        │             │          │             │          │    │
│   │        ▼             ▼          ▼             ▼          │    │
│   │      OAuth         OAuth      OAuth      Event Form     │    │
│   │      Flow          Flow       Flow                      │    │
│   └────────────────────────────────────────────────────────┘    │
│                    ▼                                             │
│   ┌────────────────────────────────────────────────────────┐    │
│   │              Automatic Event Import                     │    │
│   │  - All events pulled from connected platforms           │    │
│   │  - Normalized to Atlas Event Schema                     │    │
│   │  - Registered in Atlas Discovery Registry               │    │
│   │  - Agent-discoverable IMMEDIATELY                       │    │
│   └────────────────────────────────────────────────────────┘    │
│                    ▼                                             │
│   ┌────────────────────────────────────────────────────────┐    │
│   │              Organizer Dashboard                        │    │
│   │  - Events synced from all platforms                     │    │
│   │  - Real-time Atlas traffic + sales                      │    │
│   │  - USDC reward balance                                  │    │
│   └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Authentication Options

| Method | Flow | Wallet Created? |
|--------|------|-----------------|
| Email + password | Kratos identity creation, email verification | Auto-created (Tempo custodial) for USDC rewards |
| Wallet connect | Sign message to prove ownership, Kratos identity linked | User's existing wallet used for rewards |
| Social login (Google) | OAuth via Hydra, Kratos identity linked | Auto-created (Tempo custodial) |

### Post-Signup Prompt Sequence

1. **"Connect a platform"** -- Primary CTA. At least one connection unlocks the dashboard.
2. **"Set your payout wallet"** -- Required before receiving USDC rewards. Can be deferred; auto-created custodial wallet used in the meantime.
3. **"Invite another organizer"** -- Secondary CTA. Earns referral bonus on their first ticket sale via Atlas.

---

## 2. Platform Connectors

Atlas uses a standardized connector pattern. Each platform adapter implements the same interface, normalizing disparate APIs into the Atlas Event Schema.

### Supported Platforms

#### Eventbrite (Full Integration)

**Status:** Production-ready. Lemonade already has a working Eventbrite OAuth integration (see `lemonade-backend/src/app/services/eventbrite.ts` and `lemonade-backend/src/app/services/oauth2.ts`).

| Capability | Supported | Notes |
|------------|-----------|-------|
| OAuth 2.0 authorization | Yes | Scopes: `eventbrite.organizer`, `eventbrite.event_read`, `webhook_manage` |
| Import events | Yes | Via `/organizations/{org_id}/events/` -- paginated, supports status filter |
| Import ticket types | Yes | Via `/events/{id}/ticket_classes/` -- maps to Atlas ticket types |
| Import pricing | Yes | `cost.value` + `fee.value`, currency from `cost.currency` |
| Sync attendance | Yes | Via order webhooks (`order.placed`) and attendee API |
| Real-time webhooks | Yes | `order.placed`, `order.refunded`, `ticket_class.created/updated/deleted` |
| Purchase tickets | No | Eventbrite does not expose a purchase API; buyers go to Eventbrite |

**OAuth Flow:**
```
1. Organizer clicks "Connect Eventbrite"
2. Redirect → https://www.eventbrite.com/oauth/authorize
   ?client_id={ATLAS_EB_CLIENT_ID}
   &redirect_uri={ATLAS_CALLBACK_URL}
   &response_type=code
   &scope=eventbrite.organizer eventbrite.event_read webhook_manage
3. Organizer authorizes on Eventbrite
4. Callback → Atlas receives auth code
5. Exchange code → access_token (no expiry on Eventbrite tokens)
6. Fetch /users/me/organizations/ → get org_id
7. Fetch /organizations/{org_id}/events/ → import all events
8. Register webhooks for each imported event
```

**Field Mapping (Eventbrite to Atlas):**

| Eventbrite Field | Atlas Event Schema Field |
|-----------------|-------------------------|
| `name.text` | `title` |
| `description.text` | `description` |
| `start.utc` | `start_datetime` |
| `end.utc` | `end_datetime` |
| `logo.url` | `cover_image_url` |
| `status` (`live`/`draft`/`canceled`/`started`/`ended`) | `status` (mapped to Atlas enum) |
| `venue.address` | `location` |
| `id` | `external_ids.eventbrite` |
| `ticket_classes[].name` | `ticket_types[].title` |
| `ticket_classes[].cost.value + fee.value` | `ticket_types[].price_cents` |
| `ticket_classes[].maximum_quantity` | `ticket_types[].capacity` |

**Rate Limits:** Eventbrite API allows 2,000 requests/hour per OAuth token. Atlas implements token-bucket rate limiting per connector instance.

#### Lu.ma (Limited Integration)

**Status:** Partial. Lu.ma has a limited public API. No official OAuth flow; authentication is via API key (organizer provides it manually) or session-based.

| Capability | Supported | Notes |
|------------|-----------|-------|
| Authorization | Partial | API key (manual entry) -- no official OAuth |
| Import events | Yes | Via `/api/public/v1/calendar/list-events` |
| Import ticket types | Limited | Lu.ma events often have simple free/paid tiers |
| Import pricing | Limited | Price available for paid events |
| Sync attendance | No | No attendance export API |
| Real-time webhooks | No | Polling required (every 15 min) |
| Purchase tickets | No | No purchase API; buyers go to Lu.ma |

**Integration Notes:**
- Lu.ma's API is not publicly documented. Atlas uses the public calendar API endpoints.
- If Lu.ma launches an official partner API / OAuth, Atlas upgrades to it.
- For now, organizers paste their Lu.ma API key or calendar URL, and Atlas polls for events.

**Field Mapping (Lu.ma to Atlas):**

| Lu.ma Field | Atlas Event Schema Field |
|-------------|-------------------------|
| `name` | `title` |
| `description` | `description` |
| `start_at` | `start_datetime` |
| `end_at` | `end_datetime` |
| `cover_url` | `cover_image_url` |
| `url` | `external_url` |
| `geo_address_json.full_address` | `location` |
| `api_id` | `external_ids.luma` |

#### Meetup (Full Integration)

**Status:** Available. Meetup has a GraphQL API with OAuth 2.0.

| Capability | Supported | Notes |
|------------|-----------|-------|
| OAuth 2.0 authorization | Yes | Scopes: `ageless`, `event_management` |
| Import events | Yes | Via GraphQL `groupByUrlname` + `upcomingEvents` |
| Import RSVPs | Yes | Via GraphQL `event.rsvps` |
| Import ticket types | Limited | Meetup events rarely have multiple ticket tiers |
| Real-time webhooks | No | Polling required (every 15 min) |
| Purchase tickets | No | Buyers RSVP/pay on Meetup |

**OAuth Flow:**
```
1. Organizer clicks "Connect Meetup"
2. Redirect → https://secure.meetup.com/oauth2/authorize
   ?client_id={ATLAS_MEETUP_CLIENT_ID}
   &redirect_uri={ATLAS_CALLBACK_URL}
   &response_type=code
   &scope=ageless+event_management
3. Organizer authorizes on Meetup
4. Callback → Atlas receives auth code
5. Exchange code → access_token + refresh_token
6. GraphQL query → import all upcoming events for organizer's groups
```

**Meetup GraphQL Query:**
```graphql
query GetOrganizerEvents($urlname: String!) {
  groupByUrlname(urlname: $urlname) {
    id
    name
    upcomingEvents(input: { first: 50 }) {
      edges {
        node {
          id
          title
          description
          dateTime
          endTime
          eventUrl
          venue {
            name
            address
            city
            state
            country
          }
          rsvpSettings {
            rsvpLimit
          }
          going
          imageUrl
        }
      }
    }
  }
}
```

#### Manual Event Creation (Atlas Direct)

Organizers who do not use any external platform can create events directly on Atlas. This uses Atlas Direct Ticketing (Section 3) from the start.

| Field | Required | Notes |
|-------|----------|-------|
| Title | Yes | |
| Description | No | Markdown supported |
| Start / End datetime | Yes | Timezone-aware |
| Location | No | Address or "Online" + meeting link |
| Cover image | No | Upload or URL |
| Ticket types | Yes (at least one) | Free or paid, with price and capacity |

---

## 3. Atlas Direct Ticketing

When organizers want lower fees, USDC settlement, and full MPP 402 support for agent purchases, they can use Atlas Direct Ticketing. Under the hood, this is powered by Lemonade's ticketing infrastructure, white-labeled under the Atlas brand.

### Why Direct?

| | Platform (e.g., Eventbrite) | Atlas Direct |
|---|---|---|
| **Platform fee** | 6.95% + $0.99/ticket | 0% platform fee |
| **Atlas protocol fee** | 2% | 2% |
| **Total fee** | ~9% | 2% |
| **Agent purchase (MPP 402)** | Not supported (redirect to platform) | Full support -- agents buy directly |
| **Settlement** | Platform's schedule (weekly ACH) | USDC to wallet (near-instant via Tempo) |
| **Settlement currency** | USD (bank transfer) | USDC (or fiat via Stripe SPT) |
| **USDC cashback rewards** | No | Yes |

### Architecture

```
                            ┌─────────────────┐
                            │   Organizer      │
                            │   Dashboard      │
                            └────────┬─────────┘
                                     │ "Enable Direct Ticketing"
                                     ▼
                    ┌────────────────────────────────┐
                    │   Atlas Direct Ticketing API    │
                    │   (Atlas-branded, public API)   │
                    └────────┬───────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │  Lemonade Ticketing Engine    │
              │                              │
              │  - EventModel                │
              │  - EventTicketTypeModel       │
              │  - TicketModel               │
              │  - PaymentModel              │
              │  - Check-in infrastructure   │
              └──────────┬───────────────────┘
                         │
            ┌────────────┼────────────────┐
            ▼            ▼                ▼
     ┌───────────┐ ┌──────────┐  ┌──────────────┐
     │ USDC on   │ │ Stripe   │  │ MPP 402      │
     │ Tempo     │ │ SPT      │  │ Agent        │
     │ (crypto)  │ │ (fiat)   │  │ Purchases    │
     └───────────┘ └──────────┘  └──────────────┘
```

### Ticket Type Configuration

When an organizer enables Direct Ticketing, Atlas creates Lemonade-backed ticket types:

```typescript
// Atlas Direct Ticketing — ticket type creation
// Maps to EventTicketType in lemonade-backend/src/app/models/event-ticket-type.ts

interface AtlasDirectTicketType {
  title: string;              // e.g., "General Admission", "VIP"
  description?: string;       // Markdown description
  price: {
    amount_cents: number;     // Price in cents (0 for free)
    currency: string;         // "USD" — Atlas normalizes to USD
  };
  capacity?: number;          // null = unlimited (maps to ticket_limit)
  per_person_limit?: number;  // Max per buyer (maps to ticket_limit_per)
  visibility: 'public' | 'private' | 'limited';
  sale_start?: string;        // ISO 8601
  sale_end?: string;          // ISO 8601
}
```

**Lemonade Model Mapping:**

| Atlas Direct Field | Lemonade EventTicketType Field | Notes |
|---|---|---|
| `title` | `title` | Direct mapping |
| `description` | `description` | Direct mapping |
| `price.amount_cents` | `prices[0].cost` | Stored as string in Lemonade |
| `price.currency` | `prices[0].currency` | Default: "USD" |
| `capacity` | `ticket_limit` | null = unlimited |
| `per_person_limit` | `ticket_limit_per` | Default: 10 |
| `visibility: 'private'` | `private: true` | Host/cohost only |
| `visibility: 'limited'` | `limited: true` + `limited_whitelist_emails` | Allowlist |

### Payment Flows

**1. USDC Payment (Agent or Crypto-Native Buyer)**
```
Agent/Buyer → MPP 402 price request → Atlas returns price in USDC
           → USDC transfer on Tempo → Settlement to organizer wallet
           → Atlas protocol fee: 2% retained
           → Ticket issued → Confirmation via Atlas API
```

**2. Fiat Payment (Card/Apple Pay/Google Pay)**
```
Buyer → Atlas checkout → Stripe Payment Element (SPT)
     → Card charge in USD → Stripe settles to Atlas
     → Atlas converts to USDC on Tempo → Sends to organizer wallet
     → Atlas protocol fee: 2% retained
     → Ticket issued → Confirmation via Atlas API
```

**3. MPP 402 Agent Purchase (Fully Automated)**
```
Agent → GET /atlas/events/{id}/tickets → 402 Payment Required
     → Response includes: price (USDC), Tempo payment address, ticket_type_id
     → Agent transfers USDC on Tempo
     → Atlas detects payment (Tempo webhook / polling)
     → Ticket issued to agent's user → 200 OK + ticket details
```

### Check-In

Atlas Direct events use Lemonade's check-in infrastructure:
- QR code on ticket (generated at purchase)
- Organizer scans via Atlas mobile app or web dashboard
- Real-time attendance tracking synced to dashboard
- Maps to `EventCheckinModel` in Lemonade backend

---

## 4. Organizer Dashboard

The dashboard is the organizer's home base. It aggregates data across all connected platforms and Atlas Direct events.

### Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ATLAS ORGANIZER DASHBOARD                    [Settings] [Help] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  SUMMARY BAR                                             │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │    │
│  │  │ 12       │ │ 3,420    │ │ 847      │ │ $1,240   │   │    │
│  │  │ Events   │ │ Agent    │ │ Tickets  │ │ USDC     │   │    │
│  │  │          │ │ Views    │ │ Sold     │ │ Earned   │   │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─── TABS ────────────────────────────────────────────────┐    │
│  │ [Events] [Traffic] [Sales] [Rewards] [Settings]          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                 │
│  EVENTS TAB:                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Filter: [All Platforms ▼] [Upcoming ▼] [Search...]       │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ┌─EB─┐ Tech Meetup NYC          Mar 25  │  142 views    │   │
│  │ │ EB │ Eventbrite · Synced 2m ago│       │   38 tickets  │   │
│  │ └────┘                           │       │  [Upgrade →]  │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ┌─AT─┐ Web3 Builder Night       Apr 02  │  89 views     │   │
│  │ │ AT │ Atlas Direct · Live       │       │  22 tickets   │   │
│  │ └────┘                           │       │  [Manage →]   │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ┌─LU─┐ Design Drinks            Apr 10  │  34 views     │   │
│  │ │ LU │ Lu.ma · Synced 15m ago   │       │  (no sales    │   │
│  │ └────┘                           │       │   tracking)   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Tab Details

#### Events Tab
- **All events** from all connected platforms + Atlas Direct, unified view
- **Source badge** showing origin (Eventbrite, Lu.ma, Meetup, Atlas Direct)
- **Sync status** with last-synced timestamp per platform
- **Quick actions**: "Upgrade to Direct" (for platform events), "Manage" (for Direct events), "View on Platform" (external link)
- **Filters**: Platform, date range, status (upcoming/past/draft), search by title

#### Traffic Tab
- **Agent discovery count**: How many AI agents found this organizer's events via Atlas search
- **Agent breakdown**: Which agents (ChatGPT, Claude, Gemini, custom) drove views
- **Trend chart**: Views over time (7d, 30d, 90d)
- **Per-event breakdown**: Which events are getting the most agent attention
- **Discovery ranking**: Organizer's position in Atlas search for their event categories

#### Sales Tab
- **Tickets sold via Atlas**: Broken down by event, ticket type, and payment method
- **Revenue**: Total, per event, per period
- **Payment method split**: USDC vs Stripe (fiat) vs MPP 402 (agent)
- **Agent attribution**: Which agent drove each sale (via referral tracking in MPP headers)
- **Comparison**: Atlas-driven sales vs platform-native sales (for connected events)

#### Rewards Tab
- **USDC balance**: Total earned, available for withdrawal, pending
- **Reward breakdown**:
  - Cashback rewards (per ticket sold)
  - Referral bonuses (organizer-invites-organizer)
  - Discovery boost bonus (connect more events = bonus USDC)
- **Transaction history**: Every USDC credit/debit with timestamp and reason
- **Withdraw**: Send USDC to external wallet (one-click if payout wallet configured)

#### Settings Tab
- **Connected accounts**: View/disconnect Eventbrite, Lu.ma, Meetup; re-authorize if token expired
- **Payout wallet**: Set/change USDC payout address (Tempo wallet, or any USDC-compatible address)
- **Notification preferences**: Email alerts for ticket sales, sync errors, reward credits
- **Profile**: Display name, avatar, organizer bio (shown on Atlas event pages)
- **API access**: Atlas API key for programmatic event management (advanced)

---

## 5. Reward Mechanics

Rewards are the viral growth mechanism. Every organizer action that adds value to the Atlas network earns USDC.

### Reward Types

#### 5.1 Ticket Sale Cashback

For every ticket sold through Atlas (via agent discovery or direct Atlas link):

| Ticket Price | Cashback to Organizer | Source |
|---|---|---|
| Free ticket (RSVP) | $0.00 | No transaction = no fee = no cashback |
| $0.01 -- $25.00 | 0.5% of ticket price | From Atlas 2% protocol fee |
| $25.01 -- $100.00 | 0.75% of ticket price | From Atlas 2% protocol fee |
| $100.01+ | 1.0% of ticket price | From Atlas 2% protocol fee |

**Example:** $50 ticket sold via Atlas. Protocol fee = $1.00 (2%). Organizer cashback = $0.375 (0.75%). Atlas retains $0.625.

Cashback is credited to the organizer's USDC balance instantly upon confirmed payment.

#### 5.2 Referral Bonus

When an organizer invites another organizer to Atlas:

```
Organizer A invites Organizer B (via referral link)
  → Organizer B signs up and connects at least one platform
  → Organizer B's first 100 tickets sold via Atlas:
      → Organizer A earns 0.25% of each ticket price as referral bonus
  → After 100 tickets: referral bonus ends (prevents gaming)
```

**Cap:** Maximum $500 USDC referral bonus per referred organizer. Prevents abuse while still incentivizing high-value referrals.

#### 5.3 Discovery Boost

Organizers who add more inventory to Atlas get higher placement in search results:

| Connected Events | Boost Level | Effect |
|---|---|---|
| 1-5 events | Standard | Default ranking |
| 6-20 events | Silver | 1.2x ranking weight |
| 21-50 events | Gold | 1.5x ranking weight |
| 51+ events | Platinum | 2.0x ranking weight + featured in "Top Organizers" |

Additionally, Atlas Direct events get a 1.3x ranking boost over platform-synced events (incentivizes migration).

#### 5.4 Anti-Gaming Protections

- **Self-purchase detection**: Organizer buying their own tickets does not earn cashback
- **Minimum ticket price**: Cashback only on tickets >= $1.00 (prevents penny-ticket farming)
- **Referral cooldown**: Max 10 referrals per organizer per month
- **Velocity checks**: Abnormal sale patterns flagged for manual review
- **Wallet clustering**: Multiple organizer accounts with same payout wallet = flagged

---

## 6. Migration Path: Platform to Atlas Direct

The migration is designed to be gradual, risk-free, and data-driven. Organizers never have to go all-or-nothing.

### Stage 1: Connect (Zero Risk)

```
Organizer connects Eventbrite/Lu.ma/Meetup
  → Events synced to Atlas
  → Events discoverable by agents
  → Organizer sees Atlas traffic data
  → Ticket purchases still happen on the platform
  → Organizer changes NOTHING about their existing setup
```

**Value prop:** "See how many AI agents are discovering your events. No changes required."

### Stage 2: Observe (Data-Driven)

```
After 2-4 weeks, organizer sees:
  → "247 agents discovered your events this month"
  → "Your events appeared in 1,340 agent search results"
  → "Estimated 89 ticket purchases were driven by Atlas discovery
     (but completed on Eventbrite — you paid 6.95% + $0.99 each)"
  → "If these were Atlas Direct: you'd have saved $312 in platform fees"
```

**Value prop:** "You're already getting Atlas traffic. Here's how much you'd save."

### Stage 3: Upgrade Specific Events

```
Organizer picks ONE upcoming event → clicks "Upgrade to Atlas Direct"
  → Atlas creates a parallel Direct Ticketing setup for this event
  → Agent purchases now complete on Atlas (MPP 402, lower fees)
  → Platform listing stays active (organizer can keep both live)
  → Dashboard shows side-by-side: platform sales vs Atlas Direct sales
```

**Value prop:** "Try it on one event. Keep your platform listing as a safety net."

### Stage 4: Gradual Migration

```
Organizer sees Atlas Direct results for the test event:
  → Lower fees (2% vs ~9%)
  → Faster settlement (USDC instant vs weekly ACH)
  → USDC cashback rewards
  → Agent purchases that wouldn't have happened on the platform

Organizer upgrades more events → eventually all new events are Atlas Direct
Platform connections kept active for legacy events and historical data
```

### Stage 5: Full Atlas Direct (Optional)

```
Organizer creates all new events directly on Atlas
  → Uses Atlas event creation form or API
  → Full control over ticketing, pricing, check-in
  → Platform accounts remain connected for historical sync
  → or disconnected entirely — organizer's choice
```

**Key principle:** Atlas never forces migration. The economic incentives (lower fees, USDC rewards, agent purchases) drive organic migration.

---

## 7. Trust and Verification

### Event Ownership Proof

Atlas must verify that an organizer actually owns the events they're connecting.

```
┌──────────────────────────────────────────────────┐
│                OWNERSHIP CHAIN                    │
│                                                   │
│  Organizer authenticates on Atlas                 │
│       │                                           │
│       ▼                                           │
│  OAuth into Eventbrite/Lu.ma/Meetup               │
│       │                                           │
│       ▼                                           │
│  Platform confirms: "This OAuth token belongs     │
│  to account X, which owns events [A, B, C]"      │
│       │                                           │
│       ▼                                           │
│  Atlas records: Organizer → Platform Account      │
│                  Platform Account → Events         │
│                  Therefore: Organizer → Events     │
└──────────────────────────────────────────────────┘
```

### Edge Cases

| Scenario | Handling |
|----------|----------|
| **Co-hosted event** | Both co-hosts can connect the event. Atlas shows "co-hosted by" on discovery. Rewards split configurable by primary host. |
| **Transferred event** | New owner re-authorizes OAuth. Atlas updates ownership. Old owner loses access. |
| **Duplicate event** (same event on Eventbrite + Lu.ma) | Atlas deduplicates by title + date + location similarity (>90% match). Organizer confirms merge. Primary source selected for ticketing data. |
| **Deleted platform account** | Atlas marks synced events as "orphaned." Organizer can claim them as Atlas Direct or they expire after 30 days. |
| **OAuth token revoked on platform** | Sync fails. Dashboard shows warning. Organizer can re-authorize or disconnect. Events remain discoverable but marked "sync paused." |

### Organizer Reputation

Over time, Atlas builds an organizer reputation score based on:

- Number of events hosted
- Ticket sales volume
- Attendee check-in rate (for Direct events)
- Refund rate (lower = better)
- Time on platform

Reputation is visible to agents, helping them recommend events from reliable organizers. This creates a positive feedback loop: good organizers get more agent recommendations, which drives more sales, which attracts more organizers.
