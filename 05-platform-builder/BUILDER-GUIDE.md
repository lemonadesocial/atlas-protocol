# Atlas Platform Builder Guide

> Build a complete event platform in days, not months.

---

## The Opportunity

Building an event platform from scratch today requires:

| Component | Build Time | Complexity |
|-----------|-----------|------------|
| Payment processing | 2-4 months | PCI compliance, multi-currency, refunds |
| Ticketing engine | 2-3 months | Inventory, holds, pricing tiers, QR codes |
| Discovery & search | 1-2 months | Search indexing, filtering, recommendations |
| Agent/AI access | 1-2 months | API design, auth, rate limiting |
| Check-in system | 1 month | Credential verification, real-time sync |
| Analytics | 1 month | Data pipeline, dashboards, attribution |
| **Total** | **8-14 months** | **Before you write a single line of your actual product** |

Building on Atlas: payments (done), ticketing (done), discovery (done), agent access (done), check-in (done), analytics (done). You build the UX and the community.

**Time to launch: days to weeks.**

### Platform Ideas Atlas Enables

- **Atlas for Berlin Techno** — curated underground events, resident-only presales, artist-linked discovery
- **Atlas for Yoga Retreats** — retreat-specific fields (accommodation, dietary), teacher profiles, multi-day scheduling
- **Atlas for Corporate Conferences** — invoiced payments, badge printing, session-track management, sponsor tiers
- **Atlas for University Events** — .edu verification, student pricing, campus-wide discovery, club management
- **Atlas for Food Festivals** — vendor management, tasting-ticket bundles, dietary filtering
- **Atlas for Marathon Series** — bib assignment, wave management, timing integration, finisher credentials

Every one of these is a viable business. Atlas handles the infrastructure. You handle the niche.

---

## What Atlas Provides (Infrastructure)

### Ticketing Engine
Full-featured ticketing powered by Lemonade's production infrastructure:
- Multiple ticket types per event (GA, VIP, Early Bird, Group)
- Flexible pricing (fixed, tiered, dynamic, free)
- Inventory management with real-time availability
- Hold system (reserve tickets during checkout, configurable expiry)
- Refund processing (full, partial, automated policies)
- QR-code ticket credentials (verifiable, tamper-proof)

### Payment Processing
Dual-rail payments with near-zero fees:
- **USDC on Tempo** — sub-cent transaction fees (<$0.001), instant settlement
- **Stripe SPTs (Sponsored Payment Transactions)** — familiar card payments, connected accounts
- 2% Atlas protocol fee (compare: Eventbrite charges 6.95% + $0.99/ticket)
- Automatic splitting: your fee + Atlas fee + organizer payout
- Multi-currency support via stablecoin rails

### Discovery
Every event on your platform is automatically discoverable:
- Listed in the Atlas Event Registry
- Searchable by AI agents via MCP tools
- Indexed with structured metadata (date, location, category, price range)
- Cross-platform discovery (events on your platform appear to agents querying any Atlas platform)

### Agent Access
Your platform is AI-native from day one:
- **MPP 402 Protocol** — agents can purchase tickets programmatically via HTTP 402 payment flows
- **MCP Tools** — agents discover, query, and transact through standardized tool interfaces
- Zero additional integration work — Atlas infrastructure handles all agent interactions

### Verifiable Credentials
Cryptographic ticket lifecycle:
- Ticket issued as verifiable credential at purchase
- Check-in verification via credential presentation
- Tamper-proof attendance records
- Portable proof-of-attendance for attendees

### Analytics
Built-in analytics for every event:
- Ticket sales over time, conversion funnels
- Agent traffic and agent-driven sales attribution
- Revenue breakdown (gross, platform fees, net to organizer)
- Check-in rates and timing patterns
- Geographic and demographic insights

---

## What You Build (Differentiation)

Atlas handles infrastructure. You build what makes your platform unique:

### Frontend UX
Your brand, your design, your user experience. Atlas is headless — use any frontend:
- React, Next.js, Svelte, Vue
- React Native, Flutter for mobile
- Even a CLI or Telegram bot

