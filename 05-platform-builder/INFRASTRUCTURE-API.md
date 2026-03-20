# Atlas Infrastructure API Reference

> Complete API reference for platforms built on Atlas.

**Base URL:** `https://api.atlas-protocol.io/v1`
**Content-Type:** `application/json`
**API Version:** `v1`

---

## Table of Contents

1. [Authentication](#authentication)
2. [Events API](#events-api)
3. [Ticketing API](#ticketing-api)
4. [Check-in API](#check-in-api)
5. [Payment API](#payment-api)
6. [Analytics API](#analytics-api)
7. [Organizer API](#organizer-api)
8. [Webhook Events](#webhook-events)
9. [Rate Limits](#rate-limits)
10. [SDKs](#sdks)
11. [Error Handling](#error-handling)

---

## Authentication

### Platform API Keys

Every platform receives an API key pair on registration. Include the secret key in all server-side requests.

```
Authorization: Bearer atlas_sk_live_abc123...
```

| Key Type | Prefix | Usage |
|----------|--------|-------|
| Secret key | `atlas_sk_live_` | Server-side only. Full API access. |
| Publishable key | `atlas_pk_live_` | Client-side. Read-only. Event listing and display. |
| Test keys | `atlas_sk_test_` / `atlas_pk_test_` | Sandbox environment. No real payments. |

### Organizer JWT Tokens

Organizers authenticate via your platform's login flow. Issue a JWT by exchanging organizer credentials:

**POST** `/auth/organizer-token`

```bash
curl -X POST https://api.atlas-protocol.io/v1/auth/organizer-token \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "organizer_id": "org_9f8e7d6c",
    "scopes": ["events:write", "tickets:read", "analytics:read"],
    "expires_in": 3600
  }'
```

**Response:**

```json
{
  "token": "eyJhbGciOiJFZDI1NTE5IiwidHlwIjoiSldUIn0...",
  "expires_at": "2026-03-19T13:00:00Z",
  "organizer_id": "org_9f8e7d6c",
  "scopes": ["events:write", "tickets:read", "analytics:read"]
}
```

Organizer tokens are scoped. Available scopes:

| Scope | Description |
|-------|-------------|
| `events:read` | View own events |
| `events:write` | Create and update own events |
| `tickets:read` | View ticket types and sales for own events |
| `tickets:write` | Create and update ticket types for own events |
| `analytics:read` | View analytics for own events |
| `payments:read` | View payment and settlement status |
| `checkin:write` | Perform check-in operations |

---

## Events API

### Create Event

**POST** `/events`

```bash
curl -X POST https://api.atlas-protocol.io/v1/events \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Berghain Closing Party",
    "description": "The final night. 24 hours of techno.",
    "start_at": "2026-06-20T23:00:00Z",
    "end_at": "2026-06-21T23:00:00Z",
    "timezone": "Europe/Berlin",
    "venue": {
      "name": "Berghain",
      "address": "Am Wriezener Bhf, 10243 Berlin",
      "city": "Berlin",
      "country": "DE",
      "latitude": 52.5112,
      "longitude": 13.4425
    },
    "category": "music",
    "tags": ["techno", "club", "closing-party"],
    "cover_image": "https://cdn.berlintechno.events/berghain-closing.jpg",
    "organizer_id": "org_9f8e7d6c",
    "custom_fields": {
      "genre": "techno",
      "bpm_range": "130-140",
      "sound_system": "Funktion-One"
    },
    "settings": {
      "visibility": "public",
      "require_approval": false,
      "max_capacity": 1500,
      "age_restriction": 18
    }
  }'
```

**Response** `201 Created`:

```json
{
  "id": "evt_a1b2c3d4",
  "title": "Berghain Closing Party",
  "description": "The final night. 24 hours of techno.",
  "slug": "berghain-closing-party-2026",
  "start_at": "2026-06-20T23:00:00Z",
  "end_at": "2026-06-21T23:00:00Z",
  "timezone": "Europe/Berlin",
  "venue": {
    "name": "Berghain",
    "address": "Am Wriezener Bhf, 10243 Berlin",
    "city": "Berlin",
    "country": "DE",
    "latitude": 52.5112,
    "longitude": 13.4425
  },
  "category": "music",
  "tags": ["techno", "club", "closing-party"],
  "cover_image": "https://cdn.berlintechno.events/berghain-closing.jpg",
  "organizer_id": "org_9f8e7d6c",
  "platform_id": "plt_x1y2z3",
  "custom_fields": {
    "genre": "techno",
    "bpm_range": "130-140",
    "sound_system": "Funktion-One"
  },
  "settings": {
    "visibility": "public",
    "require_approval": false,
    "max_capacity": 1500,
    "age_restriction": 18
  },
  "state": "draft",
  "registry_id": null,
  "created_at": "2026-03-19T10:00:00Z",
  "updated_at": "2026-03-19T10:00:00Z"
}
```

### Event Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Event title. 1-200 characters. |
| `description` | string | Yes | Event description. Markdown supported. Max 10,000 chars. |
| `start_at` | ISO 8601 | Yes | Event start time in UTC. |
| `end_at` | ISO 8601 | Yes | Event end time in UTC. Must be after `start_at`. |
| `timezone` | string | Yes | IANA timezone (e.g., `Europe/Berlin`). |
| `venue` | object | Yes | Venue details (see below). |
| `venue.name` | string | Yes | Venue name. |
| `venue.address` | string | Yes | Street address. |
| `venue.city` | string | Yes | City name. |
| `venue.country` | string | Yes | ISO 3166-1 alpha-2 country code. |
| `venue.latitude` | number | No | Latitude coordinate. |
| `venue.longitude` | number | No | Longitude coordinate. |
| `category` | string | Yes | Primary event category. |
| `tags` | string[] | No | Searchable tags. Max 20. |
| `cover_image` | URL | No | Cover image URL. Recommended 1200x630. |
| `organizer_id` | string | Yes | Organizer who owns this event. |
| `custom_fields` | object | No | Platform-defined custom fields (key-value). |
| `settings.visibility` | enum | No | `public`, `unlisted`, `private`. Default: `public`. |
| `settings.require_approval` | boolean | No | Require attendee approval. Default: `false`. |
| `settings.max_capacity` | integer | No | Maximum total attendees across all ticket types. |
| `settings.age_restriction` | integer | No | Minimum age requirement. |

### Event States

| State | Description | Transitions |
|-------|-------------|------------|
| `draft` | Not visible. No ticket sales. | publish |
| `published` | Live. Ticket sales active. Listed in registry. | cancel, complete |
| `cancelled` | Cancelled. Refunds triggered. Removed from registry. | — |
| `completed` | Past event. Sales closed. Analytics finalized. | — |

### Get Event

**GET** `/events/:id`

```bash
curl https://api.atlas-protocol.io/v1/events/evt_a1b2c3d4 \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "id": "evt_a1b2c3d4",
  "title": "Berghain Closing Party",
  "state": "published",
  "registry_id": "reg_m4n5o6p7",
  "ticket_types_count": 3,
  "tickets_sold": 847,
  "capacity_remaining": 653,
  "...": "..."
}
```

### Update Event

**PATCH** `/events/:id`

Partial updates. Only include fields to change.

```bash
curl -X PATCH https://api.atlas-protocol.io/v1/events/evt_a1b2c3d4 \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated description with lineup announcement.",
    "settings": {
      "max_capacity": 2000
    }
  }'
```

**Response** `200 OK`: Updated event object.

### List Events

**GET** `/events`

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `state` | string | Filter by state: `draft`, `published`, `cancelled`, `completed` |
| `organizer_id` | string | Filter by organizer |
| `category` | string | Filter by category |
| `city` | string | Filter by venue city |
| `geo_lat` / `geo_lng` / `geo_radius` | number | Geographic search (lat, lng, radius in km) |
| `start_after` | ISO 8601 | Events starting after this time |
| `start_before` | ISO 8601 | Events starting before this time |
| `tags` | string (comma-separated) | Filter by tags (OR logic) |
| `q` | string | Full-text search across title, description, venue |
| `custom_fields.*` | string | Filter by custom field value (e.g., `custom_fields.genre=techno`) |
| `sort` | string | `date_asc`, `date_desc`, `created_desc`, `popularity`. Default: `date_asc` |
| `limit` | integer | 1-100. Default: 20. |
| `cursor` | string | Pagination cursor from previous response. |

```bash
curl "https://api.atlas-protocol.io/v1/events?category=music&city=Berlin&start_after=2026-06-01T00:00:00Z&sort=date_asc&limit=10" \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "data": [
    {
      "id": "evt_a1b2c3d4",
      "title": "Berghain Closing Party",
      "start_at": "2026-06-20T23:00:00Z",
      "venue": { "name": "Berghain", "city": "Berlin" },
      "category": "music",
      "tickets_available": true,
      "price_range": { "min": 25.00, "max": 80.00, "currency": "USD" }
    }
  ],
  "pagination": {
    "has_more": true,
    "next_cursor": "cur_abc123",
    "total": 47
  }
}
```

### Delete Event

**DELETE** `/events/:id`

Only `draft` events can be deleted. Published events must be cancelled first.

```bash
curl -X DELETE https://api.atlas-protocol.io/v1/events/evt_a1b2c3d4 \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `204 No Content`

### Publish Event

**POST** `/events/:id/publish`

Transitions event from `draft` to `published`. Requires at least one ticket type. Registers event in the Atlas Discovery Registry.

```bash
curl -X POST https://api.atlas-protocol.io/v1/events/evt_a1b2c3d4/publish \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "id": "evt_a1b2c3d4",
  "state": "published",
  "registry_id": "reg_m4n5o6p7",
  "published_at": "2026-03-19T10:30:00Z"
}
```

### Cancel Event

**POST** `/events/:id/cancel`

Cancels a published event. Triggers automatic refunds for all ticket holders.

```bash
curl -X POST https://api.atlas-protocol.io/v1/events/evt_a1b2c3d4/cancel \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Venue unavailable due to construction.",
    "refund_policy": "full"
  }'
```

**Response** `200 OK`:

```json
{
  "id": "evt_a1b2c3d4",
  "state": "cancelled",
  "cancelled_at": "2026-03-19T11:00:00Z",
  "refunds_initiated": 847,
  "refund_policy": "full"
}
```

### Bulk Import Events

**POST** `/events/bulk`

Import multiple events at once. Max 100 per request.

```bash
curl -X POST https://api.atlas-protocol.io/v1/events/bulk \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "title": "Monday Meditation",
        "start_at": "2026-04-06T07:00:00Z",
        "end_at": "2026-04-06T08:00:00Z",
        "timezone": "America/Los_Angeles",
        "venue": { "name": "Zen Center", "address": "300 Page St", "city": "San Francisco", "country": "US" },
        "category": "wellness",
        "organizer_id": "org_9f8e7d6c"
      },
      {
        "title": "Tuesday Yoga Flow",
        "start_at": "2026-04-07T08:00:00Z",
        "end_at": "2026-04-07T09:30:00Z",
        "timezone": "America/Los_Angeles",
        "venue": { "name": "Zen Center", "address": "300 Page St", "city": "San Francisco", "country": "US" },
        "category": "wellness",
        "organizer_id": "org_9f8e7d6c"
      }
    ],
    "auto_publish": false
  }'
```

**Response** `201 Created`:

```json
{
  "created": 2,
  "failed": 0,
  "events": [
    { "id": "evt_e5f6g7h8", "title": "Monday Meditation", "state": "draft" },
    { "id": "evt_i9j0k1l2", "title": "Tuesday Yoga Flow", "state": "draft" }
  ],
  "errors": []
}
```

---

## Ticketing API

### Create Ticket Type

**POST** `/events/:event_id/ticket-types`

```bash
curl -X POST https://api.atlas-protocol.io/v1/events/evt_a1b2c3d4/ticket-types \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Early Bird",
    "description": "Limited early bird pricing. First 200 tickets.",
    "price": 25.00,
    "currency": "USD",
    "limit": 200,
    "sale_start": "2026-03-20T00:00:00Z",
    "sale_end": "2026-04-20T00:00:00Z",
    "min_per_order": 1,
    "max_per_order": 4,
    "transferable": true,
    "refundable": true,
    "refund_deadline": "2026-06-13T23:00:00Z",
    "custom_fields": [
      {
        "key": "dietary",
        "label": "Dietary Requirements",
        "type": "text",
        "required": false
      }
    ]
  }'
```

**Response** `201 Created`:

```json
{
  "id": "tkt_r3s4t5u6",
  "event_id": "evt_a1b2c3d4",
  "name": "Early Bird",
  "description": "Limited early bird pricing. First 200 tickets.",
  "price": 25.00,
  "currency": "USD",
  "limit": 200,
  "sold": 0,
  "available": 200,
  "held": 0,
  "sale_start": "2026-03-20T00:00:00Z",
  "sale_end": "2026-04-20T00:00:00Z",
  "min_per_order": 1,
  "max_per_order": 4,
  "transferable": true,
  "refundable": true,
  "refund_deadline": "2026-06-13T23:00:00Z",
  "custom_fields": [
    {
      "key": "dietary",
      "label": "Dietary Requirements",
      "type": "text",
      "required": false
    }
  ],
  "created_at": "2026-03-19T10:15:00Z",
  "updated_at": "2026-03-19T10:15:00Z"
}
```

### Ticket Type Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name. Max 100 chars. |
| `description` | string | No | Description. Max 1,000 chars. |
| `price` | number | Yes | Price in the specified currency. 0 for free tickets. |
| `currency` | string | Yes | ISO 4217 currency code (e.g., `USD`, `EUR`) or `USDC`. |
| `limit` | integer | No | Maximum tickets of this type. Null for unlimited. |
| `sale_start` | ISO 8601 | No | When sales open. Default: immediately. |
| `sale_end` | ISO 8601 | No | When sales close. Default: event start time. |
| `min_per_order` | integer | No | Minimum tickets per order. Default: 1. |
| `max_per_order` | integer | No | Maximum tickets per order. Default: 10. |
| `transferable` | boolean | No | Whether tickets can be transferred. Default: true. |
| `refundable` | boolean | No | Whether tickets can be refunded. Default: true. |
| `refund_deadline` | ISO 8601 | No | Last date for refund requests. |
| `custom_fields` | array | No | Additional fields collected at purchase. |
| `metadata` | object | No | Arbitrary key-value metadata for your platform. |

### Update Ticket Type

**PATCH** `/ticket-types/:id`

```bash
curl -X PATCH https://api.atlas-protocol.io/v1/ticket-types/tkt_r3s4t5u6 \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "price": 30.00,
    "limit": 250,
    "sale_end": "2026-05-01T00:00:00Z"
  }'
```

**Response** `200 OK`: Updated ticket type object.

### List Ticket Types

**GET** `/events/:event_id/ticket-types`

```bash
curl https://api.atlas-protocol.io/v1/events/evt_a1b2c3d4/ticket-types \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "data": [
    {
      "id": "tkt_r3s4t5u6",
      "name": "Early Bird",
      "price": 25.00,
      "currency": "USD",
      "limit": 200,
      "sold": 143,
      "available": 52,
      "held": 5,
      "sale_start": "2026-03-20T00:00:00Z",
      "sale_end": "2026-04-20T00:00:00Z"
    },
    {
      "id": "tkt_v7w8x9y0",
      "name": "General Admission",
      "price": 45.00,
      "currency": "USD",
      "limit": 1000,
      "sold": 612,
      "available": 388,
      "held": 0,
      "sale_start": "2026-04-20T00:00:00Z",
      "sale_end": "2026-06-20T23:00:00Z"
    },
    {
      "id": "tkt_a1b2c3d4",
      "name": "VIP",
      "price": 80.00,
      "currency": "USD",
      "limit": 100,
      "sold": 92,
      "available": 3,
      "held": 5,
      "sale_start": "2026-03-20T00:00:00Z",
      "sale_end": "2026-06-20T23:00:00Z"
    }
  ]
}
```

### Real-Time Inventory

**GET** `/ticket-types/:id/inventory`

Returns real-time availability including active holds.

```bash
curl https://api.atlas-protocol.io/v1/ticket-types/tkt_r3s4t5u6/inventory \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "ticket_type_id": "tkt_r3s4t5u6",
  "limit": 200,
  "sold": 143,
  "held": 5,
  "available": 52,
  "on_sale": true,
  "sale_start": "2026-03-20T00:00:00Z",
  "sale_end": "2026-04-20T00:00:00Z",
  "updated_at": "2026-03-19T10:45:00Z"
}
```

### Create Hold

**POST** `/ticket-types/:id/holds`

Reserves tickets during checkout. Held tickets are unavailable to others until the hold expires or is released.

```bash
curl -X POST https://api.atlas-protocol.io/v1/ticket-types/tkt_r3s4t5u6/holds \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 2,
    "expires_in": 600,
    "session_id": "sess_xyz789"
  }'
