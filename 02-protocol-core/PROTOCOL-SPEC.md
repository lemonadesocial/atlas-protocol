# Atlas Protocol Specification

**Protocol Version:** 1.0
**Status:** Draft
**Date:** 2026-03-19
**Authors:** Lemonade (Founding Contributor)

## Abstract

Atlas is an open protocol for agent-driven event discovery, ticketing, and settlement. It defines a federated discovery mechanism, standardized event and ticket schemas, a two-phase purchase flow with payment challenges, and a receipt format based on W3C Verifiable Credentials. Payments settle in USDC on Tempo with Stripe SPT fallback. A 2% protocol fee funds USDC rewards to organizers, attendees, and referrers.

This specification uses RFC 2119 keywords: "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL".

## Table of Contents

1. [Introduction](#1-introduction)
2. [Terminology](#2-terminology)
3. [Discovery Mechanism](#3-discovery-mechanism)
4. [Event Schema](#4-event-schema)
5. [Ticket Listing Schema](#5-ticket-listing-schema)
6. [Purchase Flow](#6-purchase-flow)
7. [Receipt Schema](#7-receipt-schema)
8. [Payment Methods](#8-payment-methods)
9. [Organizer Authentication](#9-organizer-authentication)
10. [Versioning](#10-versioning)
11. [Security Considerations](#11-security-considerations)
12. [IANA Considerations](#12-iana-considerations)

---

## 1. Introduction

Existing event ecosystems are fragmented. Event data is siloed within platforms (Eventbrite, Lu.ma, Meetup), making cross-platform discovery impossible for both humans and AI agents. Atlas solves this with an organizer-first approach: organizers connect their existing platform accounts via OAuth. No platform cooperation is required for basic discovery and ticketing.

Atlas operates at three layers:

- **Protocol Core (this spec):** Discovery, listing, purchase, and settlement primitives.
- **Organizer Layer (B2C):** Organizers connect platform accounts via OAuth, list events, sell tickets.
- **Platform Layer (B2B):** Existing platforms integrate the Atlas SDK; new platforms build on Atlas infrastructure.

### 1.1 Design Goals

1. **Organizer-first:** An organizer MUST be able to make their events discoverable without platform cooperation.
2. **Agent-native:** Every endpoint MUST be machine-readable. No scraping, no HTML parsing.
3. **Payment-agnostic:** The protocol abstracts over payment rails (USDC, Stripe SPT, Lightning).
4. **Federated:** No single registry owns the namespace. Discovery is distributed.
5. **Verifiable:** Receipts are cryptographically signed credentials.

### 1.2 Conformance

An implementation is "Atlas-compliant" if it:

- Serves a valid `/.well-known/atlas.json` manifest (Section 3.1), OR
- Is registered in the Atlas Registry with a valid organizer profile (Section 3.2)
- Implements the purchase flow defined in Section 6
- Returns receipts conforming to Section 7

---

## 2. Terminology

| Term | Definition |
|------|-----------|
| **Organizer** | A person or entity that creates and manages events. Connects platform accounts via OAuth. |
| **Platform** | A service that hosts events (e.g., Eventbrite, Lu.ma, Meetup, or a new platform built on Atlas). |
| **Agent** | An AI system (LLM-powered or otherwise) that discovers, evaluates, and purchases tickets on behalf of users. |
| **Registry** | A federated index of Atlas-compliant organizers and platforms. Operated by Lemonade as the reference implementation. |
| **Challenge** | A payment instruction returned in a 402 response. The agent MUST satisfy the challenge to complete a purchase. |
| **Hold** | A time-limited reservation of ticket inventory during the purchase flow. |
| **Receipt** | A W3C Verifiable Credential proving ticket ownership. |
| **SPT** | Stripe Payment Token — represents a fiat payment method (cards, wallets) via Stripe. |
| **Tempo** | USDC settlement layer with sub-cent transaction fees. |

---

## 3. Discovery Mechanism

Atlas supports four complementary discovery mechanisms. Implementations MAY support any combination.

### 3.1 Platform Manifest: `/.well-known/atlas.json`

Any domain serving events MUST publish a manifest at `/.well-known/atlas.json`. This file declares the platform's Atlas capabilities, API endpoints, and accepted payment methods.

**Requirements:**
- The manifest MUST be served at the exact path `/.well-known/atlas.json`.
- The response MUST have `Content-Type: application/json`.
- The response MUST include `Access-Control-Allow-Origin: *` to permit agent access.
- The manifest MUST be valid according to the `AtlasManifest` schema (see SCHEMAS.md).

**Example:**
```json
{
  "@context": "https://atlas-protocol.org/v1",
  "atlas_version": "1.0",
  "platform": {
    "name": "Example Events",
    "url": "https://example-events.com",
    "logo": "https://example-events.com/logo.png",
    "description": "Community events in the Bay Area"
  },
  "capabilities": {
    "discovery": true,
    "purchase": true,
    "refund": true,
    "holds": true,
    "oauth_connect": true
  },
  "endpoints": {
    "events": "https://api.example-events.com/atlas/v1/events",
    "search": "https://api.example-events.com/atlas/v1/search",
    "purchase": "https://api.example-events.com/atlas/v1/events/{event_id}/purchase",
    "receipt_verify": "https://api.example-events.com/atlas/v1/receipts/{receipt_id}/verify"
  },
  "payment_methods": ["tempo_usdc", "stripe_spt"],
  "fee_schedule": {
    "protocol_fee_percent": 2.0,
    "platform_fee_percent": 5.0
  },
  "signing_keys": [
    {
      "kid": "atlas-2026-03",
      "kty": "EC",
      "crv": "P-256",
      "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
      "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"
    }
  ]
}
```

### 3.2 Organizer Manifest

Organizers who connect platform accounts via OAuth receive an auto-generated organizer manifest. This manifest aggregates events from all connected platforms into a single discoverable profile.

**The organizer manifest is hosted by the Atlas Registry** at:
```
https://registry.atlas-protocol.org/organizers/{organizer_id}/manifest.json
```

The manifest MUST include:
- Organizer identity and verification status
- List of connected platform accounts (with OAuth verification proof)
- Aggregated event listings across all connected platforms
- Direct ticketing events (if using Atlas Direct Ticketing)
- Accepted payment methods

**Organizer manifests are auto-generated.** Organizers do not author these manually. The Registry constructs them from OAuth-connected platform data.

### 3.3 DNS TXT Record: `_atlas.example.com`

Domain owners MAY publish a DNS TXT record to declare Atlas compliance without modifying their web server.

**Format:**
```
_atlas.example.com. 3600 IN TXT "atlas=1 manifest=https://example.com/.well-known/atlas.json"
```

**Fields:**
| Field | Required | Description |
|-------|----------|-------------|
| `atlas` | REQUIRED | Protocol version. MUST be `1`. |
| `manifest` | OPTIONAL | URL of the platform manifest. Defaults to `https://{domain}/.well-known/atlas.json`. |
| `registry` | OPTIONAL | Registry URL if not using the default Atlas Registry. |

**Resolution order:** Agents discovering a domain SHOULD check DNS TXT first (fast, cacheable), then fall back to `/.well-known/atlas.json`.

### 3.4 Federated Registry Search

The Atlas Registry provides federated search across all discovery sources — organizer manifests, platform manifests, and DNS records.

**Search endpoint:**
```
GET https://registry.atlas-protocol.org/atlas/v1/search
```

**The Registry MUST:**
- Index all registered organizer manifests
- Crawl known platform manifests on a regular schedule (RECOMMENDED: hourly)
- Resolve DNS TXT records for registered domains
- Return results ranked by relevance, with source attribution
- Support filtering by location, date range, category, price range, and source platform
- Return results within 2 seconds for 95th percentile queries

**The Registry MUST NOT:**
- Require exclusive registration — organizers and platforms MAY be discoverable via DNS/manifest without registry enrollment
- Modify event data — results MUST faithfully represent the source data
- Prefer any platform's events in ranking without explicit user/agent request

---

## 4. Event Schema

Atlas events extend [Schema.org Event](https://schema.org/Event) with the `atlas:` namespace prefix for protocol-specific fields.

### 4.1 JSON-LD Context

```json
{
  "@context": {
    "@vocab": "https://schema.org/",
    "atlas": "https://atlas-protocol.org/v1/vocab#"
  }
}
```

### 4.2 Event Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `@context` | string | REQUIRED | JSON-LD context URL. MUST include Atlas vocabulary. |
| `@type` | string | REQUIRED | MUST be `"Event"`. |
| `@id` | string (URI) | REQUIRED | Globally unique event identifier. Format: `atlas:{platform}:{platform_event_id}`. |
| `name` | string | REQUIRED | Event title. Maximum 256 characters. |
| `description` | string | REQUIRED | Event description. Plain text or HTML. |
| `startDate` | string (ISO 8601) | REQUIRED | Event start date and time with timezone. |
| `endDate` | string (ISO 8601) | OPTIONAL | Event end date and time with timezone. |
| `location` | Place or VirtualLocation | REQUIRED | Physical or virtual event location. |
| `organizer` | Organization or Person | REQUIRED | Event organizer with Atlas organizer ID. |
| `image` | string (URI) | OPTIONAL | Event cover image URL. |
| `url` | string (URI) | OPTIONAL | Canonical event URL on the source platform. |
| `eventStatus` | EventStatusType | OPTIONAL | Schema.org status. Default: `EventScheduled`. |
| `eventAttendanceMode` | EventAttendanceModeEnumeration | OPTIONAL | Online, offline, or mixed. |
| `atlas:id` | string | REQUIRED | Atlas-canonical event ID (UUID v7). |
| `atlas:source_platform` | string | REQUIRED | Platform origin identifier (e.g., `"eventbrite"`, `"luma"`, `"atlas_direct"`). |
| `atlas:source_event_id` | string | REQUIRED | Event ID on the source platform. |
| `atlas:organizer_id` | string | REQUIRED | Atlas organizer ID (UUID v7). |
| `atlas:organizer_verified` | boolean | REQUIRED | Whether the organizer has verified ownership via OAuth. |
| `atlas:categories` | array of string | OPTIONAL | Event categories from the Atlas taxonomy. |
| `atlas:tags` | array of string | OPTIONAL | Free-form tags. Maximum 20. |
| `atlas:availability` | string | REQUIRED | One of: `"available"`, `"few_remaining"`, `"sold_out"`, `"cancelled"`, `"not_on_sale"`. |
| `atlas:price_range` | object | REQUIRED | Minimum and maximum ticket price. See Section 4.3. |
| `atlas:ticket_types_count` | integer | REQUIRED | Number of distinct ticket types offered. |
| `atlas:purchase_endpoint` | string (URI) | REQUIRED | Full URL for the purchase flow (Section 6). |
| `atlas:currency` | string (ISO 4217) | REQUIRED | Price currency code. MUST be `"USD"` for Atlas v1. |
| `atlas:accepts_payment_methods` | array of string | REQUIRED | Accepted payment methods: `"tempo_usdc"`, `"stripe_spt"`, `"lightning"`. |
| `atlas:last_synced` | string (ISO 8601) | REQUIRED | Timestamp of last data sync from source platform. |
| `atlas:created_at` | string (ISO 8601) | REQUIRED | When the event was first indexed by Atlas. |
| `atlas:updated_at` | string (ISO 8601) | REQUIRED | When the Atlas record was last modified. |

### 4.3 Price Range Object

```json
{
  "atlas:price_range": {
    "min_price": 0.00,
    "max_price": 150.00,
    "currency": "USD",
    "includes_fees": false
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `min_price` | number | REQUIRED | Lowest ticket price (0 for free events). |
| `max_price` | number | REQUIRED | Highest ticket price. |
| `currency` | string | REQUIRED | ISO 4217 currency code. |
| `includes_fees` | boolean | REQUIRED | Whether prices include protocol and platform fees. |

### 4.4 Location Object

For physical events:
```json
{
  "location": {
    "@type": "Place",
    "name": "The Fillmore",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "1805 Geary Blvd",
      "addressLocality": "San Francisco",
      "addressRegion": "CA",
      "postalCode": "94115",
      "addressCountry": "US"
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": 37.7841,
      "longitude": -122.4330
    }
  }
}
```

For virtual events:
```json
{
  "location": {
    "@type": "VirtualLocation",
    "url": "https://zoom.us/j/example",
    "atlas:platform": "zoom"
  }
}
```

---

## 5. Ticket Listing Schema

Each event has one or more ticket types. Agents MUST fetch ticket types before initiating a purchase.

**Endpoint:**
```
GET /atlas/v1/events/{event_id}/ticket-types
```

### 5.1 Ticket Type Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `atlas:ticket_type_id` | string | REQUIRED | Unique ticket type identifier (UUID v7). |
| `name` | string | REQUIRED | Display name (e.g., "General Admission", "VIP"). |
| `description` | string | OPTIONAL | Ticket type description. |
| `atlas:event_id` | string | REQUIRED | Parent event Atlas ID. |
| `atlas:pricing` | object | REQUIRED | Pricing breakdown. See Section 5.2. |
| `atlas:availability` | object | REQUIRED | Inventory status. See Section 5.3. |
| `atlas:restrictions` | object | OPTIONAL | Purchase restrictions. See Section 5.4. |
| `atlas:cancellation_policy` | object | REQUIRED | Refund and cancellation terms. See Section 5.5. |
| `atlas:accepted_payment_methods` | array of string | REQUIRED | Payment methods accepted for this ticket type. |
| `atlas:metadata` | object | OPTIONAL | Arbitrary key-value pairs from the source platform. |

### 5.2 Pricing Object

Pricing MUST be fully transparent. Every fee component MUST be itemized.

```json
{
  "atlas:pricing": {
    "base_price": 50.00,
    "currency": "USD",
    "fees": [
      {
        "name": "atlas_protocol_fee",
        "type": "percentage",
        "rate": 2.0,
        "amount": 1.00,
        "description": "Atlas Protocol fee (2%)"
      },
      {
        "name": "platform_fee",
        "type": "percentage",
        "rate": 5.0,
        "amount": 2.50,
        "description": "Platform service fee"
      },
      {
        "name": "payment_processing",
        "type": "fixed",
        "amount": 0.001,
        "description": "Tempo USDC transaction fee"
      }
    ],
    "total_price": 53.501,
    "fees_total": 3.501,
    "tax_included": false,
    "tax_amount": null
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `base_price` | number | REQUIRED | Ticket price before fees. |
| `currency` | string | REQUIRED | ISO 4217 currency code. |
| `fees` | array of Fee | REQUIRED | Itemized fees. MAY be empty for free tickets. |
| `fees[].name` | string | REQUIRED | Machine-readable fee identifier. |
| `fees[].type` | string | REQUIRED | `"percentage"` or `"fixed"`. |
| `fees[].rate` | number | OPTIONAL | Percentage rate (present when type is `"percentage"`). |
| `fees[].amount` | number | REQUIRED | Calculated fee amount in `currency`. |
| `fees[].description` | string | REQUIRED | Human-readable fee description. |
| `total_price` | number | REQUIRED | `base_price` + sum of all `fees[].amount`. |
| `fees_total` | number | REQUIRED | Sum of all `fees[].amount`. |
| `tax_included` | boolean | REQUIRED | Whether `total_price` includes applicable tax. |
| `tax_amount` | number or null | REQUIRED | Tax amount if calculated, null if not applicable. |

### 5.3 Availability Object

```json
{
  "atlas:availability": {
    "status": "available",
    "total_quantity": 500,
    "remaining_quantity": 142,
    "max_per_order": 10,
    "min_per_order": 1,
    "sale_start": "2026-03-01T00:00:00Z",
    "sale_end": "2026-04-15T18:00:00Z",
    "on_sale": true
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | REQUIRED | `"available"`, `"few_remaining"` (< 10%), `"sold_out"`, `"not_on_sale"`, `"hidden"`. |
| `total_quantity` | integer or null | OPTIONAL | Total inventory. Null if unlimited. |
| `remaining_quantity` | integer or null | OPTIONAL | Remaining inventory. Null if unlimited or undisclosed. |
| `max_per_order` | integer | REQUIRED | Maximum tickets per purchase. |
| `min_per_order` | integer | REQUIRED | Minimum tickets per purchase. Default: 1. |
| `sale_start` | string (ISO 8601) | OPTIONAL | When tickets go on sale. |
| `sale_end` | string (ISO 8601) | OPTIONAL | When ticket sales close. |
| `on_sale` | boolean | REQUIRED | Whether tickets are currently purchasable. |

### 5.4 Restrictions Object

```json
{
  "atlas:restrictions": {
    "age_minimum": 21,
    "age_maximum": null,
    "requires_approval": false,
    "requires_invitation_code": false,
    "geographic_restrictions": [],
    "requires_identity_verification": false,
    "transferable": true,
    "resellable": false,
    "custom_restrictions": []
  }
}
```

### 5.5 Cancellation Policy Object

```json
{
  "atlas:cancellation_policy": {
    "refundable": true,
    "refund_type": "full",
    "refund_deadline": "2026-04-14T18:00:00Z",
    "partial_refund_schedule": null,
    "cancellation_fee": 0,
    "policy_text": "Full refund available up to 24 hours before the event.",
    "organizer_cancellation_refund": "automatic_full"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `refundable` | boolean | REQUIRED | Whether any refund is possible. |
| `refund_type` | string | REQUIRED | `"full"`, `"partial"`, `"none"`. |
| `refund_deadline` | string (ISO 8601) or null | REQUIRED | Last date for refund requests. Null if no deadline. |
| `partial_refund_schedule` | array or null | OPTIONAL | Tiered refund schedule for partial refunds. |
| `cancellation_fee` | number | REQUIRED | Fixed cancellation processing fee. |
| `policy_text` | string | REQUIRED | Human-readable policy text. |
| `organizer_cancellation_refund` | string | REQUIRED | What happens if the organizer cancels: `"automatic_full"`, `"manual_review"`, `"credit_only"`. |

---

## 6. Purchase Flow

Atlas uses a two-phase purchase flow inspired by HTTP 402 Payment Required, aligned with MPP (Machine Payment Protocol).

### 6.1 Overview

```
Agent                          Atlas Endpoint
  |                                  |
  |  POST /events/:id/purchase       |
  |  (ticket selection, quantity)     |
  |--------------------------------->|
  |                                  |
  |  402 Payment Required            |
  |  (challenge + ticket_hold_id)    |
  |<---------------------------------|
  |                                  |
  |  [Agent satisfies challenge      |
  |   via payment rail]              |
  |                                  |
  |  POST /events/:id/purchase       |
  |  Authorization: Atlas-Payment    |
  |  (payment credential)            |
  |--------------------------------->|
  |                                  |
  |  200 OK                          |
  |  (receipt with VC tickets)       |
  |<---------------------------------|
```

### 6.2 Phase 1: Purchase Request

**Request:**
```http
POST /atlas/v1/events/{event_id}/purchase HTTP/1.1
Host: api.example-events.com
Content-Type: application/json
Atlas-Version: 1.0
Atlas-Agent-Id: agent-uuid-here
Idempotency-Key: unique-request-id

{
  "ticket_type_id": "tt_01HZ3V...",
  "quantity": 2,
  "attendee_info": [
    {
      "name": "Alice Johnson",
      "email": "alice@example.com"
    },
    {
      "name": "Bob Smith",
      "email": "bob@example.com"
    }
  ],
  "preferred_payment_method": "tempo_usdc",
  "discount_codes": ["EARLY20"],
  "metadata": {}
}
```

**Required headers:**
| Header | Required | Description |
|--------|----------|-------------|
| `Atlas-Version` | REQUIRED | Protocol version. MUST be `1.0`. |
| `Atlas-Agent-Id` | REQUIRED | Agent's registered Atlas ID. |
| `Idempotency-Key` | REQUIRED | Unique key for idempotent retries (UUID v4). |
| `Content-Type` | REQUIRED | MUST be `application/json`. |

### 6.3 Phase 1 Response: 402 Payment Required

The endpoint MUST create a ticket hold and return a payment challenge.

**Response:**
```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
Atlas-Version: 1.0

{
  "atlas:challenge": {
    "challenge_id": "ch_01HZ3V...",
    "ticket_hold_id": "hold_01HZ3V...",
    "hold_expires_at": "2026-03-19T12:05:00Z",
    "hold_ttl_seconds": 300,
    "pricing": {
      "base_price": 100.00,
      "fees_total": 7.002,
      "total_price": 107.002,
      "currency": "USD",
      "fees": [
        {"name": "atlas_protocol_fee", "amount": 2.00},
        {"name": "platform_fee", "amount": 5.00},
        {"name": "payment_processing", "amount": 0.002}
      ]
    },
    "discount_applied": {
      "code": "EARLY20",
      "type": "percentage",
      "value": 20,
      "savings": 20.00
    },
    "payment_methods": [
      {
        "type": "tempo_usdc",
        "network": "tempo",
        "recipient_address": "0x1234...abcd",
        "amount": "107.002",
        "currency": "USDC",
        "memo": "atlas:ch_01HZ3V..."
      },
      {
        "type": "stripe_spt",
        "client_secret": "pi_3abc...secret_xyz",
        "amount": 10700,
        "currency": "usd"
      }
    ],
    "required_credential_type": "atlas-payment-v1"
  }
}
```

**Hold requirements:**
- The server MUST hold inventory for a minimum of 300 seconds (5 minutes).
- The `hold_ttl_seconds` field MUST accurately reflect the actual hold duration.
- The server SHOULD release held inventory immediately upon hold expiration.
- The server MUST accept payment completion up to `hold_expires_at`, even under load.
- Hold IDs MUST be globally unique and MUST NOT be reused.

### 6.4 Phase 2: Payment Completion

After satisfying the challenge via the specified payment rail, the agent retries with a payment credential.

**Request:**
```http
POST /atlas/v1/events/{event_id}/purchase HTTP/1.1
Host: api.example-events.com
Content-Type: application/json
Atlas-Version: 1.0
Atlas-Agent-Id: agent-uuid-here
Idempotency-Key: same-unique-request-id
Authorization: Atlas-Payment v1; credential="eyJhbGci..."

{
  "challenge_id": "ch_01HZ3V...",
  "ticket_hold_id": "hold_01HZ3V...",
  "payment_proof": {
    "type": "tempo_usdc",
    "transaction_hash": "0xabcdef...",
    "network": "tempo",
    "amount": "107.002",
    "currency": "USDC",
    "payer_address": "0x5678...efgh"
  }
}
```

### 6.5 Phase 2 Response: 200 Success

```http
HTTP/1.1 200 OK
Content-Type: application/json
Atlas-Version: 1.0

{
  "atlas:receipt": {
    "receipt_id": "rcpt_01HZ3V...",
    "status": "confirmed",
    "event_id": "evt_01HZ3V...",
    "purchase_timestamp": "2026-03-19T12:01:23Z",
    "total_charged": 107.002,
    "currency": "USD",
    "payment_method": "tempo_usdc",
    "transaction_hash": "0xabcdef...",
    "tickets": [
      {
        "@context": ["https://www.w3.org/2018/credentials/v1", "https://atlas-protocol.org/v1/credentials"],
        "type": ["VerifiableCredential", "AtlasTicket"],
        "id": "urn:atlas:ticket:tkt_01HZ3V_001",
        "issuer": "did:web:example-events.com",
        "issuanceDate": "2026-03-19T12:01:23Z",
        "credentialSubject": {
          "id": "did:atlas:agent:agent-uuid-here",
          "attendee_name": "Alice Johnson",
          "attendee_email": "alice@example.com",
          "event_id": "evt_01HZ3V...",
          "event_name": "Bay Area Tech Mixer",
          "ticket_type": "General Admission",
          "ticket_type_id": "tt_01HZ3V...",
          "valid_from": "2026-04-15T18:00:00Z",
          "valid_until": "2026-04-15T23:59:59Z",
          "seat": null,
          "barcode": "ATLAS-TKT-01HZ3V-001",
          "barcode_format": "qr"
        },
        "proof": {
          "type": "JsonWebSignature2020",
          "created": "2026-03-19T12:01:23Z",
          "verificationMethod": "did:web:example-events.com#atlas-2026-03",
          "proofPurpose": "assertionMethod",
          "jws": "eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il19..."
        }
      }
    ],
    "rewards": {
      "attendee_reward_usdc": 2.14,
      "reward_status": "pending",
      "reward_payout_address": "0x5678...efgh"
    }
  }
}
```

### 6.6 Error Responses

All error responses MUST use the following structure:

```json
{
  "error": {
    "code": "SOLD_OUT",
    "http_status": 409,
    "message": "The requested ticket type is sold out.",
    "details": {},
    "retry_after": null,
    "atlas_version": "1.0"
  }
}
```

**Error codes:**

| HTTP Status | Atlas Error Code | When | Retry |
|-------------|-----------------|------|-------|
| `402` | `PAYMENT_REQUIRED` | Standard challenge response (not an error). Phase 1 success. | Yes — with payment credential. |
| `409` | `SOLD_OUT` | Requested ticket type has no remaining inventory. | No. |
| `409` | `HOLD_CONFLICT` | Another hold exists for this idempotency key. | No — use existing hold. |
| `410` | `HOLD_EXPIRED` | The ticket hold has expired. Inventory released. | Yes — restart from Phase 1. |
| `422` | `INVALID_REQUEST` | Malformed request body, missing fields, invalid ticket_type_id. | No — fix request. |
| `422` | `INVALID_QUANTITY` | Quantity exceeds max_per_order or below min_per_order. | No — adjust quantity. |
| `422` | `INVALID_DISCOUNT` | Discount code is invalid, expired, or not applicable. | Yes — without discount. |
| `422` | `PAYMENT_MISMATCH` | Payment proof does not match challenge (wrong amount, wrong address). | Yes — correct payment. |
| `422` | `PAYMENT_UNVERIFIED` | Payment transaction not found or not yet confirmed on-chain. | Yes — after confirmation. |
| `429` | `RATE_LIMITED` | Too many requests from this agent. | Yes — after `Retry-After` seconds. |
| `503` | `SERVICE_UNAVAILABLE` | Platform temporarily unavailable. | Yes — after `Retry-After` seconds. |

### 6.7 Idempotency

- The `Idempotency-Key` header MUST be a UUID v4.
- Servers MUST store idempotency keys for at least 24 hours.
- Replaying a request with the same `Idempotency-Key` MUST return the same response (including the same `ticket_hold_id`).
- The `Idempotency-Key` MUST be scoped to the `Atlas-Agent-Id`.

---

## 7. Receipt Schema

Receipts serve as proof of purchase and contain embedded Verifiable Credential tickets.

### 7.1 Format

Receipts MUST conform to the [W3C Verifiable Credentials Data Model 1.1](https://www.w3.org/TR/vc-data-model/).

### 7.2 Signing

- Receipts MUST be signed using JSON Web Signature (JWS) with the `JsonWebSignature2020` proof type.
- The signing key MUST be listed in the platform's `/.well-known/atlas.json` `signing_keys` array.
- The verification method MUST use `did:web` referencing the issuing domain.
- The algorithm MUST be ES256 (ECDSA with P-256 and SHA-256).

### 7.3 Verification

Agents and third parties can verify a receipt by:

1. Extracting the `issuer` DID from the credential.
2. Resolving the issuer's `/.well-known/atlas.json` to obtain signing keys.
3. Matching the `verificationMethod` `kid` to a key in `signing_keys`.
4. Verifying the JWS signature against the matched public key.
5. Checking that `issuanceDate` is not in the future.
6. Optionally, calling the `receipt_verify` endpoint for real-time status.

### 7.4 Receipt Status Endpoint

```
GET /atlas/v1/receipts/{receipt_id}/verify
```

**Response:**
```json
{
  "receipt_id": "rcpt_01HZ3V...",
  "status": "valid",
  "tickets": [
    {
      "ticket_id": "tkt_01HZ3V_001",
      "status": "valid",
      "checked_in": false,
      "checked_in_at": null
    }
  ],
  "verified_at": "2026-03-19T12:10:00Z"
}
```

**Ticket statuses:** `"valid"`, `"used"` (checked in), `"cancelled"`, `"refunded"`, `"transferred"`.

---

## 8. Payment Methods

Atlas abstracts over multiple payment rails via the challenge mechanism. Each payment method maps to a specific challenge format.

### 8.1 Tempo USDC

The primary payment rail. Tempo provides USDC settlement with sub-cent transaction fees.

**Challenge fields:**
| Field | Description |
|-------|-------------|
| `type` | `"tempo_usdc"` |
| `network` | `"tempo"` |
| `recipient_address` | USDC recipient address on Tempo |
| `amount` | Exact USDC amount as string (decimal precision) |
| `currency` | `"USDC"` |
| `memo` | Challenge reference. Format: `atlas:{challenge_id}`. MUST be included in the transaction. |

**Payment proof fields:**
| Field | Description |
|-------|-------------|
| `type` | `"tempo_usdc"` |
| `transaction_hash` | On-chain transaction hash |
| `network` | `"tempo"` |
| `amount` | Actual amount sent |
| `currency` | `"USDC"` |
| `payer_address` | Sender address |

**Verification:** The server MUST verify the transaction on-chain — correct recipient, amount, memo, and confirmation status.

### 8.2 Stripe SPT (Stripe Payment Token)

Fallback for fiat payments (credit cards, Apple Pay, Google Pay).

**Challenge fields:**
| Field | Description |
|-------|-------------|
| `type` | `"stripe_spt"` |
| `client_secret` | Stripe PaymentIntent client secret |
| `amount` | Amount in smallest currency unit (cents for USD) |
| `currency` | ISO 4217 lowercase (e.g., `"usd"`) |

**Payment proof fields:**
| Field | Description |
|-------|-------------|
| `type` | `"stripe_spt"` |
| `payment_intent_id` | Stripe PaymentIntent ID |
| `status` | `"succeeded"` |

**Verification:** The server MUST verify the PaymentIntent status via the Stripe API.

### 8.3 Lightning (Future)

Reserved for future implementation. Lightning payment challenges will follow the BOLT11 invoice format.

**Challenge fields (reserved):**
| Field | Description |
|-------|-------------|
| `type` | `"lightning"` |
| `invoice` | BOLT11 payment request |
| `amount_sats` | Amount in satoshis |

### 8.4 Payment Method Negotiation

If the agent's preferred payment method is not available, the server MUST return all available methods in the 402 challenge. The agent SHOULD select the method with the lowest fees.

Priority order (RECOMMENDED for agents):
1. `tempo_usdc` — lowest fees, fastest settlement
2. `stripe_spt` — universal compatibility
3. `lightning` — when available

---

## 9. Organizer Authentication

Atlas is organizer-first. Organizers prove ownership of events from connected platforms via OAuth.

### 9.1 OAuth Connection Flow

```
Organizer                 Atlas Registry              Source Platform
   |                           |                           |
   |  Connect Eventbrite       |                           |
   |-------------------------->|                           |
   |                           |  OAuth2 Authorization     |
   |                           |-------------------------->|
   |                           |                           |
   |                           |  Access Token + Profile   |
   |                           |<--------------------------|
   |                           |                           |
   |                           |  Fetch organizer events   |
   |                           |-------------------------->|
   |                           |                           |
   |                           |  Event data               |
   |                           |<--------------------------|
   |                           |                           |
   |  Connection confirmed     |                           |
   |  Events now discoverable  |                           |
   |<--------------------------|                           |
```

### 9.2 Supported Platforms

Atlas v1 MUST support OAuth connections for:
- Eventbrite (OAuth2)
- Lu.ma (OAuth2)
- Meetup (OAuth2)

Additional platforms MAY be added without protocol version changes.

### 9.3 Verification Levels

| Level | Badge | Criteria |
|-------|-------|----------|
| `unverified` | None | Account created, no platforms connected. |
| `connected` | Connected | At least one platform account connected via OAuth. |
| `verified` | Verified | Connected + email domain matches platform profile + at least one past event. |
| `trusted` | Trusted | Verified + 10+ events + 100+ tickets sold via Atlas + no disputes. |

### 9.4 Event Ownership Proof

When an organizer connects a platform account, the Registry MUST:

1. Verify the OAuth token is valid and not expired.
2. Fetch the organizer's profile from the source platform API.
3. Fetch the organizer's events from the source platform API.
4. For each event, store a mapping: `(source_platform, source_event_id) → atlas_organizer_id`.
5. Set `atlas:organizer_verified` to `true` on all mapped events.
6. Refresh event data on a regular schedule (RECOMMENDED: every 15 minutes).

### 9.5 Conflict Resolution

If two organizers claim the same event (e.g., co-hosts):
- The organizer whose platform account is the event's primary organizer/creator takes precedence.
- Co-hosts MAY be listed as secondary organizers but MUST NOT control ticketing.
- Disputes are resolved by the Registry operator (Lemonade in the reference implementation).

---

## 10. Versioning

### 10.1 Version Format

Atlas uses `MAJOR.MINOR` versioning:
- **MAJOR:** Breaking changes to schemas, endpoints, or flow. Agents MUST update.
- **MINOR:** Additive changes (new optional fields, new endpoints). Backward-compatible.

### 10.2 Version Negotiation

**Request header:**
```
Atlas-Version: 1.0
```

**Response header:**
```
Atlas-Version: 1.0
Atlas-Supported-Versions: 1.0, 1.1
```

- Clients MUST send `Atlas-Version` on every request.
- Servers MUST respond with the version used to process the request.
- If the requested version is unsupported, the server MUST return `406 Not Acceptable` with supported versions.

### 10.3 Version Lifecycle

| State | Duration | Behavior |
|-------|----------|----------|
| **Current** | Until next MAJOR | Default version. Full support. |
| **Supported** | 12 months after next MAJOR | Fully functional. Deprecation warnings in response headers. |
| **Deprecated** | 6 months after Supported ends | Read-only. Purchases disabled. `Sunset` header included. |
| **Retired** | After Deprecated period | All requests return `410 Gone`. |

**Deprecation header:**
```
Sunset: Sat, 19 Mar 2028 00:00:00 GMT
Atlas-Deprecation-Notice: Version 1.0 is deprecated. Migrate to 2.0 by 2028-03-19.
```

---

## 11. Security Considerations

### 11.1 Transport Security

- All Atlas endpoints MUST be served over HTTPS (TLS 1.2 or later).
- Platforms MUST present valid TLS certificates from a trusted CA.
- HTTP requests MUST be rejected or redirected to HTTPS.

### 11.2 Authentication and Authorization

- Agents MUST authenticate via `Atlas-Agent-Id` and a registered API key or JWT.
- Agent API keys MUST be rotated at least every 90 days.
- The `Authorization: Atlas-Payment` header MUST only be accepted during Phase 2 of the purchase flow, scoped to a valid `challenge_id`.

### 11.3 Rate Limiting

- Servers MUST implement rate limiting per `Atlas-Agent-Id`.
- RECOMMENDED limits: 100 requests/minute for search, 10 requests/minute for purchase.
- Rate limit responses MUST include `Retry-After` header.

### 11.4 Input Validation

- All string fields MUST be validated for maximum length.
- Event IDs and ticket type IDs MUST match UUID v7 format.
- Monetary amounts MUST be validated as non-negative numbers with maximum 6 decimal places.
- Discount codes MUST be alphanumeric, maximum 32 characters.

### 11.5 Payment Security

- Payment proofs MUST be verified on-chain (USDC) or via the payment processor API (Stripe).
- Servers MUST NOT release tickets until payment is confirmed.
- Double-spend protection: servers MUST check that a transaction hash has not been used for a previous purchase.
- Challenge amounts MUST be exact — servers MUST reject underpayments and refund overpayments.

### 11.6 Data Privacy

- Attendee PII (name, email) MUST be encrypted at rest.
- Attendee data MUST NOT be shared with third parties without explicit consent.
- Agents MUST NOT store attendee PII beyond the purchase session unless authorized by the attendee.
- Platforms MUST comply with GDPR, CCPA, and applicable data protection regulations.

### 11.7 Receipt Integrity

- Receipts MUST be signed with keys listed in the platform manifest.
- Key rotation: platforms MUST support multiple active signing keys during rotation periods.
- Revoked keys MUST be removed from the manifest within 24 hours.
- Receipt verification MUST check key validity at the time of issuance, not at verification time.

### 11.8 Denial of Service Mitigation

- Hold creation MUST be rate-limited to prevent inventory exhaustion attacks (agent creates holds without completing purchase).
- Holds MUST expire and release inventory automatically.
- Servers SHOULD implement progressive penalties for agents that repeatedly create holds without completing purchases.

---

## 12. IANA Considerations

### 12.1 Well-Known URI Registration

This specification registers the following well-known URI:

- **URI suffix:** `atlas.json`
- **Change controller:** Atlas Protocol Working Group
- **Specification document:** This document, Section 3.1
- **Related information:** None

### 12.2 HTTP Header Registration

This specification defines the following HTTP headers:

| Header | Type | Description |
|--------|------|-------------|
| `Atlas-Version` | Request/Response | Protocol version |
| `Atlas-Agent-Id` | Request | Agent identifier |
| `Atlas-Supported-Versions` | Response | List of supported versions |
| `Atlas-Deprecation-Notice` | Response | Deprecation warning |

### 12.3 Media Type

This specification uses `application/json` for all request and response bodies. A dedicated media type `application/atlas+json` is reserved for future use.

---

## Appendix A: Complete Purchase Flow Example

### Step 1: Discover Event

```http
GET /atlas/v1/search?q=tech+mixer&location=san+francisco&date_from=2026-04-01 HTTP/1.1
Host: registry.atlas-protocol.org
Atlas-Version: 1.0
Atlas-Agent-Id: agt_01HZ3V...
```

### Step 2: Get Ticket Types

```http
GET /atlas/v1/events/evt_01HZ3V.../ticket-types HTTP/1.1
Host: api.example-events.com
Atlas-Version: 1.0
Atlas-Agent-Id: agt_01HZ3V...
```

### Step 3: Initiate Purchase (Phase 1)

```http
POST /atlas/v1/events/evt_01HZ3V.../purchase HTTP/1.1
Host: api.example-events.com
Content-Type: application/json
Atlas-Version: 1.0
Atlas-Agent-Id: agt_01HZ3V...
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "ticket_type_id": "tt_01HZ3V...",
  "quantity": 2,
  "attendee_info": [
    {"name": "Alice Johnson", "email": "alice@example.com"},
    {"name": "Bob Smith", "email": "bob@example.com"}
  ],
  "preferred_payment_method": "tempo_usdc"
}
```

Response: `402 Payment Required` with challenge (see Section 6.3).

### Step 4: Execute Payment on Tempo

Agent sends USDC to the `recipient_address` with the challenge `memo`.

### Step 5: Complete Purchase (Phase 2)

```http
POST /atlas/v1/events/evt_01HZ3V.../purchase HTTP/1.1
Host: api.example-events.com
Content-Type: application/json
Atlas-Version: 1.0
Atlas-Agent-Id: agt_01HZ3V...
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Authorization: Atlas-Payment v1; credential="eyJhbGci..."

{
  "challenge_id": "ch_01HZ3V...",
  "ticket_hold_id": "hold_01HZ3V...",
  "payment_proof": {
    "type": "tempo_usdc",
    "transaction_hash": "0xabcdef1234567890...",
    "network": "tempo",
    "amount": "107.002",
    "currency": "USDC",
    "payer_address": "0x5678...efgh"
  }
}
```

Response: `200 OK` with receipt containing Verifiable Credential tickets (see Section 6.5).

---

## Appendix B: References

- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) — Key words for use in RFCs
- [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) — Well-Known URIs
- [Schema.org Event](https://schema.org/Event) — Event vocabulary
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/) — VC Data Model 1.1
- [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/) — JSON Linked Data
- [DID:web](https://w3c-ccg.github.io/did-method-web/) — Web DID Method
- [UUID v7](https://www.rfc-editor.org/rfc/rfc9562) — Time-ordered UUIDs