### Community Curation
Decide what belongs on your platform:
- Approve/reject organizers
- Category restrictions (only techno, only yoga, only corporate)
- Geographic focus (Berlin only, Bay Area only, global)
- Quality gates (minimum event details, photo requirements)

### Niche Features
Build the features your community needs:
- Genre-specific metadata (BPM for music, difficulty for fitness)
- Region-specific payment methods
- Industry-specific workflows (sponsor management for conferences)
- Social features (follow artists, friend activity, group bookings)

### Marketing and Organizer Acquisition
Grow your platform:
- Organizer onboarding flows
- Promotional tools (featured events, email campaigns)
- Referral programs
- SEO and content strategy for your niche

---

## Architecture

```
┌─────────────────────────────────────────────┐
│           Your Platform Frontend             │
│   (React / Next.js / Mobile / Any client)   │
│                                              │
│   ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│   │ Your UX  │ │Community │ │   Niche    │  │
│   │  Design  │ │ Curation │ │  Features  │  │
│   └──────────┘ └──────────┘ └────────────┘  │
└──────────────────┬──────────────────────────┘
                   │ Atlas API (REST + WebSocket)
                   ▼
┌─────────────────────────────────────────────┐
│           Atlas Infrastructure               │
│                                              │
│  ┌───────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Ticketing │ │ Payments │ │ Discovery  │  │
│  │ (Lemonade │ │ (Tempo + │ │ (Registry) │  │
│  │  powered) │ │  Stripe) │ │            │  │
│  └───────────┘ └──────────┘ └────────────┘  │
│                                              │
│  ┌───────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Agent    │ │ Check-in │ │ Analytics  │  │
│  │  Access   │ │ (VC +    │ │ (Sales,    │  │
│  │ (MPP+MCP)│ │  verify) │ │  agents)   │  │
│  └───────────┘ └──────────┘ └────────────┘  │
└─────────────────────────────────────────────┘
```

### Data Flow: Ticket Purchase

```
Attendee → Your Frontend → Atlas API → Payment Rail (Tempo/Stripe)
                                      → Ticket Issuance (VC)
                                      → Inventory Update
                                      → Analytics Event
                                      → Webhook to Your Backend
```

### Data Flow: Agent Purchase

```
AI Agent → Atlas MCP Tool → Event Discovery → MPP 402 Payment
                                             → Ticket Issuance
                                             → Confirmation to Agent
                                             → Webhook to Your Backend
```

---

## Quick Start

### 1. Scaffold a New Platform

```bash
npm create atlas-platform@latest my-event-platform
```

Interactive prompts:

```
? Platform name: Berlin Techno Events
? Domain: berlintechno.events
? Categories: music, nightlife, festival
? Geographic focus: Berlin, Germany
? Payment methods: Tempo (USDC), Stripe (Cards)
? Your platform fee: 3%
? Template: default-nextjs
```

### 2. Project Structure

```
my-event-platform/
├── atlas.config.ts          # Platform configuration
├── src/
│   ├── app/                 # Next.js pages
│   │   ├── page.tsx         # Landing / discovery
│   │   ├── events/
│   │   │   ├── [id]/page.tsx    # Event detail
│   │   │   └── create/page.tsx  # Event creation
│   │   ├── checkout/
│   │   │   └── [id]/page.tsx    # Ticket purchase
│   │   └── dashboard/
│   │       └── page.tsx     # Organizer dashboard
│   ├── components/          # UI components
│   └── lib/
│       └── atlas.ts         # Atlas client instance
├── public/
│   ├── logo.svg
│   └── og-image.png
├── theme.config.ts          # Branding / design tokens
└── package.json
```

### 3. Configure

```typescript
// atlas.config.ts
import { defineConfig } from '@atlas-protocol/sdk';

export default defineConfig({
  platform: {
    name: 'Berlin Techno Events',
    slug: 'berlin-techno',
    domain: 'berlintechno.events',
  },
  categories: ['music', 'nightlife', 'festival', 'club', 'rave'],
  geo: {
    focus: ['Berlin, Germany'],
    radius: 50, // km — events within this radius
  },
  payments: {
    tempo: { enabled: true },
    stripe: { enabled: true },
    platformFee: 0.03, // 3% — your revenue
  },
  discovery: {
    autoRegister: true, // list events in Atlas Registry
    agentAccess: true,  // enable MPP 402 + MCP tools
  },
  curation: {
    requireOrganizerApproval: true,
    minEventFields: ['title', 'date', 'venue', 'description', 'cover_image'],
  },
});
```

