# @atlas/sdk Server SDK Specification

**Package:** `@atlas/sdk`
**Version:** 1.0.0
**Runtime:** Node.js 18+
**Language:** TypeScript 5.0+ (ships ESM + CJS, includes type declarations)
**License:** MIT
**Last Updated:** 2026-03-19

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Core Types](#2-core-types)
3. [AtlasServer](#3-atlasserver)
4. [AtlasAdapter Interface](#4-atlasadapter-interface)
5. [Middleware Integration](#5-middleware-integration)
6. [Manifest Generation](#6-manifest-generation)
7. [MPP Integration](#7-mpp-integration)
8. [Verifiable Credentials](#8-verifiable-credentials)
9. [Hold Management](#9-hold-management)
10. [Event Hooks](#10-event-hooks)
11. [Error Handling](#11-error-handling)
12. [Rate Limiting](#12-rate-limiting)
13. [Validation](#13-validation)
14. [Testing Utilities](#14-testing-utilities)
15. [Package Structure](#15-package-structure)

---

## 1. Architecture

### Design Principles

1. **Adapter pattern.** The SDK does not touch your database. You implement `AtlasAdapter` methods that map your data to Atlas schemas. The SDK handles HTTP routing, schema validation, MPP mechanics, and manifest generation.

2. **Middleware wrapping mppx.** The purchase flow wraps the `mppx` library for MPP 402 challenge-response. The SDK generates challenges, verifies payment credentials, and manages hold lifecycle -- your adapter only runs after payment is verified.

3. **Framework agnostic.** The SDK's core is a request/response handler. Framework-specific middleware (Express, Koa, Fastify, Hono, Next.js) are thin adapters that map framework-native request/response objects to the SDK's internal format.

4. **Progressive capability.** Implement only the adapter methods you need. The SDK detects which methods are implemented and auto-generates the manifest capabilities accordingly.

### Component Diagram

```
┌─────────────────────────────────────────────────────┐
│                    @atlas/sdk                        │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │   Manifest    │  │   Router     │  │   MPP     │ │
│  │  Generator    │  │  (routes     │  │  Handler  │ │
│  │              │  │   mapped to  │  │  (mppx    │ │
│  │  reads       │  │   adapter    │  │  wrapper) │ │
│  │  capabilities│  │   methods)   │  │           │ │
│  └──────────────┘  └──────┬───────┘  └─────┬─────┘ │
│                           │                │        │
│  ┌──────────────┐  ┌──────┴───────┐  ┌─────┴─────┐ │
│  │   Zod        │  │  Credential  │  │   Hold    │ │
│  │  Validators  │  │  Issuer      │  │  Manager  │ │
│  │              │  │  (DID:web    │  │  (TTL     │ │
│  │  (input/     │  │   + JWS)     │  │  indexed) │ │
│  │   output)    │  │              │  │           │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │           Framework Adapters                  │   │
│  │   Express | Koa | Fastify | Hono | Next.js   │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌──────────────────────┐
              │    YOUR ADAPTER      │
              │  (AtlasAdapter impl) │
              │                      │
              │  searchEvents()      │
              │  getEvent()          │
              │  listTicketTypes()   │
              │  createHold()        │
              │  completePurchase()  │
              │  validateDiscount()  │
              │  cancelTicket()      │
              │  verifyTicket()      │
              └──────────────────────┘
```

---

## 2. Core Types

All types are exported from `@atlas/sdk` and `@atlas/sdk/types`. Zod schemas are co-located with each type for runtime validation.

### AtlasEvent

```typescript
import { z } from 'zod';

export const AtlasEventSchema = z.object({
  /** Platform-specific unique event identifier */
  id: z.string().min(1),

  /** Event title */
  title: z.string().min(1).max(500),

  /** Event description (plain text or Markdown) */
  description: z.string().max(10000),

  /** Event start time (ISO 8601 with timezone) */
  start: z.string().datetime({ offset: true }),

  /** Event end time (ISO 8601 with timezone) */
  end: z.string().datetime({ offset: true }),

  /** Venue latitude */
  latitude: z.number().min(-90).max(90).optional(),

  /** Venue longitude */
  longitude: z.number().min(-180).max(180).optional(),

  /** Structured address */
  address: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    country: z.string().length(2).optional(), // ISO 3166-1 alpha-2
    postalCode: z.string().optional(),
  }).optional(),

  /** Cover image URL */
  coverImageUrl: z.string().url().optional(),

  /** Human-readable event page on the source platform */
  canonicalUrl: z.string().url(),

  /** Primary currency (ISO 4217) */
  currency: z.string().length(3),

  /** Price range across all ticket types */
  priceRange: z.object({
    min: z.string(), // Decimal string in smallest currency unit
    max: z.string(),
    currency: z.string().length(3),
  }).optional(),

  /** Availability summary */
  availability: z.object({
    status: z.enum(['available', 'sold_out', 'limited', 'cancelled']),
    totalCapacity: z.number().int().nonnegative().optional(),
    remaining: z.number().int().nonnegative().optional(),
  }).optional(),

  /** Event categories (controlled vocabulary) */
  categories: z.array(z.string()).optional(),

  /** Minimum age requirement */
  ageRestriction: z.number().int().nonnegative().optional(),

  /** Organizer information */
  organizer: z.object({
    name: z.string(),
    url: z.string().url().optional(),
  }).optional(),

  /** Source platform identifier */
  platform: z.string().optional(), // Auto-set by SDK

  /** Last update timestamp */
  updatedAt: z.string().datetime({ offset: true }).optional(),
});

export type AtlasEvent = z.infer<typeof AtlasEventSchema>;
```

### AtlasTicketType

```typescript
export const AtlasTicketTypeSchema = z.object({
  /** Platform-specific unique ticket type identifier */
  id: z.string().min(1),

  /** Ticket type name */
  title: z.string().min(1).max(200),

  /** Ticket type description */
  description: z.string().max(2000).optional(),

  /** Pricing */
  pricing: z.object({
    /** ISO 4217 currency code */
    currency: z.string().length(3),

    /** Price in smallest currency unit (string to avoid float precision) */
    cost: z.string(),

    /** Fee breakdown (optional, improves agent transparency) */
    fees: z.object({
      platformFee: z.string().optional(),
      processingFee: z.string().optional(),
      taxes: z.string().optional(),
      total: z.string(),
    }).optional(),
  }),

  /** Availability */
  availability: z.object({
    /** Whether tickets can currently be purchased */
    status: z.enum(['available', 'sold_out', 'limited', 'not_on_sale']),

    /** Remaining tickets (null if undisclosed) */
    remaining: z.number().int().nonnegative().nullable().optional(),

    /** Maximum tickets per purchase */
    limitPerPurchase: z.number().int().positive().optional(),
  }),

  /** Whether host approval is required before purchase */
  approvalRequired: z.boolean().default(false),

  /** Whether a passcode is needed */
  passcodeRequired: z.boolean().default(false),

  /** Whether token-gated */
  tokenGated: z.boolean().default(false),

  /** Token gate details (if token-gated) */
  tokenGateInfo: z.object({
    requiredTokens: z.array(z.object({
      network: z.string(),
      contract: z.string(),
      name: z.string().optional(),
      minBalance: z.number(),
    })),
  }).optional(),

  /** Cancellation policy */
  cancellationPolicy: z.object({
    refundable: z.boolean(),
    refundDeadline: z.string().datetime({ offset: true }).optional(),
    refundPercentage: z.number().min(0).max(100).optional(),
  }).optional(),

  /** Sales window */
  salesStart: z.string().datetime({ offset: true }).optional(),
  salesEnd: z.string().datetime({ offset: true }).optional(),

  /** Accepted payment methods for this ticket type */
  acceptedPaymentMethods: z.array(z.string()).optional(),
});

export type AtlasTicketType = z.infer<typeof AtlasTicketTypeSchema>;
```

### AtlasHold

```typescript
export const AtlasHoldSchema = z.object({
  /** Unique hold identifier */
  holdId: z.string().min(1),

  /** When this hold expires (ISO 8601) */
  expiresAt: z.string().datetime({ offset: true }),

  /** Ticket type ID being held */
  ticketTypeId: z.string(),

  /** Number of tickets held */
  quantity: z.number().int().positive(),

  /** Unit price at time of hold (string, smallest currency unit) */
  unitPrice: z.string(),

  /** Currency */
  currency: z.string().length(3),

  /** Total price (unitPrice * quantity, string) */
  totalPrice: z.string(),

  /** Discount applied (if any) */
  discount: z.object({
    code: z.string(),
    amount: z.string(),
    originalTotal: z.string(),
  }).optional(),
});

export type AtlasHold = z.infer<typeof AtlasHoldSchema>;
```

### AtlasReceipt

```typescript
export const AtlasReceiptSchema = z.object({
  /** Unique receipt identifier */
  receiptId: z.string().min(1),

  /** Event summary */
  event: z.object({
    id: z.string(),
    title: z.string(),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    address: z.object({
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
    }).optional(),
  }),

  /** Issued tickets */
  tickets: z.array(z.object({
    ticketId: z.string(),
    shortId: z.string().optional(),
    ticketTypeTitle: z.string(),
    status: z.enum(['active', 'pending_approval']),
    /** Verifiable credential (Level 3) */
    credential: z.unknown().optional(),
    /** Raw QR code data for agent rendering */
    qrCodeData: z.string().optional(),
  })),

  /** Payment details */
  payment: z.object({
    amount: z.string(),
    currency: z.string().length(3),
    method: z.enum(['tempo_usdc', 'stripe_spt']),
    transactionId: z.string(),
  }),

  /** Discount applied */
  discount: z.object({
    code: z.string(),
    originalAmount: z.string(),
    discountAmount: z.string(),
    finalAmount: z.string(),
  }).optional(),

  /** Ticket URLs (deep links to the platform's ticket view) */
  ticketUrls: z.array(z.string().url()).optional(),

  /** Buyer info */
  buyer: z.object({
    email: z.string().email(),
    name: z.string().optional(),
  }),

  /** Purchase timestamp */
  purchasedAt: z.string().datetime({ offset: true }),

  /** Cancellation info (Level 3) */
  cancellation: z.object({
    url: z.string().url().optional(),
    deadline: z.string().datetime({ offset: true }).optional(),
  }).optional(),
});

export type AtlasReceipt = z.infer<typeof AtlasReceiptSchema>;
```

### AtlasVerifiedPayment

Passed to your `completePurchase` adapter method after the SDK verifies the payment credential.

```typescript
export interface AtlasVerifiedPayment {
  /** Payment method used */
  method: 'tempo_usdc' | 'stripe_spt';

  /** Amount paid (string, smallest currency unit) */
  amount: string;

  /** Currency (ISO 4217) */
  currency: string;

  /** On-chain transaction ID or Stripe payment intent ID */
  transactionId: string;

  /** Payer identifier (wallet address or Stripe customer ID) */
  payerId: string;

  /** Raw verification result from mppx */
  raw: Record<string, unknown>;
}
```

### AtlasBuyerInfo

```typescript
export interface AtlasBuyerInfo {
  /** Buyer email (required) */
  email: string;

  /** Buyer name */
  name?: string;

  /** Multiple attendees for batch purchase */
  attendees?: Array<{ name: string; email: string }>;

  /** Callback URL for async notifications (approval decisions, cancellations) */
  callbackUrl?: string;
}
```

### AtlasDiscountResult

```typescript
export interface AtlasDiscountResult {
  /** Whether the discount code is valid */
  valid: boolean;

  /** Error reason if invalid */
  error?: 'invalid_code' | 'expired' | 'exhausted' | 'not_applicable';

  /** Adjusted pricing if valid */
  pricing?: {
    originalTotal: string;
    discountAmount: string;
    finalTotal: string;
    currency: string;
  };
}
```

### AtlasCancellationResult

```typescript
export interface AtlasCancellationResult {
  /** Cancellation status */
  status: 'cancelled' | 'refund_pending' | 'refund_completed' | 'not_refundable';

  /** Refund details */
  refund?: {
    amount: string;
    currency: string;
    method: string;
    estimatedArrival?: string; // ISO 8601
  };
}
```

### AtlasVerificationResult

```typescript
export interface AtlasVerificationResult {
  /** Whether the ticket is valid for check-in */
  valid: boolean;

  /** Reason if invalid */
  reason?: 'invalid_credential' | 'ticket_inactive' | 'already_checked_in' | 'wrong_event';

  /** Ticket details (returned on valid) */
  ticket?: {
    ticketId: string;
    ticketType: string;
    attendeeName?: string;
    attendeeEmail?: string;
    eventId: string;
    eventTitle: string;
  };
}
```

### AtlasConfig

```typescript
export interface AtlasConfig {
  /** Unique platform identifier (lowercase, alphanumeric + hyphens) */
  platformId: string;

  /** Human-readable platform name */
  platformName: string;

  /** Platform public URL */
  platformUrl: string;

  /** Platform logo URL */
  logoUrl?: string;

  /** Atlas capabilities this platform supports */
  capabilities: AtlasCapability[];

  /** Accepted payment methods */
  paymentMethods: AtlasPaymentMethodConfig[];

  /** Event categories */
  categories?: string[];

  /** Geographic coverage (ISO 3166-1 alpha-2 country codes, or ['global']) */
  geographicCoverage?: string[];

  /** Rate limit declarations */
  rateLimits?: {
    discovery?: { requestsPerMinute: number; burst?: number };
    purchase?: { requestsPerMinute: number; burst?: number };
  };

  /** Contact emails */
  contact?: {
    technical?: string;
    abuse?: string;
  };

  /** MPP configuration */
  mpp?: {
    /** Facilitator URI for payment verification */
    facilitatorUri?: string;

    /** Default hold duration in milliseconds (default: 600000 = 10 minutes) */
    defaultHoldDurationMs?: number;

    /** Minimum hold duration in milliseconds (default: 300000 = 5 minutes) */
    minHoldDurationMs?: number;
  };

  /** Verifiable Credentials configuration (Level 3) */
  credentials?: {
    /** DID for credential issuance (e.g., 'did:web:myplatform.com') */
    issuerDid: string;

    /** JWK private key for signing credentials */
    signingKey: JsonWebKey;

    /** Key ID in DID document */
    verificationMethodId: string;
  };

  /** Environment */
  environment?: 'production' | 'sandbox';
}

export type AtlasCapability =
  | 'search'
  | 'ticket_listing'
  | 'purchase'
  | 'discount_validation'
  | 'cancellation'
  | 'batch_purchase'
  | 'verifiable_credentials';
```

### AtlasPaymentMethodConfig

```typescript
export type AtlasPaymentMethodConfig =
  | {
      type: 'tempo_usdc';
      network: 'tempo' | 'tempo-testnet';
      walletAddress: string;
    }
  | {
      type: 'stripe_spt';
      stripeAccountId: string;
      stripeSecretKey: string;
    };
```

---

## 3. AtlasServer

The main SDK entry point. Creates the server instance, accepts configuration and adapter, and produces framework-specific middleware.

### Constructor

```typescript
import { AtlasServer } from '@atlas/sdk';

const atlas = new AtlasServer(config: AtlasConfig);
```

### Methods

```typescript
class AtlasServer {
  /** Set the adapter that bridges Atlas to your platform's data layer */
  setAdapter(adapter: AtlasAdapter): void;

  /** Get the auto-generated manifest object */
  getManifest(): AtlasManifest;

  // ─── Framework Middleware ─────────────────────────────────────

  /** Express/Connect middleware */
  expressMiddleware(): express.Router;

  /** Express handler for /.well-known/atlas.json */
  manifestHandler(): express.RequestHandler;

  /** Koa middleware */
  koaMiddleware(): KoaRouter.Middleware;

  /** Koa handler for manifest */
  koaManifestHandler(): KoaRouter.Middleware;

  /** Fastify plugin */
  fastifyPlugin(): FastifyPluginCallback;

  /** Hono middleware */
  honoMiddleware(): HonoMiddleware;

  /** Hono manifest handler */
  honoManifestHandler(): HonoMiddleware;

  /** Next.js App Router handler (combined GET + POST) */
  nextHandler(): (req: NextRequest) => Promise<NextResponse>;

  /** Next.js manifest handler */
  nextManifestHandler(): (req: NextRequest) => Promise<NextResponse>;

  // ─── Event Mapping Helpers ────────────────────────────────────

  /** Map a raw platform event object to AtlasEvent using a field mapping */
  mapEvent(raw: Record<string, unknown>, mapping: AtlasEventMapping): AtlasEvent;

  /** Map a raw platform ticket type to AtlasTicketType */
  mapTicketType(raw: Record<string, unknown>, mapping: AtlasTicketTypeMapping): AtlasTicketType;

  // ─── Event Hooks ──────────────────────────────────────────────

  /** Register a callback for SDK events */
  on<E extends AtlasHookEvent>(event: E, handler: AtlasHookHandler<E>): void;

  /** Remove a callback */
  off<E extends AtlasHookEvent>(event: E, handler: AtlasHookHandler<E>): void;
}
```

### Full Usage Example

```typescript
import express from 'express';
import { AtlasServer } from '@atlas/sdk';
import { db } from './db';

const atlas = new AtlasServer({
  platformId: 'acme-events',
  platformName: 'Acme Events',
  platformUrl: 'https://acme.events',
  capabilities: ['search', 'ticket_listing', 'purchase', 'discount_validation'],
  paymentMethods: [
    { type: 'tempo_usdc', network: 'tempo', walletAddress: process.env.TEMPO_WALLET! },
    { type: 'stripe_spt', stripeAccountId: process.env.STRIPE_ACCOUNT!, stripeSecretKey: process.env.STRIPE_SECRET! },
  ],
  rateLimits: {
    discovery: { requestsPerMinute: 60, burst: 10 },
    purchase: { requestsPerMinute: 10, burst: 3 },
  },
  mpp: {
    facilitatorUri: 'https://facilitator.atlas-protocol.org',
    defaultHoldDurationMs: 600_000,
  },
});

atlas.setAdapter({
  async searchEvents(query) {
    const rows = await db.query(
      `SELECT * FROM events
       WHERE published = true AND end_time > NOW()
       AND ($1::text IS NULL OR city ILIKE $1)
       AND ($2::timestamp IS NULL OR start_time >= $2)
       AND ($3::timestamp IS NULL OR start_time <= $3)
       ORDER BY start_time ASC
       LIMIT $4 OFFSET $5`,
      [query.city, query.startAfter, query.startBefore, query.limit || 20, query.skip || 0]
    );
    return rows.map(r => atlas.mapEvent(r, acmeEventMapping));
  },

  async getEvent(eventId) {
    const row = await db.query('SELECT * FROM events WHERE id = $1 AND published = true', [eventId]);
    return row ? atlas.mapEvent(row, acmeEventMapping) : null;
  },

  async listTicketTypes(eventId) {
    const rows = await db.query(
      'SELECT * FROM ticket_types WHERE event_id = $1 AND hidden = false',
      [eventId]
    );
    return rows.map(r => atlas.mapTicketType(r, acmeTicketMapping));
  },

  async createHold(eventId, ticketTypeId, quantity, durationMs) {
    const tt = await db.query('SELECT * FROM ticket_types WHERE id = $1', [ticketTypeId]);
    if (!tt) throw new AtlasError('TICKET_TYPE_NOT_FOUND', 404);
    if (tt.capacity - tt.sold < quantity) {
      throw new AtlasError('INSUFFICIENT_TICKETS', 409, { available: tt.capacity - tt.sold });
    }
    const hold = await db.query(
      `INSERT INTO holds (event_id, ticket_type_id, quantity, expires_at)
       VALUES ($1, $2, $3, NOW() + interval '1 millisecond' * $4)
       RETURNING *`,
      [eventId, ticketTypeId, quantity, durationMs]
    );
    return {
      holdId: hold.id,
      expiresAt: hold.expires_at.toISOString(),
      ticketTypeId,
      quantity,
      unitPrice: tt.price_cents.toString(),
      currency: tt.currency,
      totalPrice: (tt.price_cents * quantity).toString(),
    };
  },

  async completePurchase(holdId, payment, buyerInfo) {
    // Called ONLY after SDK verifies payment
    return await db.transaction(async (tx) => {
      const hold = await tx.query('SELECT * FROM holds WHERE id = $1 FOR UPDATE', [holdId]);
      if (!hold || hold.status !== 'active' || new Date() > hold.expires_at) {
        throw new AtlasError('HOLD_EXPIRED', 410);
      }
      const event = await tx.query('SELECT * FROM events WHERE id = $1', [hold.event_id]);
      const tt = await tx.query('SELECT * FROM ticket_types WHERE id = $1', [hold.ticket_type_id]);

      const tickets = [];
      for (let i = 0; i < hold.quantity; i++) {
        const ticket = await tx.query(
          `INSERT INTO tickets (event_id, ticket_type_id, buyer_email, buyer_name, status, source)
           VALUES ($1, $2, $3, $4, 'active', 'atlas_agent') RETURNING *`,
          [hold.event_id, hold.ticket_type_id, buyerInfo.email, buyerInfo.name]
        );
        tickets.push(ticket);
      }

      await tx.query('UPDATE ticket_types SET sold = sold + $1 WHERE id = $2', [hold.quantity, hold.ticket_type_id]);
      await tx.query("UPDATE holds SET status = 'completed' WHERE id = $1", [holdId]);

      return {
        receiptId: `rcpt_${hold.id}`,
        event: { id: event.id, title: event.name, start: event.start_time.toISOString(), end: event.end_time.toISOString() },
        tickets: tickets.map(t => ({ ticketId: t.id, shortId: t.short_code, ticketTypeTitle: tt.name, status: 'active' as const })),
        payment: { amount: payment.amount, currency: payment.currency, method: payment.method, transactionId: payment.transactionId },
        buyer: { email: buyerInfo.email, name: buyerInfo.name },
        purchasedAt: new Date().toISOString(),
      };
    });
  },

  async validateDiscount(eventId, code, ticketTypeId, quantity) {
    const discount = await db.query(
      'SELECT * FROM discounts WHERE event_id = $1 AND code = $2 AND active = true',
      [eventId, code.toUpperCase()]
    );
    if (!discount) return { valid: false, error: 'invalid_code' as const };
    if (discount.uses >= discount.max_uses) return { valid: false, error: 'exhausted' as const };

    const tt = await db.query('SELECT * FROM ticket_types WHERE id = $1', [ticketTypeId]);
    const originalTotal = tt.price_cents * quantity;
    const discountAmount = Math.round(originalTotal * discount.ratio);

    return {
      valid: true,
      pricing: {
        originalTotal: originalTotal.toString(),
        discountAmount: discountAmount.toString(),
        finalTotal: (originalTotal - discountAmount).toString(),
        currency: tt.currency,
      },
    };
  },
});

// Hook into SDK events for monitoring
atlas.on('purchase.complete', (_eventId, receipt) => {
  console.log(`Atlas purchase: ${receipt.receiptId} - ${receipt.payment.amount} ${receipt.payment.currency}`);
});

const app = express();
app.use('/.well-known/atlas.json', atlas.manifestHandler());
app.use('/atlas/v1', atlas.expressMiddleware());
app.listen(3000, () => console.log('Atlas-compliant server on :3000'));
```

---

## 4. AtlasAdapter Interface

See [Section 5 of PLATFORM-INTEGRATION-GUIDE.md](./PLATFORM-INTEGRATION-GUIDE.md#5-the-atlasadapter-interface) for the full interface definition with detailed JSDoc. The SDK detects which optional methods are implemented:

| Method | Level | Capability | Required |
|--------|-------|-----------|----------|
| `searchEvents` | 1 | `search` | Yes |
| `getEvent` | 1 | `search` | Yes |
| `listTicketTypes` | 1 | `ticket_listing` | Yes |
| `createHold` | 2 | `purchase` | No |
| `completePurchase` | 2 | `purchase` | No |
| `validateDiscount` | 3 | `discount_validation` | No |
| `cancelTicket` | 3 | `cancellation` | No |
| `verifyTicket` | 3 | `verifiable_credentials` | No |

If you declare `purchase` in capabilities but do not implement `createHold` and `completePurchase`, the SDK throws at startup:

```
AtlasConfigError: Capability 'purchase' requires adapter methods: createHold, completePurchase
```

---

## 5. Middleware Integration

The SDK's core is a framework-agnostic request handler. Each middleware adapter translates between the framework's request/response format and the SDK's internal `AtlasRequest` / `AtlasResponse` types.

### Internal Handler

```typescript
// Internal -- not exported directly, but documented for understanding
interface AtlasRequest {
  method: 'GET' | 'POST';
  path: string;
  query: Record<string, string | string[]>;
  body: unknown;
  headers: Record<string, string>;
}

interface AtlasResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

type AtlasHandler = (req: AtlasRequest) => Promise<AtlasResponse>;
```

### Route Table

The SDK registers the following routes on the middleware prefix:

| Method | Path | Handler | Level |
|--------|------|---------|-------|
| `GET` | `/search` | Search events | 1 |
| `GET` | `/events/:eventId` | Get event detail | 1 |
| `GET` | `/events/:eventId/tickets` | List ticket types | 1 |
| `POST` | `/events/:eventId/purchase` | Purchase flow (402 + fulfillment) | 2 |
| `POST` | `/events/:eventId/validate-discount` | Validate discount code | 3 |
| `POST` | `/tickets/:ticketId/cancel` | Cancel ticket | 3 |
| `POST` | `/tickets/:ticketId/verify` | Verify ticket credential | 3 |
| `GET` | `/holds/:holdId` | Check hold status | 2 |

Routes for capabilities not declared in config are not registered.

### Express

```typescript
import express from 'express';

const app = express();

// Manifest (must be at exact path for agent discovery)
app.use('/.well-known/atlas.json', atlas.manifestHandler());

// All Atlas API routes under /atlas/v1
app.use('/atlas/v1', atlas.expressMiddleware());

// The middleware is a standard express.Router
// It handles JSON parsing internally -- no need for express.json() on these routes
```

**Implementation detail:** The Express middleware creates an `express.Router()` with routes mapped to the SDK's internal handlers. Request body parsing uses `express.json({ limit: '10kb' })` scoped to the router.

### Koa

```typescript
import Koa from 'koa';
import Router from '@koa/router';

const app = new Koa();
const router = new Router();

// Manifest
router.get('/.well-known/atlas.json', atlas.koaManifestHandler());

// API routes
router.use('/atlas/v1', atlas.koaMiddleware());

app.use(router.routes()).use(router.allowedMethods());
```

**Implementation detail:** The Koa middleware reads `ctx.request.body` (requires `koa-bodyparser` or equivalent) and writes to `ctx.status`, `ctx.set()`, and `ctx.body`.

### Fastify

```typescript
import Fastify from 'fastify';

const fastify = Fastify();

// Fastify plugin registers both manifest and API routes
await fastify.register(atlas.fastifyPlugin(), { prefix: '/atlas/v1' });

// Manifest is auto-registered at /.well-known/atlas.json
// (outside the prefix, at the root level)
```

**Implementation detail:** The Fastify plugin uses `fastify.register()` with route declarations. Body parsing is handled by Fastify's built-in JSON parser.

### Hono

```typescript
import { Hono } from 'hono';

const app = new Hono();

app.get('/.well-known/atlas.json', atlas.honoManifestHandler());
app.route('/atlas/v1', atlas.honoMiddleware());

export default app; // Works with Cloudflare Workers, Deno, Bun
```

### Next.js (App Router)

```typescript
// lib/atlas.ts
import { AtlasServer } from '@atlas/sdk';

export const atlas = new AtlasServer({ /* config */ });
atlas.setAdapter({ /* your adapter */ });

// app/.well-known/atlas.json/route.ts
import { atlas } from '@/lib/atlas';
export const GET = atlas.nextManifestHandler();

// app/atlas/v1/[...path]/route.ts
import { atlas } from '@/lib/atlas';
export const GET = atlas.nextHandler();
export const POST = atlas.nextHandler();
```

**Implementation detail:** The Next.js handler uses `NextRequest` and `NextResponse`. It parses the path segments from the catch-all `[...path]` parameter to determine routing.

---

## 6. Manifest Generation

The SDK auto-generates the `/.well-known/atlas.json` manifest from your `AtlasConfig` and the adapter methods you implement.

### Generated Manifest Schema

```typescript
export interface AtlasManifest {
  'atlas:version': '1.0';
  platform: {
    id: string;
    name: string;
    url: string;
    logo?: string;
    description?: string;
  };
  endpoints: {
    search?: string;
    event?: string;        // Template: /atlas/v1/events/{eventId}
    tickets?: string;      // Template: /atlas/v1/events/{eventId}/tickets
    purchase?: string;     // Template: /atlas/v1/events/{eventId}/purchase
    validateDiscount?: string;
    cancel?: string;
    verifyTicket?: string;
  };
  capabilities: AtlasCapability[];
  paymentMethods: Array<{
    type: string;
    network?: string;
    currencies: string[];
  }>;
  geographicCoverage: string[];
  categories: string[];
  rateLimit: {
    discovery?: { requestsPerMinute: number; burst?: number };
    purchase?: { requestsPerMinute: number; burst?: number };
  };
  contact: {
    technical?: string;
    abuse?: string;
  };
}
```

### Example Output

For a server configured with `capabilities: ['search', 'ticket_listing', 'purchase']` and deployed at `https://acme.events`:

```json
{
  "atlas:version": "1.0",
  "platform": {
    "id": "acme-events",
    "name": "Acme Events",
    "url": "https://acme.events"
  },
  "endpoints": {
    "search": "https://acme.events/atlas/v1/search",
    "event": "https://acme.events/atlas/v1/events/{eventId}",
    "tickets": "https://acme.events/atlas/v1/events/{eventId}/tickets",
    "purchase": "https://acme.events/atlas/v1/events/{eventId}/purchase"
  },
  "capabilities": ["search", "ticket_listing", "purchase"],
  "paymentMethods": [
    { "type": "tempo_usdc", "network": "tempo", "currencies": ["USD"] },
    { "type": "stripe_spt", "currencies": ["USD", "EUR", "GBP"] }
  ],
  "geographicCoverage": ["global"],
  "categories": [],
  "rateLimit": {
    "discovery": { "requestsPerMinute": 60, "burst": 10 },
    "purchase": { "requestsPerMinute": 10, "burst": 3 }
  },
  "contact": {}
}
```

### Endpoint URL Resolution

The SDK needs to know your public base URL to generate absolute endpoint URLs in the manifest. It resolves this in order:

1. `config.platformUrl` + the middleware mount path
2. The `X-Forwarded-Host` / `Host` header from the manifest request
3. Falls back to relative paths if neither is available

You can override explicitly:

```typescript
const atlas = new AtlasServer({
  // ...
  manifest: {
    baseUrl: 'https://api.acme.events/atlas/v1',
  },
});
```

---

## 7. MPP Integration

The SDK wraps `mppx` for the MPP 402 challenge-response flow. This section describes the internal mechanics.

### 7.1 Purchase Endpoint Flow

```
POST /atlas/v1/events/:eventId/purchase
```

```typescript
// Simplified internal implementation (pseudo-code)
async function handlePurchase(req: AtlasRequest): Promise<AtlasResponse> {
  const { eventId } = req.params;
  const body = PurchaseRequestSchema.parse(req.body);
  // body: { ticketTypeId, quantity, buyerEmail, buyerName, discountCode?, passcode?, callbackUrl?, idempotencyKey? }

  // 1. Idempotency check
  if (body.idempotencyKey) {
    const existing = await holdManager.getIdempotencyResult(body.idempotencyKey);
    if (existing) return { status: 200, headers: {}, body: existing };
  }

  // 2. Validate via adapter
  const event = await adapter.getEvent(eventId);
  if (!event) return errorResponse(404, 'EVENT_NOT_FOUND');

  const ticketTypes = await adapter.listTicketTypes(eventId);
  const ticketType = ticketTypes.find(t => t.id === body.ticketTypeId);
  if (!ticketType) return errorResponse(404, 'TICKET_TYPE_NOT_FOUND');

  if (ticketType.availability.status === 'sold_out') {
    return errorResponse(410, 'SOLD_OUT');
  }

  // 3. Check for payment credential
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Payment ')) {
    // No credential: create hold + issue 402 challenge

    // Calculate price (with optional discount)
    let totalPrice = BigInt(ticketType.pricing.cost) * BigInt(body.quantity);
    let discountInfo: AtlasHold['discount'] | undefined;

    if (body.discountCode && adapter.validateDiscount) {
      const discountResult = await adapter.validateDiscount(
        eventId, body.discountCode, body.ticketTypeId, body.quantity
      );
      if (discountResult.valid && discountResult.pricing) {
        totalPrice = BigInt(discountResult.pricing.finalTotal);
        discountInfo = {
          code: body.discountCode,
          amount: discountResult.pricing.discountAmount,
          originalTotal: discountResult.pricing.originalTotal,
        };
      }
    }

    // Create hold via adapter
    const hold = await adapter.createHold!(
      eventId,
      body.ticketTypeId,
      body.quantity,
      config.mpp?.defaultHoldDurationMs ?? 600_000,
    );

    // Store hold metadata for verification step
    await holdManager.store(hold.holdId, {
      ...hold,
      eventId,
      buyerEmail: body.buyerEmail,
      buyerName: body.buyerName,
      discountCode: body.discountCode,
      idempotencyKey: body.idempotencyKey,
      discount: discountInfo,
    });

    // Generate 402 challenge
    const challenge = buildMppChallenge(hold, totalPrice.toString(), ticketType.pricing.currency);

    return {
      status: 402,
      headers: {
        'X-Payment': JSON.stringify(challenge),
        'WWW-Authenticate': 'Payment realm="atlas"',
      },
      body: {
        status: 'payment_required',
        holdId: hold.holdId,
        expiresAt: hold.expiresAt,
        amount: totalPrice.toString(),
        currency: ticketType.pricing.currency,
        ...challenge,
      },
    };
  }

  // 4. Has credential: verify payment
  const credential = authHeader.slice('Payment '.length);
  const holdId = body.holdId || req.headers['x-atlas-hold-id'];

  const holdData = await holdManager.get(holdId);
  if (!holdData) return errorResponse(410, 'HOLD_EXPIRED');

  const verification = await mppVerify(credential, {
    facilitatorUri: config.mpp?.facilitatorUri,
    expectedAmount: holdData.totalPrice,
    expectedCurrency: holdData.currency,
  });

  if (!verification.valid) {
    return errorResponse(401, 'PAYMENT_INVALID', verification.error);
  }

  // 5. Payment verified -- call adapter to issue tickets
  const receipt = await adapter.completePurchase!(holdId, {
    method: verification.method,
    amount: verification.amount,
    currency: verification.currency,
    transactionId: verification.transactionId,
    payerId: verification.payerId,
    raw: verification.raw,
  }, {
    email: holdData.buyerEmail,
    name: holdData.buyerName,
    callbackUrl: holdData.callbackUrl,
  });

  // 6. Issue verifiable credential if configured
  if (config.credentials && receipt.tickets) {
    for (const ticket of receipt.tickets) {
      ticket.credential = await issueCredential(config.credentials, {
        ticketId: ticket.ticketId,
        eventId: holdData.eventId,
        ticketType: ticket.ticketTypeTitle,
        validFrom: receipt.event.start,
        validUntil: receipt.event.end,
      });
      ticket.qrCodeData = buildQrData(ticket.ticketId, ticket.credential);
    }
  }

  // 7. Store idempotency result
  if (holdData.idempotencyKey) {
    await holdManager.storeIdempotencyResult(holdData.idempotencyKey, receipt);
  }

  // 8. Consume hold
  await holdManager.consume(holdId);

  // 9. Emit hook
  hooks.emit('purchase.complete', holdData.eventId, receipt);

  return {
    status: 200,
    headers: { 'X-Receipt': computeReceiptHash(receipt) },
    body: receipt,
  };
}
```

### 7.2 402 Challenge Format

```typescript
function buildMppChallenge(
  hold: AtlasHold,
  amount: string,
  currency: string,
): MppChallenge {
  return {
    amount,
    currency,
    network: getPaymentNetwork(), // 'tempo' or Stripe context
    acceptedMethods: config.paymentMethods.map(pm => ({
      type: pm.type,
      ...(pm.type === 'tempo_usdc' ? {
        network: pm.network,
        recipient: pm.walletAddress,
      } : {
        stripeAccountId: pm.stripeAccountId,
      }),
    })),
    facilitatorUri: config.mpp?.facilitatorUri || 'https://facilitator.atlas-protocol.org',
    holdId: hold.holdId,
    expiresAt: hold.expiresAt,
    resource: `atlas://${config.platformId}/events/${hold.ticketTypeId}/purchase`,
  };
}
```

### 7.3 Payment Verification

```typescript
import { verifyPayment } from 'mppx';

async function mppVerify(
  credential: string,
  params: { facilitatorUri?: string; expectedAmount: string; expectedCurrency: string },
): Promise<MppVerificationResult> {
  try {
    const result = await verifyPayment(credential, {
      facilitatorUri: params.facilitatorUri,
    });

    // Verify amount matches what we challenged
    if (result.amount !== params.expectedAmount) {
      return { valid: false, error: 'Amount mismatch' };
    }

    return {
      valid: true,
      method: result.network === 'tempo' ? 'tempo_usdc' : 'stripe_spt',
      amount: result.amount,
      currency: result.currency,
      transactionId: result.transactionId,
      payerId: result.payerId,
      raw: result,
    };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}
```

### 7.4 Purchase Request Schema

```typescript
const PurchaseRequestSchema = z.object({
  ticketTypeId: z.string().min(1),
  quantity: z.number().int().positive().max(10),
  buyerEmail: z.string().email(),
  buyerName: z.string().min(1).max(200).optional(),
  discountCode: z.string().max(50).optional(),
  passcode: z.string().max(50).optional(),
  callbackUrl: z.string().url().startsWith('https://').optional(),
  idempotencyKey: z.string().min(16).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  holdId: z.string().optional(), // Included in retry with payment credential

  /** Multiple attendees for batch purchase (Level 3) */
  attendees: z.array(z.object({
    name: z.string().min(1),
    email: z.string().email(),
  })).optional(),
});
```

---

## 8. Verifiable Credentials

Level 3 platforms can issue W3C Verifiable Credentials for tickets. The SDK handles credential issuance and verification using DID:web and JSON Web Signatures.

### 8.1 Configuration

```typescript
const atlas = new AtlasServer({
  // ...
  credentials: {
    // Your platform's DID (must match a DID document at /.well-known/did.json)
    issuerDid: 'did:web:acme.events',

    // Ed25519 or P-256 private key for signing
    signingKey: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: '<public key base64url>',
      d: '<private key base64url>',
    },

    // Key ID matching your DID document's verificationMethod
    verificationMethodId: 'did:web:acme.events#key-1',
  },
});
```

### 8.2 DID Document

Your platform must serve a DID document at `https://acme.events/.well-known/did.json`:

```json
{
  "@context": "https://www.w3.org/ns/did/v1",
  "id": "did:web:acme.events",
  "verificationMethod": [
    {
      "id": "did:web:acme.events#key-1",
      "type": "JsonWebKey2020",
      "controller": "did:web:acme.events",
      "publicKeyJwk": {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": "<public key base64url>"
      }
    }
  ],
  "assertionMethod": ["did:web:acme.events#key-1"]
}
```

### 8.3 Credential Issuance

The SDK issues credentials automatically when `config.credentials` is set and a purchase completes.

```typescript
// Internal implementation
async function issueCredential(
  credConfig: AtlasConfig['credentials'],
  params: {
    ticketId: string;
    eventId: string;
    ticketType: string;
    validFrom: string;
    validUntil: string;
  },
): Promise<VerifiableCredential> {
  const now = new Date().toISOString();

  const credential = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://atlas-protocol.org/credentials/v1',
    ],
    type: ['VerifiableCredential', 'EventTicketCredential'],
    issuer: credConfig!.issuerDid,
    issuanceDate: now,
    credentialSubject: {
      ticket_id: `atlas:${config.platformId}:${params.ticketId}`,
      event_id: `atlas:${config.platformId}:${params.eventId}`,
      ticket_type: params.ticketType,
      valid_from: params.validFrom,
      valid_until: params.validUntil,
    },
  };

  // Sign with JWS
  const jws = await signJws(credential, credConfig!.signingKey, credConfig!.verificationMethodId);

  return {
    ...credential,
    proof: {
      type: 'JsonWebSignature2020',
      created: now,
      verificationMethod: credConfig!.verificationMethodId,
      jws,
    },
  };
}
```

### 8.4 Credential Verification

```typescript
import { verifyCredential } from '@atlas/sdk';

// Agent or check-in system verifies a ticket credential
const result = await verifyCredential(credential);
// result: { valid: boolean; issuer: string; ticketId: string; eventId: string; expired: boolean }
```

The `verifyCredential` function:
1. Extracts the `issuer` DID from the credential
2. Resolves the DID document via `https://<domain>/.well-known/did.json`
3. Fetches the public key from the `verificationMethod` referenced in the proof
4. Verifies the JWS signature
5. Checks `valid_from` and `valid_until` against current time

### 8.5 QR Code Data

```typescript
function buildQrData(ticketId: string, credential: VerifiableCredential): string {
  // Compact format: ATLAS:1:<platform>:<ticketId>:<signature_base64url>
  const sig = credential.proof.jws;
  return `ATLAS:1:${config.platformId}:${ticketId}:${sig}`;
}
```

Agents receive the raw QR data string. They render the QR code in their own UI. Check-in systems scan the QR and call `verifyTicket` on the issuing platform or use the embedded signature for offline verification.

---

## 9. Hold Management

The SDK provides a built-in hold manager with TTL-based expiration. Platforms can use the default in-memory store (development) or provide a Redis/database-backed store (production).

### 9.1 Default In-Memory Store

```typescript
// Used automatically if no custom store is provided
// Suitable for development and single-instance deployments
const atlas = new AtlasServer({ /* ... */ });
// Holds are stored in a Map with setTimeout-based expiration
```

### 9.2 Redis Store

```typescript
import { RedisHoldStore } from '@atlas/sdk';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

const atlas = new AtlasServer({
  // ...
  holdStore: new RedisHoldStore(redis, {
    keyPrefix: 'atlas:hold:',
    idempotencyPrefix: 'atlas:idempotent:',
    idempotencyTtlSeconds: 86400, // 24 hours
  }),
});
```

### 9.3 Custom Store

```typescript
import { HoldStore } from '@atlas/sdk';

class PostgresHoldStore implements HoldStore {
  async store(holdId: string, data: HoldData, ttlMs: number): Promise<void> {
    await db.query(
      `INSERT INTO atlas_holds (id, data, expires_at)
       VALUES ($1, $2, NOW() + interval '1 millisecond' * $3)`,
      [holdId, JSON.stringify(data), ttlMs]
    );
  }

  async get(holdId: string): Promise<HoldData | null> {
    const row = await db.query(
      'SELECT data FROM atlas_holds WHERE id = $1 AND expires_at > NOW()',
      [holdId]
    );
    return row ? JSON.parse(row.data) : null;
  }

  async consume(holdId: string): Promise<void> {
    await db.query('DELETE FROM atlas_holds WHERE id = $1', [holdId]);
  }

  async storeIdempotencyResult(key: string, result: unknown): Promise<void> {
    await db.query(
      `INSERT INTO atlas_idempotency (key, result, expires_at)
       VALUES ($1, $2, NOW() + interval '24 hours')
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(result)]
    );
  }

  async getIdempotencyResult(key: string): Promise<unknown | null> {
    const row = await db.query(
      'SELECT result FROM atlas_idempotency WHERE key = $1 AND expires_at > NOW()',
      [key]
    );
    return row ? JSON.parse(row.result) : null;
  }
}
```

### 9.4 HoldStore Interface

```typescript
export interface HoldStore {
  /** Store hold data with TTL */
  store(holdId: string, data: HoldData, ttlMs: number): Promise<void>;

  /** Retrieve hold data (null if expired or not found) */
  get(holdId: string): Promise<HoldData | null>;

  /** Remove hold after purchase completion */
  consume(holdId: string): Promise<void>;

  /** Store idempotency result for deduplication */
  storeIdempotencyResult(key: string, result: unknown): Promise<void>;

  /** Retrieve idempotency result */
  getIdempotencyResult(key: string): Promise<unknown | null>;
}

export interface HoldData {
  holdId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  unitPrice: string;
  currency: string;
  totalPrice: string;
  expiresAt: string;
  buyerEmail: string;
  buyerName?: string;
  discountCode?: string;
  discount?: { code: string; amount: string; originalTotal: string };
  callbackUrl?: string;
  idempotencyKey?: string;
}
```

---

## 10. Event Hooks

The SDK emits events at key points in the request lifecycle. Use hooks for logging, analytics, monitoring, or side-effects.

### Available Hooks

```typescript
type AtlasHookEvent =
  | 'search'
  | 'event.view'
  | 'tickets.list'
  | 'purchase.challenge'
  | 'purchase.complete'
  | 'purchase.failed'
  | 'hold.created'
  | 'hold.expired'
  | 'discount.validated'
  | 'ticket.cancelled'
  | 'ticket.verified'
  | 'health.check';
```

### Hook Signatures

```typescript
// All hooks receive contextual data as arguments

atlas.on('search', (
  query: AtlasSearchQuery,
  resultCount: number,
  durationMs: number,
) => void);

atlas.on('event.view', (
  eventId: string,
  durationMs: number,
) => void);

atlas.on('tickets.list', (
  eventId: string,
  ticketTypeCount: number,
  durationMs: number,
) => void);

atlas.on('purchase.challenge', (
  eventId: string,
  holdId: string,
  amount: string,
  currency: string,
) => void);

atlas.on('purchase.complete', (
  eventId: string,
  receipt: AtlasReceipt,
) => void);

atlas.on('purchase.failed', (
  eventId: string,
  error: AtlasError,
) => void);

atlas.on('hold.created', (
  holdId: string,
  eventId: string,
  ticketTypeId: string,
  quantity: number,
  expiresAt: string,
) => void);

atlas.on('hold.expired', (
  holdId: string,
  eventId: string,
) => void);

atlas.on('discount.validated', (
  eventId: string,
  code: string,
  valid: boolean,
) => void);

atlas.on('ticket.cancelled', (
  ticketId: string,
  result: AtlasCancellationResult,
) => void);

atlas.on('ticket.verified', (
  ticketId: string,
  valid: boolean,
) => void);

atlas.on('health.check', (
  source: string, // IP or registry identifier
  success: boolean,
) => void);
```

### Usage Example

```typescript
// Prometheus metrics
import { Counter, Histogram } from 'prom-client';

const searchDuration = new Histogram({ name: 'atlas_search_duration_seconds', help: 'Search latency' });
const purchaseCounter = new Counter({ name: 'atlas_purchases_total', help: 'Total purchases', labelNames: ['status'] });

atlas.on('search', (_query, _count, durationMs) => {
  searchDuration.observe(durationMs / 1000);
});

atlas.on('purchase.complete', () => {
  purchaseCounter.inc({ status: 'success' });
});

atlas.on('purchase.failed', () => {
  purchaseCounter.inc({ status: 'failed' });
});
```

---

## 11. Error Handling

### AtlasError

The SDK provides a typed error class that maps to HTTP status codes.

```typescript
export class AtlasError extends Error {
  /** Machine-readable error code */
  code: AtlasErrorCode;

  /** HTTP status code */
  statusCode: number;

  /** Additional error context */
  details?: Record<string, unknown>;

  constructor(code: AtlasErrorCode, statusCode: number, details?: Record<string, unknown>) {
    super(ATLAS_ERROR_MESSAGES[code]);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
```

### Error Codes

```typescript
export type AtlasErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'TICKET_TYPE_NOT_FOUND'
  | 'HOLD_NOT_FOUND'
  | 'HOLD_EXPIRED'
  | 'SOLD_OUT'
  | 'INSUFFICIENT_TICKETS'
  | 'APPROVAL_REQUIRED'
  | 'INVALID_PASSCODE'
  | 'INVALID_DISCOUNT'
  | 'DISCOUNT_EXHAUSTED'
  | 'PAYMENT_REQUIRED'
  | 'PAYMENT_INVALID'
  | 'PAYMENT_AMOUNT_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

const ATLAS_ERROR_MESSAGES: Record<AtlasErrorCode, string> = {
  EVENT_NOT_FOUND: 'Event not found or not published',
  TICKET_TYPE_NOT_FOUND: 'Ticket type not found or not active',
  HOLD_NOT_FOUND: 'Hold not found',
  HOLD_EXPIRED: 'Hold has expired. Please restart the purchase flow.',
  SOLD_OUT: 'This ticket type is sold out',
  INSUFFICIENT_TICKETS: 'Not enough tickets available for the requested quantity',
  APPROVAL_REQUIRED: 'This ticket type requires host approval',
  INVALID_PASSCODE: 'Invalid passcode for this ticket type',
  INVALID_DISCOUNT: 'Discount code is not valid',
  DISCOUNT_EXHAUSTED: 'Discount code has reached its usage limit',
  PAYMENT_REQUIRED: 'Payment credential required',
  PAYMENT_INVALID: 'Payment credential verification failed',
  PAYMENT_AMOUNT_MISMATCH: 'Payment amount does not match the challenged amount',
  IDEMPOTENCY_CONFLICT: 'A different request was already processed with this idempotency key',
  RATE_LIMITED: 'Rate limit exceeded. Please retry after the indicated time.',
  VALIDATION_ERROR: 'Request validation failed',
  INTERNAL_ERROR: 'Internal server error',
};
```

### HTTP Status Mapping

| Error Code | HTTP Status | Agent Action |
|------------|-------------|-------------|
| `EVENT_NOT_FOUND` | 404 | Try a different event |
| `TICKET_TYPE_NOT_FOUND` | 404 | Re-fetch ticket types |
| `HOLD_NOT_FOUND` | 404 | Restart purchase flow |
| `HOLD_EXPIRED` | 410 | Restart purchase flow |
| `SOLD_OUT` | 410 | Try a different ticket type |
| `INSUFFICIENT_TICKETS` | 409 | Reduce quantity or try another type |
| `APPROVAL_REQUIRED` | 202 | Wait for approval callback or poll |
| `INVALID_PASSCODE` | 403 | Prompt user for correct passcode |
| `INVALID_DISCOUNT` | 422 | Remove discount code and retry |
| `DISCOUNT_EXHAUSTED` | 422 | Remove discount code and retry |
| `PAYMENT_REQUIRED` | 402 | Complete MPP payment flow |
| `PAYMENT_INVALID` | 401 | Retry with valid payment credential |
| `PAYMENT_AMOUNT_MISMATCH` | 402 | Retry with correct amount |
| `RATE_LIMITED` | 429 | Wait for `Retry-After` header duration |
| `VALIDATION_ERROR` | 400 | Fix request body per error details |
| `INTERNAL_ERROR` | 500 | Retry with exponential backoff |

### Error Response Format

All error responses follow a consistent JSON format:

```json
{
  "error": {
    "code": "INSUFFICIENT_TICKETS",
    "message": "Not enough tickets available for the requested quantity",
    "details": {
      "available": 3,
      "requested": 5
    }
  }
}
```

### Throwing Errors from Your Adapter

```typescript
atlas.setAdapter({
  async createHold(eventId, ticketTypeId, quantity, durationMs) {
    const tt = await db.ticketTypes.findById(ticketTypeId);
    if (!tt) {
      throw new AtlasError('TICKET_TYPE_NOT_FOUND', 404);
    }

    const available = tt.capacity - tt.sold;
    if (available < quantity) {
      throw new AtlasError('INSUFFICIENT_TICKETS', 409, {
        available,
        requested: quantity,
      });
    }

    if (tt.passcode_required && !tt.passcode_verified) {
      throw new AtlasError('INVALID_PASSCODE', 403);
    }

    // ... create hold
  },
});
```

The SDK catches `AtlasError` instances and maps them to the correct HTTP response. Any other thrown error is wrapped as `INTERNAL_ERROR` (500) with the error message redacted in production.

---

## 12. Rate Limiting

### Built-in Rate Limiter

The SDK includes a rate limiter that enforces the limits declared in your manifest. This protects your adapter from excessive load and signals to agents (via manifest) what limits to expect.

```typescript
const atlas = new AtlasServer({
  // ...
  rateLimits: {
    discovery: { requestsPerMinute: 60, burst: 10 },
    purchase: { requestsPerMinute: 10, burst: 3 },
  },
});
```

### Rate Limit Store

By default, the rate limiter uses an in-memory sliding window. For multi-instance deployments, use the Redis store:

```typescript
import { RedisRateLimitStore } from '@atlas/sdk';

const atlas = new AtlasServer({
  // ...
  rateLimitStore: new RedisRateLimitStore(redis, {
    keyPrefix: 'atlas:rl:',
  }),
});
```

### Rate Limit Headers

All responses include standard rate limit headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1711234567
```

When rate limited, the response is:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 15
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1711234567

{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Please retry after the indicated time."
  }
}
```

### Rate Limit Keys

| Endpoint Category | Key | Default Limit |
|-------------------|-----|---------------|
| Discovery (search, event, tickets) | Client IP | 60/min |
| Purchase | Client IP | 10/min |
| Purchase (per payer) | Payment credential payer ID | 10 successful/hour |

### Custom Rate Limiter

```typescript
import { RateLimitStore } from '@atlas/sdk';

class CustomRateLimitStore implements RateLimitStore {
  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    // Your implementation
  }

  async isAllowed(key: string, limit: number, windowMs: number): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    // Your implementation
  }
}
```

---

## 13. Validation

All inputs and outputs are validated using Zod schemas. Validation runs automatically in the SDK middleware -- your adapter receives pre-validated inputs and the SDK validates your adapter's outputs before sending responses.

### Input Validation

Every request body and query parameter is validated before reaching your adapter:

```typescript
// Search query validation (automatic)
const SearchQuerySchema = z.object({
  search: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(500).default(50),
  startAfter: z.string().datetime({ offset: true }).optional(),
  startBefore: z.string().datetime({ offset: true }).optional(),
  categories: z.string().transform(s => s.split(',')).optional(),
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  priceCurrency: z.string().length(3).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  skip: z.coerce.number().int().nonnegative().default(0),
});
```

If validation fails, the SDK returns a 400 error with field-level details:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "issues": [
        { "path": ["quantity"], "message": "Number must be less than or equal to 10" },
        { "path": ["buyerEmail"], "message": "Invalid email" }
      ]
    }
  }
}
```

### Output Validation

Adapter return values are validated against the corresponding Zod schemas (`AtlasEventSchema`, `AtlasTicketTypeSchema`, etc.) in development mode. In production, output validation is skipped for performance but can be re-enabled:

```typescript
const atlas = new AtlasServer({
  // ...
  validation: {
    validateOutputs: true, // Enable in production if needed (small perf cost)
  },
});
```

### Accessing Schemas

All Zod schemas are exported for use in your own validation:

```typescript
import {
  AtlasEventSchema,
  AtlasTicketTypeSchema,
  AtlasHoldSchema,
  AtlasReceiptSchema,
  PurchaseRequestSchema,
  SearchQuerySchema,
} from '@atlas/sdk/schemas';

// Use in your own code
const parsed = AtlasEventSchema.safeParse(myData);
if (!parsed.success) {
  console.error(parsed.error.issues);
}
```

---

## 14. Testing Utilities

The SDK ships testing utilities under `@atlas/sdk/testing`.

### MockAdapter

A pre-built adapter with fake data for testing the SDK itself or your middleware integration:

```typescript
import { MockAdapter } from '@atlas/sdk/testing';

const atlas = new AtlasServer({ /* config */ });
atlas.setAdapter(new MockAdapter({
  eventCount: 50,
  ticketTypesPerEvent: 3,
  soldOutPercentage: 0.1,
}));

// Now you can test your middleware, hooks, etc. against fake data
```

### MockAgent

A client that simulates an AI agent interacting with your Atlas server:

```typescript
import { MockAgent } from '@atlas/sdk/testing';

const agent = new MockAgent({
  atlasBaseUrl: 'http://localhost:3000/atlas/v1',
});

// Discovery
const events = await agent.search({ city: 'Berlin' });
const tickets = await agent.listTickets(events[0].id);

// Purchase (uses mock payment -- no real funds)
const receipt = await agent.purchase(events[0].id, {
  ticketTypeId: tickets[0].id,
  quantity: 1,
  buyerEmail: 'test@example.com',
  paymentMethod: 'tempo_usdc',
});

// Verify ticket
const verification = await agent.verifyTicket(receipt.tickets[0].ticketId);
```

### Test Fixtures

```typescript
import {
  createTestEvent,
  createTestTicketType,
  createTestReceipt,
  createTestHold,
} from '@atlas/sdk/testing';

const event = createTestEvent({ title: 'Test Conference', city: 'NYC' });
const ticket = createTestTicketType({ priceCents: 5000, remaining: 100 });
```

### Compliance Test Suite

Run the full Atlas compliance test suite against any URL:

```typescript
import { AtlasComplianceTests } from '@atlas/sdk/testing';

const suite = new AtlasComplianceTests({
  baseUrl: 'http://localhost:3000/atlas/v1',
  manifestUrl: 'http://localhost:3000/.well-known/atlas.json',
  level: 2,
  sandbox: true, // Use mock payments
});

// Run all checks
const results = await suite.runAll();
// results: { passed: number, failed: number, skipped: number, details: CheckResult[] }

// Or run individual checks
await suite.validateManifest();
await suite.validateSearch();
await suite.validateEventDetail();
await suite.validateTicketListing();
await suite.validatePurchaseChallenge();
await suite.validatePurchaseCompletion();
await suite.validateHoldLifecycle();
await suite.validateHoldExpiration();
await suite.validateIdempotency();
await suite.validateRateLimiting();
// Level 3
await suite.validateDiscountValidation();
await suite.validateCancellation();
await suite.validateCredentialIssuance();
await suite.validateCredentialVerification();
```

### Jest / Vitest Integration

```typescript
import { describe, test, beforeAll } from 'vitest';
import { AtlasComplianceTests } from '@atlas/sdk/testing';

describe('Atlas Level 2 Compliance', () => {
  let suite: AtlasComplianceTests;

  beforeAll(() => {
    suite = new AtlasComplianceTests({
      baseUrl: 'http://localhost:3000/atlas/v1',
      manifestUrl: 'http://localhost:3000/.well-known/atlas.json',
      level: 2,
      sandbox: true,
    });
  });

  test('manifest is valid and accessible', async () => {
    const result = await suite.validateManifest();
    expect(result.passed).toBe(true);
  });

  test('search returns valid Atlas events', async () => {
    const result = await suite.validateSearch();
    expect(result.passed).toBe(true);
  });

  test('purchase flow returns valid 402 challenge', async () => {
    const result = await suite.validatePurchaseChallenge();
    expect(result.passed).toBe(true);
  });

  test('holds expire correctly', async () => {
    const result = await suite.validateHoldExpiration();
    expect(result.passed).toBe(true);
  });

  test('idempotency keys prevent duplicate purchases', async () => {
    const result = await suite.validateIdempotency();
    expect(result.passed).toBe(true);
  });
});
```

---

## 15. Package Structure

### Directory Layout

```
@atlas/sdk/
├── dist/
│   ├── esm/           # ESM build (import)
│   ├── cjs/           # CJS build (require)
│   └── types/         # TypeScript declarations
├── src/
│   ├── index.ts       # Main entry: AtlasServer, AtlasError, types
│   ├── types/
│   │   ├── config.ts
│   │   ├── adapter.ts
│   │   ├── event.ts
│   │   ├── ticket.ts
│   │   ├── hold.ts
│   │   ├── receipt.ts
│   │   ├── payment.ts
│   │   ├── credential.ts
│   │   └── manifest.ts
│   ├── server.ts      # AtlasServer class
│   ├── router.ts      # Internal route handler
│   ├── mpp/
│   │   ├── challenge.ts    # 402 challenge generation
│   │   ├── verify.ts       # Payment credential verification (wraps mppx)
│   │   └── receipt.ts      # Receipt hash computation
│   ├── credentials/
│   │   ├── issuer.ts       # VC issuance (DID:web + JWS)
│   │   ├── verifier.ts     # VC verification
│   │   └── qr.ts           # QR code data generation
│   ├── holds/
│   │   ├── manager.ts      # Hold lifecycle management
│   │   ├── memory-store.ts # In-memory hold store
│   │   └── redis-store.ts  # Redis hold store
│   ├── rate-limit/
│   │   ├── limiter.ts      # Rate limit logic
│   │   ├── memory-store.ts
│   │   └── redis-store.ts
│   ├── validation/
│   │   └── schemas.ts      # All Zod schemas
│   ├── middleware/
│   │   ├── express.ts
│   │   ├── koa.ts
│   │   ├── fastify.ts
│   │   ├── hono.ts
│   │   └── next.ts
│   ├── manifest/
│   │   └── generator.ts    # Manifest auto-generation
│   ├── mapping/
│   │   ├── event.ts        # mapEvent helper
│   │   └── ticket.ts       # mapTicketType helper
│   └── hooks/
│       └── emitter.ts      # Event hook system
├── testing/
│   ├── index.ts             # Testing entry point
│   ├── mock-adapter.ts
│   ├── mock-agent.ts
│   ├── fixtures.ts
│   └── compliance.ts
├── schemas/
│   └── index.ts             # Re-exports all Zod schemas
├── package.json
├── tsconfig.json
└── README.md
```

### package.json Exports

```json
{
  "name": "@atlas/sdk",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js",
      "types": "./dist/types/index.d.ts"
    },
    "./testing": {
      "import": "./dist/esm/testing/index.js",
      "require": "./dist/cjs/testing/index.js",
      "types": "./dist/types/testing/index.d.ts"
    },
    "./schemas": {
      "import": "./dist/esm/schemas/index.js",
      "require": "./dist/cjs/schemas/index.js",
      "types": "./dist/types/schemas/index.d.ts"
    }
  },
  "sideEffects": false,
  "dependencies": {
    "mppx": "^1.0.0",
    "zod": "^3.22.0"
  },
  "peerDependencies": {
    "ioredis": ">=5.0.0"
  },
  "peerDependenciesMeta": {
    "ioredis": { "optional": true }
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.0.0",
    "express": "^4.18.0",
    "koa": "^2.15.0",
    "@koa/router": "^12.0.0",
    "fastify": "^4.26.0",
    "hono": "^4.0.0",
    "next": "^14.0.0"
  }
}
```

### Dependencies

| Dependency | Purpose | Size |
|------------|---------|------|
| `mppx` | MPP 402 payment verification | ~15KB |
| `zod` | Schema validation (input + output) | ~55KB |

Framework middleware adapters import framework types from `peerDependencies` or `devDependencies` -- they are not bundled. If you use Express, only the Express adapter code is loaded. Tree-shaking ensures unused middleware adapters are excluded from your bundle.

### Tree-Shaking

The package is fully tree-shakeable:

```typescript
// Only imports the server core + Express middleware
// Koa, Fastify, Hono, Next.js middleware are NOT bundled
import { AtlasServer } from '@atlas/sdk';
const middleware = atlas.expressMiddleware();
```

```typescript
// Only imports testing utilities -- no server code
import { MockAgent, AtlasComplianceTests } from '@atlas/sdk/testing';
```

```typescript
// Only imports Zod schemas -- no server or testing code
import { AtlasEventSchema } from '@atlas/sdk/schemas';
```