```

**Response** `201 Created`:

```json
{
  "id": "hld_d4e5f6g7",
  "ticket_type_id": "tkt_r3s4t5u6",
  "quantity": 2,
  "session_id": "sess_xyz789",
  "expires_at": "2026-03-19T11:00:00Z",
  "status": "active",
  "created_at": "2026-03-19T10:50:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `quantity` | integer | Yes | Number of tickets to hold. |
| `expires_in` | integer | No | Hold duration in seconds. Default: 600 (10 minutes). Max: 1800 (30 minutes). |
| `session_id` | string | No | Your session identifier for tracking. |

### Release Hold

**DELETE** `/holds/:id`

Releases held tickets back to available inventory.

```bash
curl -X DELETE https://api.atlas-protocol.io/v1/holds/hld_d4e5f6g7 \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `204 No Content`

### Purchase Tickets (Checkout)

**POST** `/checkout`

Initiates a ticket purchase. If a hold exists, converts the hold to a purchase. Otherwise, attempts direct purchase from available inventory.

```bash
curl -X POST https://api.atlas-protocol.io/v1/checkout \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_type_id": "tkt_r3s4t5u6",
    "quantity": 2,
    "hold_id": "hld_d4e5f6g7",
    "payment_method": "stripe",
    "attendee": {
      "email": "buyer@example.com",
      "name": "Alex Techno"
    },
    "custom_field_values": {
      "dietary": "vegan"
    },
    "metadata": {
      "source": "website",
      "referral": "instagram-story"
    }
  }'
