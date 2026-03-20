# Atlas Protocol: Platform Integration Guide

**Version:** 1.0
**Last Updated:** 2026-03-19
**Audience:** Platform engineers integrating Atlas into existing event platforms
**Time to Integrate:** 1 day (Level 1) to 1 week (Level 3)

---

## Table of Contents

1. [Why Integrate Atlas?](#1-why-integrate-atlas)
2. [Integration Levels](#2-integration-levels)
3. [Quick Start (20 Lines)](#3-quick-start)
4. [Step-by-Step Integration](#4-step-by-step-integration)
5. [The AtlasAdapter Interface](#5-the-atlasadapter-interface)
6. [Field Mapping Guide](#6-field-mapping-guide)
7. [Payment Setup](#7-payment-setup)
8. [Testing and Validation](#8-testing-and-validation)
9. [Registry Registration](#9-registry-registration)
10. [Ongoing Maintenance](#10-ongoing-maintenance)
11. [Revenue Model](#11-revenue-model)
12. [FAQ](#12-faq)

---

## 1. Why Integrate Atlas?

### Your events become discoverable by every AI agent

Atlas is the open protocol for agent-driven event discovery and ticketing. When your platform is Atlas-compliant, any AI agent -- Claude, GPT, Gemini, custom LangChain agents, or any future agent runtime -- can discover your events, compare tickets, and purchase directly. You do not need to build separate integrations for each AI provider.

### Agent-driven ticket sales = incremental revenue, zero CAC

AI agents are becoming the primary interface for "find me an event this weekend." These purchases are net-new demand that does not cannibalize your existing web/app traffic. You pay zero customer acquisition cost -- agents find your events through the Atlas Registry and purchase autonomously.

### Organizers are already connecting via OAuth -- official integration gives you control

Atlas's B2C layer lets individual organizers connect their platform accounts via OAuth. If your platform has organizers using Atlas, they are already bridging their events into the protocol. An official SDK integration gives you control over how your events are represented, which data is exposed, and how purchases are processed.

### USDC reward share from protocol fees

Atlas charges a 2% protocol fee on transactions routed through the registry. Platforms that integrate officially receive a share of this fee for purchases on their events. The more agent-driven sales your platform processes, the more USDC you earn.

### The numbers

| Metric | Without Atlas | With Atlas |
|--------|---------------|------------|
| AI agent discovery | Zero (agents can't find your events) | Every Atlas-connected agent |
| Integration cost per AI provider | 2-4 weeks each | One-time SDK integration |
| Incremental ticket revenue | $0 | Estimated 5-15% lift within 6 months |
| Agent-driven CAC | N/A | $0 |

---

## 2. Integration Levels

Atlas supports progressive integration. Start with Level 1 in a day, then deepen integration as you see results.

### Level 1: Discovery (1-2 days)

Your events become discoverable by AI agents. Purchases redirect to your existing checkout.

**What you implement:**
- Publish `/.well-known/atlas.json` manifest
- Expose a search endpoint returning events in Atlas schema
- Expose an event detail endpoint
- Expose a ticket listing endpoint

**What agents can do:**
- Discover your events by location, date, keyword, and category
- View ticket types, pricing, and availability
- Link users to your platform's checkout page

**What agents cannot do:**
- Purchase tickets directly (redirect to your web checkout instead)

**Manifest declares:** `capabilities: ["search", "ticket_listing"]`

### Level 2: Transactional (3-5 days)

Agents can purchase tickets directly via the MPP 402 payment flow, without redirecting to your platform's UI.

**What you add on top of Level 1:**
- Purchase endpoint with MPP 402 challenge-response
- Hold management (reserve tickets during payment window)
- Receipt generation
- Payment verification (Tempo USDC and/or Stripe SPT)

**What agents can do:**
- Everything from Level 1
- Create a ticket hold
- Pay via USDC on Tempo or Stripe SPT
- Receive a structured receipt with ticket details

**Manifest declares:** `capabilities: ["search", "ticket_listing", "purchase"]`

### Level 3: Full (1 week)

Complete Atlas compliance with advanced features.

**What you add on top of Level 2:**
- Discount code validation endpoint
- Cancellation/refund endpoint
- Batch purchase support (multiple ticket types in one transaction)
- Verifiable Credential issuance for tickets (W3C VC format)
- Ticket verification endpoint for check-in

**What agents can do:**
- Everything from Level 2
- Validate and apply discount codes before purchase
- Cancel tickets and process refunds programmatically
- Purchase mixed ticket types in a single flow
- Receive cryptographically verifiable ticket credentials
- Present credentials at any Atlas-compliant check-in system

**Manifest declares:** `capabilities: ["search", "ticket_listing", "purchase", "discount_validation", "cancellation", "batch_purchase", "verifiable_credentials"]`

### Comparison

| Feature | Level 1 | Level 2 | Level 3 |
|---------|---------|---------|---------|
| Event discovery | Yes | Yes | Yes |
| Ticket listing with pricing | Yes | Yes | Yes |
| Agent direct purchase | No | Yes | Yes |
| MPP 402 payment flow | No | Yes | Yes |
| Hold management | No | Yes | Yes |
| Discount validation | No | No | Yes |
| Cancellation API | No | No | Yes |
| Batch purchase | No | No | Yes |
| Verifiable Credentials | No | No | Yes |
| Estimated effort | 1-2 days | 3-5 days | 1 week |
| Registry fee share | Base | Standard | Premium |

---

## 3. Quick Start

Install the SDK and get a Level 1 integration running in 20 lines.

### Install

```bash
npm install @atlas/sdk
```

### Minimal Express integration (Level 1)

```typescript
import express from 'express';
import { AtlasServer } from '@atlas/sdk';

const atlas = new AtlasServer({
  platformId: 'my-events-platform',
  platformName: 'My Events',
  platformUrl: 'https://myevents.com',
  capabilities: ['search', 'ticket_listing'],
  paymentMethods: [],  // Level 1: no direct purchase
});

atlas.setAdapter({
  async searchEvents(query) {
    const events = await db.events.find(query.toFilter());
    return events.map(e => atlas.mapEvent(e, myFieldMapping));
  },
  async getEvent(eventId) {
    const event = await db.events.findById(eventId);
    return event ? atlas.mapEvent(event, myFieldMapping) : null;
  },
  async listTicketTypes(eventId) {
    const types = await db.ticketTypes.find({ event_id: eventId, active: true });
    return types.map(t => atlas.mapTicketType(t, myTicketMapping));
  },
});

const app = express();
app.use('/.well-known/atlas.json', atlas.manifestHandler());
app.use('/atlas/v1', atlas.expressMiddleware());
app.listen(3000);
```

That is a discoverable Atlas-compliant platform. Agents can find your events, browse tickets, and link to your checkout.

---

## 4. Step-by-Step Integration

### Step 1: Install @atlas/sdk

```bash
# npm
npm install @atlas/sdk

# yarn
yarn add @atlas/sdk

# pnpm
pnpm add @atlas/sdk
```

**Requirements:** Node.js 18+ | TypeScript 5.0+ (recommended, not required)

### Step 2: Create an AtlasServer instance

```typescript
import { AtlasServer } from '@atlas/sdk';

const atlas = new AtlasServer({
  // Required: unique platform identifier (lowercase, alphanumeric + hyphens)
  platformId: 'my-events-platform',

  // Required: human-readable name
  platformName: 'My Events Platform',

  // Required: your platform's public URL
  platformUrl: 'https://myevents.com',

  // Required: which Atlas capabilities you support
  capabilities: ['search', 'ticket_listing', 'purchase'],

  // Required for Level 2+: accepted payment methods
  paymentMethods: [
    { type: 'tempo_usdc', network: 'tempo' },
    { type: 'stripe_spt' },
  ],

  // Optional: logo URL for registry listing
  logoUrl: 'https://myevents.com/logo.png',

  // Optional: event categories your platform covers
  categories: ['music', 'tech', 'nightlife', 'sports'],

  // Optional: geographic coverage
  geographicCoverage: ['US', 'EU'],

  // Optional: rate limit declarations (agents will respect these)
  rateLimits: {
    discovery: { requestsPerMinute: 60, burst: 10 },
    purchase: { requestsPerMinute: 10, burst: 3 },
  },

  // Optional: contact emails
  contact: {
    technical: 'engineering@myevents.com',
    abuse: 'abuse@myevents.com',
  },
});
```

### Step 3: Implement the AtlasAdapter

The adapter is the bridge between Atlas and your platform's data layer. You implement the methods, the SDK handles HTTP routing, schema validation, manifest generation, and MPP protocol mechanics.

See [Section 5](#5-the-atlasadapter-interface) for the full interface definition and examples.

```typescript
atlas.setAdapter({
  // Level 1: Discovery
  searchEvents: async (query) => { /* ... */ },
  getEvent: async (eventId) => { /* ... */ },
  listTicketTypes: async (eventId) => { /* ... */ },

  // Level 2: Transactional
  createHold: async (eventId, ticketTypeId, quantity, durationMs) => { /* ... */ },
  completePurchase: async (holdId, paymentProof, buyerInfo) => { /* ... */ },

  // Level 3: Full
  validateDiscount: async (eventId, code, ticketTypeId, quantity) => { /* ... */ },
  cancelTicket: async (ticketId) => { /* ... */ },
  verifyTicket: async (ticketId, credential) => { /* ... */ },
});
```

### Step 4: Mount middleware on your web framework

The SDK provides middleware for all major Node.js frameworks.

**Express:**
```typescript
import express from 'express';
const app = express();
app.use('/.well-known/atlas.json', atlas.manifestHandler());
app.use('/atlas/v1', atlas.expressMiddleware());
```

**Koa:**
```typescript
import Koa from 'koa';
import Router from '@koa/router';
const app = new Koa();
const router = new Router();
router.use('/.well-known/atlas.json', atlas.koaManifestHandler());
router.use('/atlas/v1', atlas.koaMiddleware());
app.use(router.routes());
```

**Fastify:**
```typescript
import Fastify from 'fastify';
const fastify = Fastify();
await fastify.register(atlas.fastifyPlugin(), { prefix: '/atlas/v1' });
```

**Hono:**
```typescript
import { Hono } from 'hono';
const app = new Hono();
app.route('/.well-known/atlas.json', atlas.honoManifestHandler());
app.route('/atlas/v1', atlas.honoMiddleware());
```

**Next.js (App Router):**
```typescript
// app/atlas/v1/[...path]/route.ts
import { atlas } from '@/lib/atlas';
export const GET = atlas.nextHandler();
export const POST = atlas.nextHandler();

// app/.well-known/atlas.json/route.ts
export const GET = atlas.nextManifestHandler();
```

### Step 5: Register with the Atlas Registry

After your integration is live, register with the Atlas Registry so agents can discover your platform through federated search.

```bash
npx @atlas/cli register \
  --manifest-url https://myevents.com/.well-known/atlas.json \
  --contact engineering@myevents.com
```

Or programmatically:
```typescript
import { AtlasRegistry } from '@atlas/sdk';

const registry = new AtlasRegistry({ apiKey: process.env.ATLAS_REGISTRY_KEY });
await registry.register({
  manifestUrl: 'https://myevents.com/.well-known/atlas.json',
  contact: 'engineering@myevents.com',
});
```

### Step 6: Validate compliance

Run the Atlas validator to verify your implementation is correct.

```bash
npx @atlas/validator https://myevents.com
```

Output:
```
Atlas Compliance Validator v1.0
Target: https://myevents.com

[PASS] /.well-known/atlas.json is accessible
[PASS] Manifest schema is valid
[PASS] Platform capabilities declared: search, ticket_listing, purchase
[PASS] GET /atlas/v1/search returns valid event array
[PASS] GET /atlas/v1/events/:id returns valid event object
[PASS] GET /atlas/v1/events/:id/tickets returns valid ticket types
[PASS] POST /atlas/v1/events/:id/purchase returns 402 with valid challenge
[PASS] 402 challenge includes required MPP fields
[PASS] Hold TTL is >= 5 minutes
[PASS] Rate limit headers present

Result: Level 2 COMPLIANT (9/9 checks passed)
Optional Level 3 checks: 4 not implemented (discount_validation, cancellation, batch_purchase, verifiable_credentials)
```

---

## 5. The AtlasAdapter Interface

The `AtlasAdapter` is the single interface you implement. Every method maps to your platform's data layer.

### Full Interface

```typescript
interface AtlasAdapter {
  // ─── Level 1: Discovery ───────────────────────────────────────

  /**
   * Search events by location, date, keyword, and category.
   * Return events matching the query in Atlas schema format.
   */
  searchEvents(query: AtlasSearchQuery): Promise<AtlasEvent[]>;

  /**
   * Get a single event by its platform-specific ID.
   * Return null if not found or not published.
   */
  getEvent(eventId: string): Promise<AtlasEvent | null>;

  /**
   * List purchasable ticket types for an event.
   * Exclude private, hidden, or exhausted ticket types.
   */
  listTicketTypes(eventId: string): Promise<AtlasTicketType[]>;

  // ─── Level 2: Transactional ───────────────────────────────────

  /**
   * Create a temporary hold (reservation) for tickets.
   * The hold guarantees availability for the specified duration.
   * Return a hold ID and expiration timestamp.
   */
  createHold?(
    eventId: string,
    ticketTypeId: string,
    quantity: number,
    durationMs: number,
  ): Promise<AtlasHold>;

  /**
   * Complete a purchase against an existing hold.
   * Verify the payment proof, issue tickets, and return a receipt.
   * This is called AFTER the SDK verifies the MPP payment credential.
   */
  completePurchase?(
    holdId: string,
    payment: AtlasVerifiedPayment,
    buyerInfo: AtlasBuyerInfo,
  ): Promise<AtlasReceipt>;

  // ─── Level 3: Full ────────────────────────────────────────────

  /**
   * Validate a discount code and return the adjusted pricing.
   * Do not apply the discount -- just calculate what it would be.
   */
  validateDiscount?(
    eventId: string,
    code: string,
    ticketTypeId: string,
    quantity: number,
  ): Promise<AtlasDiscountResult>;

  /**
   * Cancel a ticket and initiate a refund if applicable.
   * Return the cancellation status and refund details.
   */
  cancelTicket?(ticketId: string): Promise<AtlasCancellationResult>;

  /**
   * Verify a ticket credential for check-in purposes.
   * Return whether the credential is valid and the ticket is active.
   */
  verifyTicket?(
    ticketId: string,
    credential: string,
  ): Promise<AtlasVerificationResult>;
}
```

### Search Query

```typescript
interface AtlasSearchQuery {
  /** Keyword search string */
  search?: string;

  /** City name */
  city?: string;

  /** Latitude for geo-search */
  latitude?: number;

  /** Longitude for geo-search */
  longitude?: number;

  /** Radius in kilometers (default 50) */
  radiusKm?: number;

  /** Only events starting after this ISO 8601 date */
  startAfter?: string;

  /** Only events starting before this ISO 8601 date */
  startBefore?: string;

  /** Event categories to filter by */
  categories?: string[];

  /** Minimum ticket price (cents) */
  priceMin?: number;

  /** Maximum ticket price (cents) */
  priceMax?: number;

  /** Currency for price filtering (ISO 4217) */
  priceCurrency?: string;

  /** Pagination: number of results (default 20, max 50) */
  limit?: number;

  /** Pagination: offset */
  skip?: number;

  /**
   * Convert this query to a generic filter object.
   * Utility method -- you can ignore it and use the raw fields.
   */
  toFilter(): Record<string, unknown>;
}
```

### Example: Implementing searchEvents

```typescript
atlas.setAdapter({
  async searchEvents(query) {
    // Build your platform's query from Atlas fields
    const filter: any = {
      published: true,
      active: true,
      end_date: { $gte: new Date() },
    };

    if (query.city) {
      filter['venue.city'] = { $regex: query.city, $options: 'i' };
    }

    if (query.latitude && query.longitude) {
      filter.location = {
        $near: {
          $geometry: { type: 'Point', coordinates: [query.longitude, query.latitude] },
          $maxDistance: (query.radiusKm || 50) * 1000,
        },
      };
    }

    if (query.startAfter) {
      filter.start_date = { ...filter.start_date, $gte: new Date(query.startAfter) };
    }

    if (query.startBefore) {
      filter.start_date = { ...filter.start_date, $lte: new Date(query.startBefore) };
    }

    if (query.search) {
      filter.$text = { $search: query.search };
    }

    if (query.categories?.length) {
      filter.category = { $in: query.categories };
    }

    const events = await Event.find(filter)
      .limit(query.limit || 20)
      .skip(query.skip || 0)
      .sort({ start_date: 1 })
      .lean();

    // Map to Atlas schema using your field mapping
    return events.map(e => atlas.mapEvent(e, {
      id: e._id.toString(),
      title: e.name,
      description: e.description,
      start: e.start_date.toISOString(),
      end: e.end_date.toISOString(),
      latitude: e.location?.coordinates?.[1],
      longitude: e.location?.coordinates?.[0],
      address: {
        street: e.venue?.street,
        city: e.venue?.city,
        region: e.venue?.state,
        country: e.venue?.country,
        postalCode: e.venue?.zip,
      },
      coverImageUrl: e.cover_image,
      canonicalUrl: `https://myevents.com/events/${e.slug}`,
      currency: e.default_currency || 'USD',
      categories: e.tags || [],
      organizerName: e.organizer_name,
    }));
  },
  // ... other methods
});
```

### Example: Implementing createHold and completePurchase (Level 2)

```typescript
atlas.setAdapter({
  // ... Level 1 methods ...

  async createHold(eventId, ticketTypeId, quantity, durationMs) {
    const ticketType = await TicketType.findById(ticketTypeId);
    if (!ticketType) throw new AtlasError('TICKET_TYPE_NOT_FOUND', 404);

    const available = ticketType.capacity - ticketType.sold_count;
    if (available < quantity) {
      throw new AtlasError('INSUFFICIENT_TICKETS', 409, {
        available,
        requested: quantity,
      });
    }

    // Create a hold record with TTL
    const hold = await Hold.create({
      event_id: eventId,
      ticket_type_id: ticketTypeId,
      quantity,
      expires_at: new Date(Date.now() + durationMs),
      status: 'active',
    });

    return {
      holdId: hold._id.toString(),
      expiresAt: hold.expires_at.toISOString(),
      ticketTypeId,
      quantity,
      unitPrice: ticketType.price_cents.toString(),
      currency: ticketType.currency,
      totalPrice: (ticketType.price_cents * quantity).toString(),
    };
  },

  async completePurchase(holdId, payment, buyerInfo) {
    const hold = await Hold.findById(holdId);
    if (!hold) throw new AtlasError('HOLD_NOT_FOUND', 404);
    if (hold.status !== 'active') throw new AtlasError('HOLD_EXPIRED', 410);
    if (new Date() > hold.expires_at) throw new AtlasError('HOLD_EXPIRED', 410);

    const ticketType = await TicketType.findById(hold.ticket_type_id);
    const event = await Event.findById(hold.event_id);

    // Issue tickets in a transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const tickets = await Ticket.insertMany(
        Array(hold.quantity).fill(0).map(() => ({
          event_id: hold.event_id,
          ticket_type_id: hold.ticket_type_id,
          buyer_email: buyerInfo.email,
          buyer_name: buyerInfo.name,
          status: 'active',
          source: 'atlas_agent',
          payment_transaction_id: payment.transactionId,
        })),
        { session },
      );

      await TicketType.updateOne(
        { _id: hold.ticket_type_id },
        { $inc: { sold_count: hold.quantity } },
        { session },
      );

      await Hold.updateOne(
        { _id: holdId },
        { $set: { status: 'completed' } },
        { session },
      );

      await session.commitTransaction();

      return {
        receiptId: `rcpt_${hold._id}`,
        event: {
          id: event._id.toString(),
          title: event.name,
          start: event.start_date.toISOString(),
          end: event.end_date.toISOString(),
          address: event.venue,
        },
        tickets: tickets.map(t => ({
          ticketId: t._id.toString(),
          shortId: t.short_id,
          ticketTypeTitle: ticketType.name,
          status: 'active',
        })),
        payment: {
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          transactionId: payment.transactionId,
        },
        buyer: {
          email: buyerInfo.email,
          name: buyerInfo.name,
        },
        purchasedAt: new Date().toISOString(),
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  },
});
```

---

## 6. Field Mapping Guide

Your platform's event and ticket models will not match Atlas schemas exactly. The `atlas.mapEvent()` and `atlas.mapTicketType()` helpers accept a flat mapping object that transforms your fields into Atlas fields.

### Event Field Mapping

| Atlas Field | Type | Required | Description |
|-------------|------|----------|-------------|
| `id` | string | Yes | Your platform's unique event identifier |
| `title` | string | Yes | Event title/name |
| `description` | string | Yes | Event description (plain text or Markdown) |
| `start` | string (ISO 8601) | Yes | Event start date and time with timezone |
| `end` | string (ISO 8601) | Yes | Event end date and time with timezone |
| `latitude` | number | No | Venue latitude (enables geo-search) |
| `longitude` | number | No | Venue longitude (enables geo-search) |
| `address.street` | string | No | Street address |
| `address.city` | string | No | City |
| `address.region` | string | No | State/province/region |
| `address.country` | string | No | ISO 3166-1 alpha-2 country code |
| `address.postalCode` | string | No | Postal/ZIP code |
| `coverImageUrl` | string (URL) | No | Event cover image |
| `canonicalUrl` | string (URL) | Yes | Human-readable event page on your platform |
| `currency` | string (ISO 4217) | Yes | Primary currency for pricing |
| `categories` | string[] | No | Event categories (from Atlas controlled vocabulary) |
| `organizerName` | string | No | Organizer display name |
| `organizerUrl` | string (URL) | No | Organizer profile page |
| `ageRestriction` | number | No | Minimum age requirement |
| `totalCapacity` | number | No | Total venue capacity |
| `remainingCapacity` | number | No | Remaining spots across all ticket types |

### Ticket Type Field Mapping

| Atlas Field | Type | Required | Description |
|-------------|------|----------|-------------|
| `id` | string | Yes | Your platform's unique ticket type identifier |
| `title` | string | Yes | Ticket type name (e.g., "General Admission") |
| `description` | string | No | Ticket type description |
| `currency` | string (ISO 4217) | Yes | Currency code |
| `priceCents` | number | Yes | Price in smallest currency unit (cents for USD) |
| `available` | boolean | Yes | Whether tickets are currently purchasable |
| `remaining` | number | No | Number of tickets remaining (null if undisclosed) |
| `limitPerPurchase` | number | No | Max tickets per transaction (default: unlimited) |
| `approvalRequired` | boolean | No | Whether host must approve purchases |
| `passcodeRequired` | boolean | No | Whether a passcode is needed to purchase |
| `salesStart` | string (ISO 8601) | No | When ticket sales begin |
| `salesEnd` | string (ISO 8601) | No | When ticket sales end |
| `refundable` | boolean | No | Whether tickets can be refunded |
| `refundDeadline` | string (ISO 8601) | No | Last date for refund requests |

### Category Vocabulary

Atlas uses a controlled vocabulary for event categories. Map your platform's categories to the closest match:

```
music, nightlife, tech, networking, food, wellness, sports,
arts, comedy, theater, film, education, conference, workshop,
meetup, festival, charity, gaming, outdoors, family, other
```

### Example: Mapping from Eventbrite's schema

```typescript
const eventbriteMapping = {
  id: event.id,
  title: event.name.text,
  description: event.description.text,
  start: event.start.utc,
  end: event.end.utc,
  latitude: event.venue?.latitude ? parseFloat(event.venue.latitude) : undefined,
  longitude: event.venue?.longitude ? parseFloat(event.venue.longitude) : undefined,
  address: {
    street: event.venue?.address?.address_1,
    city: event.venue?.address?.city,
    region: event.venue?.address?.region,
    country: event.venue?.address?.country,
    postalCode: event.venue?.address?.postal_code,
  },
  coverImageUrl: event.logo?.url,
  canonicalUrl: event.url,
  currency: event.currency,
  categories: mapEventbriteCategory(event.category_id),
  organizerName: event.organizer?.name,
};
```

### Example: Mapping from a custom PostgreSQL schema

```typescript
const pgMapping = {
  id: row.id.toString(),
  title: row.event_name,
  description: row.event_description,
  start: row.starts_at.toISOString(),
  end: row.ends_at.toISOString(),
  latitude: row.lat,
  longitude: row.lng,
  address: {
    street: row.address_line1,
    city: row.city,
    region: row.state,
    country: row.country_code,
    postalCode: row.postal_code,
  },
  coverImageUrl: row.image_url,
  canonicalUrl: `https://myplatform.com/events/${row.slug}`,
  currency: row.currency_code,
  categories: row.tags,
  organizerName: row.org_name,
};
```

---

## 7. Payment Setup

Level 2+ integrations require payment configuration. Atlas supports two payment methods, both handled by the SDK automatically.

### 7.1 Tempo USDC (Recommended)

Tempo is a high-throughput payment chain with sub-cent fees (<$0.001) and sub-second finality. USDC on Tempo is the default payment method for Atlas.

**Setup:**

1. Create a Tempo wallet (any EVM-compatible wallet works -- Tempo is EVM-compatible)
2. Note your wallet address
3. Configure it in the AtlasServer:

```typescript
const atlas = new AtlasServer({
  // ...
  paymentMethods: [
    {
      type: 'tempo_usdc',
      network: 'tempo',
      walletAddress: process.env.ATLAS_TEMPO_WALLET_ADDRESS,
    },
  ],
  mpp: {
    facilitatorUri: 'https://facilitator.atlas-protocol.org',
  },
});
```

**How settlement works:**
- Agent pays USDC on Tempo to your wallet address via MPP 402 flow
- The SDK verifies the payment credential with the Atlas facilitator
- Funds arrive in your wallet immediately (sub-second finality)
- 2% protocol fee is deducted at settlement

### 7.2 Stripe SPT (Shared Payment Tokens)

For platforms that prefer traditional payment rails, Stripe SPTs allow agents to pay with card-backed tokens.

**Setup:**

1. You need a Stripe account with Connected Accounts enabled
2. Enable SPT support in your Stripe dashboard
3. Configure:

```typescript
const atlas = new AtlasServer({
  // ...
  paymentMethods: [
    {
      type: 'stripe_spt',
      stripeAccountId: process.env.STRIPE_CONNECTED_ACCOUNT_ID,
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    },
  ],
});
```

**How settlement works:**
- Agent pays via Stripe SPT credential
- The SDK verifies the credential with Stripe's API
- Payment is processed as a destination charge to your connected account
- Standard Stripe settlement timeline applies (T+2 for most regions)

### 7.3 Supporting Both

Most platforms should support both methods. Agents choose their preferred method based on the options your manifest declares.

```typescript
const atlas = new AtlasServer({
  // ...
  paymentMethods: [
    {
      type: 'tempo_usdc',
      network: 'tempo',
      walletAddress: process.env.ATLAS_TEMPO_WALLET_ADDRESS,
    },
    {
      type: 'stripe_spt',
      stripeAccountId: process.env.STRIPE_CONNECTED_ACCOUNT_ID,
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    },
  ],
});
```

### 7.4 Payment Flow (Handled by SDK)

You do not need to implement the MPP 402 challenge-response flow manually. The SDK handles it:

```
Agent                          Your Server (with @atlas/sdk)
  |                                       |
  |-- POST /atlas/v1/events/:id/purchase ->|
  |                                       |  SDK checks: does agent include
  |                                       |  Authorization: Payment header?
  |                                       |
  |<-- 402 + X-Payment challenge ---------|  No: SDK auto-generates 402
  |                                       |       with your payment config
  |                                       |
  |-- POST (retry with Payment header) -->|
  |                                       |  SDK verifies payment credential
  |                                       |  via facilitator
  |                                       |
  |                                       |  SDK calls YOUR adapter's
  |                                       |  completePurchase() method
  |                                       |  with verified payment proof
  |                                       |
  |<-- 200 + receipt ---------------------|
```

Your adapter's `completePurchase()` is only called after the SDK has verified the payment is valid. You issue the tickets and return the receipt.

---

## 8. Testing and Validation

### 8.1 Sandbox Environment

Atlas provides a sandbox for development and testing.

```typescript
const atlas = new AtlasServer({
  // ...
  environment: 'sandbox',  // Uses sandbox facilitator + testnet
  mpp: {
    facilitatorUri: 'https://sandbox.facilitator.atlas-protocol.org',
  },
  paymentMethods: [
    {
      type: 'tempo_usdc',
      network: 'tempo-testnet',
      walletAddress: process.env.ATLAS_TEMPO_TESTNET_WALLET,
    },
  ],
});
```

Sandbox mode:
- Connects to the Atlas sandbox registry (your platform is not visible in production)
- Uses Tempo testnet for USDC payments (free testnet tokens)
- Uses Stripe test mode for SPT payments
- All validation checks work identically to production

### 8.2 Mock Agents

The SDK includes a mock agent for testing your adapter without a real AI agent.

```typescript
import { MockAgent } from '@atlas/sdk/testing';

const agent = new MockAgent({
  atlasBaseUrl: 'http://localhost:3000/atlas/v1',
});

// Test discovery
const events = await agent.search({ city: 'Berlin', search: 'techno' });
console.log(`Found ${events.length} events`);

// Test ticket listing
const tickets = await agent.listTickets(events[0].id);
console.log(`Found ${tickets.length} ticket types`);

// Test purchase flow (Level 2)
const receipt = await agent.purchase(events[0].id, {
  ticketTypeId: tickets[0].id,
  quantity: 2,
  buyerEmail: 'test@example.com',
  buyerName: 'Test User',
  paymentMethod: 'tempo_usdc',  // Mock payment -- no real funds
});
console.log(`Receipt: ${receipt.receiptId}`);
```

### 8.3 Integration Test Suite

The SDK includes a comprehensive test suite you can run against your implementation.

```bash
npx @atlas/validator https://localhost:3000 --level 2 --verbose
```

Flags:
- `--level 1|2|3` -- Which integration level to validate (default: auto-detect from manifest)
- `--verbose` -- Print full request/response for each check
- `--sandbox` -- Use sandbox facilitator for payment tests
- `--skip-payment` -- Skip actual payment flow tests (Level 1 validation only)

### 8.4 Compliance Test Suite

For CI/CD integration, use the programmatic test runner:

```typescript
import { AtlasComplianceTests } from '@atlas/sdk/testing';

describe('Atlas compliance', () => {
  const tests = new AtlasComplianceTests({
    baseUrl: 'http://localhost:3000/atlas/v1',
    manifestUrl: 'http://localhost:3000/.well-known/atlas.json',
    level: 2,
  });

  test('manifest is valid', () => tests.validateManifest());
  test('search returns valid events', () => tests.validateSearch());
  test('event detail returns valid schema', () => tests.validateEventDetail());
  test('ticket listing returns valid types', () => tests.validateTicketListing());
  test('purchase flow returns valid 402', () => tests.validatePurchaseChallenge());
  test('hold management works', () => tests.validateHoldLifecycle());
});
```

---

## 9. Registry Registration

The Atlas Registry is the federated discovery layer. When your platform is registered, agents using the registry can find events across all Atlas-compliant platforms in a single query.

### 9.1 Registration Process

1. **Deploy your Atlas integration** to a publicly accessible URL
2. **Run the validator** to confirm compliance: `npx @atlas/validator https://yourplatform.com`
3. **Register via CLI or API:**

```bash
npx @atlas/cli register \
  --manifest-url https://yourplatform.com/.well-known/atlas.json \
  --contact engineering@yourplatform.com \
  --payment-wallet 0xYourTempoWalletAddress
```

4. **Receive confirmation** -- the registry fetches your manifest, runs validation, and adds you to the directory
5. **Verification** -- the registry performs health checks every 15 minutes. Your platform must respond to `/.well-known/atlas.json` with a valid manifest and a 200 status.

### 9.2 Required Information

| Field | Description |
|-------|-------------|
| `manifestUrl` | Public URL of your `/.well-known/atlas.json` |
| `contact` | Technical contact email |
| `paymentWallet` | Tempo wallet address for receiving protocol fee share |
| `description` | Short description of your platform (displayed in registry) |
| `website` | Your platform's public website URL |

### 9.3 After Registration

Once registered, your platform:
- Appears in federated search results from `registry.atlas-protocol.org`
- Is included in the public platform directory
- Receives health check pings every 15 minutes
- Gets an agent traffic analytics dashboard
- Starts earning protocol fee share on agent-driven purchases

### 9.4 Health Check Requirements

The registry monitors your platform's availability. Your endpoints must:
- Respond to `GET /.well-known/atlas.json` with HTTP 200 and a valid manifest within 5 seconds
- Respond to `GET /atlas/v1/search?limit=1` with HTTP 200 and at least an empty results array within 5 seconds
- Maintain > 95% uptime measured over a rolling 7-day window

If your platform fails health checks for 1 hour, it is marked as `degraded` in the registry. After 24 hours of consecutive failures, it is marked as `offline` and excluded from federated search until it recovers.

---

## 10. Ongoing Maintenance

### 10.1 Protocol Version Updates

Atlas follows semantic versioning. Within a major version (e.g., 1.x):
- No required fields will be removed
- No field semantics will change
- New fields are always optional
- Existing endpoints will not change URL structure

When a new minor version is released (e.g., 1.1), the SDK auto-negotiates the version. Update your SDK to the latest to gain access to new optional features.

For major version changes (2.0), there will be a minimum 6-month migration window with both versions supported concurrently.

### 10.2 SDK Updates

```bash
npm update @atlas/sdk
```

The SDK maintains backward compatibility within major versions. Update regularly to receive:
- Bug fixes and security patches
- New optional capabilities
- Performance improvements
- New framework middleware support

### 10.3 Manifest Updates

If your platform's capabilities change (e.g., you add discount validation), update your `AtlasServer` configuration:

```typescript
const atlas = new AtlasServer({
  capabilities: ['search', 'ticket_listing', 'purchase', 'discount_validation'], // Added
  // ...
});
```

The manifest at `/.well-known/atlas.json` updates automatically. The registry picks up the change on its next health check (within 15 minutes).

### 10.4 Schema Migrations

When Atlas adds new optional fields to the event or ticket schema:
1. The SDK handles serialization -- your adapter does not need to change
2. New fields that map to your data are populated via your field mapping
3. New fields that don't map to anything are omitted (they are optional)

### 10.5 Monitoring

The SDK emits events you can hook into for observability:

```typescript
atlas.on('search', (query, resultCount, durationMs) => {
  metrics.histogram('atlas.search.duration', durationMs);
  metrics.counter('atlas.search.results', resultCount);
});

atlas.on('purchase.challenge', (eventId, amount) => {
  metrics.counter('atlas.purchase.challenge');
});

atlas.on('purchase.complete', (eventId, receipt) => {
  metrics.counter('atlas.purchase.complete');
  metrics.counter('atlas.purchase.revenue', parseFloat(receipt.payment.amount));
});

atlas.on('purchase.failed', (eventId, error) => {
  metrics.counter('atlas.purchase.failed');
});

atlas.on('health.check', (source, success) => {
  metrics.counter('atlas.health.check', { success: String(success) });
});
```

---

## 11. Revenue Model

### 11.1 How Platforms Earn from Atlas

Atlas uses a transparent fee structure that aligns platform, protocol, and organizer incentives.

**Protocol fee:** 2% on every transaction routed through Atlas (agent-driven purchases).

**Fee distribution:**

| Recipient | Share | Notes |
|-----------|-------|-------|
| Platform (you) | 40% of protocol fee (0.8% of transaction) | For hosting and processing the event |
| Atlas Protocol treasury | 40% of protocol fee (0.8% of transaction) | For registry operations, SDK maintenance, agent ecosystem |
| Organizer USDC reward | 20% of protocol fee (0.4% of transaction) | Cashback to the event organizer |

**Example:** An agent purchases a $50 ticket on your platform via Atlas.
- Total protocol fee: $1.00 (2% of $50)
- Your platform receives: $0.40
- Atlas treasury receives: $0.40
- Organizer cashback: $0.20

### 11.2 Organizer Retention

Atlas drives a retention flywheel for your platform:
1. Agents sell tickets to your organizers' events
2. Organizers receive USDC cashback rewards
3. Organizers see incremental revenue they did not have before
4. Organizers stay on your platform (and tell other organizers)

### 11.3 Fee Waiver (First Year)

For the first 12 months after registration, the protocol fee is waived. Your platform keeps 100% of ticket revenue from agent-driven sales. After 12 months, the 2% protocol fee activates with the distribution above.

### 11.4 Fee Settlement

Protocol fees are settled in USDC on Tempo to your registered payment wallet. Settlement occurs daily for the previous day's transactions. You receive a detailed settlement report via the registry dashboard.

### 11.5 Analytics Dashboard

Registered platforms get access to an analytics dashboard at `dashboard.atlas-protocol.org` showing:
- Agent-driven discovery volume (search queries hitting your events)
- Conversion funnel (search -> ticket view -> purchase)
- Revenue from Atlas-sourced purchases
- Top-performing events by agent traffic
- Agent distribution (which AI systems are driving purchases)

---

## 12. FAQ

### Do I need to change my existing checkout flow?

No. Level 1 integration does not touch your checkout at all -- agents link users to your existing event page for purchase. Level 2+ adds a parallel purchase path (MPP 402) that runs alongside your existing checkout, not instead of it.

### What happens if my platform is down? Do agents see errors?

The registry marks your platform as `degraded` after failed health checks and stops including your events in federated search results until you recover. Agents that have cached your events directly may still attempt requests and receive errors -- your standard error handling applies.

### Can I choose which events are discoverable via Atlas?

Yes. Your adapter's `searchEvents` and `listTicketTypes` methods control what is returned. You can filter by any criteria -- only public events, only events with agent sales enabled, only events in certain categories. The SDK does not bypass your data layer.

### What about private or invite-only events?

Do not return them from `searchEvents` or `listTicketTypes`. Atlas only exposes what your adapter returns. Private events remain private.

### Do I need to support both Tempo and Stripe SPT?

No. Support whichever payment methods work for your platform. If you only accept Stripe, declare only Stripe in your manifest. Agents that only have Tempo credentials will not attempt to purchase from your platform -- they see your accepted methods in the manifest and filter accordingly.

### Can I set different prices for agent purchases vs. direct purchases?

Atlas requires that prices returned by `listTicketTypes` match what agents will be charged. Price discrimination between channels is not supported by the protocol and would violate compliance.

### How do I handle events with approval-required tickets?

If your adapter's `createHold` detects that the ticket type requires host approval, throw an `AtlasError` with code `APPROVAL_REQUIRED`. The SDK responds with HTTP 202 Accepted and the appropriate approval flow metadata. The agent can poll for approval status or provide a callback URL.

### What is the minimum data I need to provide for an event?

Required fields: `id`, `title`, `description`, `start`, `end`, `canonicalUrl`, `currency`. All other fields are optional but improve discoverability. Events without `latitude`/`longitude` will not appear in geo-search results.

### Can I rate-limit agent traffic independently from my web traffic?

Yes. The Atlas middleware runs on its own route prefix (`/atlas/v1`). You can apply different rate limits to these routes using your existing rate limiting infrastructure. Additionally, declare your limits in the `AtlasServer` config and agents will respect them proactively.

### What happens if I unregister from the Atlas Registry?

Your platform is removed from federated search results. Agents that have cached your endpoints directly may still send requests until their cache expires. Your Atlas endpoints continue to function -- they just are not discoverable via the registry. You can re-register at any time.