### 4. Use the Atlas Client

```typescript
// src/lib/atlas.ts
import { AtlasClient } from '@atlas-protocol/sdk';

export const atlas = new AtlasClient({
  apiKey: process.env.ATLAS_API_KEY!,
  platformId: process.env.ATLAS_PLATFORM_ID!,
});
```

```typescript
// src/app/events/[id]/page.tsx
import { atlas } from '@/lib/atlas';

export default async function EventPage({ params }: { params: { id: string } }) {
  const event = await atlas.events.get(params.id);
  const ticketTypes = await atlas.ticketTypes.list(params.id);

  return (
    <div>
      <h1>{event.title}</h1>
      <p>{event.description}</p>
      <p>{new Date(event.start_at).toLocaleDateString()}</p>
      <p>{event.venue.name}, {event.venue.city}</p>

      {ticketTypes.map(tt => (
        <TicketCard
          key={tt.id}
          name={tt.name}
          price={tt.price}
          currency={tt.currency}
          available={tt.available}
          onPurchase={() => handlePurchase(tt.id)}
        />
      ))}
    </div>
  );
}
```

### 5. Deploy

```bash
# Vercel (recommended for Next.js)
vercel --prod

# Or Docker
docker build -t my-platform .
docker run -p 3000:3000 my-platform

# Or Netlify, Fly.io, Railway, etc.
```

Your platform is live, Atlas-compliant, and agent-discoverable.

---

## API Reference (Summary)

Full reference: [INFRASTRUCTURE-API.md](./INFRASTRUCTURE-API.md)

| Operation | Endpoint | Method |
|-----------|----------|--------|
| Create event | `/atlas/v1/events` | POST |
| Get event | `/atlas/v1/events/:id` | GET |
| Update event | `/atlas/v1/events/:id` | PATCH |
| List events | `/atlas/v1/events` | GET |
| Delete event | `/atlas/v1/events/:id` | DELETE |
| Create ticket type | `/atlas/v1/events/:id/ticket-types` | POST |
| Update ticket type | `/atlas/v1/ticket-types/:id` | PATCH |
| List ticket types | `/atlas/v1/events/:id/ticket-types` | GET |
| Purchase tickets | `/atlas/v1/checkout` | POST |
| Refund ticket | `/atlas/v1/tickets/:id/refund` | POST |
| Check in | `/atlas/v1/tickets/:id/checkin` | POST |
| Event analytics | `/atlas/v1/analytics/events/:id` | GET |
| Manage organizers | `/atlas/v1/organizers` | CRUD |
| Payment status | `/atlas/v1/payments/:id` | GET |
| List transactions | `/atlas/v1/transactions` | GET |

---

## Customization

### Branding

```typescript
// theme.config.ts
export default {
  brand: {
    name: 'Berlin Techno Events',
    logo: '/logo.svg',
    favicon: '/favicon.ico',
  },
  colors: {
    primary: '#FF2D55',
    secondary: '#1A1A2E',
    background: '#0F0F1A',
    surface: '#1A1A2E',
    text: '#FFFFFF',
    textSecondary: '#8B8BA3',
    accent: '#00D4FF',
  },
  fonts: {
    heading: 'Space Grotesk',
    body: 'Inter',
    mono: 'JetBrains Mono',
  },
  radius: '8px',
  domain: 'berlintechno.events',
};
```

### Fee Structure

You set your platform fee on top of Atlas's 2% protocol fee:

| Your Fee | Atlas Fee | Total to Attendee | Your Revenue on $50 Ticket |
|----------|-----------|-------------------|---------------------------|
| 0% | 2% | 2% | $0.00 |
| 1% | 2% | 3% | $0.50 |
| 3% | 2% | 5% | $1.50 |
| 5% | 2% | 7% | $2.50 |