```

**Response** `201 Created`:

```json
{
  "id": "chk_h8i9j0k1",
  "status": "pending_payment",
  "ticket_type_id": "tkt_r3s4t5u6",
  "quantity": 2,
  "unit_price": 25.00,
  "subtotal": 50.00,
  "platform_fee": 1.50,
  "protocol_fee": 1.00,
  "total": 52.50,
  "currency": "USD",
  "payment_method": "stripe",
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_live_abc123...",
  "expires_at": "2026-03-19T11:20:00Z",
  "tickets": [],
  "created_at": "2026-03-19T10:50:00Z"
}
```

For **Tempo (USDC)** payments:

```bash
curl -X POST https://api.atlas-protocol.io/v1/checkout \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_type_id": "tkt_r3s4t5u6",
    "quantity": 1,
    "payment_method": "tempo",
    "payer_wallet": "0x1234567890abcdef1234567890abcdef12345678",
    "attendee": {
      "email": "buyer@example.com",
      "name": "Alex Techno"
    }
  }'
```

**Response** `201 Created`:

```json
{
  "id": "chk_l2m3n4o5",
  "status": "pending_payment",
  "ticket_type_id": "tkt_r3s4t5u6",
  "quantity": 1,
  "unit_price": 25.00,
  "subtotal": 25.00,
  "platform_fee": 0.75,
  "protocol_fee": 0.50,
  "total": 26.25,
  "currency": "USD",
  "payment_method": "tempo",
  "tempo_payment": {
    "recipient_wallet": "0xAtlasEscrow...",
    "amount_usdc": "26.250000",
    "chain": "tempo",
    "memo": "chk_l2m3n4o5",
    "expires_at": "2026-03-19T11:00:00Z"
  },
  "tickets": [],
  "created_at": "2026-03-19T10:50:00Z"
}
```

After payment completes (webhook confirmation or polling), tickets are issued:

**GET** `/checkout/:id`

```json
{
  "id": "chk_l2m3n4o5",
  "status": "completed",
  "tickets": [
    {
      "id": "tic_p6q7r8s9",
      "ticket_type_id": "tkt_r3s4t5u6",
      "event_id": "evt_a1b2c3d4",
      "attendee": { "email": "buyer@example.com", "name": "Alex Techno" },
      "credential": {
        "type": "VerifiableCredential",
        "issuer": "did:atlas:plt_x1y2z3",
        "subject": "did:atlas:tic_p6q7r8s9",
        "qr_code": "https://api.atlas-protocol.io/v1/tickets/tic_p6q7r8s9/qr"
      },
      "status": "valid",
      "checked_in": false,
      "issued_at": "2026-03-19T10:51:00Z"
    }
  ]
}
```

### Refund Ticket

**POST** `/tickets/:id/refund`

```bash
curl -X POST https://api.atlas-protocol.io/v1/tickets/tic_p6q7r8s9/refund \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "attendee_request",
    "amount": "full"
  }'
