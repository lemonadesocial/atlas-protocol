# IMPL: Phase 2 — Atlas Protocol Layer in lemonade-backend

> **AUDIT FIX [P2-C1]:** Removed `mppx` SDK dependency — it does not exist as an npm package. 402 challenge/verification is hand-rolled using patterns from `@x402/core` in `lemonade-ai` or pure custom code.

**Feature:** Atlas Protocol REST endpoints with 402 purchase flow, schema mapper, Verifiable Credentials, and well-known manifest
**Author:** Bridge Agent
**Status:** Ready for Lead Routing
**Created:** 2026-03-19
**Repo:** `lemonade-backend`
**Dependencies:** `jose` (JWS/JWT), `uuid` (v7 generation), `stripe` (already in backend), `viem` (already in backend for EVM verification)
**Reference PRDs:** MPP #1 (Gated API), MPP #2 (Agent Ticket Purchasing), MPP #10 (Paid MCP Tools)
**Reference Specs:** `atlas-protocol/02-protocol-core/PROTOCOL-SPEC.md`, `atlas-protocol/02-protocol-core/SCHEMAS.md`

---

## Table of Contents

1. [Execution Summary](#1-execution-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [New Files to Create](#3-new-files-to-create)
4. [Existing Files to Modify](#4-existing-files-to-modify)
5. [Task 1: Atlas Koa Router](#5-task-1-atlas-koa-router)
6. [Task 2: Schema Mapper Service](#6-task-2-schema-mapper-service)
7. [Task 3: MPP 402 Middleware](#7-task-3-mpp-402-middleware)
8. [Task 4: Ticket Purchase Service (Paid Ticket Flow)](#8-task-4-ticket-purchase-service)
9. [Task 5: AtlasTicketHold Model](#9-task-5-atlastickethold-model)
10. [Task 6: AtlasReceipt Model](#10-task-6-atlasreceipt-model)
11. [Task 7: Verifiable Credential Issuance Service](#11-task-7-vc-issuance-service)
12. [Task 8: Well-Known Manifest Generator](#12-task-8-well-known-manifest-generator)
13. [Task 9: Tempo + Base Chain Documents](#13-task-9-tempo-base-chain-docs)
14. [Task 10: Agent Authentication Middleware](#14-task-10-agent-authentication-middleware)
15. [Task 11: Idempotency Middleware](#15-task-11-idempotency-middleware)
16. [Task 12: Discount Validation Endpoint](#16-task-12-discount-validation-endpoint)
17. [Environment Variables](#17-environment-variables)
18. [Migration Steps](#18-migration-steps)
19. [Testing Strategy](#19-testing-strategy)
20. [Execution Status](#20-execution-status)

---

## 1. Execution Summary

Build the Atlas Protocol REST surface inside `lemonade-backend` as a new Koa router at `/atlas/v1`. This wraps existing `ai-tool` resolver logic for discovery endpoints and builds the **missing paid ticket purchase flow** that `aiBuyTickets` currently stubs out (`src/graphql/resolvers/ai-tool.ts:1309-1378` returns "not supported" for paid tickets). The Atlas layer adds:

- Schema mapping from Lemonade models to Atlas JSON-LD (Schema.org Event)
- Two-phase 402 purchase flow with ticket holds (TTL-indexed MongoDB)
- Payment verification via hand-rolled verification (Stripe API + on-chain EVM tx verification for Base USDC + Tempo USDC)
- W3C Verifiable Credential issuance for tickets (DID:web + ES256 JWS)
- Auto-generated `/.well-known/atlas.json` per Space
- Agent authentication via `Atlas-Agent-Id` + API key
- Idempotency via `Idempotency-Key` header

**Critical constraint:** All Atlas endpoints live in `lemonade-backend` as a Koa router. Do NOT create a separate service. Hand-roll 402 challenge/verification logic. Do NOT use `@x402/express` (that is in `lemonade-ai`) and do NOT use `mppx` (does not exist as a package).

---

## 2. Architecture Overview

```
                         lemonade-backend
                              |
        /.well-known/atlas.json (per Space)
                              |
             /atlas/v1/* (new Koa router)
             |          |           |           |
          search    events/:id   events/:id/   events/:id/
                                  tickets      purchase
                                                 |
                                         [Phase 1: 402]
                                         AtlasTicketHold
                                         402 challenge
                                                 |
                                         [Phase 2: 200]
                                         Payment verify
                                         NewPayment create
                                         Ticket issuance
                                         VC signing
                                         AtlasReceipt
```

### Request Flow for Purchase

```
Agent                          lemonade-backend /atlas/v1
  |                                      |
  |  POST /events/:id/purchase           |
  |  Atlas-Agent-Id + Idempotency-Key    |
  |  (no Authorization header)           |
  |------------------------------------->|
  |                                      |-- Validate event, ticket type, count
  |                                      |-- Calculate price (cents / 100 = USD)
  |                                      |-- Create AtlasTicketHold (TTL 300s)
  |                                      |-- Build 402 challenge
  |  402 Payment Required                |
  |  { challenge, hold, payment_methods }|
  |<-------------------------------------|
  |                                      |
  |  [Agent pays via Tempo/Stripe/Base]  |
  |                                      |
  |  POST /events/:id/purchase           |
  |  Authorization: Atlas-Payment v1     |
  |  Idempotency-Key (same)              |
  |------------------------------------->|
  |                                      |-- Verify payment (Stripe API / on-chain)
  |                                      |-- Consume hold
  |                                      |-- Create NewPayment (succeeded)
  |                                      |-- Create Ticket[] in transaction
  |                                      |-- Sign VC tickets (ES256)
  |                                      |-- Create AtlasReceipt
  |  200 OK                              |
  |  { receipt with VC tickets }         |
  |<-------------------------------------|
```

---

## 3. New Files to Create

All paths relative to `lemonade-backend/src/`.

| # | File Path | Purpose |
|---|-----------|---------|
| 1 | `app/routers/atlas.ts` | Koa router for all `/atlas/v1/*` endpoints + `/.well-known/atlas.json` |
| 2 | `app/controllers/atlas/search.ts` | Search endpoint handler (wraps `aiSearchEvents` logic) |
| 3 | `app/controllers/atlas/events.ts` | Event detail + ticket listing handlers |
| 4 | `app/controllers/atlas/purchase.ts` | Two-phase purchase flow controller |
| 5 | `app/controllers/atlas/receipts.ts` | Receipt lookup + verification handler |
| 6 | `app/controllers/atlas/discounts.ts` | Discount validation handler |
| 7 | `app/controllers/atlas/well-known.ts` | `/.well-known/atlas.json` generator |
| 8 | `app/middlewares/atlas-agent-auth.ts` | Atlas-Agent-Id + API key validation middleware |
| 9 | `app/middlewares/atlas-version.ts` | Atlas-Version header validation middleware |
| 10 | `app/middlewares/atlas-idempotency.ts` | Idempotency-Key dedup middleware |
| 11 | `app/middlewares/atlas-mpp.ts` | Atlas 402 challenge builder (hand-rolled, no SDK) |
| 11b | `app/middlewares/atlas-rate-limit.ts` | **AUDIT FIX R4 [FT-3]:** IP-based rate limiting for discovery endpoints |
| 12 | `app/services/atlas/schema-mapper.ts` | Lemonade models to Atlas JSON-LD mapper |
| 13 | `app/services/atlas/purchase.ts` | Paid ticket purchase orchestration |
| 14 | `app/services/atlas/ticket-hold.ts` | Ticket hold creation/consumption |
| 15 | `app/services/atlas/vc-issuer.ts` | W3C Verifiable Credential issuance (DID:web + ES256) |
| 16 | `app/services/atlas/manifest.ts` | Well-known manifest generation from Space config |
| 17 | `app/services/atlas/payment-verify.ts` | Payment verification (Stripe API + EVM on-chain) |
| 18 | `app/models/atlas-ticket-hold.ts` | AtlasTicketHold MongoDB model (TTL-indexed) |
| 19 | `app/models/atlas-receipt.ts` | AtlasReceipt MongoDB model |
| 20 | `app/models/atlas-agent-registration.ts` | AtlasAgentRegistration MongoDB model |
| 21 | `db/migrations/<timestamp>-add-atlas-protocol-models.ts` | Migration for new collections + indexes |

---

## 4. Existing Files to Modify

| # | File Path | Change |
|---|-----------|--------|
| 1 | `app/index.ts:78` | Add `atlasRouter` import and register in the first router batch |
| 2 | `app/models/ticket.ts:15-22` | Add `atlas_agent = 'atlas_agent'` to `TicketSource` enum |
| 3 | `app/models/ticket.ts:24-30` | Add `atlas_agent_id?: string`, `atlas_receipt_id?: string` to `TicketMetadata` |
| 4 | `config/index.ts` | Add Atlas-specific env vars (see Section 17) |
| 5 | `package.json` | Add dependencies: `jose`, `uuid`, `koa-bodyparser` (Stripe + viem already present) |
| 6 | `app/models/event.ts` | > **AUDIT FIX R3 [E15-2]:** Add `atlas_searchable?: boolean` optional field. Defaults to `undefined` (truthy). Set to `false` by Phase 5 when a connection is suspended, which removes the event from Atlas search results. Existing events are unaffected (undefined is truthy). |

---

## 5. Task 1: Atlas Koa Router

**File:** `src/app/routers/atlas.ts`

The router follows the exact pattern from `src/app/routers/api-v1.ts` (`api-v1.ts:1-15`).

```typescript
// src/app/routers/atlas.ts
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';   // AUDIT FIX [P2-H4]

import * as search from '../controllers/atlas/search';
import * as events from '../controllers/atlas/events';
import * as purchase from '../controllers/atlas/purchase';
import * as receipts from '../controllers/atlas/receipts';
import * as discounts from '../controllers/atlas/discounts';
import * as wellKnown from '../controllers/atlas/well-known';

import { atlasAgentAuth } from '../middlewares/atlas-agent-auth';
import { atlasVersion } from '../middlewares/atlas-version';
import { atlasIdempotency } from '../middlewares/atlas-idempotency';

import { atlasEnabled } from '../../config';  // AUDIT FIX [P2-M4]
import { type Context, type State } from '../types';

// ---- Well-known manifest (no prefix, no agent auth) ----
export const wellKnownRouter = new Router<State, Context>();
wellKnownRouter.get('/.well-known/atlas.json', wellKnown.handleManifestRequest);

// ---- Atlas v1 API ----
export const router = new Router<State, Context>({
  prefix: '/atlas/v1',
});

// AUDIT FIX [P2-H4]: Body parser for POST routes
// > **AUDIT FIX R3 [F5]:** Verify no global bodyparser in app/index.ts before adding
// > this router-level bodyparser. If a global bodyparser already exists (e.g., registered
// > in the app middleware chain), remove this router-level one to avoid double-parsing.
// > Double body-parsing can cause empty body on second parse or unexpected behavior.
router.use(bodyParser());

// > **AUDIT FIX [P2-M4]:** Check ATLAS_ENABLED feature flag.
// > Return 404 if disabled, so the endpoints are invisible when the flag is off.
router.use(async (ctx, next) => {
  if (!atlasEnabled) {
    ctx.status = 404;
    ctx.body = { error: { code: 'NOT_FOUND', message: 'Atlas Protocol is not enabled on this instance' } };
    return;
  }
  await next();
});

// All Atlas endpoints require version header
router.use(atlasVersion());

// > **AUDIT FIX R4 [FT-3]:** IP-based rate limiting on discovery endpoints.
// > Prevents bots from flooding search/event detail endpoints to scrape event data
// > or abuse the free ticket redirect endpoint. Limits are enforced at the router
// > level via Redis sliding window counters.
// > - Unauthenticated (no Atlas-Agent-Id): max 60 req/min per IP
// > - Authenticated agents: max 200 req/min per IP
// > Implementation: `atlasRateLimit()` middleware uses Redis keys:
// >   `atlas:ratelimit:ip:{ip}:unauth` (TTL 60s) and
// >   `atlas:ratelimit:ip:{ip}:auth` (TTL 60s).
// > Returns 429 with `Retry-After` header when exceeded.
import { atlasRateLimit } from '../middlewares/atlas-rate-limit';

// Discovery endpoints (agent auth required, no payment)
// > **AUDIT FIX R4 [FT-3]:** Rate limit applied before agent auth so IP limits
// > are enforced even if the agent auth header is missing or invalid.
router.get('/search', atlasRateLimit(), atlasAgentAuth(), search.searchEvents);
router.get('/events/:id', atlasRateLimit(), atlasAgentAuth(), events.getEvent);
router.get('/events/:id/tickets', atlasRateLimit(), atlasAgentAuth(), events.listTicketTypes);

// Purchase endpoint (agent auth + idempotency, two-phase 402)
router.post(
  '/events/:id/purchase',
  atlasAgentAuth(),
  atlasIdempotency(),
  purchase.purchaseTickets,
);

// Discount validation (agent auth required)
router.post(
  '/events/:id/discounts/validate',
  atlasAgentAuth(),
  discounts.validateDiscount,
);

// Receipt endpoints (agent auth required)
router.get('/receipts/:txn_id', atlasAgentAuth(), receipts.getReceipt);

// Ticket verification (public, no agent auth needed)
// > **AUDIT FIX R2 [E7]:** Requires `?event_id=` query parameter.
// > Validates credential's event_id matches the event being checked into.
router.get('/tickets/:id/verify', receipts.verifyTicket);
```

**Registration in `app/index.ts`:**

Add to imports at line 34 (after the `apiV1Router` import):

```typescript
import { router as atlasRouter, wellKnownRouter as atlasWellKnownRouter } from './routers/atlas';
```

Add to the first router batch at line 78:

```typescript
[calendarRouter, forestRouter, webhooksRouter, apiV1Router, creditsRouter, atlasWellKnownRouter, atlasRouter, router].forEach((router) => {
```

**IMPORTANT:** The `wellKnownRouter` must be registered BEFORE the main GraphQL `router` to avoid the catch-all matching it.

---

## 6. Task 2: Schema Mapper Service

**File:** `src/app/services/atlas/schema-mapper.ts`

Maps Lemonade models to Atlas JSON-LD schemas defined in `atlas-protocol/02-protocol-core/SCHEMAS.md`.

### Critical Price Conversion

Lemonade stores prices as **BigInt strings in CENTS** in `EventTicketType.prices[].cost` (verified at `src/app/models/event-ticket-type.ts`). Atlas schema uses **decimal USD numbers**. The mapper MUST convert:

```
cents_string -> Number(cents_string) / 100 = dollars
```

Example: `cost: "5000"` (50 dollars in cents) -> `base_price: 50.00`

### Interfaces

```typescript
// src/app/services/atlas/schema-mapper.ts

import { type Types } from 'mongoose';
import { v7 as uuidv7 } from 'uuid';

// ---------- Atlas JSON-LD types ----------

export interface AtlasEvent {
  '@context': {
    '@vocab': 'https://schema.org/';
    atlas: 'https://atlas-protocol.org/v1/vocab#';
  };
  '@type': 'Event';
  '@id': string;                              // atlas:lemonade:{event._id}
  name: string;
  description: string;
  startDate: string;                          // ISO 8601 with timezone
  endDate?: string;
  location: AtlasPlace | AtlasVirtualLocation;
  organizer: AtlasOrganizer;
  image?: string;
  url?: string;
  eventStatus: string;
  eventAttendanceMode: string;
  'atlas:id': string;                         // UUID v7 (generated, cached)
  'atlas:source_platform': 'lemonade';
  'atlas:source_event_id': string;            // event._id.toString()
  'atlas:organizer_id': string;               // UUID v7 for the space
  'atlas:organizer_verified': boolean;
  'atlas:categories': string[];
  'atlas:tags': string[];
  'atlas:availability': AtlasAvailabilityStatus;
  'atlas:price_range': AtlasPriceRange;
  'atlas:ticket_types_count': number;
  'atlas:purchase_endpoint': string;
  'atlas:currency': string;                    // ISO 4217 from event.currency (not hardcoded)
  'atlas:accepts_payment_methods': string[];
  'atlas:last_synced': string;
  'atlas:created_at': string;
  'atlas:updated_at': string;
}

export type AtlasAvailabilityStatus =
  | 'available'
  | 'few_remaining'
  | 'sold_out'
  | 'cancelled'
  | 'not_on_sale';

export interface AtlasPriceRange {
  min_price: number;    // decimal in event currency
  max_price: number;    // decimal in event currency
  currency: string;     // ISO 4217 from event.currency
  includes_fees: boolean;
}

export interface AtlasPlace {
  '@type': 'Place';
  name: string;
  address: {
    '@type': 'PostalAddress';
    streetAddress: string;
    addressLocality: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry: string;
  };
  geo?: {
    '@type': 'GeoCoordinates';
    latitude: number;
    longitude: number;
  };
}

export interface AtlasVirtualLocation {
  '@type': 'VirtualLocation';
  url: string;
  'atlas:platform'?: string;
}

export interface AtlasOrganizer {
  '@type': 'Organization';
  name: string;
  url?: string;
}

export interface AtlasTicketType {
  'atlas:ticket_type_id': string;             // UUID v7
  name: string;
  description?: string;
  'atlas:event_id': string;
  'atlas:pricing': AtlasPricing;
  'atlas:availability': AtlasTicketAvailability;
  'atlas:restrictions': AtlasRestrictions;
  'atlas:cancellation_policy': AtlasCancellationPolicy;
  'atlas:accepted_payment_methods': string[];
  'atlas:metadata': Record<string, string>;
}

export interface AtlasPricing {
  base_price: number;         // decimal (cents / 100)
  currency: string;           // ISO 4217 from event.currency
  fees: AtlasFee[];
  total_price: number;
  fees_total: number;
  tax_included: boolean;
  tax_amount: number | null;
}

export interface AtlasFee {
  name: string;
  type: 'percentage' | 'fixed';
  rate?: number;
  amount: number;
  description: string;
}

export interface AtlasTicketAvailability {
  status: 'available' | 'few_remaining' | 'sold_out' | 'not_on_sale' | 'hidden';
  total_quantity: number | null;
  remaining_quantity: number | null;
  max_per_order: number;
  min_per_order: number;
  sale_start: string | null;
  sale_end: string | null;
  on_sale: boolean;
}

export interface AtlasRestrictions {
  age_minimum: number | null;
  age_maximum: number | null;
  requires_approval: boolean;
  requires_invitation_code: boolean;
  geographic_restrictions: string[];
  requires_identity_verification: boolean;
  transferable: boolean;
  resellable: boolean;
  custom_restrictions: string[];
}

export interface AtlasCancellationPolicy {
  refundable: boolean;
  refund_type: 'full' | 'partial' | 'none';
  refund_deadline: string | null;
  partial_refund_schedule: null;
  cancellation_fee: number;
  policy_text: string;
  organizer_cancellation_refund: 'automatic_full' | 'manual_review' | 'credit_only';
}
```

### Core Mapping Functions

```typescript
/**
 * Convert a Lemonade Event document to an AtlasEvent.
 *
 * @param event - Lean Event document from MongoDB
 * @param space - Lean Space document (event.space populated)
 * @param ticketTypes - Array of active EventTicketType documents for this event
 * @param baseUrl - API base URL (e.g., "https://api.lemonade.social")
 */
export function mapEventToAtlas(
  event: LeanEvent,
  space: LeanSpace,
  ticketTypes: LeanEventTicketType[],
  baseUrl: string,
): AtlasEvent {
  const atlasId = generateDeterministicUuid(event._id);
  const organizerId = generateDeterministicUuid(space._id);

  // > **AUDIT FIX [P2-H5]:** Use event.currency instead of hardcoded 'USD'.
  // > Lemonade supports EUR, GBP, etc. The cents→dollars conversion (÷100) is
  // > still valid regardless of currency.
  const currency = event.currency || 'USD';

  // Compute price range from ticket types
  const prices = ticketTypes
    .filter((tt) => tt.active && !tt.private)
    .flatMap((tt) => tt.prices || [])
    .map((p) => centsToDollars(p.cost));

  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  // Compute overall availability
  const availability = computeEventAvailability(event, ticketTypes);

  // Map location
  const location = event.virtual
    ? mapVirtualLocation(event)
    : mapPhysicalLocation(event);

  // Map event status
  const eventStatus = mapEventStatus(event.state);

  return {
    '@context': {
      '@vocab': 'https://schema.org/',
      atlas: 'https://atlas-protocol.org/v1/vocab#',
    },
    '@type': 'Event',
    '@id': `atlas:lemonade:${event._id}`,
    name: event.title,
    description: event.description_plain_text || event.description || '',
    startDate: event.start.toISOString(),
    endDate: event.end?.toISOString(),
    location,
    organizer: {
      '@type': 'Organization',
      name: space.title || space.slug || 'Unknown',
      url: `https://app.lemonade.social/space/${space.slug || space._id}`,
    },
    image: event.cover || undefined,
    url: `https://app.lemonade.social/event/${event.slug || event._id}`,
    eventStatus,
    eventAttendanceMode: event.virtual
      ? 'OnlineEventAttendanceMode'
      : 'OfflineEventAttendanceMode',
    'atlas:id': atlasId,
    'atlas:source_platform': 'lemonade',
    'atlas:source_event_id': event._id.toString(),
    'atlas:organizer_id': organizerId,
    'atlas:organizer_verified': true,  // Lemonade-native events are always verified
    'atlas:categories': [],            // Future: derive from event tags
    'atlas:tags': [],                  // Future: derive from event tags
    'atlas:availability': availability,
    'atlas:price_range': {
      min_price: minPrice,
      max_price: maxPrice,
      currency,
      includes_fees: false,
    },
    'atlas:ticket_types_count': ticketTypes.filter((tt) => tt.active && !tt.private).length,
    'atlas:purchase_endpoint': `${baseUrl}/atlas/v1/events/${event._id}/purchase`,
    'atlas:currency': currency,
    'atlas:accepts_payment_methods': ['tempo_usdc', 'base_usdc', 'stripe_spt'],
    'atlas:last_synced': new Date().toISOString(),
    // > **AUDIT FIX [P2-M2]:** `created_at` does NOT exist on the Event model.
    // > Use `event._id.getTimestamp()` which extracts the creation timestamp
    // > embedded in the MongoDB ObjectId.
    'atlas:created_at': (event._id.getTimestamp?.() || new Date()).toISOString(),
    'atlas:updated_at': (event.updated_at || event.stamp || new Date()).toISOString(),
  };
}

/**
 * Convert a Lemonade EventTicketType to an AtlasTicketType.
 */
// > **AUDIT FIX [P2-H5]:** Currency parameter added — passed through from event.currency.
export function mapTicketTypeToAtlas(
  ticketType: LeanEventTicketType,
  event: LeanEvent,
  platformFeePercent: number,
): AtlasTicketType {
  const currency = event.currency || 'USD';
  const atlasTicketTypeId = generateDeterministicUuid(ticketType._id);
  const atlasEventId = generateDeterministicUuid(event._id);

  // Get the default price (first price entry, or the one marked default)
  const price = ticketType.prices?.find((p) => p.default) || ticketType.prices?.[0];
  const basePriceDollars = price ? centsToDollars(price.cost) : 0;

  // Compute fees
  const protocolFee = roundTo6(basePriceDollars * 0.02);       // 2% Atlas protocol fee
  const platformFee = roundTo6(basePriceDollars * (platformFeePercent / 100));
  const paymentProcessingFee = 0.001;                          // Tempo flat fee

  const fees: AtlasFee[] = basePriceDollars > 0
    ? [
        {
          name: 'atlas_protocol_fee',
          type: 'percentage' as const,
          rate: 2.0,
          amount: protocolFee,
          description: 'Atlas Protocol fee (2%)',
        },
        {
          name: 'platform_fee',
          type: 'percentage' as const,
          rate: platformFeePercent,
          amount: platformFee,
          description: `Lemonade platform fee (${platformFeePercent}%)`,
        },
        {
          name: 'payment_processing',
          type: 'fixed' as const,
          amount: paymentProcessingFee,
          description: 'Payment processing fee',
        },
      ]
    : [];

  const feesTotal = fees.reduce((sum, f) => sum + f.amount, 0);
  const totalPrice = roundTo6(basePriceDollars + feesTotal);

  // Compute availability
  const remaining = ticketType.ticket_limit
    ? ticketType.ticket_limit - (ticketType.ticket_count || 0)
    : null;
  const remainingRatio = ticketType.ticket_limit
    ? remaining! / ticketType.ticket_limit
    : 1;

  let status: AtlasTicketAvailability['status'] = 'available';
  if (!ticketType.active) status = 'not_on_sale';
  else if (ticketType.private) status = 'hidden';
  else if (remaining !== null && remaining <= 0) status = 'sold_out';
  else if (remainingRatio < 0.1) status = 'few_remaining';

  return {
    'atlas:ticket_type_id': atlasTicketTypeId,
    name: ticketType.title,
    description: ticketType.description || undefined,
    'atlas:event_id': atlasEventId,
    'atlas:pricing': {
      base_price: basePriceDollars,
      currency,
      fees,
      total_price: totalPrice,
      fees_total: roundTo6(feesTotal),
      tax_included: false,
      tax_amount: null,
    },
    'atlas:availability': {
      status,
      total_quantity: ticketType.ticket_limit || null,
      remaining_quantity: remaining,
      max_per_order: ticketType.ticket_limit_per || 10,
      min_per_order: 1,
      sale_start: null,
      sale_end: event.end?.toISOString() || null,
      on_sale: status === 'available' || status === 'few_remaining',
    },
    'atlas:restrictions': {
      age_minimum: null,
      age_maximum: null,
      requires_approval: ticketType.approval_required || false,
      requires_invitation_code: ticketType.private || false,
      geographic_restrictions: [],
      requires_identity_verification: false,
      transferable: true,
      resellable: false,
      custom_restrictions: [],
    },
    'atlas:cancellation_policy': {
      refundable: false,
      refund_type: 'none',
      refund_deadline: null,
      partial_refund_schedule: null,
      cancellation_fee: 0,
      policy_text: 'Refund policy is determined by the event organizer.',
      organizer_cancellation_refund: 'manual_review',
    },
    'atlas:accepted_payment_methods': basePriceDollars > 0
      ? ['tempo_usdc', 'base_usdc', 'stripe_spt']
      : [],
    'atlas:metadata': {},
  };
}

// ---------- Helpers ----------

/**
 * Convert cents string to decimal dollars number.
 * "5000" -> 50.00
 * "0" -> 0
 *
 * > **AUDIT FIX R3 [F9]:** This function uses `Number()` conversion, NOT true BigInt
 * > arithmetic. It is safe for amounts up to ~$90 trillion (Number.MAX_SAFE_INTEGER / 100).
 * > For Atlas Protocol ticket prices this is more than sufficient. If true BigInt
 * > precision is needed in the future, convert to: `Number(BigInt(centsStr) / 100n)` +
 * > `Number(BigInt(centsStr) % 100n) / 100`.
 */
export function centsToDollars(centsStr: string): number {
  const cents = Number(centsStr);
  if (isNaN(cents)) return 0;

  return roundTo6(cents / 100);
}

/**
 * Convert decimal dollars to BigInt cents string.
 * 50.00 -> "5000"
 */
export function dollarsToCents(dollars: number): string {
  return String(Math.round(dollars * 100));
}

function roundTo6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}

/**
 * Generate a deterministic UUID v5-style string from a MongoDB ObjectId.
 * Uses SHA-256 hash of the ObjectId hex to produce all 32 hex chars needed for a UUID,
 * then sets version (4 bits) and variant (2 bits) nibbles per RFC 4122.
 * This ensures the same ObjectId always maps to the same Atlas ID.
 *
 * > **AUDIT FIX R3 [F13]:** Previous implementation skipped hex positions 12 and 16
 * > (the version/variant nibble positions), using only ~20 of 24 ObjectId hex chars
 * > and padding with zeros. This reduced entropy. Now uses SHA-256 to expand the
 * > 24-char ObjectId hex into 32 hex chars with proper version/variant bits.
 */
function generateDeterministicUuid(objectId: Types.ObjectId): string {
  const { createHash } = require('crypto');
  const hash = createHash('sha256').update(objectId.toHexString()).digest('hex');
  // Take first 32 hex chars (16 bytes) from SHA-256 hash
  const h = hash.slice(0, 32).split('');
  // Set version nibble (position 12) to '7' (UUID v7-like)
  h[12] = '7';
  // Set variant nibble (position 16) to '8'-'b' range (RFC 4122)
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const flat = h.join('');
  // Format as UUID: 8-4-4-4-12
  return [
    flat.slice(0, 8),
    flat.slice(8, 12),
    flat.slice(12, 16),
    flat.slice(16, 20),
    flat.slice(20, 32),
  ].join('-');
}

function mapEventStatus(state?: string): string {
  switch (state) {
    case 'cancelled': return 'EventCancelled';
    case 'ended': return 'EventEnded' ;     // Not standard Schema.org but descriptive
    default: return 'EventScheduled';
  }
}

function computeEventAvailability(
  event: LeanEvent,
  ticketTypes: LeanEventTicketType[],
): AtlasAvailabilityStatus {
  if (event.state === 'cancelled') return 'cancelled';

  const activeTypes = ticketTypes.filter((tt) => tt.active && !tt.private);
  if (activeTypes.length === 0) return 'not_on_sale';

  const hasAvailable = activeTypes.some((tt) => {
    if (!tt.ticket_limit) return true;

    return (tt.ticket_count || 0) < tt.ticket_limit;
  });

  if (!hasAvailable) return 'sold_out';

  // Check if < 10% remaining across all types
  const totalLimit = activeTypes.reduce((sum, tt) => sum + (tt.ticket_limit || 0), 0);
  const totalSold = activeTypes.reduce((sum, tt) => sum + (tt.ticket_count || 0), 0);
  if (totalLimit > 0 && (totalLimit - totalSold) / totalLimit < 0.1) return 'few_remaining';

  return 'available';
}

function mapPhysicalLocation(event: LeanEvent): AtlasPlace {
  const addr = event.address || {};

  return {
    '@type': 'Place',
    name: addr.street_1 || 'TBD',
    address: {
      '@type': 'PostalAddress',
      streetAddress: addr.street_1 || '',
      addressLocality: addr.city || '',
      addressRegion: addr.region || undefined,
      postalCode: addr.postal || undefined,
      addressCountry: addr.country || 'US',
    },
    geo: event.location?.coordinates
      ? {
          '@type': 'GeoCoordinates',
          latitude: event.location.coordinates[1],
          longitude: event.location.coordinates[0],
        }
      : undefined,
  };
}

function mapVirtualLocation(event: LeanEvent): AtlasVirtualLocation {
  return {
    '@type': 'VirtualLocation',
    url: event.virtual_url || '',
  };
}
```

### Lean Type Aliases

These reference the actual Mongoose document shapes without importing the full model class:

```typescript
// Lean document types (populated from MongoDB .lean() queries)
interface LeanEvent {
  _id: Types.ObjectId;
  title: string;
  slug?: string;
  description?: string;
  description_plain_text?: string;
  start: Date;
  end?: Date;
  state?: string;
  cover?: string;
  virtual?: boolean;
  virtual_url?: string;
  address?: {
    street_1?: string;
    city?: string;
    region?: string;
    postal?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  };
  location?: { type: string; coordinates: [number, number] };
  space: Types.ObjectId;
  host: Types.ObjectId;
  published?: boolean;
  active?: boolean;
  payment_enabled?: boolean;
  payment_fee?: number;
  currency?: string;
  payment_ticket_discounts?: Array<{
    active: boolean;
    code: string;
    ratio: number;
    use_count?: number;
    use_limit?: number;
    ticket_types?: Types.ObjectId[];
  }>;
  guest_limit?: number;
  stamp?: Date;        // Event model uses `stamp` (updated on save), NOT `created_at`
  updated_at?: Date;
}

interface LeanSpace {
  _id: Types.ObjectId;
  title?: string;
  slug?: string;
  payment_accounts?: Types.ObjectId[];
}

interface LeanEventTicketType {
  _id: Types.ObjectId;
  event: Types.ObjectId;
  title: string;
  description?: string;
  active: boolean;
  default?: boolean;
  private?: boolean;
  prices?: Array<{
    default?: boolean;
    currency: string;
    cost: string;           // BigInt cents string
    payment_accounts?: Types.ObjectId[];
  }>;
  ticket_limit?: number;
  ticket_limit_per?: number;
  ticket_count?: number;
  ticket_count_map?: Record<string, number>;
  approval_required?: boolean;
}
```

---

> **AUDIT FIX [P2-C1]:** Replaced `mppx` SDK (does not exist) with hand-rolled 402 challenge builder. No external SDK used — the purchase controller manually builds 402 responses and the payment-verify service verifies payments directly via Stripe API and on-chain EVM calls (following `@x402/core` patterns from `lemonade-ai/src/app/helpers/x402.ts`).

> **AUDIT FIX [P2-H4]:** Added `koa-bodyparser` middleware to the atlas router. Without this, `ctx.request.body` is `undefined` on all POST endpoints.

## 7. Task 3: Atlas 402 Challenge Builder

**File:** `src/app/middlewares/atlas-mpp.ts`

Hand-rolled 402 challenge builder. Does NOT use any external SDK. Constructs challenges with three payment methods: Stripe SPT, Base USDC, and Tempo USDC.

**Body parser requirement:** The atlas router MUST include `koa-bodyparser` for POST routes:

```typescript
// In src/app/routers/atlas.ts — add at the top:
import bodyParser from 'koa-bodyparser';

// After router creation, before route definitions:
router.use(bodyParser());
```

```typescript
// src/app/middlewares/atlas-mpp.ts

import {
  atlasStripeMerchantId,
  atlasTempoReceiverAddress,
  atlasBaseReceiverAddress,
} from '../../config';

export interface AtlasMppChallengeParams {
  base_price_usd: number;           // > **AUDIT FIX R3 [F8]:** pre-fee base price in dollars
  total_price_usd: number;          // > **AUDIT FIX R3 [F8]:** fee-inclusive total in dollars (buyer pays)
  hold_id: string;
  challenge_id: string;
  hold_expires_at: string;         // ISO 8601
  event_id: string;
  ticket_type_id: string;
  quantity: number;
  currency: string;                // ISO 4217 from event.currency (AUDIT FIX P2-H5)
  price_valid_until: string;       // ISO 8601 — AUDIT FIX R2 [E3]
}

/**
 * Build an Atlas Protocol 402 challenge response body
 * conforming to PROTOCOL-SPEC.md Section 6.3.
 *
 * This is hand-rolled — no mppx or @x402 SDK is used.
 * The response tells the agent which payment methods are accepted
 * and the exact amounts/addresses needed for each.
 */
export function buildAtlas402Response(params: AtlasMppChallengeParams): object {
  // > **AUDIT FIX R2 [E3]:** Include `price_valid_until` in the 402 challenge.
  // > Set to `min(hold_expires_at, next_scheduled_sync)` by the caller.
  // > Tells agents the price is guaranteed only until this timestamp.
  return {
    'atlas:challenge': {
      challenge_id: params.challenge_id,
      ticket_hold_id: params.hold_id,
      hold_expires_at: params.hold_expires_at,
      hold_ttl_seconds: 300,
      price_valid_until: params.price_valid_until,  // AUDIT FIX R2 [E3]
      // > **AUDIT FIX R3 [F8]:** Pricing breakdown now shows base price + 2% protocol fee.
      // > `total_price` is the fee-inclusive amount the buyer pays.
      // > `base_price` is the pre-fee amount (what the organizer receives).
      // > Platform fee = 0 for launch. Processing fee = passed through by chain/Stripe.
      pricing: {
        quantity: params.quantity,
        unit_price: roundTo6(params.base_price_usd / params.quantity),
        base_price: params.base_price_usd,
        fees_total: roundTo6(params.total_price_usd - params.base_price_usd),
        total_price: params.total_price_usd,
        currency: params.currency,  // AUDIT FIX [P2-H5]: dynamic currency
        fees: [
          {
            type: 'protocol_fee',
            label: 'Atlas Protocol Fee (2%)',
            amount: roundTo6(params.total_price_usd - params.base_price_usd),
            rate: '2%',
          },
        ],
      },
      discount_applied: null,
      payment_methods: [
        {
          type: 'tempo_usdc',
          network: 'tempo',
          recipient_address: atlasTempoReceiverAddress,
          amount: String(params.total_price_usd),
          currency: 'USDC',
          memo: `atlas:${params.challenge_id}`,
        },
        {
          type: 'base_usdc',
          network: 'base',
          chain_id: 8453,
          recipient_address: atlasBaseReceiverAddress,
          amount: String(params.total_price_usd),
          currency: 'USDC',
          usdc_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          memo: `atlas:${params.challenge_id}`,
        },
        {
          type: 'stripe_spt',
          amount: Math.round(params.total_price_usd * 100), // cents for Stripe
          currency: 'usd',
        },
      ],
      required_credential_type: 'atlas-payment-v1',
    },
  };
}

function roundTo6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}
```

---

## 8. Task 4: Ticket Purchase Service (Paid Ticket Flow)

**File:** `src/app/services/atlas/purchase.ts`

This is the CORE GAP being filled. The existing `aiBuyTickets` (`src/graphql/resolvers/ai-tool.ts:1309-1378`) handles free tickets but returns "not supported" for paid tickets. This service builds the paid path.

### Purchase Orchestration

```typescript
// src/app/services/atlas/purchase.ts

import { type ClientSession, type Types } from 'mongoose';
import { nanoid } from '../../utils/nanoid';

import EventModel from '../../models/event';
import EventTicketTypeModel from '../../models/event-ticket-type';
import TicketModel, { TicketSource } from '../../models/ticket';
import NewPaymentModel, { NewPaymentState, PaymentRefType } from '../../models/new-payment';
import AtlasTicketHoldModel from '../../models/atlas-ticket-hold';  // AUDIT FIX [P2-H3]: needed for active holds count
import AtlasReceiptModel from '../../models/atlas-receipt';

import { centsToDollars, dollarsToCents } from './schema-mapper';
import { issueVerifiableCredentials } from './vc-issuer';
import { withTransaction } from '../../helpers/db';

export interface PurchaseInitParams {
  event_id: string;
  ticket_type_id: string;
  quantity: number;
  attendee_info: Array<{ name: string; email: string }>;
  preferred_payment_method?: string;
  discount_codes?: string[];
  agent_id: string;
  idempotency_key: string;
}

export interface PurchaseCompleteParams {
  challenge_id: string;
  ticket_hold_id: string;
  payment_proof: {
    type: 'tempo_usdc' | 'base_usdc' | 'stripe_spt';
    transaction_hash?: string;
    network?: string;
    amount: string;
    currency: string;
    payer_address?: string;
    payment_intent_id?: string;
    status?: string;
  };
  agent_id: string;
  idempotency_key: string;
}

export interface PurchaseValidation {
  event: any;                 // Lean Event document
  ticketType: any;            // Lean EventTicketType document
  space: any;                 // Lean Space document
  pricePerTicketCents: string;
  subtotalCents: string;        // > **AUDIT FIX R3 [F8]:** Base price before fees (sent to Phase 4)
  protocolFeeCents: string;     // > **AUDIT FIX R3 [F8]:** 2% protocol fee in cents
  totalCents: string;           // > **AUDIT FIX R3 [F8]:** Fee-inclusive total (buyer pays this)
  totalDollars: number;         // > **AUDIT FIX R3 [F8]:** Fee-inclusive total in dollars
  discountApplied?: {
    code: string;
    ratio: number;
    savings_cents: string;
  };
}

/**
 * Validate a purchase request. Returns pricing and validated documents.
 * Called in Phase 1 (before 402) and Phase 2 (before fulfillment).
 */
export async function validatePurchase(
  params: PurchaseInitParams,
): Promise<PurchaseValidation> {
  // 1. Load event
  const event = await EventModel.findOne({
    _id: params.event_id,
    published: true,
    active: true,
    end: { $gte: new Date() },
  }).lean();

  if (!event) {
    throw new AtlasError('INVALID_REQUEST', 'Event not found or not published', 404);
  }

  // 2. Load ticket type
  const ticketType = await EventTicketTypeModel.findOne({
    _id: params.ticket_type_id,
    event: event._id,
    active: true,
  }).lean();

  if (!ticketType || ticketType.private) {
    throw new AtlasError('INVALID_REQUEST', 'Ticket type not found or not available', 404);
  }

  // 3. Check availability
  // > **AUDIT FIX [P2-H3]:** Holds don't reserve inventory. Active (unconsumed,
  // > unexpired) holds must be counted against availability to prevent overselling
  // > when multiple agents purchase simultaneously.
  if (ticketType.ticket_limit) {
    const activeHoldsCount = await AtlasTicketHoldModel.countDocuments({
      ticket_type_id: params.ticket_type_id,
      status: 'pending',
      expires_at: { $gt: new Date() },
    });
    const remaining = ticketType.ticket_limit - (ticketType.ticket_count || 0) - activeHoldsCount;
    if (remaining <= 0) {
      throw new AtlasError('SOLD_OUT', 'The requested ticket type is sold out', 409);
    }
    if (remaining < params.quantity) {
      throw new AtlasError(
        'INVALID_QUANTITY',
        `Only ${remaining} tickets remaining (including held), requested ${params.quantity}`,
        409,
      );
    }
  }

  // 4. Check per-agent limit
  const maxPerOrder = ticketType.ticket_limit_per || 10;
  if (params.quantity > maxPerOrder) {
    throw new AtlasError(
      'INVALID_QUANTITY',
      `Maximum ${maxPerOrder} tickets per order`,
      422,
    );
  }

  // 5. Get price
  const price = ticketType.prices?.find((p: any) => p.default) || ticketType.prices?.[0];
  if (!price) {
    throw new AtlasError('INVALID_REQUEST', 'No price configured for this ticket type', 422);
  }

  // 6. Calculate total with optional discount
  // Follows aiCalculateTicketPrice logic (ai-tool.ts:1265-1306)
  const subtotalCents = BigInt(price.cost) * BigInt(params.quantity);
  let discountCents = 0n;
  let discountApplied: PurchaseValidation['discountApplied'];

  if (params.discount_codes?.length) {
    const code = params.discount_codes[0].toUpperCase();
    const discount = event.payment_ticket_discounts?.find(
      (d: any) => d.active && d.code === code,
    );

    if (discount) {
      // Check use limit
      if (discount.use_limit && (discount.use_count || 0) >= discount.use_limit) {
        throw new AtlasError('INVALID_DISCOUNT', 'Discount code has reached its usage limit', 422);
      }

      // Check ticket type applicability
      if (
        discount.ticket_types?.length &&
        !discount.ticket_types.some((t: Types.ObjectId) => t.equals(ticketType._id))
      ) {
        throw new AtlasError('INVALID_DISCOUNT', 'Discount code is not valid for this ticket type', 422);
      }

      discountCents = BigInt(Math.round(Number(subtotalCents) * discount.ratio));
      discountApplied = {
        code,
        ratio: discount.ratio,
        savings_cents: discountCents.toString(),
      };
    } else {
      throw new AtlasError('INVALID_DISCOUNT', 'Discount code is invalid', 422);
    }
  }

  const baseCents = subtotalCents - discountCents;

  // > **AUDIT FIX R3 [F8]:** Calculate 2% protocol fee and add to buyer total.
  // > Protocol fee is charged to the buyer ON TOP of the base price.
  // > Platform fee = 0 for launch (Lemonade absorbs).
  // > Payment processing fee = passed through by Stripe/chain (not our concern).
  // > Phase 4 receives `baseCents` (subtotalCents) as `grossAmountUsdc`, NOT the
  // > fee-inclusive total. Phase 4 then calculates the 2% split from that base.
  const protocolFeeCents = baseCents * 200n / 10000n;  // 2% protocol fee
  const totalCents = baseCents + protocolFeeCents;
  const totalDollars = centsToDollars(totalCents.toString());

  // 7. Load space
  const SpaceModel = (await import('../../models/space')).default;
  const space = await SpaceModel.findById(event.space).lean();

  return {
    event,
    ticketType,
    space,
    pricePerTicketCents: price.cost,
    subtotalCents: baseCents.toString(),             // AUDIT FIX R3 [F8]: base price for Phase 4
    protocolFeeCents: protocolFeeCents.toString(),    // AUDIT FIX R3 [F8]: 2% fee
    totalCents: totalCents.toString(),               // AUDIT FIX R3 [F8]: fee-inclusive total
    totalDollars,
    discountApplied,
  };
}

/**
 * Issue tickets after payment is verified.
 * Runs inside a MongoDB transaction.
 * Follows the pattern from aiBuyTickets (ai-tool.ts:1352-1369).
 */
export async function fulfillPurchase(
  validation: PurchaseValidation,
  paymentProof: PurchaseCompleteParams['payment_proof'],
  agentId: string,
  idempotencyKey: string,
  attendeeInfo: Array<{ name: string; email: string }>,
): Promise<{
  receipt: any;
  tickets: any[];
  payment: any;
}> {
  const result = await withTransaction(async (session: ClientSession) => {
    // 1. Create NewPayment record with state: succeeded
    const [payment] = await NewPaymentModel.create(
      [
        {
          amount: validation.totalCents,
          currency: validation.event.currency || 'USD',
          state: NewPaymentState.succeeded,
          stamps: {
            [NewPaymentState.created]: new Date(),
            [NewPaymentState.succeeded]: new Date(),
          },
          ref_type: PaymentRefType.ticket,
          ref_data: {
            event: validation.event._id,
            items: [{ id: validation.ticketType._id, count: attendeeInfo.length }],
            discount: validation.discountApplied?.code,
          },
          // > **AUDIT FIX [P2-H1]:** `NewPayment.account` is required but
          // > `ticketType.prices[0].payment_accounts[0]` can be undefined.
          // > Fall back to Space's default payment account. Return 422 if still none.
          account: validation.ticketType.prices?.[0]?.payment_accounts?.[0]
            || validation.space?.payment_accounts?.[0]
            || (() => { throw new AtlasError('PAYMENT_CONFIG_ERROR', 'Event not configured for Atlas payments — no payment account found on ticket type or Space', 422); })(),
          buyer_info: {
            email: attendeeInfo[0]?.email,
            name: attendeeInfo[0]?.name,
          },
          transfer_metadata: {
            tx_hash: paymentProof.transaction_hash,
            atlas_agent_id: agentId,
            atlas_payment_type: paymentProof.type,
            atlas_idempotency_key: idempotencyKey,
            atlas_payer_address: paymentProof.payer_address,
            intent_id: paymentProof.payment_intent_id,
          },
        },
      ],
      { session },
    );

    // 2. Create Ticket documents (one per attendee)
    const tickets = await TicketModel.create(
      attendeeInfo.map((attendee) => ({
        event: validation.event._id,
        type: validation.ticketType._id,
        active: true,
        acquired_by_email: attendee.email,
        assigned_email: attendee.email,
        payment_id: payment._id,
        metadata: {
          source: TicketSource.atlas_agent,
          buyer_name: attendee.name,
          transaction_id: paymentProof.transaction_hash || paymentProof.payment_intent_id,
          atlas_agent_id: agentId,
          atlas_receipt_id: undefined,   // Set after receipt creation
        },
      })),
      { session },
    );

    // 3. Increment ticket count + update count map
    // > **AUDIT FIX [P2-C2]:** Merged two `$inc` keys into a single object.
    // > JavaScript silently drops duplicate keys — the original code never
    // > incremented `ticket_count`, causing ticket overselling.
    await EventTicketTypeModel.updateOne(
      { _id: validation.ticketType._id },
      {
        $inc: {
          ticket_count: attendeeInfo.length,
          [`ticket_count_map.atlas_${agentId}`]: attendeeInfo.length,
        },
      },
      { session },
    );

    // 4. Increment discount use count if applicable
    if (validation.discountApplied) {
      await EventModel.updateOne(
        {
          _id: validation.event._id,
          'payment_ticket_discounts.code': validation.discountApplied.code,
        },
        { $inc: { 'payment_ticket_discounts.$.use_count': 1 } },
        { session },
      );
    }

    // 5. Increment event attending count
    await EventModel.updateOne(
      { _id: validation.event._id },
      { $inc: { attending_count: attendeeInfo.length } },
      { session },
    );

    // 6. Sign Verifiable Credentials for each ticket
    const vcTickets = await issueVerifiableCredentials(
      tickets,
      validation.event,
      validation.ticketType,
      attendeeInfo,
      agentId,
    );

    // 7. Create AtlasReceipt
    const receiptId = `rcpt_${nanoid(24)}`;
    const [receipt] = await AtlasReceiptModel.create(
      [
        {
          receipt_id: receiptId,
          event: validation.event._id,
          event_name: validation.event.title,
          agent_id: agentId,
          payment: payment._id,
          tickets: tickets.map((t: any) => t._id),
          total_charged: validation.totalDollars,
          currency: validation.event.currency || 'USD',  // AUDIT FIX [P2-H5]: use event currency
          payment_method: paymentProof.type,
          transaction_hash: paymentProof.transaction_hash,
          stripe_payment_intent: paymentProof.payment_intent_id,
          idempotency_key: idempotencyKey,
          vc_tickets: vcTickets,
          status: 'confirmed',
        },
      ],
      { session },
    );

    // Update ticket metadata with receipt ID
    await TicketModel.updateMany(
      { _id: { $in: tickets.map((t: any) => t._id) } },
      { $set: { 'metadata.atlas_receipt_id': receiptId } },
      { session },
    );

    return { receipt, tickets, payment };
  });

  // > **AUDIT FIX R3 [F8] + [XP-1]:** Schedule fee processing via Agenda job
  // > instead of fire-and-forget. Agenda handles retry on failure.
  // > CRITICAL: Pass `subtotalCents` (base price) as `grossAmountUsdc`, NOT
  // > `totalCents` (fee-inclusive). Phase 4 calculates the 2% split from the base.
  // > The protocol fee was already collected from the buyer in totalCents.
  const { agenda } = await import('../../helpers/agenda');
  await agenda.now('atlas-process-fee', {
    paymentId: result.payment._id,
    eventId: validation.event._id,
    spaceId: validation.space?._id,
    organizerId: validation.event.host,
    attendeeId: agentId,
    grossAmountUsdc: validation.subtotalCents,  // BASE price, not fee-inclusive
    protocolFeeCents: validation.protocolFeeCents,
    currency: validation.event.currency || 'USD',
  });

  return result;
}

// ---------- Atlas Error ----------

export class AtlasError extends Error {
  code: string;
  httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
```

### Purchase Controller

**File:** `src/app/controllers/atlas/purchase.ts`

```typescript
// src/app/controllers/atlas/purchase.ts

import { type ParameterizedContext } from '../../types';
import {
  validatePurchase,
  fulfillPurchase,
  AtlasError,
  type PurchaseInitParams,
} from '../../services/atlas/purchase';
import { createTicketHold, consumeTicketHold } from '../../services/atlas/ticket-hold';
import { verifyAtlasPayment } from '../../services/atlas/payment-verify';
import { buildAtlas402Response } from '../../middlewares/atlas-mpp';
import { nanoid } from '../../utils/nanoid';
import { centsToDollars } from '../../services/atlas/schema-mapper';
// > **AUDIT FIX R2 [E13]:** Import ExternalEventMapping to check if event is synced.
import ExternalEventMappingModel from '../../models/external-event-mapping';
// > **AUDIT FIX R3 [F14]:** Import AtlasAgentRegistration for abandoned hold counter.
import AtlasAgentRegistrationModel from '../../models/atlas-agent-registration';

export async function purchaseTickets(ctx: ParameterizedContext) {
  const eventId = ctx.params.id;
  const body = ctx.request.body as any;
  const agentId = ctx.state.atlasAgentId as string;
  const idempotencyKey = ctx.state.idempotencyKey as string;

  // Check for idempotency hit (set by middleware)
  if (ctx.state.idempotencyResult) {
    ctx.status = 200;
    ctx.set('Atlas-Version', '1.0');
    ctx.body = ctx.state.idempotencyResult;

    return;
  }

  try {
    // Parse and validate request
    const params: PurchaseInitParams = {
      event_id: eventId,
      ticket_type_id: body.ticket_type_id,
      quantity: body.quantity || 1,
      attendee_info: body.attendee_info || [],
      preferred_payment_method: body.preferred_payment_method,
      discount_codes: body.discount_codes,
      agent_id: agentId,
      idempotency_key: idempotencyKey,
    };

    // Validate attendee count matches quantity
    if (params.attendee_info.length !== params.quantity) {
      ctx.status = 422;
      ctx.body = atlasError('INVALID_REQUEST', 'attendee_info count must match quantity', 422);

      return;
    }

    // Validate purchase (event exists, tickets available, price calculated)
    const validation = await validatePurchase(params);

    // > **AUDIT FIX R2 [E13]:** Synced events are discovery-only. If the event has an
    // > ExternalEventMapping record, reject the purchase attempt. Only native Lemonade
    // > events (no ExternalEventMapping) can use Atlas Direct Ticketing.
    // > **AUDIT FIX R3 [F3]:** Use `lemonadeEventId` (camelCase Mongoose property name),
    // > NOT `lemonade_event_id` (snake_case). The Phase 1 ExternalEventMapping model
    // > defines the field as `lemonadeEventId`. Mongoose queries use property names.
    // > Using snake_case always returns null, making every synced event purchasable.
    const externalMapping = await ExternalEventMappingModel.findOne({
      lemonadeEventId: validation.event._id,
    }).lean();
    if (externalMapping) {
      ctx.status = 422;
      ctx.body = atlasError(
        'SYNCED_EVENT_PURCHASE_BLOCKED',
        `Synced events are discovery-only. Purchase tickets on ${(externalMapping as any).external_url || (externalMapping as any).platform}`,
        422,
      );

      return;
    }

    // > **AUDIT FIX R2 [E5]:** Enforce minimum ticket price of $0.50 for Atlas Direct
    // > Ticketing. Events with ticket prices below this are not eligible for Atlas
    // > purchase flow (discovery is still fine). Prevents micropayment dust attacks.
    if (validation.totalDollars > 0 && validation.totalDollars / params.quantity < 0.50) {
      ctx.status = 422;
      ctx.body = atlasError(
        'PRICE_BELOW_MINIMUM',
        'Ticket price below Atlas minimum ($0.50)',
        422,
      );

      return;
    }

    // ---- Check for Authorization: Atlas-Payment header ----
    const authHeader = ctx.get('Authorization');
    const isPhase2 = authHeader?.startsWith('Atlas-Payment ');

    if (!isPhase2) {
      // ---- PHASE 1: Return 402 with challenge ----

      // > **AUDIT FIX R4 [FT-2]:** Free tickets are NOT eligible for Atlas Direct Ticketing.
      // > Atlas Direct Ticketing is for PAID events only. Free tickets are claimed on the
      // > source platform or via the existing Lemonade free-ticket flow — NOT through the
      // > Atlas MPP purchase path. Return a redirect response (HTTP 200, not 402) so the
      // > agent can direct the user to the correct claiming flow. This prevents database
      // > flooding attacks where bots claim millions of free tickets through Atlas, creating
      // > Ticket documents, EventJoinRequests, receipts, and VCs with no payment barrier.
      if (validation.totalDollars === 0) {
        ctx.status = 200;
        ctx.set('Atlas-Version', '1.0');
        ctx.body = {
          type: 'free_ticket_redirect',
          message: 'Free tickets are claimed directly on the event page, not through the Atlas payment flow. Atlas Direct Ticketing is for PAID events only.',
          redirect_url: validation.event.url || `${config.FRONTEND_URL}/event/${validation.event._id}`,
        };

        return;
      }

      // Create ticket hold (TTL 300s)
      const challengeId = `ch_${nanoid(24)}`;
      const hold = await createTicketHold({
        challenge_id: challengeId,
        event_id: eventId,
        ticket_type_id: params.ticket_type_id,
        quantity: params.quantity,
        agent_id: agentId,
        idempotency_key: idempotencyKey,
        total_price_usd: validation.totalDollars,       // AUDIT FIX R3 [F8]: fee-inclusive total
        protocol_fee_cents: validation.protocolFeeCents, // AUDIT FIX R3 [F8]: stored for Phase 4
        subtotal_cents: validation.subtotalCents,        // AUDIT FIX R3 [F8]: base price for Phase 4
        ip_address: ctx.ip,                              // AUDIT FIX R3 [F2]: IP for rate limiting
        attendee_info: params.attendee_info,
        discount_codes: params.discount_codes,
      });

      // > **AUDIT FIX R2 [E3]:** Compute `price_valid_until` as `min(hold_expires_at, next_scheduled_sync)`.
      // > For native events (no sync), price_valid_until = hold_expires_at.
      // > NOTE: Synced events are blocked above by E13, so only native events reach here.
      // > However, if dual-mode is ever enabled in a future phase, this logic will handle it.
      const priceValidUntil = hold.expires_at.toISOString();

      // Build 402 response per PROTOCOL-SPEC.md Section 6.3
      ctx.status = 402;
      ctx.set('Atlas-Version', '1.0');
      // > **AUDIT FIX R3 [F8]:** 402 challenge includes fee-inclusive total. Buyer pays
      // > base + 2% protocol fee. `base_price_usd` is the organizer's portion.
      ctx.body = buildAtlas402Response({
        base_price_usd: centsToDollars(validation.subtotalCents),  // AUDIT FIX R3 [F8]
        total_price_usd: validation.totalDollars,                   // AUDIT FIX R3 [F8]: fee-inclusive
        hold_id: hold.hold_id,
        challenge_id: challengeId,
        hold_expires_at: hold.expires_at.toISOString(),
        event_id: eventId,
        ticket_type_id: params.ticket_type_id,
        quantity: params.quantity,
        currency: validation.event.currency || 'USD',  // AUDIT FIX [P2-H5]
        price_valid_until: priceValidUntil,             // AUDIT FIX R2 [E3]
      });

      return;
    }

    // ---- PHASE 2: Verify payment and fulfill ----

    const challengeId = body.challenge_id;
    const holdId = body.ticket_hold_id;
    const paymentProof = body.payment_proof;

    if (!challengeId || !holdId || !paymentProof) {
      ctx.status = 422;
      ctx.body = atlasError('INVALID_REQUEST', 'Missing challenge_id, ticket_hold_id, or payment_proof', 422);

      return;
    }

    // Consume the hold (marks it used, returns null if expired/consumed/wrong agent)
    const hold = await consumeTicketHold(holdId, challengeId, agentId);
    if (!hold) {
      // > **AUDIT FIX R3 [F14]:** Increment abandoned_hold_count on agent registration.
      // > TTL index auto-deletes expired holds, so this counter is the only reliable
      // > way to track non-completion for progressive TTL reduction (E6).
      await AtlasAgentRegistrationModel.updateOne(
        { agent_id: agentId },
        { $inc: { abandoned_hold_count: 1 } },
      );

      ctx.status = 410;
      ctx.body = atlasError('HOLD_EXPIRED', 'Ticket hold has expired. Please restart the purchase.', 410);

      return;
    }

    // > **AUDIT FIX [P2-H2]:** Verify payment against held price, not current price.
    // > The hold IS the price lock. If the price changed between Phase 1 and
    // > Phase 2, the hold price wins — prevents price manipulation attacks.
    const verification = await verifyAtlasPayment(paymentProof, {
      expected_amount_usd: hold.total_price_usd,
      challenge_id: challengeId,
    });

    if (!verification.valid) {
      ctx.status = 422;
      ctx.body = atlasError('PAYMENT_UNVERIFIED', verification.error || 'Payment verification failed', 422);

      return;
    }

    // Fulfill: create payment + tickets + VCs + receipt
    const result = await fulfillPurchase(
      validation,
      paymentProof,
      agentId,
      idempotencyKey,
      hold.attendee_info,
    );

    ctx.status = 200;
    ctx.set('Atlas-Version', '1.0');
    // > **AUDIT FIX R4 [SV-4]:** Pass the purchasing user to include verification prompt
    // > for unverified users. `validation.attendeeUser` is the User document resolved
    // > during purchase validation. The implementing agent must ensure this is populated.
    ctx.body = formatReceiptResponse(result, validation.attendeeUser);
  } catch (err) {
    if (err instanceof AtlasError) {
      ctx.status = err.httpStatus;
      ctx.body = atlasError(err.code, err.message, err.httpStatus);

      return;
    }
    throw err;
  }
}

function atlasError(code: string, message: string, httpStatus: number) {
  return {
    error: {
      code,
      http_status: httpStatus,
      message,
      details: {},
      retry_after: null,
      atlas_version: '1.0',
    },
  };
}

// > **AUDIT FIX R4 [SV-4]:** `formatReceiptResponse` accepts the purchasing user to check
// > Self.xyz verification status. Unverified users receive a `verification_prompt` field
// > encouraging them to verify for boosted rewards. Verified users get `null`.
// > The implementing agent MUST find the existing Self.xyz verification field on the
// > User model — grep for `self` / `selfxyz` / `self_xyz` / `verified` in
// > `src/app/models/user.ts` to locate the correct field name (e.g., `user.selfVerified`
// > or `user.self_verified` or `user.identity_verified`).
function formatReceiptResponse(result: any, purchasingUser?: any) {
  // > **AUDIT FIX R4 [SV-4]:** Build verification prompt for unverified users.
  // > Only include if the user is NOT Self-verified.
  const isVerified = purchasingUser?.selfVerified === true; // Agent: replace `selfVerified` with actual field name from User model
  const verificationPrompt = isVerified ? null : {
    message: 'Verify your identity with Self to earn 2x cashback on future purchases',
    verify_url: 'https://lemonade.social/settings/verify',
    benefits: ['2x cashback', 'Referral rewards', 'Free event rewards', 'Discovery bonus'],
  };

  return {
    'atlas:receipt': {
      receipt_id: result.receipt.receipt_id,
      status: result.receipt.status,
      event_id: result.receipt.event.toString(),
      event_name: result.receipt.event_name,
      purchase_timestamp: result.receipt.created_at?.toISOString() || new Date().toISOString(),
      total_charged: result.receipt.total_charged,
      currency: result.receipt.currency,
      payment_method: result.receipt.payment_method,
      transaction_hash: result.transaction_hash || null,
      stripe_payment_intent: result.receipt.stripe_payment_intent || null,
      tickets: result.receipt.vc_tickets,
      rewards: {
        attendee_reward_usdc: 0,
        reward_status: 'ineligible',
        reward_payout_address: null,
      },
      // > **AUDIT FIX R4 [SV-4]:** Verification prompt for unverified users.
      verification_prompt: verificationPrompt,
    },
  };
}
```

---

## 9. Task 5: AtlasTicketHold Model

**File:** `src/app/models/atlas-ticket-hold.ts`

TTL-indexed MongoDB document for inventory holds during the 402 flow.

```typescript
// src/app/models/atlas-ticket-hold.ts

import { getModelForClass, index, modelOptions, prop } from '@typegoose/typegoose';
import { Types } from 'mongoose';

@modelOptions({ schemaOptions: { collection: 'atlas_ticket_holds' } })
@index({ hold_id: 1 }, { unique: true })
@index({ challenge_id: 1 }, { unique: true })
@index({ agent_id: 1, event_id: 1 })
@index({ agent_id: 1, event_id: 1, status: 1 })       // AUDIT FIX R2 [E6]: supports hold limit + abandoned count queries
@index({ event_id: 1, status: 1, expires_at: 1 })      // AUDIT FIX R2 [E6]: supports total active holds per event query
@index({ expires_at: 1 }, { expireAfterSeconds: 0 })   // TTL index: auto-delete when expired
export class AtlasTicketHold {
  @prop({ required: true })
  hold_id!: string;                  // hold_<nanoid>

  @prop({ required: true })
  challenge_id!: string;             // ch_<nanoid>

  @prop({ required: true })
  event_id!: string;

  @prop({ required: true })
  ticket_type_id!: string;

  @prop({ required: true })
  quantity!: number;

  @prop({ required: true })
  agent_id!: string;

  @prop({ required: true })
  idempotency_key!: string;

  @prop({ required: true })
  total_price_usd!: number;

  // > **AUDIT FIX R3 [F8]:** Store protocol fee and subtotal on hold for Phase 4.
  // > Phase 4 receives `subtotal_cents` as `grossAmountUsdc` (base price, NOT fee-inclusive).
  // > Phase 4 then calculates the 2% split from that base.
  @prop({ required: true })
  protocol_fee_cents!: string;         // 2% protocol fee in cents (BigInt string)

  @prop({ required: true })
  subtotal_cents!: string;             // Base price before fees in cents (BigInt string)

  @prop({ type: () => [Object] })
  attendee_info!: Array<{ name: string; email: string }>;

  @prop({ type: () => [String] })
  discount_codes?: string[];

  @prop({ required: true, enum: ['pending', 'consumed', 'expired'] })
  status!: string;

  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop({ required: true })
  expires_at!: Date;                 // TTL field — MongoDB auto-deletes after this time
}

export const AtlasTicketHoldModel = getModelForClass(AtlasTicketHold);

export default AtlasTicketHoldModel;
```

### Ticket Hold Service

**File:** `src/app/services/atlas/ticket-hold.ts`

```typescript
// src/app/services/atlas/ticket-hold.ts

import AtlasTicketHoldModel from '../../models/atlas-ticket-hold';
import AtlasAgentRegistrationModel from '../../models/atlas-agent-registration';
import EventTicketTypeModel from '../../models/event-ticket-type';
import { nanoid } from '../../utils/nanoid';
import { redis } from '../../helpers/redis';
import { AtlasError } from './purchase';

const HOLD_TTL_SECONDS = 300; // 5 minutes per PROTOCOL-SPEC.md Section 6.3
// > **AUDIT FIX R2 [E6]:** Reduced TTL for agents with repeated non-completion.
const REDUCED_HOLD_TTL_SECONDS = 60;
// > **AUDIT FIX R2 [E6]:** Max active holds per agent per event.
const MAX_HOLDS_PER_AGENT_PER_EVENT = 5;
// > **AUDIT FIX R2 [E6]:** Max total active holds as fraction of event inventory.
const MAX_HOLDS_INVENTORY_FRACTION = 0.2; // 20% of ticket_limit
// > **AUDIT FIX R2 [E6]:** Abandoned hold threshold before TTL reduction.
const ABANDONED_HOLD_THRESHOLD = 3;

export interface CreateHoldParams {
  challenge_id: string;
  event_id: string;
  ticket_type_id: string;
  quantity: number;
  agent_id: string;
  idempotency_key: string;
  total_price_usd: number;
  protocol_fee_cents: string;       // > **AUDIT FIX R3 [F8]:** 2% protocol fee in cents
  subtotal_cents: string;           // > **AUDIT FIX R3 [F8]:** Base price for Phase 4
  ip_address: string;               // > **AUDIT FIX R3 [F2]:** Client IP for rate limiting
  attendee_info: Array<{ name: string; email: string }>;
  discount_codes?: string[];
}

export async function createTicketHold(params: CreateHoldParams) {
  // > **AUDIT FIX R3 [F2]:** IP-based hold rate limiting. Agent IDs are self-asserted
  // > (any non-empty string), so per-agent limits are trivially bypassed by generating
  // > new agent IDs. IP-based limits are the primary defense alongside the 20% inventory cap.
  // >
  // > (1) Max 10 active holds per IP across ALL events (Redis counter, TTL 300s)
  const ipActiveKey = `atlas:holds:ip:${params.ip_address}:active`;
  const ipActiveCount = Number(await redis.get(ipActiveKey) || '0');
  if (ipActiveCount >= 10) {
    throw new AtlasError(
      'IP_HOLD_LIMIT_EXCEEDED',
      'Too many active holds from this IP address. Complete or wait for existing holds to expire.',
      429,
    );
  }
  // > (2) Max 20 hold CREATIONS per IP per hour (sliding window)
  const ipHourlyKey = `atlas:holds:ip:${params.ip_address}:hourly`;
  const ipHourlyCount = Number(await redis.get(ipHourlyKey) || '0');
  if (ipHourlyCount >= 20) {
    throw new AtlasError(
      'IP_RATE_LIMIT_EXCEEDED',
      'Too many hold requests from this IP address. Try again later.',
      429,
    );
  }
  // > Agent registration with approval/cost is a future enhancement — don't block launch.

  // > **AUDIT FIX R2 [E6]:** Limit holds per agent per event: max 5 active holds
  // > per `Atlas-Agent-Id` per event. Reject with 429 if exceeded.
  const agentActiveHolds = await AtlasTicketHoldModel.countDocuments({
    agent_id: params.agent_id,
    event_id: params.event_id,
    status: 'pending',
    expires_at: { $gt: new Date() },
  });
  if (agentActiveHolds >= MAX_HOLDS_PER_AGENT_PER_EVENT) {
    throw new AtlasError(
      'HOLD_LIMIT_EXCEEDED',
      `Maximum ${MAX_HOLDS_PER_AGENT_PER_EVENT} active holds per agent per event. Complete or wait for existing holds to expire.`,
      429,
    );
  }

  // > **AUDIT FIX R2 [E6]:** Limit total active holds per event: max `ticket_limit * 0.2`
  // > (20% of total inventory) held simultaneously.
  const ticketType = await EventTicketTypeModel.findById(params.ticket_type_id).lean() as any;
  if (ticketType?.ticket_limit) {
    const totalActiveHolds = await AtlasTicketHoldModel.countDocuments({
      event_id: params.event_id,
      status: 'pending',
      expires_at: { $gt: new Date() },
    });
    const maxTotalHolds = Math.max(1, Math.floor(ticketType.ticket_limit * MAX_HOLDS_INVENTORY_FRACTION));
    if (totalActiveHolds >= maxTotalHolds) {
      throw new AtlasError(
        'EVENT_HOLD_CAPACITY',
        'Too many pending holds for this event. Try again shortly.',
        429,
      );
    }
  }

  // > **AUDIT FIX R2 [E6]:** Reduce hold TTL for repeated non-completion.
  // > After 3 abandoned holds by same agent, reduce TTL from 300s to 60s.
  // > **AUDIT FIX R3 [F14]:** TTL index auto-deletes expired holds, so querying
  // > holds collection for `status: 'expired'` always returns 0. Instead, read
  // > `abandoned_hold_count` from AtlasAgentRegistration, which is incremented
  // > when the purchase flow detects a hold has expired (hold returns null from
  // > consumeTicketHold). See consumeTicketHold below.
  const agentReg = await AtlasAgentRegistrationModel.findOne({
    agent_id: params.agent_id,
  }).lean();
  const abandonedHoldCount = agentReg?.abandoned_hold_count || 0;
  const effectiveTtl = abandonedHoldCount >= ABANDONED_HOLD_THRESHOLD
    ? REDUCED_HOLD_TTL_SECONDS
    : HOLD_TTL_SECONDS;

  const holdId = `hold_${nanoid(24)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + effectiveTtl * 1000);

  const hold = await AtlasTicketHoldModel.create({
    hold_id: holdId,
    challenge_id: params.challenge_id,
    event_id: params.event_id,
    ticket_type_id: params.ticket_type_id,
    quantity: params.quantity,
    agent_id: params.agent_id,
    idempotency_key: params.idempotency_key,
    total_price_usd: params.total_price_usd,
    protocol_fee_cents: params.protocol_fee_cents,   // AUDIT FIX R3 [F8]
    subtotal_cents: params.subtotal_cents,             // AUDIT FIX R3 [F8]
    attendee_info: params.attendee_info,
    discount_codes: params.discount_codes,
    status: 'pending',
    created_at: now,
    expires_at: expiresAt,
  });

  // > **AUDIT FIX R3 [F2]:** Increment IP-based Redis counters after hold creation.
  // > Active counter: TTL 300s (matches hold TTL). Hourly counter: TTL 3600s.
  await redis.multi()
    .incr(ipActiveKey)
    .expire(ipActiveKey, 300)
    .incr(ipHourlyKey)
    .expire(ipHourlyKey, 3600)
    .exec();

  return hold;
}

// > **AUDIT FIX [P2-M3]:** Added `agent_id` parameter and filter to prevent
// > a different agent from consuming another agent's hold.
/**
 * Consume a ticket hold. Returns the hold if valid, null if expired/consumed.
 * Uses findOneAndUpdate for atomicity. Rejects if agent_id doesn't match.
 */
export async function consumeTicketHold(
  holdId: string,
  challengeId: string,
  agentId: string,
): Promise<InstanceType<typeof AtlasTicketHoldModel> | null> {
  const hold = await AtlasTicketHoldModel.findOneAndUpdate(
    {
      hold_id: holdId,
      challenge_id: challengeId,
      agent_id: agentId,
      status: 'pending',
      expires_at: { $gt: new Date() },
    },
    { $set: { status: 'consumed' } },
    { new: false },                     // Return the original (pre-update) document
  ).lean();

  return hold as any;
}
```

---

## 10. Task 6: AtlasReceipt Model

**File:** `src/app/models/atlas-receipt.ts`

```typescript
// src/app/models/atlas-receipt.ts

import { type Ref, getModelForClass, index, modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Types } from 'mongoose';

@modelOptions({
  schemaOptions: { collection: 'atlas_receipts' },
  options: { allowMixed: Severity.ALLOW },
})
@index({ receipt_id: 1 }, { unique: true })
@index({ event: 1, created_at: -1 })
@index({ agent_id: 1, created_at: -1 })
@index({ idempotency_key: 1 }, { unique: true })
@index({ 'tickets': 1 })
export class AtlasReceipt {
  @prop({ required: true })
  receipt_id!: string;                    // rcpt_<nanoid>

  @prop({ required: true, enum: ['confirmed', 'pending', 'failed'] })
  status!: string;

  @prop({ required: true, ref: 'Event' })
  event!: Types.ObjectId;

  @prop({ required: true })
  event_name!: string;

  @prop({ required: true })
  agent_id!: string;

  @prop({ required: true, ref: 'NewPayment' })
  payment!: Types.ObjectId;

  @prop({ required: true, type: () => [Types.ObjectId] })
  tickets!: Types.ObjectId[];              // Refs to Ticket documents

  @prop({ required: true })
  total_charged!: number;                  // decimal USD

  @prop({ required: true })
  currency!: string;

  @prop({ required: true })
  payment_method!: string;                 // tempo_usdc | base_usdc | stripe_spt

  @prop()
  transaction_hash?: string;

  @prop()
  stripe_payment_intent?: string;

  @prop({ required: true })
  idempotency_key!: string;

  @prop({ type: () => [Object] })
  vc_tickets!: object[];                   // Array of W3C VC objects

  @prop({ required: true, default: Date.now })
  created_at!: Date;
}

export const AtlasReceiptModel = getModelForClass(AtlasReceipt);

export default AtlasReceiptModel;
```

---

## 11. Task 7: Verifiable Credential Issuance Service

**File:** `src/app/services/atlas/vc-issuer.ts`

Issues W3C Verifiable Credentials with DID:web and ES256 JWS per PROTOCOL-SPEC.md Section 7.

```typescript
// src/app/services/atlas/vc-issuer.ts

import * as jose from 'jose';
import { nanoid } from '../../utils/nanoid';
import { atlasSigningKeyId, atlasSigningPrivateKeyPem, atlasDomain } from '../../../config';

// ---- Types ----

export interface AtlasVerifiableCredential {
  '@context': string[];
  type: string[];
  id: string;                                // urn:atlas:ticket:{ticket_id}
  issuer: string;                            // did:web:{domain}
  issuanceDate: string;
  credentialSubject: {
    id: string;                              // did:atlas:agent:{agent_id}
    attendee_name: string;
    attendee_email: string;
    event_id: string;
    event_name: string;
    ticket_type: string;
    ticket_type_id: string;
    valid_from: string;
    valid_until: string;
    seat: null;
    barcode: string;
    barcode_format: 'qr';
  };
  proof: {
    type: 'JsonWebSignature2020';
    created: string;
    verificationMethod: string;              // did:web:{domain}#{kid}
    proofPurpose: 'assertionMethod';
    jws: string;
  };
}

// ---- Signing Key Cache ----

let _signingKey: jose.KeyLike | null = null;

async function getSigningKey(): Promise<jose.KeyLike> {
  if (_signingKey) return _signingKey;
  _signingKey = await jose.importPKCS8(atlasSigningPrivateKeyPem, 'ES256');

  return _signingKey;
}

// ---- VC Issuance ----

/**
 * Issue W3C Verifiable Credentials for a set of tickets.
 *
 * Each ticket gets its own VC with an ES256 JWS proof.
 * The issuer DID is did:web:{domain} and the verification method
 * references the key ID from /.well-known/atlas.json signing_keys[].
 */
export async function issueVerifiableCredentials(
  tickets: any[],               // Ticket documents from MongoDB
  event: any,                   // Lean Event document
  ticketType: any,              // Lean EventTicketType document
  attendeeInfo: Array<{ name: string; email: string }>,
  agentId: string,
): Promise<AtlasVerifiableCredential[]> {
  const signingKey = await getSigningKey();
  const now = new Date().toISOString();

  const vcs: AtlasVerifiableCredential[] = [];

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const attendee = attendeeInfo[i];

    // Build the credential (without proof)
    const credential = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://atlas-protocol.org/v1/credentials',
      ],
      type: ['VerifiableCredential', 'AtlasTicket'],
      id: `urn:atlas:ticket:tkt_${ticket.shortid || nanoid(16)}`,
      issuer: `did:web:${atlasDomain}`,
      issuanceDate: now,
      credentialSubject: {
        id: `did:atlas:agent:${agentId}`,
        attendee_name: attendee.name,
        attendee_email: attendee.email,
        event_id: event._id.toString(),
        event_name: event.title,
        ticket_type: ticketType.title,
        ticket_type_id: ticketType._id.toString(),
        valid_from: event.start.toISOString(),
        valid_until: (event.end || event.start).toISOString(),
        seat: null,
        barcode: `ATLAS-TKT-${ticket.shortid || nanoid(8)}`,
        barcode_format: 'qr' as const,
      },
    };

    // Sign with ES256 (JWS compact serialization, detached payload)
    // Using b64=false critical header for JsonWebSignature2020 compliance
    const payload = JSON.stringify(credential);
    const jws = await new jose.CompactSign(
      new TextEncoder().encode(payload),
    )
      .setProtectedHeader({
        alg: 'ES256',
        b64: false,
        crit: ['b64'],
      })
      .sign(signingKey);

    vcs.push({
      ...credential,
      proof: {
        type: 'JsonWebSignature2020',
        created: now,
        verificationMethod: `did:web:${atlasDomain}#${atlasSigningKeyId}`,
        proofPurpose: 'assertionMethod',
        jws,
      },
    });
  }

  return vcs;
}
```

---

## 12. Task 8: Well-Known Manifest Generator

**File:** `src/app/services/atlas/manifest.ts` and `src/app/controllers/atlas/well-known.ts`

Auto-generates `/.well-known/atlas.json` per Space config, conforming to SCHEMAS.md Section 1.

### Manifest Service

```typescript
// src/app/services/atlas/manifest.ts

import {
  atlasApiBaseUrl,
  atlasDomain,
  atlasSigningKeyId,
  atlasSigningPublicKeyJwk,
  atlasPlatformFeePercent,
} from '../../../config';

export interface AtlasManifest {
  '@context': string;
  atlas_version: string;
  platform: {
    name: string;
    url: string;
    logo?: string;
    description: string;
    contact_email?: string;
  };
  capabilities: {
    discovery: boolean;
    purchase: boolean;
    refund: boolean;
    holds: boolean;
    oauth_connect: boolean;
    webhooks: boolean;
  };
  endpoints: {
    events: string;
    search: string;
    purchase: string;
    receipt_verify: string;
  };
  payment_methods: string[];
  fee_schedule: {
    protocol_fee_percent: number;
    platform_fee_percent: number;
    payment_processing_note: string;
  };
  signing_keys: object[];
  rate_limits: {
    search_per_minute: number;
    purchase_per_minute: number;
  };
}

export function generateManifest(): AtlasManifest {
  return {
    '@context': 'https://atlas-protocol.org/v1',
    atlas_version: '1.0',
    platform: {
      name: 'Lemonade',
      url: 'https://lemonade.social',
      logo: 'https://lemonade.social/assets/logo.png',
      description: 'Social events platform for communities',
      contact_email: 'atlas-tech@lemonade.social',
    },
    capabilities: {
      discovery: true,
      purchase: true,
      refund: false,             // Phase 2 does not implement refunds
      holds: true,
      oauth_connect: false,      // Future phase
      webhooks: false,           // Future phase
    },
    endpoints: {
      events: `${atlasApiBaseUrl}/atlas/v1/events`,
      search: `${atlasApiBaseUrl}/atlas/v1/search`,
      purchase: `${atlasApiBaseUrl}/atlas/v1/events/{event_id}/purchase`,
      receipt_verify: `${atlasApiBaseUrl}/atlas/v1/receipts/{receipt_id}/verify`,
    },
    payment_methods: ['tempo_usdc', 'base_usdc', 'stripe_spt'],
    fee_schedule: {
      protocol_fee_percent: 2.0,
      platform_fee_percent: atlasPlatformFeePercent,
      payment_processing_note: 'Tempo USDC: <$0.001 per tx. Base USDC: ~$0.001 per tx. Stripe: 2.9% + $0.30.',
    },
    signing_keys: [atlasSigningPublicKeyJwk],
    rate_limits: {
      search_per_minute: 100,
      purchase_per_minute: 10,
    },
  };
}
```

### Well-Known Controller

```typescript
// src/app/controllers/atlas/well-known.ts

import { type ParameterizedContext } from '../../types';
import { generateManifest } from '../../services/atlas/manifest';

// > **AUDIT FIX [P2-M1]:** Renamed controller function from `generateManifest` to
// > `handleManifestRequest` to avoid name collision with the service function.
/**
 * GET /.well-known/atlas.json
 *
 * Returns the Atlas manifest with CORS headers per PROTOCOL-SPEC.md Section 3.1.
 */
export async function handleManifestRequest(ctx: ParameterizedContext) {
  const manifest = generateManifest();

  ctx.set('Content-Type', 'application/json');
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Cache-Control', 'public, max-age=3600');  // 1 hour cache
  ctx.body = manifest;
}
```

**NOTE:** The controller function is `handleManifestRequest` (not `generateManifest`) to avoid collision with the imported service function of the same name.

---

## 13. Task 9: Tempo + Base Chain Documents

New Chain model entries for Tempo and Base networks. Tempo is EVM-compatible and reuses the `ethereum` `BlockchainPlatform` enum (per `src/app/models/chain.ts:9-12`).

### Tempo Chain Configuration

Based on Tempo documentation (https://docs.tempo.xyz):

- **Chain ID:** `1001` (Tempo Mainnet)
- **Platform:** `ethereum` (EVM-compatible, reuses existing enum)
- **RPC URL:** `https://rpc.tempo.xyz`
- **Block time:** ~1 second
- **Safe confirmations:** 1 (near-instant finality)
- **USDC contract on Tempo:** Research needed at deployment time. Placeholder: `0xTEMPO_USDC_CONTRACT`

### Base Chain Configuration

Base (Coinbase L2) is already EVM-compatible:

- **Chain ID:** `8453` (Base Mainnet)
- **Platform:** `ethereum`
- **RPC URL:** `https://mainnet.base.org`
- **Block time:** 2 seconds
- **Safe confirmations:** 12
- **USDC contract:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

### Migration Seed Data

Add to the migration file (`db/migrations/<timestamp>-add-atlas-protocol-models.ts`):

```typescript
// Tempo chain document
await ChainModel.create({
  active: true,
  platform: 'ethereum',              // EVM-compatible, reuses existing enum
  chain_id: '1001',                   // Tempo mainnet chain ID
  name: 'Tempo',
  code_name: 'tempo',
  rpc_url: 'https://rpc.tempo.xyz',
  private_rpc_url: process.env.TEMPO_PRIVATE_RPC_URL || 'https://rpc.tempo.xyz',
  block_explorer_url: 'https://explorer.tempo.xyz',
  block_explorer_name: 'Tempo Explorer',
  block_explorer_for_tx: '/tx/',
  block_explorer_for_token: '/token/',
  block_explorer_for_address: '/address/',
  block_time: 1,
  safe_confirmations: 1,
  tokens: [
    {
      active: true,
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      contract: '0xTEMPO_USDC_CONTRACT',   // UPDATE at deployment
      is_native: false,
    },
  ],
});

// Base chain document (may already exist — use upsert)
await ChainModel.updateOne(
  { chain_id: '8453' },
  {
    $setOnInsert: {
      active: true,
      platform: 'ethereum',
      chain_id: '8453',
      name: 'Base',
      code_name: 'base',
      rpc_url: 'https://mainnet.base.org',
      block_explorer_url: 'https://basescan.org',
      block_explorer_name: 'BaseScan',
      block_explorer_for_tx: '/tx/',
      block_explorer_for_token: '/token/',
      block_explorer_for_address: '/address/',
      block_time: 2,
      safe_confirmations: 12,
      tokens: [
        {
          active: true,
          name: 'USD Coin',
          symbol: 'USDC',
          decimals: 6,
          contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          is_native: false,
        },
      ],
    },
  },
  { upsert: true },
);
```

**IMPORTANT:** The Tempo USDC contract address is a placeholder. Before deployment, research the actual contract address from https://docs.tempo.xyz and update the migration. The implementing agent MUST verify this before the PR is opened.

---

## 13b. Task 9b: Internal Spaces Discovery Endpoint (Phase 3 Dependency)

**File:** `src/app/routers/atlas.ts` (add to existing Atlas router)

Phase 3 (Atlas Registry) needs to discover which Spaces have Atlas enabled. Add a simple internal endpoint:

```typescript
// GET /atlas/v1/internal/spaces
// Returns list of Atlas-enabled Spaces for Registry indexing.
// Protected by internal API secret (not public-facing).
router.get('/internal/spaces', async (ctx) => {
  const secret = ctx.get('x-internal-secret');
  if (secret !== config.ATLAS_INTERNAL_SECRET) {
    ctx.status = 401;
    ctx.body = { error: 'Unauthorized' };
    return;
  }

  // > **AUDIT FIX [P2-M5]:** `custom_domain` does NOT exist on the Space model.
  // > Removed from projection. Use `Space.slug` for URL construction instead.
  // > Space model has `hostnames` (for whitelabel) but NOT `custom_domain`.
  // Find all Spaces that have at least one payment account (Atlas-capable)
  const spaces = await SpaceModel.find(
    { payment_accounts: { $exists: true, $ne: [] } },
    { _id: 1, title: 1, slug: 1, payment_accounts: 1 }
  ).lean();

  ctx.body = {
    spaces: spaces.map((s) => ({
      id: s._id.toString(),
      name: s.title,
      slug: s.slug,
      atlas_endpoint: `${config.APPLICATION_URL}/atlas/v1`,
      manifest_url: `${config.APPLICATION_URL}/.well-known/atlas.json?space=${s._id}`,
    })),
  };
});
```

**Environment variable:** Add `ATLAS_INTERNAL_SECRET` to config (shared with Registry service).

> **Cross-phase dependency:** Phase 3 Registry polls this endpoint to discover Atlas-enabled Spaces. If Phase 2 ships before Phase 3, this endpoint is ready. If Phase 3 starts before this endpoint exists, Registry should fall back to manual Space registration via admin API.

---

## 14. Task 10: Agent Authentication Middleware

**File:** `src/app/middlewares/atlas-agent-auth.ts`

Validates the `Atlas-Agent-Id` header and optional API key. Creates a lightweight agent registration on first contact.

```typescript
// src/app/middlewares/atlas-agent-auth.ts

import { type Middleware } from '@koa/router';
import { type Context, type State } from '../types';
import AtlasAgentRegistrationModel from '../models/atlas-agent-registration';

/**
 * Middleware that validates the Atlas-Agent-Id header.
 * For Phase 2, this performs lightweight validation:
 * - Requires Atlas-Agent-Id header (non-empty string)
 * - Optionally validates API key via Authorization: Bearer atlas_<key>
 * - Creates/updates agent registration on first contact
 */
export function atlasAgentAuth(): Middleware<State, Context> {
  return async function (ctx, next) {
    const agentId = ctx.get('Atlas-Agent-Id');

    if (!agentId || agentId.trim().length === 0) {
      ctx.status = 401;
      ctx.body = {
        error: {
          code: 'MISSING_AGENT_ID',
          http_status: 401,
          message: 'Atlas-Agent-Id header is required',
          atlas_version: '1.0',
        },
      };

      return;
    }

    // Store agent ID in state for downstream use
    ctx.state.atlasAgentId = agentId;

    // Upsert agent registration (non-blocking, fire-and-forget)
    AtlasAgentRegistrationModel.updateOne(
      { agent_id: agentId },
      {
        $set: { last_seen_at: new Date(), ip_address: ctx.ip },
        $setOnInsert: { agent_id: agentId, first_seen_at: new Date() },
        $inc: { request_count: 1 },
      },
      { upsert: true },
    ).catch(() => {});   // Swallow errors — auth should not fail on tracking

    await next();
  };
}
```

### AtlasAgentRegistration Model

**File:** `src/app/models/atlas-agent-registration.ts`

```typescript
// src/app/models/atlas-agent-registration.ts

import { getModelForClass, index, modelOptions, prop } from '@typegoose/typegoose';

@modelOptions({ schemaOptions: { collection: 'atlas_agent_registrations' } })
@index({ agent_id: 1 }, { unique: true })
@index({ last_seen_at: -1 })
export class AtlasAgentRegistration {
  @prop({ required: true })
  agent_id!: string;

  @prop()
  api_key?: string;                   // Future: hashed API key for premium agents

  @prop({ required: true, default: Date.now })
  first_seen_at!: Date;

  @prop({ required: true, default: Date.now })
  last_seen_at!: Date;

  @prop({ default: 0 })
  request_count!: number;

  // > **AUDIT FIX R3 [F14]:** Counter for abandoned (expired, unconsumed) holds.
  // > Incremented when purchase flow detects an expired hold (consumeTicketHold returns null).
  // > TTL index auto-deletes holds, so this counter is the only reliable source.
  // > Used by createTicketHold to reduce TTL for repeat offenders (E6 fix).
  @prop({ default: 0 })
  abandoned_hold_count!: number;

  @prop()
  ip_address?: string;

  @prop()
  user_agent?: string;

  @prop()
  metadata?: Record<string, unknown>;
}

export const AtlasAgentRegistrationModel = getModelForClass(AtlasAgentRegistration);

export default AtlasAgentRegistrationModel;
```

---

## 15. Task 11: Idempotency Middleware

**File:** `src/app/middlewares/atlas-idempotency.ts`

Deduplicates purchase requests via the required `Idempotency-Key` header. Uses Redis with 24h TTL.

```typescript
// src/app/middlewares/atlas-idempotency.ts

import { type Middleware } from '@koa/router';
import { type Context, type State } from '../types';
import { redis } from '../helpers/redis';

const IDEMPOTENCY_PREFIX = 'atlas:idempotent:';
const IDEMPOTENCY_TTL = 86400;   // 24 hours

/**
 * Middleware that enforces the Idempotency-Key header.
 * - If a previous result exists for this key, returns it immediately.
 * - Otherwise, stores the result after the handler completes.
 */
export function atlasIdempotency(): Middleware<State, Context> {
  return async function (ctx, next) {
    const idempotencyKey = ctx.get('Idempotency-Key');

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      ctx.status = 422;
      ctx.body = {
        error: {
          code: 'MISSING_IDEMPOTENCY_KEY',
          http_status: 422,
          message: 'Idempotency-Key header is required for purchase requests',
          atlas_version: '1.0',
        },
      };

      return;
    }

    // Validate format: UUID v4 or 16-64 alphanumeric
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      ctx.status = 422;
      ctx.body = {
        error: {
          code: 'INVALID_IDEMPOTENCY_KEY',
          http_status: 422,
          message: 'Idempotency-Key must be 16-128 characters',
          atlas_version: '1.0',
        },
      };

      return;
    }

    ctx.state.idempotencyKey = idempotencyKey;

    // Check for existing result
    const agentId = ctx.state.atlasAgentId || 'unknown';
    const redisKey = `${IDEMPOTENCY_PREFIX}${agentId}:${idempotencyKey}`;
    const existing = await redis.get(redisKey);

    if (existing) {
      try {
        ctx.state.idempotencyResult = JSON.parse(existing);
      } catch {
        // Corrupted cache — proceed normally
      }
    }

    await next();

    // Store successful result for dedup (only for 200 responses)
    if (ctx.status === 200 && ctx.body && !ctx.state.idempotencyResult) {
      await redis.setex(redisKey, IDEMPOTENCY_TTL, JSON.stringify(ctx.body)).catch(() => {});
    }
  };
}
```

---

### Task 11b: Atlas Rate Limit Middleware

> **AUDIT FIX R4 [FT-3]:** IP-based rate limiting on Atlas search and event detail endpoints. Prevents bots from flooding discovery endpoints to scrape event data or abuse the free ticket redirect. Rate limits declared in the manifest must actually be enforced at the router level.

**File:** `src/app/middlewares/atlas-rate-limit.ts`

```typescript
// src/app/middlewares/atlas-rate-limit.ts
// > **AUDIT FIX R4 [FT-3]:** IP-based rate limiting for Atlas discovery endpoints.
// > Enforces the rate limits declared in the well-known manifest.

import { type Middleware } from '@koa/router';
import { type Context, type State } from '../types';
import { redis } from '../helpers/redis';

// > **AUDIT FIX R4 [FT-3]:** Rate limits per IP.
// > Unauthenticated (no Atlas-Agent-Id header): 60 req/min per IP.
// > Authenticated agents (valid Atlas-Agent-Id): 200 req/min per IP.
const UNAUTH_LIMIT = 60;
const AUTH_LIMIT = 200;
const WINDOW_SECONDS = 60;

/**
 * Rate limiting middleware for Atlas discovery endpoints.
 * Uses Redis sliding window counters keyed by IP address.
 * Must be placed BEFORE atlasAgentAuth() in the middleware chain
 * so IP limits are enforced even for unauthenticated requests.
 */
export function atlasRateLimit(): Middleware<State, Context> {
  return async function (ctx, next) {
    const ip = ctx.ip;
    const agentId = ctx.get('Atlas-Agent-Id');
    const isAuthenticated = !!agentId && agentId.trim().length > 0;
    const limit = isAuthenticated ? AUTH_LIMIT : UNAUTH_LIMIT;
    const tier = isAuthenticated ? 'auth' : 'unauth';

    const redisKey = `atlas:ratelimit:ip:${ip}:${tier}`;

    // Increment counter (auto-creates with TTL on first hit)
    const current = await redis.incr(redisKey);
    if (current === 1) {
      await redis.expire(redisKey, WINDOW_SECONDS);
    }

    // Set rate limit headers (standard)
    ctx.set('X-RateLimit-Limit', String(limit));
    ctx.set('X-RateLimit-Remaining', String(Math.max(0, limit - current)));

    if (current > limit) {
      const ttl = await redis.ttl(redisKey);
      ctx.status = 429;
      ctx.set('Retry-After', String(ttl > 0 ? ttl : WINDOW_SECONDS));
      ctx.body = {
        error: {
          code: 'RATE_LIMITED',
          http_status: 429,
          message: `Rate limit exceeded: ${limit} requests per minute per IP for ${tier} access. Try again in ${ttl > 0 ? ttl : WINDOW_SECONDS}s.`,
          atlas_version: '1.0',
        },
      };

      return;
    }

    await next();
  };
}
```

---

## 16. Task 12: Discount Validation Endpoint

**File:** `src/app/controllers/atlas/discounts.ts`

Implements `POST /atlas/v1/events/:id/discounts/validate` per SCHEMAS.md Section 10.

```typescript
// src/app/controllers/atlas/discounts.ts

import { type ParameterizedContext } from '../../types';
import EventModel from '../../models/event';
import EventTicketTypeModel from '../../models/event-ticket-type';
import { centsToDollars } from '../../services/atlas/schema-mapper';

export async function validateDiscount(ctx: ParameterizedContext) {
  const eventId = ctx.params.id;
  const { code, ticket_type_id, quantity } = ctx.request.body as any;

  if (!code || !ticket_type_id || !quantity) {
    ctx.status = 422;
    ctx.body = { valid: false, code: code || '', discount: null, pricing_preview: null, error: { reason: 'invalid_code', message: 'Missing required fields: code, ticket_type_id, quantity' } };

    return;
  }

  const event = await EventModel.findOne({ _id: eventId, published: true, active: true }).lean();
  if (!event) {
    ctx.status = 404;
    ctx.body = { valid: false, code, discount: null, pricing_preview: null, error: { reason: 'invalid_code', message: 'Event not found' } };

    return;
  }

  const ticketType = await EventTicketTypeModel.findOne({ _id: ticket_type_id, event: eventId, active: true }).lean() as any;
  if (!ticketType) {
    ctx.status = 404;
    ctx.body = { valid: false, code, discount: null, pricing_preview: null, error: { reason: 'not_applicable', message: 'Ticket type not found' } };

    return;
  }

  const upperCode = code.toUpperCase();
  const discount = event.payment_ticket_discounts?.find(
    (d: any) => d.active && d.code === upperCode,
  );

  if (!discount) {
    ctx.body = { valid: false, code, discount: null, pricing_preview: null, error: { reason: 'invalid_code', message: 'Discount code is not valid' } };

    return;
  }

  // Check use limit
  if (discount.use_limit && (discount.use_count || 0) >= discount.use_limit) {
    ctx.body = { valid: false, code, discount: null, pricing_preview: null, error: { reason: 'max_uses_reached', message: 'Discount code has reached its usage limit' } };

    return;
  }

  // Check ticket type applicability
  if (discount.ticket_types?.length && !discount.ticket_types.some((t: any) => t.toString() === ticket_type_id)) {
    ctx.body = { valid: false, code, discount: null, pricing_preview: null, error: { reason: 'not_applicable', message: 'Discount code is not applicable to this ticket type' } };

    return;
  }

  // Calculate pricing preview
  const price = ticketType.prices?.find((p: any) => p.default) || ticketType.prices?.[0];
  const basePriceCents = BigInt(price?.cost || '0') * BigInt(quantity);
  const basePriceDollars = centsToDollars(basePriceCents.toString());
  const savingsDollars = Math.round(basePriceDollars * discount.ratio * 100) / 100;
  const discountedBaseDollars = Math.round((basePriceDollars - savingsDollars) * 100) / 100;

  // Approximate fees on discounted price
  const protocolFee = Math.round(discountedBaseDollars * 0.02 * 1000) / 1000;
  const platformFee = Math.round(discountedBaseDollars * ((event.payment_fee || 0.05) * 100) / 100 * 1000) / 1000;
  const feesTotal = Math.round((protocolFee + platformFee + 0.001) * 1000) / 1000;

  ctx.body = {
    valid: true,
    code: upperCode,
    discount: {
      type: 'percentage',
      value: discount.ratio * 100,
      description: `${discount.ratio * 100}% off`,
      max_uses: discount.use_limit || null,
      remaining_uses: discount.use_limit ? discount.use_limit - (discount.use_count || 0) : null,
      valid_from: null,
      valid_until: null,
      applicable_ticket_types: discount.ticket_types?.map((t: any) => t.toString()) || null,
      minimum_quantity: 1,
    },
    pricing_preview: {
      original_base_price: basePriceDollars,
      discounted_base_price: discountedBaseDollars,
      savings: savingsDollars,
      fees_total: feesTotal,
      total_price: Math.round((discountedBaseDollars + feesTotal) * 1000) / 1000,
      currency: event.currency || 'USD',  // AUDIT FIX [P2-H5]: dynamic currency
    },
    error: null,
  };
}
```

---

## 17. Environment Variables

Add these to `src/config/index.ts`:

```typescript
// ---------- Atlas Protocol ----------
export const atlasEnabled = env.get('ATLAS_ENABLED').default('false').asBool();
export const atlasApiBaseUrl = env.get('ATLAS_API_BASE_URL').default('https://api.lemonade.social').asString();
export const atlasDomain = env.get('ATLAS_DOMAIN').default('lemonade.social').asString();
export const atlasPlatformFeePercent = env.get('ATLAS_PLATFORM_FEE_PERCENT').default('3.5').asFloat();

// Atlas signing key (ES256 / P-256)
export const atlasSigningKeyId = env.get('ATLAS_SIGNING_KEY_ID').default('lemonade-atlas-2026-03').asString();
export const atlasSigningPrivateKeyPem = env.get('ATLAS_SIGNING_PRIVATE_KEY_PEM').asString();
export const atlasSigningPublicKeyJwk = JSON.parse(env.get('ATLAS_SIGNING_PUBLIC_KEY_JWK').default('{}').asString());

// Atlas payment receivers
export const atlasTempoReceiverAddress = env.get('ATLAS_TEMPO_RECEIVER_ADDRESS').default('').asString();
export const atlasBaseReceiverAddress = env.get('ATLAS_BASE_RECEIVER_ADDRESS').default('').asString();
export const atlasStripeMerchantId = env.get('ATLAS_STRIPE_MERCHANT_ID').default('').asString();
export const atlasStripeSecretKey = env.get('ATLAS_STRIPE_SECRET_KEY').default('').asString();
export const atlasReceiptSigningKey = env.get('ATLAS_RECEIPT_SIGNING_KEY').default('').asString();
```

### Required Env Vars for Deployment

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLAS_ENABLED` | Yes | Feature flag. Set `true` to enable Atlas endpoints |
| `ATLAS_API_BASE_URL` | Yes | Public API URL (e.g., `https://api.lemonade.social`) |
| `ATLAS_DOMAIN` | Yes | Domain for DID:web (e.g., `lemonade.social`) |
| `ATLAS_SIGNING_PRIVATE_KEY_PEM` | Yes | ES256 private key in PEM format for VC signing |
| `ATLAS_SIGNING_PUBLIC_KEY_JWK` | Yes | Matching public key in JWK format for atlas.json |
| `ATLAS_SIGNING_KEY_ID` | Yes | Key ID (kid) for the signing key |
| `ATLAS_TEMPO_RECEIVER_ADDRESS` | Yes | USDC receiver address on Tempo |
| `ATLAS_BASE_RECEIVER_ADDRESS` | Yes | USDC receiver address on Base |
| `ATLAS_STRIPE_MERCHANT_ID` | For fiat | Stripe SPT merchant ID |
| `ATLAS_STRIPE_SECRET_KEY` | For fiat | Stripe secret key for SPT verification |
| `ATLAS_PLATFORM_FEE_PERCENT` | No | Platform fee (default 3.5%) |

### Key Generation (Pre-Deployment)

```bash
# Generate ES256 (P-256) keypair
openssl ecparam -genkey -name prime256v1 -noout -out atlas-private.pem
openssl ec -in atlas-private.pem -pubout -out atlas-public.pem

# Convert public key to JWK format (use jose CLI or node script)
node -e "
const crypto = require('crypto');
const pem = require('fs').readFileSync('atlas-public.pem', 'utf8');
const key = crypto.createPublicKey(pem);
const jwk = key.export({ format: 'jwk' });
jwk.kid = 'lemonade-atlas-2026-03';
console.log(JSON.stringify(jwk));
"
```

---

## 18. Migration Steps

**File:** `src/db/migrations/<timestamp>-add-atlas-protocol-models.ts`

Generate with: `yarn migrate:generate add-atlas-protocol-models`

```typescript
// Migration: add-atlas-protocol-models

import AtlasTicketHoldModel from '../app/models/atlas-ticket-hold';
import AtlasReceiptModel from '../app/models/atlas-receipt';
import AtlasAgentRegistrationModel from '../app/models/atlas-agent-registration';
import ChainModel from '../app/models/chain';

export async function up() {
  // 1. Ensure indexes on new collections
  await AtlasTicketHoldModel.ensureIndexes();
  await AtlasReceiptModel.ensureIndexes();
  await AtlasAgentRegistrationModel.ensureIndexes();

  // 2. Add Tempo chain document
  const tempoExists = await ChainModel.findOne({ chain_id: '1001' });
  if (!tempoExists) {
    await ChainModel.create({
      active: true,
      platform: 'ethereum',
      chain_id: '1001',
      name: 'Tempo',
      code_name: 'tempo',
      rpc_url: 'https://rpc.tempo.xyz',
      block_time: 1,
      safe_confirmations: 1,
      tokens: [
        {
          active: true,
          name: 'USD Coin',
          symbol: 'USDC',
          decimals: 6,
          contract: '0xTEMPO_USDC_CONTRACT',  // UPDATE before production deploy
          is_native: false,
        },
      ],
    });
  }

  // 3. Ensure Base chain document exists
  await ChainModel.updateOne(
    { chain_id: '8453' },
    {
      $setOnInsert: {
        active: true,
        platform: 'ethereum',
        chain_id: '8453',
        name: 'Base',
        code_name: 'base',
        rpc_url: 'https://mainnet.base.org',
        block_time: 2,
        safe_confirmations: 12,
        tokens: [
          {
            active: true,
            name: 'USD Coin',
            symbol: 'USDC',
            decimals: 6,
            contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            is_native: false,
          },
        ],
      },
    },
    { upsert: true },
  );
}

export async function down() {
  // Drop new collections (holds are TTL-expired anyway)
  await AtlasTicketHoldModel.collection.drop().catch(() => {});
  await AtlasReceiptModel.collection.drop().catch(() => {});
  await AtlasAgentRegistrationModel.collection.drop().catch(() => {});

  // Do NOT drop chain documents (they may be used by other features)
}
```

### TicketSource Enum Modification

**File:** `src/app/models/ticket.ts:15-22`

Add `atlas_agent` to the enum:

```typescript
export enum TicketSource {
  forest_admin = 'forest_admin',
  insider = 'insider',
  eventbrite = 'eventbrite',
  payment = 'payment',
  host = 'host',
  redeem = 'redeem',
  atlas_agent = 'atlas_agent',     // NEW: Purchased via Atlas Protocol by an AI agent
}
```

---

## 19. Testing Strategy

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| `services/atlas/schema-mapper.test.ts` | centsToDollars, dollarsToCents, mapEventToAtlas, mapTicketTypeToAtlas |
| `services/atlas/vc-issuer.test.ts` | ES256 signing, VC structure validation, proof verification |
| `services/atlas/ticket-hold.test.ts` | Create, consume, expiry |
| `middlewares/atlas-agent-auth.test.ts` | Missing header rejection, valid header passthrough |
| `middlewares/atlas-idempotency.test.ts` | Dedup hit, miss, Redis TTL |

### Integration Tests

| Test | Flow |
|------|------|
| Discovery | `GET /atlas/v1/search` -> returns Atlas JSON-LD events |
| Event Detail | `GET /atlas/v1/events/:id` -> returns mapped event |
| Ticket Types | `GET /atlas/v1/events/:id/tickets` -> returns Atlas ticket types with USD pricing |
| Free Ticket Redirect | `POST /purchase` (free ticket) -> 200 with `type: 'free_ticket_redirect'` + `redirect_url` (AUDIT FIX R4 [FT-2]: no receipt/VC issued) |
| Paid Purchase Phase 1 | `POST /purchase` (paid, no auth) -> 402 with challenge + hold |
| Paid Purchase Phase 2 | `POST /purchase` (paid, with payment proof) -> 200 with receipt + VC |
| Hold Expiry | Create hold -> wait 300s -> attempt Phase 2 -> 410 HOLD_EXPIRED |
| Idempotency | Same Idempotency-Key -> returns original receipt |
| Discount | `POST /discounts/validate` with valid code -> pricing preview |
| Well-Known | `GET /.well-known/atlas.json` -> valid manifest |

### Key Assertions

- Price conversion: `EventTicketType.prices[0].cost = "5000"` maps to `atlas:pricing.base_price = 50.00`
- VC proof is verifiable with the public key from `/.well-known/atlas.json`
- > **AUDIT FIX R2 [E3]:** 402 challenge includes `price_valid_until` timestamp
- > **AUDIT FIX R2 [E5]:** Purchase of ticket priced below $0.50 returns 422 with `PRICE_BELOW_MINIMUM`
- > **AUDIT FIX R2 [E6]:** 6th hold by same agent on same event returns 429; total holds exceeding 20% of inventory returns 429; agent with 3+ abandoned holds gets 60s TTL instead of 300s
- > **AUDIT FIX R2 [E7]:** `GET /tickets/:id/verify` without `event_id` returns 422; with mismatched `event_id` returns 403
- > **AUDIT FIX R2 [E13]:** Purchase attempt on synced event (with ExternalEventMapping) returns 422 with `SYNCED_EVENT_PURCHASE_BLOCKED`
- > **AUDIT FIX R4 [FT-2]:** Free ticket purchase returns `{ type: 'free_ticket_redirect', redirect_url: ... }` with HTTP 200, NOT a receipt/VC. No AtlasTicketHold, AtlasReceipt, Ticket, or VC is created for free events.
- > **AUDIT FIX R4 [FT-3]:** 61st unauthenticated request per minute from same IP returns 429 with `Retry-After` header. 201st authenticated request per minute returns 429. Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`) present on all discovery responses.
- > **AUDIT FIX R4 [SV-4]:** Receipt response for unverified user includes `verification_prompt` with `verify_url` and `benefits` array. Receipt response for verified user has `verification_prompt: null`.
- AtlasTicketHold documents auto-delete after TTL (verify with MongoDB TTL monitor)
- NewPayment.state is `succeeded` after fulfillment
- Ticket.metadata.source is `atlas_agent`

---

## 20. Execution Status

| Task | Assignee | Status | PR |
|------|----------|--------|----|
| Task 1: Atlas Koa Router | — | Not Started | — |
| Task 2: Schema Mapper Service | — | Not Started | — |
| Task 3: MPP 402 Middleware | — | Not Started | — |
| Task 4: Ticket Purchase Service | — | Not Started | — |
| Task 5: AtlasTicketHold Model | — | Not Started | — |
| Task 6: AtlasReceipt Model | — | Not Started | — |
| Task 7: VC Issuance Service | — | Not Started | — |
| Task 8: Well-Known Manifest | — | Not Started | — |
| Task 9: Tempo + Base Chain Docs | — | Not Started | — |
| Task 10: Agent Auth Middleware | — | Not Started | — |
| Task 11: Idempotency Middleware | — | Not Started | — |
| Task 12: Discount Validation | — | Not Started | — |
| Migration | — | Not Started | — |
| Tests | — | Not Started | — |

---

## Appendix A: Search and Event Detail Controllers

### Search Controller

**File:** `src/app/controllers/atlas/search.ts`

Wraps `aiSearchEvents` logic (`src/graphql/resolvers/ai-tool.ts:1156-1206`).

```typescript
// src/app/controllers/atlas/search.ts

import { type ParameterizedContext } from '../../types';
import EventModel from '../../models/event';
import EventTicketTypeModel from '../../models/event-ticket-type';
import SpaceModel from '../../models/space';
import { mapEventToAtlas } from '../../services/atlas/schema-mapper';
import { atlasApiBaseUrl } from '../../../config';

export async function searchEvents(ctx: ParameterizedContext) {
  const {
    q,
    location,
    lat,
    lng,
    radius_km = 50,
    date_from,
    date_to,
    categories,
    price_max,
    free_only,
    sort = 'relevance',
    page = 1,
    per_page = 20,
  } = ctx.query as Record<string, any>;

  const perPage = Math.min(Number(per_page) || 20, 100);
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * perPage;

  // Build MongoDB query (mirrors aiSearchEvents logic)
  const query: any = {
    active: true,
    published: true,
    end: { $gte: new Date() },
    // > **AUDIT FIX R3 [E15-2]:** Filter out events with `atlas_searchable: false`.
    // > Events from suspended connections have this set to `false` by Phase 5.
    // > Default is `undefined` (field absent), which is truthy — existing events unaffected.
    atlas_searchable: { $ne: false },
  };

  // Text search
  if (q) {
    query.$text = { $search: q };
  }

  // Geo search
  if (lat && lng) {
    query.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [Number(lng), Number(lat)],
        },
        $maxDistance: Number(radius_km) * 1000,
      },
    };
  }

  // Date filter
  if (date_from) {
    query.start = { ...query.start, $gte: new Date(date_from) };
  }
  if (date_to) {
    query.start = { ...query.start, $lte: new Date(date_to) };
  }

  // Execute query
  // > **AUDIT FIX R3 [F6]:** textScore sort crashes when no `$text` query is present.
  // > Default to `{ start: 1 }` (date ascending) when no `q` parameter is provided.
  const defaultSort = query.$text
    ? { score: { $meta: 'textScore' } }
    : { start: 1 };

  const [events, total] = await Promise.all([
    EventModel.find(query)
      .sort(sort === 'date_asc' ? { start: 1 } : sort === 'date_desc' ? { start: -1 } : defaultSort)
      .skip(skip)
      .limit(perPage)
      .lean(),
    EventModel.countDocuments(query),
  ]);

  // Load related data for mapping
  const eventIds = events.map((e: any) => e._id);
  const spaceIds = [...new Set(events.map((e: any) => e.space?.toString()))];

  const [ticketTypes, spaces] = await Promise.all([
    EventTicketTypeModel.find({ event: { $in: eventIds }, active: true }).lean(),
    SpaceModel.find({ _id: { $in: spaceIds } }).lean(),
  ]);

  const spaceMap = new Map(spaces.map((s: any) => [s._id.toString(), s]));
  const ttMap = new Map<string, any[]>();
  for (const tt of ticketTypes) {
    const key = (tt as any).event.toString();
    if (!ttMap.has(key)) ttMap.set(key, []);
    ttMap.get(key)!.push(tt);
  }

  // Map to Atlas format
  const results = events.map((event: any) => ({
    event: mapEventToAtlas(
      event,
      spaceMap.get(event.space?.toString()) || { _id: event.space, title: 'Unknown' },
      ttMap.get(event._id.toString()) || [],
      atlasApiBaseUrl,
    ),
    relevance_score: undefined,
    distance_km: undefined,
    source: 'registry' as const,
  }));

  ctx.set('Atlas-Version', '1.0');
  ctx.body = {
    'atlas:search_result': {
      query: { q, lat, lng, radius_km, date_from, date_to, sort, per_page: perPage },
      total_results: total,
      page: pageNum,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
      has_next: pageNum * perPage < total,
      results,
      response_time_ms: 0,  // Populated by timing middleware if added
    },
  };
}
```

### Event Detail + Ticket Types Controllers

**File:** `src/app/controllers/atlas/events.ts`

```typescript
// src/app/controllers/atlas/events.ts

import { type ParameterizedContext } from '../../types';
import EventModel from '../../models/event';
import EventTicketTypeModel from '../../models/event-ticket-type';
import SpaceModel from '../../models/space';
import { mapEventToAtlas, mapTicketTypeToAtlas } from '../../services/atlas/schema-mapper';
import { atlasApiBaseUrl } from '../../../config';

/**
 * GET /atlas/v1/events/:id
 * Wraps aiGetEvent (ai-tool.ts:211-218)
 */
export async function getEvent(ctx: ParameterizedContext) {
  const event = await EventModel.findOne({
    _id: ctx.params.id,
    published: true,
  }).lean() as any;

  if (!event) {
    ctx.status = 404;
    ctx.body = { error: { code: 'NOT_FOUND', http_status: 404, message: 'Event not found', atlas_version: '1.0' } };

    return;
  }

  const [space, ticketTypes] = await Promise.all([
    SpaceModel.findById(event.space).lean(),
    EventTicketTypeModel.find({ event: event._id, active: true }).lean(),
  ]);

  ctx.set('Atlas-Version', '1.0');
  ctx.body = mapEventToAtlas(
    event,
    space || { _id: event.space, title: 'Unknown' },
    ticketTypes as any[],
    atlasApiBaseUrl,
  );
}

/**
 * GET /atlas/v1/events/:id/tickets
 * Wraps aiListEventTicketTypes (ai-tool.ts:380-391)
 */
export async function listTicketTypes(ctx: ParameterizedContext) {
  const event = await EventModel.findOne({
    _id: ctx.params.id,
    published: true,
  }).lean() as any;

  if (!event) {
    ctx.status = 404;
    ctx.body = { error: { code: 'NOT_FOUND', http_status: 404, message: 'Event not found', atlas_version: '1.0' } };

    return;
  }

  const ticketTypes = await EventTicketTypeModel.find({
    event: event._id,
    active: true,
    private: { $ne: true },
  }).lean();

  const platformFeePercent = (event.payment_fee || 0.05) * 100;

  const atlasTicketTypes = ticketTypes.map((tt: any) =>
    mapTicketTypeToAtlas(tt, event, platformFeePercent),
  );

  ctx.set('Atlas-Version', '1.0');
  ctx.body = {
    'atlas:event_id': event._id.toString(),
    ticket_types: atlasTicketTypes,
  };
}
```

### Atlas-Version Middleware

**File:** `src/app/middlewares/atlas-version.ts`

```typescript
// src/app/middlewares/atlas-version.ts

import { type Middleware } from '@koa/router';
import { type Context, type State } from '../types';

const SUPPORTED_VERSIONS = ['1.0'];

export function atlasVersion(): Middleware<State, Context> {
  return async function (ctx, next) {
    const version = ctx.get('Atlas-Version');

    if (!version) {
      ctx.status = 422;
      ctx.body = {
        error: {
          code: 'MISSING_VERSION',
          http_status: 422,
          message: 'Atlas-Version header is required',
          atlas_version: '1.0',
        },
      };

      return;
    }

    if (!SUPPORTED_VERSIONS.includes(version)) {
      ctx.status = 406;
      ctx.set('Atlas-Supported-Versions', SUPPORTED_VERSIONS.join(', '));
      ctx.body = {
        error: {
          code: 'UNSUPPORTED_VERSION',
          http_status: 406,
          message: `Version ${version} is not supported. Supported: ${SUPPORTED_VERSIONS.join(', ')}`,
          atlas_version: '1.0',
        },
      };

      return;
    }

    ctx.set('Atlas-Version', version);
    ctx.set('Atlas-Supported-Versions', SUPPORTED_VERSIONS.join(', '));

    await next();
  };
}
```

> **AUDIT FIX [P2-C1, P2-C3]:** Replaced `mppx` SDK (does not exist) with full hand-rolled payment verification. Implements: (1) Stripe SPT via Stripe API PaymentIntent status check, (2) Base USDC on-chain EVM verification using `viem` (tx hash, recipient, amount, confirmations), (3) Tempo USDC same pattern, (4) tx hash uniqueness check against `NewPayment.transfer_metadata.tx_hash` to prevent replay, (5) verified amount comparison against hold price.

### Payment Verification Service

**File:** `src/app/services/atlas/payment-verify.ts`

```typescript
// src/app/services/atlas/payment-verify.ts

import Stripe from 'stripe';
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { base } from 'viem/chains';

import {
  atlasTempoReceiverAddress,
  atlasBaseReceiverAddress,
  atlasStripeSecretKey,
} from '../../../config';
import NewPaymentModel from '../../models/new-payment';
import { logger } from '../../helpers/pino';

// --- Stripe client ---
const stripe = new Stripe(atlasStripeSecretKey, { apiVersion: '2024-04-10' });

// --- EVM public clients ---
const baseClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
});

// Tempo chain definition (EVM-compatible, chain ID 1001)
const tempoChain = {
  id: 1001,
  name: 'Tempo',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.tempo.xyz'] } },
} as const;

const tempoClient = createPublicClient({
  chain: tempoChain,
  transport: http('https://rpc.tempo.xyz'),
});

// USDC ERC-20 ABI (Transfer event)
const erc20TransferAbi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

// USDC contract addresses
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TEMPO_USDC = '0xTEMPO_USDC_CONTRACT'; // UPDATE before deployment

interface VerifyParams {
  expected_amount_usd: number;
  challenge_id: string;
}

interface VerifyResult {
  valid: boolean;
  verified_amount_usd?: number;
  error?: string;
}

/**
 * Verify an Atlas payment proof.
 *
 * Hand-rolled verification (no mppx SDK). Supports:
 * - stripe_spt: Verify PaymentIntent status via Stripe API
 * - base_usdc: Verify EVM transaction on Base (chain 8453) — tx hash, recipient, amount, confirmations
 * - tempo_usdc: Verify EVM transaction on Tempo — tx hash, recipient, amount, confirmations
 *
 * Also checks tx hash uniqueness against existing NewPayment records to prevent replay.
 */
export async function verifyAtlasPayment(
  paymentProof: any,
  params: VerifyParams,
): Promise<VerifyResult> {
  try {
    // --- Replay protection: check tx hash uniqueness ---
    if (paymentProof.transaction_hash) {
      const existingPayment = await NewPaymentModel.findOne({
        'transfer_metadata.tx_hash': paymentProof.transaction_hash,
      }).lean();

      if (existingPayment) {
        return { valid: false, error: 'Transaction hash already used for a previous payment (replay rejected)' };
      }
    }

    if (paymentProof.payment_intent_id) {
      const existingPayment = await NewPaymentModel.findOne({
        'transfer_metadata.intent_id': paymentProof.payment_intent_id,
      }).lean();

      if (existingPayment) {
        return { valid: false, error: 'Payment intent already used for a previous payment (replay rejected)' };
      }
    }

    switch (paymentProof.type) {
      case 'tempo_usdc':
        return await verifyEvmUsdcPayment(
          tempoClient,
          paymentProof.transaction_hash,
          atlasTempoReceiverAddress,
          params.expected_amount_usd,
          TEMPO_USDC,
          1,   // Tempo: 1 confirmation (near-instant finality)
        );

      case 'base_usdc':
        return await verifyEvmUsdcPayment(
          baseClient,
          paymentProof.transaction_hash,
          atlasBaseReceiverAddress,
          params.expected_amount_usd,
          BASE_USDC,
          12,  // Base: 12 confirmations
        );

      case 'stripe_spt':
        return await verifyStripePayment(
          paymentProof.payment_intent_id,
          params.expected_amount_usd,
        );

      default:
        return { valid: false, error: `Unsupported payment type: ${paymentProof.type}` };
    }
  } catch (err: any) {
    logger.error({ err, paymentProof }, 'Atlas payment verification failed');

    return { valid: false, error: err.message || 'Payment verification failed' };
  }
}

/**
 * Verify a Stripe PaymentIntent.
 * Checks: status === 'succeeded', amount matches, currency is USD.
 */
async function verifyStripePayment(
  paymentIntentId: string,
  expectedAmountUsd: number,
): Promise<VerifyResult> {
  if (!paymentIntentId) {
    return { valid: false, error: 'Missing payment_intent_id' };
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (intent.status !== 'succeeded') {
    return { valid: false, error: `PaymentIntent status is '${intent.status}', expected 'succeeded'` };
  }

  if (intent.currency !== 'usd') {
    return { valid: false, error: `PaymentIntent currency is '${intent.currency}', expected 'usd'` };
  }

  // Stripe amounts are in cents
  const paidAmountUsd = intent.amount / 100;
  if (Math.abs(paidAmountUsd - expectedAmountUsd) > 0.01) {
    return { valid: false, error: `Amount mismatch: paid $${paidAmountUsd}, expected $${expectedAmountUsd}` };
  }

  return { valid: true, verified_amount_usd: paidAmountUsd };
}

/**
 * Verify an EVM USDC transfer on-chain.
 * Checks: tx exists, is confirmed, has Transfer event to expected recipient
 * with expected amount, and has sufficient confirmations.
 */
async function verifyEvmUsdcPayment(
  client: any,
  txHash: string,
  expectedRecipient: string,
  expectedAmountUsd: number,
  usdcContract: string,
  requiredConfirmations: number,
): Promise<VerifyResult> {
  if (!txHash) {
    return { valid: false, error: 'Missing transaction_hash' };
  }

  // 1. Get transaction receipt
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

  if (!receipt) {
    return { valid: false, error: 'Transaction not found on-chain' };
  }

  if (receipt.status !== 'success') {
    return { valid: false, error: 'Transaction reverted on-chain' };
  }

  // 2. Check confirmations
  const currentBlock = await client.getBlockNumber();
  const confirmations = Number(currentBlock - receipt.blockNumber);
  if (confirmations < requiredConfirmations) {
    return { valid: false, error: `Insufficient confirmations: ${confirmations}/${requiredConfirmations}` };
  }

  // 3. Find USDC Transfer event log
  const transferLogs = receipt.logs.filter(
    (log: any) =>
      log.address.toLowerCase() === usdcContract.toLowerCase() &&
      log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer(address,address,uint256)
  );

  if (transferLogs.length === 0) {
    return { valid: false, error: 'No USDC Transfer event found in transaction' };
  }

  // 4. Find a Transfer to our recipient address with correct amount
  const recipientLower = expectedRecipient.toLowerCase();
  // USDC has 6 decimals — expectedAmountUsd is in dollars
  const expectedMicroUnits = BigInt(Math.round(expectedAmountUsd * 1_000_000));

  for (const log of transferLogs) {
    const to = '0x' + log.topics[2].slice(26).toLowerCase();
    if (to !== recipientLower) continue;

    const transferredAmount = BigInt(log.data);
    // Allow 0.01 USD tolerance (10000 micro-units)
    const diff = transferredAmount > expectedMicroUnits
      ? transferredAmount - expectedMicroUnits
      : expectedMicroUnits - transferredAmount;

    if (diff <= 10000n) {
      const verifiedUsd = Number(transferredAmount) / 1_000_000;

      return { valid: true, verified_amount_usd: verifiedUsd };
    }
  }

  return { valid: false, error: 'No matching USDC transfer to expected recipient with expected amount' };
}
```

### Receipt Controller

**File:** `src/app/controllers/atlas/receipts.ts`

```typescript
// src/app/controllers/atlas/receipts.ts

import { type ParameterizedContext } from '../../types';
import AtlasReceiptModel from '../../models/atlas-receipt';
import TicketModel from '../../models/ticket';
import UserModel from '../../models/user'; // AUDIT FIX R4 [SV-4]: needed for verification status

/**
 * GET /atlas/v1/receipts/:txn_id
 */
export async function getReceipt(ctx: ParameterizedContext) {
  const receipt = await AtlasReceiptModel.findOne({
    receipt_id: ctx.params.txn_id,
  }).lean();

  if (!receipt) {
    ctx.status = 404;
    ctx.body = { error: { code: 'NOT_FOUND', http_status: 404, message: 'Receipt not found', atlas_version: '1.0' } };

    return;
  }

  // > **AUDIT FIX R4 [SV-4]:** Look up the purchasing user to check Self.xyz verification status.
  // > The receipt stores the attendee user ID. The implementing agent must verify the
  // > correct field name for the user reference on AtlasReceipt (e.g., `receipt.user` or
  // > `receipt.attendee_user_id`).
  const user = receipt.user ? await UserModel.findById(receipt.user).lean() : null;
  // > **AUDIT FIX R4 [SV-4]:** Agent MUST grep for `self` / `selfxyz` / `self_xyz` / `verified`
  // > in `src/app/models/user.ts` to find the actual Self.xyz verification field name.
  const isVerified = (user as any)?.selfVerified === true; // Replace `selfVerified` with actual field
  const verificationPrompt = isVerified ? null : {
    message: 'Verify your identity with Self to earn 2x cashback on future purchases',
    verify_url: 'https://lemonade.social/settings/verify',
    benefits: ['2x cashback', 'Referral rewards', 'Free event rewards', 'Discovery bonus'],
  };

  ctx.set('Atlas-Version', '1.0');
  ctx.body = {
    'atlas:receipt': {
      receipt_id: receipt.receipt_id,
      status: receipt.status,
      event_id: receipt.event.toString(),
      event_name: receipt.event_name,
      purchase_timestamp: receipt.created_at?.toISOString(),
      total_charged: receipt.total_charged,
      currency: receipt.currency,
      payment_method: receipt.payment_method,
      transaction_hash: receipt.transaction_hash || null,
      stripe_payment_intent: receipt.stripe_payment_intent || null,
      tickets: receipt.vc_tickets,
      rewards: {
        attendee_reward_usdc: 0,
        reward_status: 'ineligible',
        reward_payout_address: null,
      },
      // > **AUDIT FIX R4 [SV-4]:** Verification prompt for unverified users.
      verification_prompt: verificationPrompt,
    },
  };
}

/**
 * GET /atlas/v1/tickets/:id/verify
 * Per PROTOCOL-SPEC.md Section 7.4
 *
 * > **AUDIT FIX R2 [E7]:** `event_id` query parameter is REQUIRED.
 * > The endpoint validates that the credential's `event_id` matches the event
 * > being checked into, preventing receipt forgery / credential reuse across events.
 */
export async function verifyTicket(ctx: ParameterizedContext) {
  const ticketId = ctx.params.id;

  // > **AUDIT FIX R2 [E7]:** Require event_id parameter to prevent cross-event credential reuse.
  const eventId = ctx.query.event_id as string;
  if (!eventId) {
    ctx.status = 422;
    ctx.body = { error: { code: 'MISSING_EVENT_ID', http_status: 422, message: 'event_id query parameter is required for ticket verification', atlas_version: '1.0' } };

    return;
  }

  // Look up ticket by shortid or _id
  const ticket = await TicketModel.findOne({
    $or: [{ shortid: ticketId }, { _id: ticketId }],
  }).lean() as any;

  if (!ticket) {
    ctx.status = 404;
    ctx.body = { error: { code: 'NOT_FOUND', http_status: 404, message: 'Ticket not found', atlas_version: '1.0' } };

    return;
  }

  // > **AUDIT FIX R2 [E7]:** Validate that the ticket's event_id matches the
  // > event being checked into. Return 403 on mismatch.
  if (ticket.event?.toString() !== eventId) {
    ctx.status = 403;
    ctx.body = { error: { code: 'EVENT_MISMATCH', http_status: 403, message: 'Ticket does not belong to the specified event', atlas_version: '1.0' } };

    return;
  }

  // Find the receipt containing this ticket
  const receipt = await AtlasReceiptModel.findOne({
    tickets: ticket._id,
  }).lean();

  ctx.set('Atlas-Version', '1.0');
  ctx.body = {
    receipt_id: receipt?.receipt_id || null,
    status: ticket.active ? 'valid' : 'cancelled',
    tickets: [
      {
        ticket_id: ticket._id.toString(),
        shortid: ticket.shortid,
        status: ticket.active ? 'valid' : 'cancelled',
        checked_in: ticket.checkin_date != null,
        checked_in_at: ticket.checkin_date?.toISOString() || null,
      },
    ],
    verified_at: new Date().toISOString(),
  };
}
```

---

> **AUDIT FIX [P2-C1]:** Removed `mppx` from dependencies — it does not exist as an npm package. Payment verification is hand-rolled using `stripe` (already in backend) and `viem` (already in backend).

## Appendix B: npm Dependencies to Add

```bash
cd lemonade-backend
yarn add jose uuid koa-bodyparser
yarn add -D @types/uuid @types/koa-bodyparser
```

- `jose` — JOSE library for ES256 JWS signing (VC proofs)
- `uuid` — UUID v7 generation for Atlas IDs
- `koa-bodyparser` — Body parser for POST routes (P2-H4)
- `stripe` — Already in backend (v13.7), used for PaymentIntent verification
- `viem` — Already in backend (v2.16), used for on-chain EVM transaction verification

---

## Appendix C: Critical Implementation Notes

1. **Price conversion is the #1 correctness risk.** Every place where Lemonade cents meet Atlas dollars MUST go through `centsToDollars()` or `dollarsToCents()`. A bug here means charging 100x too much or too little.

2. **The `$inc` for `ticket_count` and `ticket_count_map`** are in a single `$inc` operator object (AUDIT FIX P2-C2 applied). The implementing agent must verify this compiles correctly with the Mongoose types.

3. **Tempo USDC contract address is a placeholder.** The migration seeds `0xTEMPO_USDC_CONTRACT` which is NOT a real address. Before opening the PR, the implementing agent MUST:
   - Fetch https://docs.tempo.xyz/developers/contract-addresses (or equivalent) for the canonical USDC deployment on Tempo Mainnet
   - If Tempo docs are unavailable, check the Tempo block explorer at https://explorer.tempo.xyz for the USDC token contract
   - Verify the contract is a standard ERC-20 with 6 decimals by calling `decimals()` and `symbol()` on-chain
   - **This is a PR-blocking requirement** — do not open the PR with the placeholder address

4. **`withTransaction` helper** is referenced from `src/app/helpers/db.ts`. If this helper does not exist in the current codebase, the implementing agent must use the standard Mongoose `connection.startSession()` + `session.withTransaction()` pattern instead.

5. **The well-known controller** uses `handleManifestRequest` (AUDIT FIX P2-M1 applied) to avoid collision with the service function `generateManifest`.

6. **Atlas-Version header is REQUIRED on all /atlas/v1 requests** per PROTOCOL-SPEC.md. The middleware rejects requests without it. Agents consuming the API must always send `Atlas-Version: 1.0`.

7. > **AUDIT FIX R2 [E6]:** **Future enhancement: require payment proof deposit for high-volume holds.** Agents with sustained high-volume hold patterns (e.g., > 50 holds/hour across events) should be required to put down a small refundable deposit before creating additional holds. This is documented here as a future enhancement and should NOT be implemented in Phase 2.

8. > **AUDIT FIX R2 [E3]:** **Synced event price re-fetch for future dual-mode.** Currently synced events are blocked from Atlas Direct Ticketing (E13), so the price re-fetch is not needed. However, if dual-ticketing mode is ever enabled in a future phase: before building the 402 challenge for a synced event, the purchase controller MUST re-fetch the current price from the source platform (Eventbrite API, Lu.ma API, etc.) rather than using the cached/synced price. The synced price should only be used for discovery/listing. The re-fetch ensures the 402 challenge reflects the current price on the source platform.

9. > **AUDIT FIX R2 [E7]:** **Verify `event_id` is in `credentialSubject` during VC issuance.** The VC issuance code in `vc-issuer.ts` already includes `event_id: event._id.toString()` in `credentialSubject` (see Task 7 above, line `event_id: event._id.toString()`). This is confirmed present. The ticket verification endpoint now validates this field against the `event_id` query parameter.