Compare with incumbents:
- **Eventbrite:** 6.95% + $0.99/ticket
- **Universe:** 7% + $1.50/ticket
- **Dice:** ~10% (to organizer)

Even at 5% platform fee, you undercut Eventbrite while earning revenue AND organizers pay less.

### Payment Method Configuration

```typescript
// atlas.config.ts — payments section
payments: {
  tempo: {
    enabled: true,
    // Attendees pay with USDC — sub-cent fees
    // Organizers receive USDC to their wallet
  },
  stripe: {
    enabled: true,
    // Attendees pay with cards
    // Organizers receive via Stripe connected account
    // Standard Stripe processing fees apply on top
  },
  platformFee: 0.03,
  feeRecipient: 'your-usdc-wallet-address',
}
```

### Event Categories and Curation

```typescript
// atlas.config.ts — curation section
curation: {
  // Restrict events to your niche
  allowedCategories: ['music', 'nightlife', 'festival'],

  // Require organizer approval before they can post events
  requireOrganizerApproval: true,

  // Minimum fields required to publish an event
  minEventFields: ['title', 'date', 'venue', 'description', 'cover_image'],

  // Custom fields specific to your niche
  customFields: [
    { key: 'genre', label: 'Music Genre', type: 'select',
      options: ['techno', 'house', 'ambient', 'drum-and-bass', 'experimental'],
      required: true },
    { key: 'bpm_range', label: 'BPM Range', type: 'range',
      min: 80, max: 200, required: false },
    { key: 'sound_system', label: 'Sound System', type: 'text',
      required: false },
  ],
}
```

### Custom Fields on Tickets

```typescript
// When creating a ticket type
await atlas.ticketTypes.create(eventId, {
  name: 'VIP',
  price: 50.00,
  currency: 'USD',
  limit: 100,
  customFields: [
    { key: 'table_preference', label: 'Table Preference', type: 'select',
      options: ['front', 'middle', 'back'], required: false },
    { key: 'dietary', label: 'Dietary Requirements', type: 'text',
      required: false },
  ],
});
```

---

## Revenue Model

### How You Make Money

```
Ticket Sale ($50)
  ├── Atlas Protocol Fee (2%):  $1.00 → Atlas treasury
  ├── Your Platform Fee (3%):   $1.50 → Your wallet
  └── Organizer Payout:        $47.50 → Organizer wallet
```

### Revenue Scenarios

| Monthly Ticket Volume | Avg Price | Your Fee (3%) | Monthly Revenue |
|-----------------------|-----------|---------------|-----------------|
| 1,000 tickets | $30 | 3% | $900 |
| 5,000 tickets | $40 | 3% | $6,000 |
| 20,000 tickets | $50 | 3% | $30,000 |
| 100,000 tickets | $45 | 3% | $135,000 |

### Settlement

- **Tempo payments:** USDC settles to your wallet within seconds
- **Stripe payments:** Standard Stripe payout schedule (2-7 business days)
- Fee splitting is automatic — you never handle organizer payouts manually

---

## Examples

### Minimal: Config-Only Platform

100 lines of configuration. Zero custom code. Default Atlas theme.

```typescript
// atlas.config.ts — this is the entire platform
import { defineConfig } from '@atlas-protocol/sdk';

export default defineConfig({
  platform: {
    name: 'Yoga Retreats Worldwide',
    slug: 'yoga-retreats',
    domain: 'yogaretreats.world',
  },
  categories: ['yoga', 'wellness', 'retreat', 'meditation'],
  geo: { focus: ['global'] },
  payments: {
    tempo: { enabled: true },
    stripe: { enabled: true },
    platformFee: 0.04,
  },
  discovery: {
    autoRegister: true,
    agentAccess: true,
  },
  curation: {
    requireOrganizerApproval: false,
    minEventFields: ['title', 'date', 'venue', 'description'],
  },
});
```

```bash
npm create atlas-platform@latest yoga-retreats -- --config-only
cd yoga-retreats
vercel --prod
# Live in 5 minutes
```

### Custom: Next.js Frontend with Custom Design

Full custom frontend, your design system, direct API integration.