```

**Response** `200 OK`:

```json
{
  "id": "ref_t0u1v2w3",
  "ticket_id": "tic_p6q7r8s9",
  "checkout_id": "chk_l2m3n4o5",
  "reason": "attendee_request",
  "amount": 26.25,
  "currency": "USD",
  "refund_breakdown": {
    "ticket_price": 25.00,
    "platform_fee_refunded": 0.75,
    "protocol_fee_refunded": 0.50
  },
  "payment_method": "tempo",
  "status": "processing",
  "refund_to": "0x1234567890abcdef1234567890abcdef12345678",
  "created_at": "2026-03-19T12:00:00Z"
}
```

Refund amount options:

| Value | Description |
|-------|-------------|
| `"full"` | Refund full purchase price including fees |
| `"ticket_only"` | Refund ticket price, keep fees |
| Number (e.g., `15.00`) | Partial refund of the specified amount |

### Get Ticket

**GET** `/tickets/:id`

```bash
curl https://api.atlas-protocol.io/v1/tickets/tic_p6q7r8s9 \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "id": "tic_p6q7r8s9",
  "ticket_type_id": "tkt_r3s4t5u6",
  "ticket_type_name": "Early Bird",
  "event_id": "evt_a1b2c3d4",
  "event_title": "Berghain Closing Party",
  "checkout_id": "chk_l2m3n4o5",
  "attendee": {
    "email": "buyer@example.com",
    "name": "Alex Techno"
  },
  "custom_field_values": {
    "dietary": "vegan"
  },
  "credential": {
    "type": "VerifiableCredential",
    "issuer": "did:atlas:plt_x1y2z3",
    "subject": "did:atlas:tic_p6q7r8s9",
    "qr_code": "https://api.atlas-protocol.io/v1/tickets/tic_p6q7r8s9/qr"
  },
  "status": "valid",
  "checked_in": false,
  "checked_in_at": null,
  "refunded": false,
  "issued_at": "2026-03-19T10:51:00Z"
}
```

Ticket statuses: `valid`, `checked_in`, `refunded`, `cancelled`, `expired`.

### List Tickets (for an event)

**GET** `/events/:event_id/tickets`

Query parameters: `status`, `ticket_type_id`, `checked_in` (boolean), `limit`, `cursor`.

```bash
curl "https://api.atlas-protocol.io/v1/events/evt_a1b2c3d4/tickets?status=valid&limit=50" \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "data": [
    {
      "id": "tic_p6q7r8s9",
      "ticket_type_name": "Early Bird",
      "attendee": { "name": "Alex Techno", "email": "buyer@example.com" },
      "status": "valid",
      "checked_in": false,
      "issued_at": "2026-03-19T10:51:00Z"
    }
  ],
  "pagination": {
    "has_more": true,
    "next_cursor": "cur_def456",
    "total": 847
  }
}
```

---

## Check-in API

### Verify and Check In

**POST** `/tickets/:id/checkin`

Verifies the ticket credential and records check-in.

```bash
curl -X POST https://api.atlas-protocol.io/v1/tickets/tic_p6q7r8s9/checkin \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "checkpoint": "main-entrance",
    "operator_id": "staff_001"
  }'
```

**Response** `200 OK`:

```json
{
  "ticket_id": "tic_p6q7r8s9",
  "event_id": "evt_a1b2c3d4",
  "status": "checked_in",
  "attendee": {
    "name": "Alex Techno",
    "email": "buyer@example.com"
  },
  "ticket_type": "Early Bird",
  "checkpoint": "main-entrance",
  "operator_id": "staff_001",
  "checked_in_at": "2026-06-20T23:15:00Z",
  "credential_valid": true
}
```

**Error responses:**

Already checked in (`409 Conflict`):
```json
{
  "error": "already_checked_in",
  "message": "Ticket was already checked in at 2026-06-20T23:10:00Z",
  "checked_in_at": "2026-06-20T23:10:00Z",
  "checkpoint": "main-entrance"
}
```

Invalid ticket (`422 Unprocessable Entity`):
```json
{
  "error": "ticket_invalid",
  "message": "Ticket has been refunded and is no longer valid.",
  "ticket_status": "refunded"
}
```

### Verify Ticket (Without Check-in)

**POST** `/tickets/:id/verify`

Validates the credential without recording a check-in. Useful for pre-screening or secondary checkpoints.

```bash
curl -X POST https://api.atlas-protocol.io/v1/tickets/tic_p6q7r8s9/verify \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "ticket_id": "tic_p6q7r8s9",
  "valid": true,
  "status": "valid",
  "event_id": "evt_a1b2c3d4",
  "event_title": "Berghain Closing Party",
  "ticket_type": "Early Bird",
  "attendee": { "name": "Alex Techno" },
  "checked_in": false
}
```

### Check-in Analytics (Real-Time)

**GET** `/events/:event_id/checkin-stats`

```bash
curl https://api.atlas-protocol.io/v1/events/evt_a1b2c3d4/checkin-stats \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "event_id": "evt_a1b2c3d4",
  "total_tickets": 847,
  "checked_in": 423,
  "check_in_rate": 0.4994,
  "by_ticket_type": [
    { "ticket_type_id": "tkt_r3s4t5u6", "name": "Early Bird", "total": 143, "checked_in": 98 },
    { "ticket_type_id": "tkt_v7w8x9y0", "name": "General Admission", "total": 612, "checked_in": 287 },
    { "ticket_type_id": "tkt_a1b2c3d4", "name": "VIP", "total": 92, "checked_in": 38 }
  ],
  "by_checkpoint": [
    { "checkpoint": "main-entrance", "count": 398 },
    { "checkpoint": "vip-entrance", "count": 25 }
  ],
  "time_series": [
    { "time": "2026-06-20T23:00:00Z", "count": 45 },
    { "time": "2026-06-20T23:15:00Z", "count": 112 },
    { "time": "2026-06-20T23:30:00Z", "count": 89 },
    { "time": "2026-06-20T23:45:00Z", "count": 67 },
    { "time": "2026-06-21T00:00:00Z", "count": 53 },
    { "time": "2026-06-21T00:15:00Z", "count": 34 },
    { "time": "2026-06-21T00:30:00Z", "count": 23 }
  ],
  "updated_at": "2026-06-21T00:35:00Z"
}
```

---

## Payment API

### Setup Payment Account

**POST** `/payment-accounts`

Connect an organizer's payment destination.

**Tempo (USDC) wallet:**

```bash
curl -X POST https://api.atlas-protocol.io/v1/payment-accounts \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "organizer_id": "org_9f8e7d6c",
    "type": "tempo",
    "wallet_address": "0xOrganizerWalletAddress...",
    "chain": "tempo"
  }'
```

**Response** `201 Created`:

```json
{
  "id": "pac_x4y5z6a7",
  "organizer_id": "org_9f8e7d6c",
  "type": "tempo",
  "wallet_address": "0xOrganizerWalletAddress...",
  "chain": "tempo",
  "status": "active",
  "created_at": "2026-03-19T10:00:00Z"
}
```

**Stripe connected account:**

```bash
curl -X POST https://api.atlas-protocol.io/v1/payment-accounts \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "organizer_id": "org_9f8e7d6c",
    "type": "stripe",
    "return_url": "https://berlintechno.events/settings/payments",
    "refresh_url": "https://berlintechno.events/settings/payments?retry=true"
  }'
```

**Response** `201 Created`:

```json
{
  "id": "pac_b8c9d0e1",
  "organizer_id": "org_9f8e7d6c",
  "type": "stripe",
  "status": "pending_onboarding",
  "onboarding_url": "https://connect.stripe.com/setup/s/abc123...",
  "created_at": "2026-03-19T10:00:00Z"
}
```

### Get Payment Account

**GET** `/payment-accounts/:id`

```bash
curl https://api.atlas-protocol.io/v1/payment-accounts/pac_x4y5z6a7 \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "id": "pac_x4y5z6a7",
  "organizer_id": "org_9f8e7d6c",
  "type": "tempo",
  "wallet_address": "0xOrganizerWalletAddress...",
  "chain": "tempo",
  "status": "active",
  "total_received": "12450.00",
  "currency": "USDC",
  "created_at": "2026-03-19T10:00:00Z"
}
```

### Transaction History

**GET** `/transactions`

Query parameters: `event_id`, `organizer_id`, `payment_method` (`tempo`, `stripe`), `status` (`completed`, `pending`, `failed`, `refunded`), `start_date`, `end_date`, `limit`, `cursor`.

```bash
curl "https://api.atlas-protocol.io/v1/transactions?event_id=evt_a1b2c3d4&status=completed&limit=20" \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "data": [
    {
      "id": "txn_f2g3h4i5",
      "checkout_id": "chk_l2m3n4o5",
      "event_id": "evt_a1b2c3d4",
      "organizer_id": "org_9f8e7d6c",
      "payment_method": "tempo",
      "amount": 26.25,
      "currency": "USD",
      "breakdown": {
        "ticket_price": 25.00,
        "platform_fee": 0.75,
        "protocol_fee": 0.50,
        "organizer_payout": 24.50,
        "processing_fee": 0.00
      },
      "status": "completed",
      "tempo_tx_hash": "0xabc123...",
      "settled_at": "2026-03-19T10:51:05Z",
      "created_at": "2026-03-19T10:51:00Z"
    },
    {
      "id": "txn_j6k7l8m9",
      "checkout_id": "chk_h8i9j0k1",
      "event_id": "evt_a1b2c3d4",
      "organizer_id": "org_9f8e7d6c",
      "payment_method": "stripe",
      "amount": 52.50,
      "currency": "USD",
      "breakdown": {
        "ticket_price": 50.00,
        "platform_fee": 1.50,
        "protocol_fee": 1.00,
        "organizer_payout": 47.50,
        "processing_fee": 1.82
      },
      "status": "completed",
      "stripe_payment_intent": "pi_abc123...",
      "settled_at": null,
      "settlement_eta": "2026-03-26T00:00:00Z",
      "created_at": "2026-03-19T10:52:00Z"
    }
  ],
  "pagination": {
    "has_more": false,
    "next_cursor": null,
    "total": 2
  }
}
```

### Settlement Status

**GET** `/settlements`

Query parameters: `organizer_id`, `status` (`pending`, `processing`, `completed`, `failed`), `payment_method`, `limit`, `cursor`.

```bash
curl "https://api.atlas-protocol.io/v1/settlements?organizer_id=org_9f8e7d6c&status=completed" \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "data": [
    {
      "id": "stl_n0o1p2q3",
      "organizer_id": "org_9f8e7d6c",
      "payment_method": "tempo",
      "amount": 2450.00,
      "currency": "USDC",
      "transaction_count": 100,
      "destination": "0xOrganizerWalletAddress...",
      "status": "completed",
      "settled_at": "2026-03-18T00:00:05Z",
      "period": {
        "start": "2026-03-17T00:00:00Z",
        "end": "2026-03-17T23:59:59Z"
      }
    }
  ],
  "pagination": { "has_more": false, "next_cursor": null, "total": 1 }
}
```

### Initiate Refund

**POST** `/tickets/:id/refund`

See [Refund Ticket](#refund-ticket) in the Ticketing section.

---

## Analytics API

### Event Analytics

**GET** `/analytics/events/:id`

Query parameters: `period` (`24h`, `7d`, `30d`, `all`), `granularity` (`hour`, `day`, `week`).

```bash
curl "https://api.atlas-protocol.io/v1/analytics/events/evt_a1b2c3d4?period=30d&granularity=day" \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "event_id": "evt_a1b2c3d4",
  "period": "30d",
  "granularity": "day",
  "summary": {
    "total_views": 12847,
    "unique_views": 8932,
    "agent_queries": 3241,
    "tickets_sold": 847,
    "conversion_rate": 0.0659,
    "gross_revenue": 35680.00,
    "platform_fees": 1070.40,
    "protocol_fees": 713.60,
    "net_to_organizer": 33896.00,
    "currency": "USD"
  },
  "sales_by_type": [
    {
      "ticket_type_id": "tkt_r3s4t5u6",
      "name": "Early Bird",
      "sold": 200,
      "revenue": 5000.00
    },
    {
      "ticket_type_id": "tkt_v7w8x9y0",
      "name": "General Admission",
      "sold": 612,
      "revenue": 27540.00
    },
    {
      "ticket_type_id": "tkt_a1b2c3d4",
      "name": "VIP",
      "sold": 35,
      "revenue": 2800.00
    }
  ],
  "sales_over_time": [
    { "date": "2026-03-01", "tickets": 45, "revenue": 1125.00 },
    { "date": "2026-03-02", "tickets": 32, "revenue": 800.00 },
    { "date": "2026-03-03", "tickets": 67, "revenue": 2345.00 }
  ],
  "traffic_sources": {
    "direct": { "views": 5200, "purchases": 312 },
    "agent_chatgpt": { "views": 1800, "purchases": 89 },
    "agent_claude": { "views": 1100, "purchases": 67 },
    "agent_other": { "views": 341, "purchases": 12 },
    "search": { "views": 2800, "purchases": 201 },
    "social": { "views": 1606, "purchases": 166 }
  },
  "payment_methods": {
    "tempo": { "count": 423, "amount": 17840.00 },
    "stripe": { "count": 424, "amount": 17840.00 }
  },
  "geographic": [
    { "city": "Berlin", "country": "DE", "tickets": 612 },
    { "city": "Hamburg", "country": "DE", "tickets": 89 },
    { "city": "Amsterdam", "country": "NL", "tickets": 45 },
    { "city": "London", "country": "GB", "tickets": 34 }
  ]
}
```

### Platform Analytics

**GET** `/analytics/platform`

Aggregate analytics across your entire platform.

Query parameters: `period` (`24h`, `7d`, `30d`, `90d`, `all`).

```bash
curl "https://api.atlas-protocol.io/v1/analytics/platform?period=30d" \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "platform_id": "plt_x1y2z3",
  "period": "30d",
  "events": {
    "total": 234,
    "published": 198,
    "upcoming": 67,
    "completed": 131
  },
  "tickets": {
    "sold": 28450,
    "checked_in": 21300,
    "refunded": 342
  },
  "revenue": {
    "gross": 1423000.00,
    "platform_fees": 42690.00,
    "protocol_fees": 28460.00,
    "net_to_organizers": 1351850.00,
    "currency": "USD"
  },
  "organizers": {
    "total": 89,
    "active": 67
  },
  "agent_traffic": {
    "total_queries": 45200,
    "agent_purchases": 3400,
    "agent_revenue": 156000.00,
    "agent_share": 0.1096
  }
}
```

### Agent Source Attribution

**GET** `/analytics/agents`

Detailed breakdown of AI agent traffic and conversions.

```bash
curl "https://api.atlas-protocol.io/v1/analytics/agents?period=30d" \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "period": "30d",
  "total_agent_queries": 45200,
  "total_agent_purchases": 3400,
  "total_agent_revenue": 156000.00,
  "by_agent": [
    {
      "agent": "chatgpt",
      "queries": 22000,
      "purchases": 1800,
      "revenue": 82000.00,
      "conversion_rate": 0.0818
    },
    {
      "agent": "claude",
      "queries": 15000,
      "purchases": 1200,
      "revenue": 56000.00,
      "conversion_rate": 0.0800
    },
    {
      "agent": "other",
      "queries": 8200,
      "purchases": 400,
      "revenue": 18000.00,
      "conversion_rate": 0.0488
    }
  ],
  "top_events_by_agent_sales": [
    { "event_id": "evt_a1b2c3d4", "title": "Berghain Closing Party", "agent_sales": 168 },
    { "event_id": "evt_e5f6g7h8", "title": "Tresor Anniversary", "agent_sales": 134 }
  ]
}
```

---

## Organizer API

### Create Organizer

**POST** `/organizers`

```bash
curl -X POST https://api.atlas-protocol.io/v1/organizers \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Berlin Bass Collective",
    "email": "bookings@berlinbass.de",
    "description": "Underground techno events since 2015.",
    "website": "https://berlinbass.de",
    "logo": "https://cdn.berlinbass.de/logo.png",
    "social": {
      "instagram": "@berlinbass",
      "soundcloud": "berlinbasscollective"
    }
  }'