```typescript
// src/app/events/page.tsx — custom discovery page
import { atlas } from '@/lib/atlas';
import { EventGrid } from '@/components/EventGrid';
import { GenreFilter } from '@/components/GenreFilter';

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: { genre?: string; city?: string };
}) {
  const events = await atlas.events.list({
    category: 'music',
    custom_fields: searchParams.genre
      ? { genre: searchParams.genre }
      : undefined,
    geo: searchParams.city
      ? { city: searchParams.city, radius: 25 }
      : { city: 'Berlin', radius: 50 },
    sort: 'date_asc',
    limit: 40,
  });

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="p-8">
        <h1 className="text-5xl font-bold tracking-tight">
          Berlin Techno Events
        </h1>
        <GenreFilter selected={searchParams.genre} />
      </header>
      <EventGrid events={events.data} />
    </main>
  );
}
```

```typescript
// src/app/checkout/[ticketTypeId]/page.tsx — custom checkout
'use client';

import { useState } from 'react';
import { atlas } from '@/lib/atlas';

export default function CheckoutPage({ params }: { params: { ticketTypeId: string } }) {
  const [paymentMethod, setPaymentMethod] = useState<'tempo' | 'stripe'>('tempo');
  const [loading, setLoading] = useState(false);

  async function handlePurchase() {
    setLoading(true);
    const { checkout_url, ticket } = await atlas.checkout.create({
      ticket_type_id: params.ticketTypeId,
      quantity: 1,
      payment_method: paymentMethod,
      // For Tempo: wallet address collected via WalletConnect
      // For Stripe: redirects to Stripe Checkout
    });

    if (paymentMethod === 'stripe') {
      window.location.href = checkout_url;
    } else {
      // Tempo: present USDC payment in wallet
      await presentTempoPayment(checkout_url);
    }
    setLoading(false);
  }

  return (
    <div className="max-w-md mx-auto p-8">
      <h2 className="text-2xl font-bold mb-4">Checkout</h2>
      <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />
      <button onClick={handlePurchase} disabled={loading}
              className="w-full bg-pink-600 text-white py-3 rounded-lg mt-4">
        {loading ? 'Processing...' : 'Purchase Ticket'}
      </button>
    </div>
  );
}
```

### Advanced: Mobile App with Social Features

Native mobile app with push notifications, social features, and loyalty.

```typescript
// React Native with Atlas SDK
import { AtlasClient } from '@atlas-protocol/sdk-react-native';

const atlas = new AtlasClient({
  apiKey: Config.ATLAS_API_KEY,
  platformId: Config.ATLAS_PLATFORM_ID,
});

// Social: follow artists
await atlas.social.follow(artistId);

// Notifications: subscribe to new events by genre
await atlas.notifications.subscribe({
  type: 'new_event',
  filters: { genre: 'techno', city: 'Berlin' },
  channel: 'push',
});

// Loyalty: check reward balance
const rewards = await atlas.rewards.balance();
// { points: 2400, tier: 'gold', next_tier_at: 5000 }

// Loyalty: redeem for discount
const discount = await atlas.rewards.redeem({
  points: 500,
  type: 'ticket_discount',
  // Returns a discount code usable at checkout
});
```

---

## What Happens When You Launch

1. **Your platform is live** — organizers create events, attendees buy tickets
2. **Automatically listed in Atlas Registry** — every event is discoverable by AI agents across the Atlas ecosystem
3. **Agent purchases work immediately** — ChatGPT, Claude, and other agents can find and purchase tickets for events on your platform via MPP 402
4. **Revenue flows automatically** — fees split per transaction, USDC settlement to your wallet
5. **Analytics from day one** — see sales, agent traffic, conversion, revenue in your dashboard

You built a niche event platform. Atlas made it possible in days instead of months. And every event on your platform is part of a global, agent-native discovery network.

---

## Next Steps

- [Infrastructure API Reference](./INFRASTRUCTURE-API.md) — complete API docs
- [Atlas Whitepaper](../01-whitepaper/) — protocol design and vision
- [Agent Layer](../06-agent-layer/) — how agents interact with Atlas
- [Economics](../07-economics/) — tokenomics and incentive design