```

**Response** `201 Created`:

```json
{
  "id": "org_9f8e7d6c",
  "name": "Berlin Bass Collective",
  "email": "bookings@berlinbass.de",
  "description": "Underground techno events since 2015.",
  "website": "https://berlinbass.de",
  "logo": "https://cdn.berlinbass.de/logo.png",
  "social": {
    "instagram": "@berlinbass",
    "soundcloud": "berlinbasscollective"
  },
  "status": "pending_approval",
  "payment_accounts": [],
  "events_count": 0,
  "total_tickets_sold": 0,
  "created_at": "2026-03-19T10:00:00Z"
}
```

Organizer statuses: `pending_approval`, `active`, `suspended`.

### Get Organizer

**GET** `/organizers/:id`

```bash
curl https://api.atlas-protocol.io/v1/organizers/org_9f8e7d6c \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "id": "org_9f8e7d6c",
  "name": "Berlin Bass Collective",
  "email": "bookings@berlinbass.de",
  "description": "Underground techno events since 2015.",
  "website": "https://berlinbass.de",
  "logo": "https://cdn.berlinbass.de/logo.png",
  "social": {
    "instagram": "@berlinbass",
    "soundcloud": "berlinbasscollective"
  },
  "status": "active",
  "payment_accounts": [
    { "id": "pac_x4y5z6a7", "type": "tempo", "status": "active" },
    { "id": "pac_b8c9d0e1", "type": "stripe", "status": "active" }
  ],
  "events_count": 24,
  "total_tickets_sold": 8920,
  "total_revenue": 312000.00,
  "reward_balance": 156.00,
  "reward_currency": "USDC",
  "created_at": "2026-01-15T10:00:00Z"
}
```

### Update Organizer

**PATCH** `/organizers/:id`

```bash
curl -X PATCH https://api.atlas-protocol.io/v1/organizers/org_9f8e7d6c \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Berlin underground since 2015. Berghain, Tresor, ://about blank.",
    "social": {
      "instagram": "@berlinbass",
      "soundcloud": "berlinbasscollective",
      "resident_advisor": "berlinbasscollective"
    }
  }'
```

**Response** `200 OK`: Updated organizer object.

### List Organizers

**GET** `/organizers`

Query parameters: `status` (`pending_approval`, `active`, `suspended`), `q` (search name/email), `limit`, `cursor`.

```bash
curl "https://api.atlas-protocol.io/v1/organizers?status=active&limit=20" \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "data": [
    {
      "id": "org_9f8e7d6c",
      "name": "Berlin Bass Collective",
      "status": "active",
      "events_count": 24,
      "total_tickets_sold": 8920
    }
  ],
  "pagination": { "has_more": false, "next_cursor": null, "total": 67 }
}
```

### Approve/Suspend Organizer

**POST** `/organizers/:id/approve`

```bash
curl -X POST https://api.atlas-protocol.io/v1/organizers/org_9f8e7d6c/approve \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "id": "org_9f8e7d6c",
  "status": "active",
  "approved_at": "2026-03-19T10:05:00Z"
}
```

**POST** `/organizers/:id/suspend`

```bash
curl -X POST https://api.atlas-protocol.io/v1/organizers/org_9f8e7d6c/suspend \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Violation of platform terms." }'
```

**Response** `200 OK`:

```json
{
  "id": "org_9f8e7d6c",
  "status": "suspended",
  "suspended_at": "2026-03-19T10:05:00Z",
  "reason": "Violation of platform terms."
}
```

### Organizer Payout Settings

**GET** `/organizers/:id/payout-settings`

```bash
curl https://api.atlas-protocol.io/v1/organizers/org_9f8e7d6c/payout-settings \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "organizer_id": "org_9f8e7d6c",
  "preferred_method": "tempo",
  "payment_accounts": [
    {
      "id": "pac_x4y5z6a7",
      "type": "tempo",
      "wallet_address": "0xOrganizerWalletAddress...",
      "status": "active",
      "is_default": true
    },
    {
      "id": "pac_b8c9d0e1",
      "type": "stripe",
      "stripe_account_id": "acct_abc123",
      "status": "active",
      "is_default": false
    }
  ],
  "auto_payout": true,
  "payout_schedule": "daily"
}
```

### Organizer Reward Balance

**GET** `/organizers/:id/rewards`

Atlas rewards organizers for driving agent traffic and cross-platform discovery.

```bash
curl https://api.atlas-protocol.io/v1/organizers/org_9f8e7d6c/rewards \
  -H "Authorization: Bearer atlas_sk_live_abc123"
```

**Response** `200 OK`:

```json
{
  "organizer_id": "org_9f8e7d6c",
  "balance": 156.00,
  "currency": "USDC",
  "lifetime_earned": 892.00,
  "lifetime_withdrawn": 736.00,
  "rewards": [
    { "type": "agent_sale_bonus", "amount": 2.50, "description": "Agent-driven ticket sale", "date": "2026-03-18T14:30:00Z" },
    { "type": "cross_platform_bonus", "amount": 1.00, "description": "Event discovered via Atlas Registry", "date": "2026-03-18T16:00:00Z" }
  ],
  "withdrawal_address": "0xOrganizerWalletAddress..."
}
```

---

## Webhook Events

Register a webhook endpoint to receive real-time event notifications.

### Configure Webhook

**POST** `/webhooks`

```bash
curl -X POST https://api.atlas-protocol.io/v1/webhooks \
  -H "Authorization: Bearer atlas_sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://berlintechno.events/api/webhooks/atlas",
    "events": [
      "ticket.purchased",
      "ticket.refunded",
      "ticket.checked_in",
      "event.published",
      "event.cancelled",
      "payment.settled",
      "payment.failed",
      "organizer.connected",
      "organizer.rewarded"
    ],
    "secret": "whsec_your_signing_secret"
  }'
```

**Response** `201 Created`:

```json
{
  "id": "whk_r4s5t6u7",
  "url": "https://berlintechno.events/api/webhooks/atlas",
  "events": ["ticket.purchased", "ticket.refunded", "..."],
  "status": "active",
  "created_at": "2026-03-19T10:00:00Z"
}
```

### Webhook Payload Format

All webhooks are signed with your webhook secret using HMAC-SHA256.

**Headers:**
```
Atlas-Webhook-Signature: sha256=abc123...
Atlas-Webhook-Timestamp: 1710849600
Atlas-Webhook-Id: whevt_a1b2c3d4
```

### Event Types

#### ticket.purchased

```json
{
  "id": "whevt_a1b2c3d4",
  "type": "ticket.purchased",
  "timestamp": "2026-03-19T10:51:00Z",
  "data": {
    "ticket_id": "tic_p6q7r8s9",
    "ticket_type_id": "tkt_r3s4t5u6",
    "ticket_type_name": "Early Bird",
    "event_id": "evt_a1b2c3d4",
    "event_title": "Berghain Closing Party",
    "checkout_id": "chk_l2m3n4o5",
    "attendee": { "name": "Alex Techno", "email": "buyer@example.com" },
    "amount": 26.25,
    "currency": "USD",
    "payment_method": "tempo",
    "source": "agent_claude"
  }
}
```

#### ticket.refunded

```json
{
  "id": "whevt_e5f6g7h8",
  "type": "ticket.refunded",
  "timestamp": "2026-03-19T12:00:00Z",
  "data": {
    "ticket_id": "tic_p6q7r8s9",
    "refund_id": "ref_t0u1v2w3",
    "event_id": "evt_a1b2c3d4",
    "amount": 26.25,
    "currency": "USD",
    "reason": "attendee_request"
  }
}
```

#### ticket.checked_in

```json
{
  "id": "whevt_i9j0k1l2",
  "type": "ticket.checked_in",
  "timestamp": "2026-06-20T23:15:00Z",
  "data": {
    "ticket_id": "tic_p6q7r8s9",
    "event_id": "evt_a1b2c3d4",
    "attendee": { "name": "Alex Techno" },
    "checkpoint": "main-entrance",
    "operator_id": "staff_001"
  }
}
```

#### event.published

```json
{
  "id": "whevt_m3n4o5p6",
  "type": "event.published",
  "timestamp": "2026-03-19T10:30:00Z",
  "data": {
    "event_id": "evt_a1b2c3d4",
    "title": "Berghain Closing Party",
    "registry_id": "reg_m4n5o6p7",
    "organizer_id": "org_9f8e7d6c",
    "start_at": "2026-06-20T23:00:00Z"
  }
}
```

#### event.cancelled

```json
{
  "id": "whevt_q7r8s9t0",
  "type": "event.cancelled",
  "timestamp": "2026-03-19T11:00:00Z",
  "data": {
    "event_id": "evt_a1b2c3d4",
    "title": "Berghain Closing Party",
    "reason": "Venue unavailable due to construction.",
    "refunds_initiated": 847
  }
}
```

#### payment.settled

```json
{
  "id": "whevt_u1v2w3x4",
  "type": "payment.settled",
  "timestamp": "2026-03-19T10:51:05Z",
  "data": {
    "transaction_id": "txn_f2g3h4i5",
    "organizer_id": "org_9f8e7d6c",
    "amount": 24.50,
    "currency": "USD",
    "payment_method": "tempo",
    "destination": "0xOrganizerWalletAddress..."
  }
}
```

#### payment.failed

```json
{
  "id": "whevt_y5z6a7b8",
  "type": "payment.failed",
  "timestamp": "2026-03-19T10:51:10Z",
  "data": {
    "checkout_id": "chk_h8i9j0k1",
    "event_id": "evt_a1b2c3d4",
    "payment_method": "stripe",
    "failure_reason": "card_declined",
    "failure_code": "insufficient_funds"
  }
}
```

#### organizer.connected

```json
{
  "id": "whevt_c9d0e1f2",
  "type": "organizer.connected",
  "timestamp": "2026-03-19T10:00:00Z",
  "data": {
    "organizer_id": "org_9f8e7d6c",
    "name": "Berlin Bass Collective",
    "status": "pending_approval"
  }
}
```

#### organizer.rewarded

```json
{
  "id": "whevt_g3h4i5j6",
  "type": "organizer.rewarded",
  "timestamp": "2026-03-18T14:30:00Z",
  "data": {
    "organizer_id": "org_9f8e7d6c",
    "reward_type": "agent_sale_bonus",
    "amount": 2.50,
    "currency": "USDC",
    "new_balance": 156.00,
    "trigger": "Agent-driven ticket sale for evt_a1b2c3d4"
  }
}
```

### Verifying Webhook Signatures

```typescript
import crypto from 'crypto';

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(`sha256=${expected}`),
    Buffer.from(signature)
  );
}

// In your webhook handler:
app.post('/api/webhooks/atlas', (req, res) => {
  const signature = req.headers['atlas-webhook-signature'];
  const payload = JSON.stringify(req.body);

  if (!verifyWebhook(payload, signature, process.env.ATLAS_WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  const event = req.body;
  switch (event.type) {
    case 'ticket.purchased':
      handleTicketPurchased(event.data);
      break;
    case 'ticket.checked_in':
      handleCheckin(event.data);
      break;
    // ...
  }

  res.status(200).send('OK');
});
```

---

## Rate Limits

| Tier | Requests/min | Burst (requests/sec) | Included |
|------|-------------|---------------------|----------|
| Free | 60 | 5 | Default for new platforms |
| Growth | 600 | 30 | Platforms with >1,000 monthly tickets |
| Scale | 6,000 | 100 | Platforms with >50,000 monthly tickets |
| Enterprise | Custom | Custom | Contact Atlas |

Rate limit headers are included in every response:

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 594
X-RateLimit-Reset: 1710849660
```

When rate limited, you receive `429 Too Many Requests`:

```json
{
  "error": "rate_limit_exceeded",
  "message": "Rate limit exceeded. Retry after 12 seconds.",
  "retry_after": 12
}
```

### Per-Endpoint Limits

Some endpoints have additional limits:

| Endpoint | Additional Limit | Reason |
|----------|-----------------|--------|
| `POST /checkout` | 30/min per IP | Fraud prevention |
| `POST /events/bulk` | 10/min | Resource-intensive |
| `GET /analytics/*` | 30/min | Computation-heavy |

---

## SDKs

### JavaScript / TypeScript (Official)

```bash
npm install @atlas-protocol/sdk
```

```typescript
import { AtlasClient } from '@atlas-protocol/sdk';

const atlas = new AtlasClient({
  apiKey: 'atlas_sk_live_abc123',
  platformId: 'plt_x1y2z3',
});

// Create an event
const event = await atlas.events.create({
  title: 'Berghain Closing Party',
  start_at: '2026-06-20T23:00:00Z',
  end_at: '2026-06-21T23:00:00Z',
  timezone: 'Europe/Berlin',
  venue: {
    name: 'Berghain',
    address: 'Am Wriezener Bhf, 10243 Berlin',
    city: 'Berlin',
    country: 'DE',
  },
  category: 'music',
  organizer_id: 'org_9f8e7d6c',
});

// List events
const events = await atlas.events.list({
  category: 'music',
  city: 'Berlin',
  sort: 'date_asc',
  limit: 20,
});

// Create ticket type
const ticketType = await atlas.ticketTypes.create(event.id, {
  name: 'Early Bird',
  price: 25.00,
  currency: 'USD',
  limit: 200,
});

// Initiate checkout
const checkout = await atlas.checkout.create({
  ticket_type_id: ticketType.id,
  quantity: 2,
  payment_method: 'tempo',
  payer_wallet: '0x1234...',
  attendee: { email: 'buyer@example.com', name: 'Alex' },
});

// Check in a ticket
const checkin = await atlas.tickets.checkin('tic_p6q7r8s9', {
  checkpoint: 'main-entrance',
});

// Get analytics
const analytics = await atlas.analytics.event(event.id, { period: '30d' });
```

### Python (Official)

```bash
pip install atlas-protocol
```

```python
from atlas_protocol import AtlasClient

atlas = AtlasClient(
    api_key="atlas_sk_live_abc123",
    platform_id="plt_x1y2z3",
)

# Create an event
event = atlas.events.create(
    title="Berghain Closing Party",
    start_at="2026-06-20T23:00:00Z",
    end_at="2026-06-21T23:00:00Z",
    timezone="Europe/Berlin",
    venue={
        "name": "Berghain",
        "address": "Am Wriezener Bhf, 10243 Berlin",
        "city": "Berlin",
        "country": "DE",
    },
    category="music",
    organizer_id="org_9f8e7d6c",
)

# List events
events = atlas.events.list(category="music", city="Berlin", limit=20)

# Create ticket type
ticket_type = atlas.ticket_types.create(
    event_id=event.id,
    name="Early Bird",
    price=25.00,
    currency="USD",
    limit=200,
)

# Checkout
checkout = atlas.checkout.create(
    ticket_type_id=ticket_type.id,
    quantity=1,
    payment_method="tempo",
    payer_wallet="0x1234...",
    attendee={"email": "buyer@example.com", "name": "Alex"},
)

# Analytics
analytics = atlas.analytics.event(event.id, period="30d")
print(f"Tickets sold: {analytics.summary.tickets_sold}")
print(f"Revenue: ${analytics.summary.gross_revenue:,.2f}")
```

### Go (Future)

```go
// Coming soon
import "github.com/atlas-protocol/atlas-go"

client := atlas.NewClient("atlas_sk_live_abc123", "plt_x1y2z3")

event, err := client.Events.Create(atlas.CreateEventParams{
    Title:    "Berghain Closing Party",
    StartAt:  "2026-06-20T23:00:00Z",
    // ...
})
```

---

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "error_code",
  "message": "Human-readable description of the error.",
  "details": {}
}
```

### HTTP Status Codes

| Code | Meaning | When |
|------|---------|------|
| `200` | OK | Successful read or update |
| `201` | Created | Successful creation |
| `204` | No Content | Successful deletion |
| `400` | Bad Request | Invalid request body or parameters |
| `401` | Unauthorized | Missing or invalid API key |
| `403` | Forbidden | Insufficient permissions / wrong scope |
| `404` | Not Found | Resource does not exist |
| `409` | Conflict | Duplicate operation (e.g., double check-in) |
| `422` | Unprocessable Entity | Validation error (e.g., ticket already refunded) |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Server-side error (retry with backoff) |

### Common Error Codes

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `invalid_request` | 400 | Malformed JSON or missing required fields |
| `invalid_parameter` | 400 | Parameter value out of range or wrong type |
| `unauthorized` | 401 | Invalid or expired API key / JWT |
| `forbidden` | 403 | API key lacks required scope |
| `not_found` | 404 | Resource does not exist or belongs to another platform |
| `already_checked_in` | 409 | Ticket was already checked in |
| `ticket_invalid` | 422 | Ticket is refunded, cancelled, or expired |
| `insufficient_inventory` | 422 | Not enough tickets available |
| `hold_expired` | 422 | Hold has expired, tickets released |
| `event_not_published` | 422 | Action requires a published event |
| `sale_not_active` | 422 | Ticket type not currently on sale |
| `rate_limit_exceeded` | 429 | Too many requests |
| `internal_error` | 500 | Server error — retry with exponential backoff |

### Validation Error Example

```json
{
  "error": "invalid_request",
  "message": "Validation failed for 2 fields.",
  "details": {
    "fields": [
      { "field": "start_at", "message": "Must be a valid ISO 8601 datetime in the future." },
      { "field": "venue.country", "message": "Must be a valid ISO 3166-1 alpha-2 country code." }
    ]
  }
}
```

### Retry Strategy

For `429` and `5xx` errors, implement exponential backoff:

```typescript
async function atlasRequest(fn: () => Promise<any>, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 || error.status >= 500) {
        if (attempt === maxRetries) throw error;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw error;
      }
    }
  }
}
```
