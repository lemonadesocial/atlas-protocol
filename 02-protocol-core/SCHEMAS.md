# Atlas Protocol — Schema Reference

**Protocol Version:** 1.0
**Date:** 2026-03-19
**Companion to:** [PROTOCOL-SPEC.md](./PROTOCOL-SPEC.md)

This document defines the complete JSON schemas for all Atlas Protocol data structures. Every schema includes field definitions, types, constraints, and a full example. A developer should be able to build a compliant implementation from these schemas alone.

---

## Table of Contents

1. [AtlasManifest](#1-atlasmanifest)
2. [AtlasEvent](#2-atlasevent)
3. [AtlasTicketType](#3-atlastickettype)
4. [AtlasPurchaseChallenge](#4-atlaspurchasechallenge)
5. [AtlasCredential](#5-atlascredential)
6. [AtlasReceipt](#6-atlasreceipt)
7. [AtlasOrganizerProfile](#7-atlasorganizerprofile)
8. [AtlasSearchQuery](#8-atlassearchquery)
9. [AtlasSearchResult](#9-atlassearchresult)
10. [AtlasDiscountValidation](#10-atlasdiscountvalidation)

---

## 1. AtlasManifest

The platform manifest served at `/.well-known/atlas.json`. Declares a platform's Atlas capabilities, endpoints, payment methods, and signing keys.

### 1.1 Field Definitions

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `@context` | string | REQUIRED | Must be `"https://atlas-protocol.org/v1"` | JSON-LD context URL |
| `atlas_version` | string | REQUIRED | Semver MAJOR.MINOR | Protocol version this manifest conforms to |
| `platform` | object | REQUIRED | | Platform identity |
| `platform.name` | string | REQUIRED | 1-128 chars | Human-readable platform name |
| `platform.url` | string (URI) | REQUIRED | Valid HTTPS URL | Platform homepage |
| `platform.logo` | string (URI) | OPTIONAL | Valid HTTPS URL, image/* MIME | Platform logo URL |
| `platform.description` | string | OPTIONAL | Max 512 chars | Platform description |
| `platform.contact_email` | string (email) | OPTIONAL | Valid email | Technical contact |
| `capabilities` | object | REQUIRED | | Feature flags |
| `capabilities.discovery` | boolean | REQUIRED | | Platform serves event data via Atlas endpoints |
| `capabilities.purchase` | boolean | REQUIRED | | Platform supports the Atlas purchase flow |
| `capabilities.refund` | boolean | REQUIRED | | Platform supports programmatic refunds |
| `capabilities.holds` | boolean | REQUIRED | | Platform supports inventory holds |
| `capabilities.oauth_connect` | boolean | REQUIRED | | Platform supports organizer OAuth connections |
| `capabilities.webhooks` | boolean | OPTIONAL | Default: false | Platform sends webhook notifications |
| `endpoints` | object | REQUIRED | | API endpoint URLs |
| `endpoints.events` | string (URI) | REQUIRED | HTTPS URL | List/get events endpoint |
| `endpoints.search` | string (URI) | OPTIONAL | HTTPS URL | Search endpoint (if different from events) |
| `endpoints.purchase` | string (URI template) | REQUIRED if purchase=true | HTTPS URL with `{event_id}` | Purchase endpoint template |
| `endpoints.receipt_verify` | string (URI template) | REQUIRED if purchase=true | HTTPS URL with `{receipt_id}` | Receipt verification endpoint |
| `endpoints.webhooks` | string (URI) | OPTIONAL | HTTPS URL | Webhook registration endpoint |
| `endpoints.oauth` | string (URI) | OPTIONAL | HTTPS URL | OAuth authorization endpoint |
| `payment_methods` | array of string | REQUIRED | At least one of: `"tempo_usdc"`, `"stripe_spt"`, `"lightning"` | Accepted payment methods |
| `fee_schedule` | object | REQUIRED | | Fee structure |
| `fee_schedule.protocol_fee_percent` | number | REQUIRED | Must be 2.0 for Atlas v1 | Atlas protocol fee percentage |
| `fee_schedule.platform_fee_percent` | number | REQUIRED | 0-50 | Platform's own fee percentage |
| `fee_schedule.payment_processing_note` | string | OPTIONAL | Max 256 chars | Note about payment processing fees |
| `signing_keys` | array of JWK | REQUIRED | At least one key | Public keys for receipt verification (JWK format) |
| `signing_keys[].kid` | string | REQUIRED | Unique within array | Key identifier |
| `signing_keys[].kty` | string | REQUIRED | Must be `"EC"` | Key type |
| `signing_keys[].crv` | string | REQUIRED | Must be `"P-256"` | Elliptic curve |
| `signing_keys[].x` | string | REQUIRED | Base64url | X coordinate |
| `signing_keys[].y` | string | REQUIRED | Base64url | Y coordinate |
| `rate_limits` | object | OPTIONAL | | Published rate limits |
| `rate_limits.search_per_minute` | integer | OPTIONAL | | Search requests per minute per agent |
| `rate_limits.purchase_per_minute` | integer | OPTIONAL | | Purchase requests per minute per agent |

### 1.2 Complete Example

```json
{
  "@context": "https://atlas-protocol.org/v1",
  "atlas_version": "1.0",
  "platform": {
    "name": "Lemonade",
    "url": "https://lemonade.social",
    "logo": "https://lemonade.social/assets/logo.png",
    "description": "Social events platform for communities",
    "contact_email": "atlas-tech@lemonade.social"
  },
  "capabilities": {
    "discovery": true,
    "purchase": true,
    "refund": true,
    "holds": true,
    "oauth_connect": true,
    "webhooks": true
  },
  "endpoints": {
    "events": "https://api.lemonade.social/atlas/v1/events",
    "search": "https://api.lemonade.social/atlas/v1/search",
    "purchase": "https://api.lemonade.social/atlas/v1/events/{event_id}/purchase",
    "receipt_verify": "https://api.lemonade.social/atlas/v1/receipts/{receipt_id}/verify",
    "webhooks": "https://api.lemonade.social/atlas/v1/webhooks",
    "oauth": "https://api.lemonade.social/atlas/v1/oauth/authorize"
  },
  "payment_methods": ["tempo_usdc", "stripe_spt"],
  "fee_schedule": {
    "protocol_fee_percent": 2.0,
    "platform_fee_percent": 3.5,
    "payment_processing_note": "Tempo USDC: <$0.001 per tx. Stripe: 2.9% + $0.30."
  },
  "signing_keys": [
    {
      "kid": "lemonade-atlas-2026-03",
      "kty": "EC",
      "crv": "P-256",
      "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
      "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"
    },
    {
      "kid": "lemonade-atlas-2026-01",
      "kty": "EC",
      "crv": "P-256",
      "x": "WbbaSStuffGoes_hereBase64urlEncoded",
      "y": "AndMoreBase64urlEncodedStuffHere123"
    }
  ],
  "rate_limits": {
    "search_per_minute": 100,
    "purchase_per_minute": 10
  }
}
```

---

## 2. AtlasEvent

A discoverable event in the Atlas network. Extends Schema.org Event with `atlas:` namespace fields.

### 2.1 Field Definitions

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `@context` | object | REQUIRED | Must include Schema.org and Atlas vocab | JSON-LD context |
| `@type` | string | REQUIRED | Must be `"Event"` | Schema.org type |
| `@id` | string (URI) | REQUIRED | Format: `atlas:{platform}:{id}` | Globally unique identifier |
| `name` | string | REQUIRED | 1-256 chars | Event title |
| `description` | string | REQUIRED | Max 10,000 chars | Plain text or sanitized HTML |
| `startDate` | string | REQUIRED | ISO 8601 with timezone | Event start |
| `endDate` | string | OPTIONAL | ISO 8601 with timezone, >= startDate | Event end |
| `location` | object | REQUIRED | Place or VirtualLocation | Event location |
| `location.@type` | string | REQUIRED | `"Place"` or `"VirtualLocation"` | Location type |
| `location.name` | string | REQUIRED if Place | 1-256 chars | Venue name |
| `location.address` | object | REQUIRED if Place | PostalAddress | Structured address |
| `location.address.streetAddress` | string | REQUIRED | | Street address |
| `location.address.addressLocality` | string | REQUIRED | | City |
| `location.address.addressRegion` | string | OPTIONAL | | State/province |
| `location.address.postalCode` | string | OPTIONAL | | Postal code |
| `location.address.addressCountry` | string | REQUIRED | ISO 3166-1 alpha-2 | Country code |
| `location.geo` | object | OPTIONAL | GeoCoordinates | GPS coordinates |
| `location.geo.latitude` | number | REQUIRED if geo | -90 to 90 | Latitude |
| `location.geo.longitude` | number | REQUIRED if geo | -180 to 180 | Longitude |
| `location.url` | string (URI) | REQUIRED if VirtualLocation | Valid URL | Virtual event link |
| `location.atlas:platform` | string | OPTIONAL | | Virtual platform name (e.g., `"zoom"`, `"meet"`) |
| `organizer` | object | REQUIRED | | Event organizer |
| `organizer.@type` | string | REQUIRED | `"Organization"` or `"Person"` | Organizer type |
| `organizer.name` | string | REQUIRED | 1-128 chars | Organizer name |
| `organizer.url` | string (URI) | OPTIONAL | | Organizer website/profile |
| `image` | string (URI) | OPTIONAL | HTTPS URL, image/* MIME | Cover image |
| `url` | string (URI) | OPTIONAL | | Canonical event URL on source platform |
| `eventStatus` | string | OPTIONAL | Schema.org EventStatusType | Default: `"EventScheduled"` |
| `eventAttendanceMode` | string | OPTIONAL | Schema.org enumeration | `"OfflineEventAttendanceMode"`, `"OnlineEventAttendanceMode"`, `"MixedEventAttendanceMode"` |
| `atlas:id` | string | REQUIRED | UUID v7 | Atlas-canonical event ID |
| `atlas:source_platform` | string | REQUIRED | Known platform identifier | Source platform (e.g., `"eventbrite"`, `"luma"`, `"meetup"`, `"atlas_direct"`) |
| `atlas:source_event_id` | string | REQUIRED | Platform-specific ID | Event ID on the source platform |
| `atlas:organizer_id` | string | REQUIRED | UUID v7 | Atlas organizer ID |
| `atlas:organizer_verified` | boolean | REQUIRED | | Organizer verified via OAuth |
| `atlas:categories` | array of string | OPTIONAL | Max 5, from Atlas taxonomy | Event categories |
| `atlas:tags` | array of string | OPTIONAL | Max 20, each max 64 chars | Free-form tags |
| `atlas:availability` | string | REQUIRED | Enum | `"available"`, `"few_remaining"`, `"sold_out"`, `"cancelled"`, `"not_on_sale"` |
| `atlas:price_range` | object | REQUIRED | | Price range summary |
| `atlas:price_range.min_price` | number | REQUIRED | >= 0 | Lowest ticket price |
| `atlas:price_range.max_price` | number | REQUIRED | >= min_price | Highest ticket price |
| `atlas:price_range.currency` | string | REQUIRED | ISO 4217 | Price currency |
| `atlas:price_range.includes_fees` | boolean | REQUIRED | | Whether prices include fees |
| `atlas:ticket_types_count` | integer | REQUIRED | >= 1 | Number of ticket types |
| `atlas:purchase_endpoint` | string (URI) | REQUIRED | HTTPS URL | Purchase flow URL |
| `atlas:currency` | string | REQUIRED | ISO 4217, must be `"USD"` in v1 | Transaction currency |
| `atlas:accepts_payment_methods` | array of string | REQUIRED | At least one | Accepted payment methods |
| `atlas:last_synced` | string | REQUIRED | ISO 8601 | Last sync from source |
| `atlas:created_at` | string | REQUIRED | ISO 8601 | First indexed by Atlas |
| `atlas:updated_at` | string | REQUIRED | ISO 8601 | Last Atlas record update |

### 2.2 Complete Example

```json
{
  "@context": {
    "@vocab": "https://schema.org/",
    "atlas": "https://atlas-protocol.org/v1/vocab#"
  },
  "@type": "Event",
  "@id": "atlas:eventbrite:987654321",
  "name": "SF Web3 Builders Night",
  "description": "Monthly gathering for Web3 developers, designers, and founders in San Francisco. Lightning talks, demos, and networking. Food and drinks provided.",
  "startDate": "2026-04-15T18:00:00-07:00",
  "endDate": "2026-04-15T22:00:00-07:00",
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
  },
  "organizer": {
    "@type": "Organization",
    "name": "SF Builders Collective",
    "url": "https://sfbuilders.xyz"
  },
  "image": "https://img.evbuc.com/https%3A%2F%2Fcdn.evbuc.com%2Fimages%2F987654321%2Fcover.jpg",
  "url": "https://www.eventbrite.com/e/sf-web3-builders-night-987654321",
  "eventStatus": "EventScheduled",
  "eventAttendanceMode": "OfflineEventAttendanceMode",
  "atlas:id": "019514a2-7c3b-7def-8a9b-1234567890ab",
  "atlas:source_platform": "eventbrite",
  "atlas:source_event_id": "987654321",
  "atlas:organizer_id": "019514a2-1111-7def-8a9b-abcdef012345",
  "atlas:organizer_verified": true,
  "atlas:categories": ["technology", "networking", "web3"],
  "atlas:tags": ["builders", "web3", "san-francisco", "monthly", "free-food"],
  "atlas:availability": "available",
  "atlas:price_range": {
    "min_price": 0.00,
    "max_price": 50.00,
    "currency": "USD",
    "includes_fees": false
  },
  "atlas:ticket_types_count": 3,
  "atlas:purchase_endpoint": "https://api.lemonade.social/atlas/v1/events/019514a2-7c3b-7def-8a9b-1234567890ab/purchase",
  "atlas:currency": "USD",
  "atlas:accepts_payment_methods": ["tempo_usdc", "stripe_spt"],
  "atlas:last_synced": "2026-03-19T10:30:00Z",
  "atlas:created_at": "2026-03-01T14:00:00Z",
  "atlas:updated_at": "2026-03-19T10:30:00Z"
}
```

---

## 3. AtlasTicketType

A purchasable ticket type within an event. Includes pricing with full fee breakdown, availability, restrictions, and cancellation policy.

### 3.1 Field Definitions

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `atlas:ticket_type_id` | string | REQUIRED | UUID v7 | Unique ticket type identifier |
| `name` | string | REQUIRED | 1-128 chars | Display name |
| `description` | string | OPTIONAL | Max 1,000 chars | Ticket type description |
| `atlas:event_id` | string | REQUIRED | UUID v7 | Parent event Atlas ID |
| `atlas:pricing` | object | REQUIRED | | Pricing with fee breakdown |
| `atlas:pricing.base_price` | number | REQUIRED | >= 0, max 6 decimal places | Price before fees |
| `atlas:pricing.currency` | string | REQUIRED | ISO 4217 | Currency code |
| `atlas:pricing.fees` | array of Fee | REQUIRED | May be empty | Itemized fees |
| `atlas:pricing.fees[].name` | string | REQUIRED | Machine-readable identifier | Fee name |
| `atlas:pricing.fees[].type` | string | REQUIRED | `"percentage"` or `"fixed"` | Fee calculation type |
| `atlas:pricing.fees[].rate` | number | OPTIONAL | Present if type=percentage | Percentage rate |
| `atlas:pricing.fees[].amount` | number | REQUIRED | >= 0 | Calculated fee amount |
| `atlas:pricing.fees[].description` | string | REQUIRED | Max 128 chars | Human-readable description |
| `atlas:pricing.total_price` | number | REQUIRED | base_price + sum(fees.amount) | Total price including fees |
| `atlas:pricing.fees_total` | number | REQUIRED | sum(fees.amount) | Total fees |
| `atlas:pricing.tax_included` | boolean | REQUIRED | | Whether total includes tax |
| `atlas:pricing.tax_amount` | number or null | REQUIRED | | Tax amount, null if N/A |
| `atlas:availability` | object | REQUIRED | | Inventory status |
| `atlas:availability.status` | string | REQUIRED | Enum | `"available"`, `"few_remaining"`, `"sold_out"`, `"not_on_sale"`, `"hidden"` |
| `atlas:availability.total_quantity` | integer or null | OPTIONAL | >= 0 or null | Total inventory (null = unlimited) |
| `atlas:availability.remaining_quantity` | integer or null | OPTIONAL | >= 0 or null | Remaining inventory |
| `atlas:availability.max_per_order` | integer | REQUIRED | >= 1 | Max per purchase |
| `atlas:availability.min_per_order` | integer | REQUIRED | >= 1 | Min per purchase |
| `atlas:availability.sale_start` | string or null | OPTIONAL | ISO 8601 | Sale start time |
| `atlas:availability.sale_end` | string or null | OPTIONAL | ISO 8601 | Sale end time |
| `atlas:availability.on_sale` | boolean | REQUIRED | | Currently purchasable |
| `atlas:restrictions` | object | OPTIONAL | | Purchase restrictions |
| `atlas:restrictions.age_minimum` | integer or null | OPTIONAL | >= 0 | Minimum age |
| `atlas:restrictions.age_maximum` | integer or null | OPTIONAL | | Maximum age |
| `atlas:restrictions.requires_approval` | boolean | OPTIONAL | Default: false | Organizer must approve |
| `atlas:restrictions.requires_invitation_code` | boolean | OPTIONAL | Default: false | Invitation code needed |
| `atlas:restrictions.geographic_restrictions` | array of string | OPTIONAL | ISO 3166-1 alpha-2 | Allowed countries |
| `atlas:restrictions.requires_identity_verification` | boolean | OPTIONAL | Default: false | ID verification needed |
| `atlas:restrictions.transferable` | boolean | OPTIONAL | Default: true | Ticket can be transferred |
| `atlas:restrictions.resellable` | boolean | OPTIONAL | Default: false | Ticket can be resold |
| `atlas:restrictions.custom_restrictions` | array of string | OPTIONAL | Max 10, each max 256 chars | Free-text restrictions |
| `atlas:cancellation_policy` | object | REQUIRED | | Refund/cancellation terms |
| `atlas:cancellation_policy.refundable` | boolean | REQUIRED | | Any refund possible |
| `atlas:cancellation_policy.refund_type` | string | REQUIRED | `"full"`, `"partial"`, `"none"` | Refund type |
| `atlas:cancellation_policy.refund_deadline` | string or null | REQUIRED | ISO 8601 or null | Last refund date |
| `atlas:cancellation_policy.partial_refund_schedule` | array or null | OPTIONAL | | Tiered refund schedule |
| `atlas:cancellation_policy.cancellation_fee` | number | REQUIRED | >= 0 | Cancellation processing fee |
| `atlas:cancellation_policy.policy_text` | string | REQUIRED | Max 1,000 chars | Human-readable policy |
| `atlas:cancellation_policy.organizer_cancellation_refund` | string | REQUIRED | Enum | `"automatic_full"`, `"manual_review"`, `"credit_only"` |
| `atlas:accepted_payment_methods` | array of string | REQUIRED | At least one | Payment methods for this ticket |
| `atlas:metadata` | object | OPTIONAL | Max 20 keys, values max 1,000 chars | Arbitrary key-value data |

### 3.2 Complete Example

```json
{
  "atlas:ticket_type_id": "019514a2-aaaa-7def-8a9b-111111111111",
  "name": "General Admission",
  "description": "Standard entry with access to all talks and networking area. Includes food and one drink.",
  "atlas:event_id": "019514a2-7c3b-7def-8a9b-1234567890ab",
  "atlas:pricing": {
    "base_price": 25.00,
    "currency": "USD",
    "fees": [
      {
        "name": "atlas_protocol_fee",
        "type": "percentage",
        "rate": 2.0,
        "amount": 0.50,
        "description": "Atlas Protocol fee (2%)"
      },
      {
        "name": "platform_fee",
        "type": "percentage",
        "rate": 3.5,
        "amount": 0.88,
        "description": "Lemonade platform fee"
      },
      {
        "name": "payment_processing",
        "type": "fixed",
        "amount": 0.001,
        "description": "Tempo USDC transaction fee"
      }
    ],
    "total_price": 26.381,
    "fees_total": 1.381,
    "tax_included": false,
    "tax_amount": null
  },
  "atlas:availability": {
    "status": "available",
    "total_quantity": 300,
    "remaining_quantity": 187,
    "max_per_order": 5,
    "min_per_order": 1,
    "sale_start": "2026-03-01T00:00:00Z",
    "sale_end": "2026-04-15T17:00:00Z",
    "on_sale": true
  },
  "atlas:restrictions": {
    "age_minimum": 18,
    "age_maximum": null,
    "requires_approval": false,
    "requires_invitation_code": false,
    "geographic_restrictions": [],
    "requires_identity_verification": false,
    "transferable": true,
    "resellable": false,
    "custom_restrictions": []
  },
  "atlas:cancellation_policy": {
    "refundable": true,
    "refund_type": "full",
    "refund_deadline": "2026-04-14T18:00:00-07:00",
    "partial_refund_schedule": null,
    "cancellation_fee": 0,
    "policy_text": "Full refund available up to 24 hours before the event. No refunds after that.",
    "organizer_cancellation_refund": "automatic_full"
  },
  "atlas:accepted_payment_methods": ["tempo_usdc", "stripe_spt"],
  "atlas:metadata": {
    "source_ticket_class_id": "tc_eventbrite_555",
    "includes_food": "true",
    "drink_tickets": "1"
  }
}
```

### 3.3 Additional Example: VIP Ticket with Partial Refund Schedule

```json
{
  "atlas:ticket_type_id": "019514a2-bbbb-7def-8a9b-222222222222",
  "name": "VIP Experience",
  "description": "Premium access including front-row seating, private networking lounge, premium bar, and exclusive swag bag.",
  "atlas:event_id": "019514a2-7c3b-7def-8a9b-1234567890ab",
  "atlas:pricing": {
    "base_price": 150.00,
    "currency": "USD",
    "fees": [
      {
        "name": "atlas_protocol_fee",
        "type": "percentage",
        "rate": 2.0,
        "amount": 3.00,
        "description": "Atlas Protocol fee (2%)"
      },
      {
        "name": "platform_fee",
        "type": "percentage",
        "rate": 3.5,
        "amount": 5.25,
        "description": "Lemonade platform fee"
      },
      {
        "name": "payment_processing",
        "type": "fixed",
        "amount": 0.001,
        "description": "Tempo USDC transaction fee"
      }
    ],
    "total_price": 158.251,
    "fees_total": 8.251,
    "tax_included": false,
    "tax_amount": null
  },
  "atlas:availability": {
    "status": "few_remaining",
    "total_quantity": 50,
    "remaining_quantity": 4,
    "max_per_order": 2,
    "min_per_order": 1,
    "sale_start": "2026-03-01T00:00:00Z",
    "sale_end": "2026-04-14T00:00:00Z",
    "on_sale": true
  },
  "atlas:restrictions": {
    "age_minimum": 21,
    "age_maximum": null,
    "requires_approval": false,
    "requires_invitation_code": false,
    "geographic_restrictions": [],
    "requires_identity_verification": true,
    "transferable": false,
    "resellable": false,
    "custom_restrictions": ["Valid government-issued photo ID required at check-in"]
  },
  "atlas:cancellation_policy": {
    "refundable": true,
    "refund_type": "partial",
    "refund_deadline": "2026-04-14T18:00:00-07:00",
    "partial_refund_schedule": [
      {
        "before": "2026-04-01T00:00:00-07:00",
        "refund_percent": 100,
        "description": "Full refund before April 1"
      },
      {
        "before": "2026-04-10T00:00:00-07:00",
        "refund_percent": 50,
        "description": "50% refund April 1-10"
      },
      {
        "before": "2026-04-14T18:00:00-07:00",
        "refund_percent": 25,
        "description": "25% refund April 10-14"
      }
    ],
    "cancellation_fee": 5.00,
    "policy_text": "Full refund before April 1. 50% refund April 1-10. 25% refund April 10-14. $5 processing fee applies to all refunds. No refunds after April 14.",
    "organizer_cancellation_refund": "automatic_full"
  },
  "atlas:accepted_payment_methods": ["tempo_usdc", "stripe_spt"],
  "atlas:metadata": {
    "includes_lounge": "true",
    "includes_swag": "true",
    "drink_tickets": "unlimited"
  }
}
```

### 3.4 Additional Example: Free Ticket

```json
{
  "atlas:ticket_type_id": "019514a2-cccc-7def-8a9b-333333333333",
  "name": "Community (Free)",
  "description": "Free entry for community members. Standing room.",
  "atlas:event_id": "019514a2-7c3b-7def-8a9b-1234567890ab",
  "atlas:pricing": {
    "base_price": 0,
    "currency": "USD",
    "fees": [],
    "total_price": 0,
    "fees_total": 0,
    "tax_included": false,
    "tax_amount": null
  },
  "atlas:availability": {
    "status": "available",
    "total_quantity": 150,
    "remaining_quantity": 98,
    "max_per_order": 2,
    "min_per_order": 1,
    "sale_start": "2026-03-10T00:00:00Z",
    "sale_end": "2026-04-15T18:00:00Z",
    "on_sale": true
  },
  "atlas:restrictions": {
    "age_minimum": null,
    "age_maximum": null,
    "requires_approval": true,
    "requires_invitation_code": false,
    "geographic_restrictions": [],
    "requires_identity_verification": false,
    "transferable": true,
    "resellable": false,
    "custom_restrictions": ["Subject to organizer approval"]
  },
  "atlas:cancellation_policy": {
    "refundable": false,
    "refund_type": "none",
    "refund_deadline": null,
    "partial_refund_schedule": null,
    "cancellation_fee": 0,
    "policy_text": "Free ticket. Cancel anytime by contacting the organizer.",
    "organizer_cancellation_refund": "automatic_full"
  },
  "atlas:accepted_payment_methods": [],
  "atlas:metadata": {}
}
```

---

## 4. AtlasPurchaseChallenge

The 402 Payment Required response body. Contains the payment challenge, hold information, and available payment methods.

### 4.1 Field Definitions

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `atlas:challenge` | object | REQUIRED | | Root challenge object |
| `atlas:challenge.challenge_id` | string | REQUIRED | Unique, prefixed `ch_` | Challenge identifier |
| `atlas:challenge.ticket_hold_id` | string | REQUIRED | Unique, prefixed `hold_` | Associated inventory hold |
| `atlas:challenge.hold_expires_at` | string | REQUIRED | ISO 8601, future | Hold expiration timestamp |
| `atlas:challenge.hold_ttl_seconds` | integer | REQUIRED | >= 300 | Hold duration in seconds |
| `atlas:challenge.pricing` | object | REQUIRED | | Price breakdown for this purchase |
| `atlas:challenge.pricing.base_price` | number | REQUIRED | >= 0 | Total base price (unit * qty) |
| `atlas:challenge.pricing.fees_total` | number | REQUIRED | >= 0 | Total fees |
| `atlas:challenge.pricing.total_price` | number | REQUIRED | base_price + fees_total | Amount to pay |
| `atlas:challenge.pricing.currency` | string | REQUIRED | ISO 4217 | Currency |
| `atlas:challenge.pricing.fees` | array of object | REQUIRED | | Fee line items |
| `atlas:challenge.pricing.quantity` | integer | REQUIRED | >= 1 | Number of tickets |
| `atlas:challenge.pricing.unit_price` | number | REQUIRED | >= 0 | Price per ticket before fees |
| `atlas:challenge.discount_applied` | object or null | REQUIRED | | Discount details (null if none) |
| `atlas:challenge.discount_applied.code` | string | REQUIRED if present | | Discount code used |
| `atlas:challenge.discount_applied.type` | string | REQUIRED if present | `"percentage"`, `"fixed"`, `"bogo"` | Discount type |
| `atlas:challenge.discount_applied.value` | number | REQUIRED if present | | Discount value (percent or amount) |
| `atlas:challenge.discount_applied.savings` | number | REQUIRED if present | | Total savings amount |
| `atlas:challenge.payment_methods` | array of object | REQUIRED | At least one | Available payment options |
| `atlas:challenge.payment_methods[].type` | string | REQUIRED | `"tempo_usdc"`, `"stripe_spt"`, `"lightning"` | Payment rail |
| `atlas:challenge.required_credential_type` | string | REQUIRED | Must be `"atlas-payment-v1"` | Expected credential format |

**Tempo USDC payment method fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | REQUIRED | `"tempo_usdc"` |
| `network` | string | REQUIRED | `"tempo"` |
| `recipient_address` | string | REQUIRED | USDC recipient address |
| `amount` | string | REQUIRED | Decimal string, exact amount |
| `currency` | string | REQUIRED | `"USDC"` |
| `memo` | string | REQUIRED | `"atlas:{challenge_id}"` |

**Stripe SPT payment method fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | REQUIRED | `"stripe_spt"` |
| `client_secret` | string | REQUIRED | Stripe PaymentIntent client secret |
| `amount` | integer | REQUIRED | Amount in smallest currency unit |
| `currency` | string | REQUIRED | ISO 4217 lowercase |

### 4.2 Complete Example

```json
{
  "atlas:challenge": {
    "challenge_id": "ch_019514a3-dddd-7def-8a9b-444444444444",
    "ticket_hold_id": "hold_019514a3-eeee-7def-8a9b-555555555555",
    "hold_expires_at": "2026-03-19T12:05:00Z",
    "hold_ttl_seconds": 300,
    "pricing": {
      "quantity": 2,
      "unit_price": 25.00,
      "base_price": 50.00,
      "fees_total": 2.762,
      "total_price": 52.762,
      "currency": "USD",
      "fees": [
        {
          "name": "atlas_protocol_fee",
          "amount": 1.00,
          "description": "Atlas Protocol fee (2%)"
        },
        {
          "name": "platform_fee",
          "amount": 1.76,
          "description": "Lemonade platform fee (3.5%)"
        },
        {
          "name": "payment_processing",
          "amount": 0.002,
          "description": "Tempo USDC transaction fee"
        }
      ]
    },
    "discount_applied": null,
    "payment_methods": [
      {
        "type": "tempo_usdc",
        "network": "tempo",
        "recipient_address": "0x1a2b3c4d5e6f7890abcdef1234567890abcdef12",
        "amount": "52.762",
        "currency": "USDC",
        "memo": "atlas:ch_019514a3-dddd-7def-8a9b-444444444444"
      },
      {
        "type": "stripe_spt",
        "client_secret": "pi_3PqRsT4U5v6W7x8y_secret_AbCdEfGhIjKlMnOp",
        "amount": 5276,
        "currency": "usd"
      }
    ],
    "required_credential_type": "atlas-payment-v1"
  }
}
```

---

## 5. AtlasCredential

The payment credential sent in the Phase 2 `Authorization` header and request body to prove payment.

### 5.1 Authorization Header Format

```
Authorization: Atlas-Payment v1; credential="{base64url_encoded_jws}"
```

The credential is a JWS (JSON Web Signature) compact serialization containing:

### 5.2 JWS Payload Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `iss` | string | REQUIRED | Agent ID (`Atlas-Agent-Id`) |
| `sub` | string | REQUIRED | Challenge ID |
| `aud` | string | REQUIRED | Platform domain (e.g., `"api.lemonade.social"`) |
| `iat` | integer | REQUIRED | Issued-at timestamp (Unix epoch) |
| `exp` | integer | REQUIRED | Expiration (MUST be <= hold_expires_at) |
| `atlas:payment_type` | string | REQUIRED | Payment method used |
| `atlas:transaction_ref` | string | REQUIRED | Transaction hash or payment intent ID |
| `atlas:amount` | string | REQUIRED | Amount paid (decimal string) |
| `atlas:currency` | string | REQUIRED | Currency paid |

### 5.3 Request Body Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `challenge_id` | string | REQUIRED | Challenge ID from Phase 1 |
| `ticket_hold_id` | string | REQUIRED | Hold ID from Phase 1 |
| `payment_proof` | object | REQUIRED | Payment verification data |
| `payment_proof.type` | string | REQUIRED | Payment method type |
| `payment_proof.transaction_hash` | string | REQUIRED if tempo_usdc | On-chain tx hash |
| `payment_proof.network` | string | REQUIRED if tempo_usdc | Network name |
| `payment_proof.amount` | string | REQUIRED | Amount paid (decimal string) |
| `payment_proof.currency` | string | REQUIRED | Currency |
| `payment_proof.payer_address` | string | REQUIRED if tempo_usdc | Sender address |
| `payment_proof.payment_intent_id` | string | REQUIRED if stripe_spt | Stripe PaymentIntent ID |
| `payment_proof.status` | string | REQUIRED if stripe_spt | Must be `"succeeded"` |

### 5.4 Complete Example: Tempo USDC

**JWS Payload (before signing):**
```json
{
  "iss": "agt_019514a2-ffff-7def-8a9b-666666666666",
  "sub": "ch_019514a3-dddd-7def-8a9b-444444444444",
  "aud": "api.lemonade.social",
  "iat": 1742385683,
  "exp": 1742385983,
  "atlas:payment_type": "tempo_usdc",
  "atlas:transaction_ref": "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
  "atlas:amount": "52.762",
  "atlas:currency": "USDC"
}
```

**Full request body:**
```json
{
  "challenge_id": "ch_019514a3-dddd-7def-8a9b-444444444444",
  "ticket_hold_id": "hold_019514a3-eeee-7def-8a9b-555555555555",
  "payment_proof": {
    "type": "tempo_usdc",
    "transaction_hash": "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    "network": "tempo",
    "amount": "52.762",
    "currency": "USDC",
    "payer_address": "0x9876543210fedcba9876543210fedcba98765432"
  }
}
```

### 5.5 Complete Example: Stripe SPT

**Full request body:**
```json
{
  "challenge_id": "ch_019514a3-dddd-7def-8a9b-444444444444",
  "ticket_hold_id": "hold_019514a3-eeee-7def-8a9b-555555555555",
  "payment_proof": {
    "type": "stripe_spt",
    "payment_intent_id": "pi_3PqRsT4U5v6W7x8y",
    "status": "succeeded",
    "amount": "52.76",
    "currency": "usd"
  }
}
```

---

## 6. AtlasReceipt

The purchase receipt returned in the 200 response. Contains transaction details and embedded Verifiable Credential tickets.

### 6.1 Field Definitions

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `atlas:receipt` | object | REQUIRED | | Root receipt object |
| `atlas:receipt.receipt_id` | string | REQUIRED | Unique, prefixed `rcpt_` | Receipt identifier |
| `atlas:receipt.status` | string | REQUIRED | `"confirmed"`, `"pending"`, `"failed"` | Receipt status |
| `atlas:receipt.event_id` | string | REQUIRED | UUID v7 | Atlas event ID |
| `atlas:receipt.event_name` | string | REQUIRED | | Event name for display |
| `atlas:receipt.purchase_timestamp` | string | REQUIRED | ISO 8601 | When purchase completed |
| `atlas:receipt.total_charged` | number | REQUIRED | | Total amount charged |
| `atlas:receipt.currency` | string | REQUIRED | ISO 4217 | Currency charged |
| `atlas:receipt.payment_method` | string | REQUIRED | | Payment method used |
| `atlas:receipt.transaction_hash` | string or null | REQUIRED | | On-chain tx hash (null for Stripe) |
| `atlas:receipt.stripe_payment_intent` | string or null | OPTIONAL | | Stripe PI ID (null for USDC) |
| `atlas:receipt.tickets` | array of VC | REQUIRED | | Verifiable Credential tickets |
| `atlas:receipt.rewards` | object | REQUIRED | | USDC reward details |
| `atlas:receipt.rewards.attendee_reward_usdc` | number | REQUIRED | >= 0 | USDC cashback earned |
| `atlas:receipt.rewards.reward_status` | string | REQUIRED | `"pending"`, `"distributed"`, `"ineligible"` | Reward payout status |
| `atlas:receipt.rewards.reward_payout_address` | string or null | REQUIRED | | Address for reward (null if ineligible) |
| `atlas:receipt.rewards.organizer_reward_usdc` | number | OPTIONAL | | Organizer's reward for this sale |

**Embedded ticket (Verifiable Credential) fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `@context` | array | REQUIRED | W3C VC + Atlas contexts |
| `type` | array | REQUIRED | `["VerifiableCredential", "AtlasTicket"]` |
| `id` | string (URN) | REQUIRED | `urn:atlas:ticket:{ticket_id}` |
| `issuer` | string (DID) | REQUIRED | `did:web:{domain}` |
| `issuanceDate` | string | REQUIRED | ISO 8601 |
| `credentialSubject.id` | string (DID) | REQUIRED | Agent or attendee DID |
| `credentialSubject.attendee_name` | string | REQUIRED | Attendee name |
| `credentialSubject.attendee_email` | string | REQUIRED | Attendee email |
| `credentialSubject.event_id` | string | REQUIRED | Atlas event ID |
| `credentialSubject.event_name` | string | REQUIRED | Event name |
| `credentialSubject.ticket_type` | string | REQUIRED | Ticket type name |
| `credentialSubject.ticket_type_id` | string | REQUIRED | Atlas ticket type ID |
| `credentialSubject.valid_from` | string | REQUIRED | ISO 8601 (event start) |
| `credentialSubject.valid_until` | string | REQUIRED | ISO 8601 (event end) |
| `credentialSubject.seat` | string or null | OPTIONAL | Seat assignment |
| `credentialSubject.barcode` | string | REQUIRED | Check-in barcode value |
| `credentialSubject.barcode_format` | string | REQUIRED | `"qr"`, `"code128"`, `"pdf417"` |
| `proof.type` | string | REQUIRED | `"JsonWebSignature2020"` |
| `proof.created` | string | REQUIRED | ISO 8601 |
| `proof.verificationMethod` | string | REQUIRED | DID + key ID |
| `proof.proofPurpose` | string | REQUIRED | `"assertionMethod"` |
| `proof.jws` | string | REQUIRED | JWS compact serialization |

### 6.2 Complete Example

```json
{
  "atlas:receipt": {
    "receipt_id": "rcpt_019514a4-1111-7def-8a9b-aaaaaaaaaaaa",
    "status": "confirmed",
    "event_id": "019514a2-7c3b-7def-8a9b-1234567890ab",
    "event_name": "SF Web3 Builders Night",
    "purchase_timestamp": "2026-03-19T12:01:23Z",
    "total_charged": 52.762,
    "currency": "USD",
    "payment_method": "tempo_usdc",
    "transaction_hash": "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    "stripe_payment_intent": null,
    "tickets": [
      {
        "@context": [
          "https://www.w3.org/2018/credentials/v1",
          "https://atlas-protocol.org/v1/credentials"
        ],
        "type": ["VerifiableCredential", "AtlasTicket"],
        "id": "urn:atlas:ticket:tkt_019514a4-2222-7def-8a9b-bbbbbbbbbbbb",
        "issuer": "did:web:lemonade.social",
        "issuanceDate": "2026-03-19T12:01:23Z",
        "credentialSubject": {
          "id": "did:atlas:agent:agt_019514a2-ffff-7def-8a9b-666666666666",
          "attendee_name": "Alice Johnson",
          "attendee_email": "alice@example.com",
          "event_id": "019514a2-7c3b-7def-8a9b-1234567890ab",
          "event_name": "SF Web3 Builders Night",
          "ticket_type": "General Admission",
          "ticket_type_id": "019514a2-aaaa-7def-8a9b-111111111111",
          "valid_from": "2026-04-15T18:00:00-07:00",
          "valid_until": "2026-04-15T22:00:00-07:00",
          "seat": null,
          "barcode": "ATLAS-TKT-019514A4-2222-001",
          "barcode_format": "qr"
        },
        "proof": {
          "type": "JsonWebSignature2020",
          "created": "2026-03-19T12:01:23Z",
          "verificationMethod": "did:web:lemonade.social#lemonade-atlas-2026-03",
          "proofPurpose": "assertionMethod",
          "jws": "eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il19..SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        }
      },
      {
        "@context": [
          "https://www.w3.org/2018/credentials/v1",
          "https://atlas-protocol.org/v1/credentials"
        ],
        "type": ["VerifiableCredential", "AtlasTicket"],
        "id": "urn:atlas:ticket:tkt_019514a4-3333-7def-8a9b-cccccccccccc",
        "issuer": "did:web:lemonade.social",
        "issuanceDate": "2026-03-19T12:01:23Z",
        "credentialSubject": {
          "id": "did:atlas:agent:agt_019514a2-ffff-7def-8a9b-666666666666",
          "attendee_name": "Bob Smith",
          "attendee_email": "bob@example.com",
          "event_id": "019514a2-7c3b-7def-8a9b-1234567890ab",
          "event_name": "SF Web3 Builders Night",
          "ticket_type": "General Admission",
          "ticket_type_id": "019514a2-aaaa-7def-8a9b-111111111111",
          "valid_from": "2026-04-15T18:00:00-07:00",
          "valid_until": "2026-04-15T22:00:00-07:00",
          "seat": null,
          "barcode": "ATLAS-TKT-019514A4-3333-002",
          "barcode_format": "qr"
        },
        "proof": {
          "type": "JsonWebSignature2020",
          "created": "2026-03-19T12:01:23Z",
          "verificationMethod": "did:web:lemonade.social#lemonade-atlas-2026-03",
          "proofPurpose": "assertionMethod",
          "jws": "eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il19..7ksYn3Pq2WRJZ8xT4fwpMeJf36POk6yJV_adQssw5d"
        }
      }
    ],
    "rewards": {
      "attendee_reward_usdc": 1.055,
      "reward_status": "pending",
      "reward_payout_address": "0x9876543210fedcba9876543210fedcba98765432",
      "organizer_reward_usdc": 0.528
    }
  }
}
```

---

## 7. AtlasOrganizerProfile

An organizer's profile in the Atlas Registry, including connected platform accounts and verification status.

### 7.1 Field Definitions

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `atlas:organizer_id` | string | REQUIRED | UUID v7 | Unique organizer identifier |
| `name` | string | REQUIRED | 1-128 chars | Display name |
| `email` | string | REQUIRED | Valid email | Primary contact email |
| `avatar` | string (URI) | OPTIONAL | HTTPS URL | Profile image |
| `bio` | string | OPTIONAL | Max 1,000 chars | Organizer bio |
| `website` | string (URI) | OPTIONAL | Valid URL | Organizer website |
| `verification_level` | string | REQUIRED | Enum | `"unverified"`, `"connected"`, `"verified"`, `"trusted"` |
| `connected_accounts` | array of object | REQUIRED | | Linked platform accounts |
| `connected_accounts[].platform` | string | REQUIRED | Known platform ID | Platform identifier |
| `connected_accounts[].platform_user_id` | string | REQUIRED | | User ID on platform |
| `connected_accounts[].platform_username` | string | OPTIONAL | | Username on platform |
| `connected_accounts[].connected_at` | string | REQUIRED | ISO 8601 | When OAuth was completed |
| `connected_accounts[].oauth_valid` | boolean | REQUIRED | | Whether OAuth token is currently valid |
| `connected_accounts[].last_sync` | string | REQUIRED | ISO 8601 | Last data sync |
| `connected_accounts[].event_count` | integer | REQUIRED | >= 0 | Number of events from this account |
| `stats` | object | REQUIRED | | Aggregate statistics |
| `stats.total_events` | integer | REQUIRED | >= 0 | Total events across all platforms |
| `stats.active_events` | integer | REQUIRED | >= 0 | Currently active/upcoming events |
| `stats.total_tickets_sold` | integer | REQUIRED | >= 0 | Lifetime tickets sold via Atlas |
| `stats.total_revenue_usdc` | number | REQUIRED | >= 0 | Lifetime revenue via Atlas (USDC) |
| `stats.total_rewards_earned_usdc` | number | REQUIRED | >= 0 | Total USDC rewards earned |
| `stats.member_since` | string | REQUIRED | ISO 8601 | Registration date |
| `stats.disputes` | integer | REQUIRED | >= 0 | Number of disputes filed against |
| `payout_address` | string | REQUIRED if selling | Tempo/USDC address | USDC payout address |
| `stripe_connected_account_id` | string | OPTIONAL | Stripe account ID | For Stripe SPT payouts |
| `atlas:created_at` | string | REQUIRED | ISO 8601 | Profile creation date |
| `atlas:updated_at` | string | REQUIRED | ISO 8601 | Last profile update |

### 7.2 Complete Example

```json
{
  "atlas:organizer_id": "019514a2-1111-7def-8a9b-abcdef012345",
  "name": "SF Builders Collective",
  "email": "events@sfbuilders.xyz",
  "avatar": "https://sfbuilders.xyz/logo-256.png",
  "bio": "We organize monthly meetups for Web3 builders in the San Francisco Bay Area. Tech talks, demos, networking, and good vibes.",
  "website": "https://sfbuilders.xyz",
  "verification_level": "verified",
  "connected_accounts": [
    {
      "platform": "eventbrite",
      "platform_user_id": "eb_user_12345678",
      "platform_username": "sfbuilders",
      "connected_at": "2026-03-01T10:00:00Z",
      "oauth_valid": true,
      "last_sync": "2026-03-19T10:30:00Z",
      "event_count": 12
    },
    {
      "platform": "luma",
      "platform_user_id": "lu_user_abcdef",
      "platform_username": "sf-builders-collective",
      "connected_at": "2026-03-05T14:00:00Z",
      "oauth_valid": true,
      "last_sync": "2026-03-19T10:15:00Z",
      "event_count": 8
    }
  ],
  "stats": {
    "total_events": 20,
    "active_events": 3,
    "total_tickets_sold": 847,
    "total_revenue_usdc": 18240.50,
    "total_rewards_earned_usdc": 364.81,
    "member_since": "2026-03-01T10:00:00Z",
    "disputes": 0
  },
  "payout_address": "0xaabbccdd11223344556677889900aabbccddeeff",
  "stripe_connected_account_id": "acct_1PqRsT4U5v6W7x8y",
  "atlas:created_at": "2026-03-01T10:00:00Z",
  "atlas:updated_at": "2026-03-19T10:30:00Z"
}
```

---

## 8. AtlasSearchQuery

Search request parameters for the federated registry search endpoint.

### 8.1 Endpoint

```
GET /atlas/v1/search
```

All parameters are query string parameters. Complex filters use dot notation.

### 8.2 Field Definitions

| Parameter | Type | Required | Default | Constraints | Description |
|-----------|------|----------|---------|-------------|-------------|
| `q` | string | OPTIONAL | | Max 256 chars | Free-text search query |
| `location` | string | OPTIONAL | | City, region, or country | Location filter (geocoded server-side) |
| `lat` | number | OPTIONAL | | -90 to 90 | Latitude for geo search |
| `lng` | number | OPTIONAL | | -180 to 180 | Longitude for geo search |
| `radius_km` | number | OPTIONAL | 50 | 1-500 | Search radius in kilometers (requires lat/lng) |
| `date_from` | string | OPTIONAL | now | ISO 8601 date or datetime | Earliest event start date |
| `date_to` | string | OPTIONAL | | ISO 8601, >= date_from | Latest event start date |
| `categories` | string | OPTIONAL | | Comma-separated | Filter by Atlas categories |
| `tags` | string | OPTIONAL | | Comma-separated | Filter by tags |
| `price_min` | number | OPTIONAL | 0 | >= 0 | Minimum ticket price (USD) |
| `price_max` | number | OPTIONAL | | >= price_min | Maximum ticket price (USD) |
| `free_only` | boolean | OPTIONAL | false | | Only show free events |
| `availability` | string | OPTIONAL | `"available"` | Comma-separated | Filter by availability status |
| `source_platform` | string | OPTIONAL | | Known platform ID | Filter by source platform |
| `organizer_id` | string | OPTIONAL | | UUID v7 | Filter by organizer |
| `organizer_verified` | boolean | OPTIONAL | | | Only verified organizers |
| `attendance_mode` | string | OPTIONAL | | `"offline"`, `"online"`, `"mixed"` | Event attendance mode |
| `sort` | string | OPTIONAL | `"relevance"` | Enum | Sort order |
| `sort_values` | | | | `"relevance"`, `"date_asc"`, `"date_desc"`, `"price_asc"`, `"price_desc"`, `"distance"`, `"popularity"` | |
| `page` | integer | OPTIONAL | 1 | >= 1 | Page number |
| `per_page` | integer | OPTIONAL | 20 | 1-100 | Results per page |
| `include_sold_out` | boolean | OPTIONAL | false | | Include sold-out events |
| `payment_methods` | string | OPTIONAL | | Comma-separated | Filter by accepted payment method |

### 8.3 Complete Example

```
GET /atlas/v1/search?q=web3+builders&location=san+francisco&lat=37.7749&lng=-122.4194&radius_km=25&date_from=2026-04-01&date_to=2026-04-30&categories=technology,networking&price_max=100&organizer_verified=true&sort=date_asc&per_page=10&payment_methods=tempo_usdc HTTP/1.1
Host: registry.atlas-protocol.org
Atlas-Version: 1.0
Atlas-Agent-Id: agt_019514a2-ffff-7def-8a9b-666666666666
```

Equivalent as structured parameters:

```json
{
  "q": "web3 builders",
  "location": "san francisco",
  "lat": 37.7749,
  "lng": -122.4194,
  "radius_km": 25,
  "date_from": "2026-04-01",
  "date_to": "2026-04-30",
  "categories": "technology,networking",
  "price_max": 100,
  "organizer_verified": true,
  "sort": "date_asc",
  "per_page": 10,
  "payment_methods": "tempo_usdc"
}
```

---

## 9. AtlasSearchResult

The search response format with pagination, result metadata, and an array of events.

### 9.1 Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `atlas:search_result` | object | REQUIRED | Root result object |
| `atlas:search_result.query` | object | REQUIRED | Echo of parsed query parameters |
| `atlas:search_result.total_results` | integer | REQUIRED | Total matching events |
| `atlas:search_result.page` | integer | REQUIRED | Current page number |
| `atlas:search_result.per_page` | integer | REQUIRED | Results per page |
| `atlas:search_result.total_pages` | integer | REQUIRED | Total pages available |
| `atlas:search_result.has_next` | boolean | REQUIRED | Whether more pages exist |
| `atlas:search_result.results` | array of object | REQUIRED | Event results |
| `atlas:search_result.results[].event` | AtlasEvent | REQUIRED | Full event object |
| `atlas:search_result.results[].relevance_score` | number | OPTIONAL | 0.0-1.0, search relevance |
| `atlas:search_result.results[].distance_km` | number | OPTIONAL | Distance from search point |
| `atlas:search_result.results[].source` | string | REQUIRED | How event was discovered: `"registry"`, `"manifest"`, `"dns"` |
| `atlas:search_result.facets` | object | OPTIONAL | Aggregated filter counts |
| `atlas:search_result.facets.categories` | array of object | OPTIONAL | Category counts |
| `atlas:search_result.facets.source_platforms` | array of object | OPTIONAL | Platform counts |
| `atlas:search_result.facets.price_ranges` | array of object | OPTIONAL | Price range counts |
| `atlas:search_result.response_time_ms` | integer | REQUIRED | Server processing time |

### 9.2 Complete Example

```json
{
  "atlas:search_result": {
    "query": {
      "q": "web3 builders",
      "location": "san francisco",
      "lat": 37.7749,
      "lng": -122.4194,
      "radius_km": 25,
      "date_from": "2026-04-01",
      "date_to": "2026-04-30",
      "categories": ["technology", "networking"],
      "price_max": 100,
      "organizer_verified": true,
      "sort": "date_asc",
      "per_page": 10,
      "payment_methods": ["tempo_usdc"]
    },
    "total_results": 23,
    "page": 1,
    "per_page": 10,
    "total_pages": 3,
    "has_next": true,
    "results": [
      {
        "event": {
          "@context": {
            "@vocab": "https://schema.org/",
            "atlas": "https://atlas-protocol.org/v1/vocab#"
          },
          "@type": "Event",
          "@id": "atlas:eventbrite:987654321",
          "name": "SF Web3 Builders Night",
          "description": "Monthly gathering for Web3 developers, designers, and founders in San Francisco.",
          "startDate": "2026-04-15T18:00:00-07:00",
          "endDate": "2026-04-15T22:00:00-07:00",
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
          },
          "organizer": {
            "@type": "Organization",
            "name": "SF Builders Collective",
            "url": "https://sfbuilders.xyz"
          },
          "image": "https://img.evbuc.com/cover-987654321.jpg",
          "url": "https://www.eventbrite.com/e/sf-web3-builders-night-987654321",
          "eventStatus": "EventScheduled",
          "eventAttendanceMode": "OfflineEventAttendanceMode",
          "atlas:id": "019514a2-7c3b-7def-8a9b-1234567890ab",
          "atlas:source_platform": "eventbrite",
          "atlas:source_event_id": "987654321",
          "atlas:organizer_id": "019514a2-1111-7def-8a9b-abcdef012345",
          "atlas:organizer_verified": true,
          "atlas:categories": ["technology", "networking", "web3"],
          "atlas:tags": ["builders", "web3", "san-francisco"],
          "atlas:availability": "available",
          "atlas:price_range": {
            "min_price": 0.00,
            "max_price": 50.00,
            "currency": "USD",
            "includes_fees": false
          },
          "atlas:ticket_types_count": 3,
          "atlas:purchase_endpoint": "https://api.lemonade.social/atlas/v1/events/019514a2-7c3b-7def-8a9b-1234567890ab/purchase",
          "atlas:currency": "USD",
          "atlas:accepts_payment_methods": ["tempo_usdc", "stripe_spt"],
          "atlas:last_synced": "2026-03-19T10:30:00Z",
          "atlas:created_at": "2026-03-01T14:00:00Z",
          "atlas:updated_at": "2026-03-19T10:30:00Z"
        },
        "relevance_score": 0.94,
        "distance_km": 2.3,
        "source": "registry"
      },
      {
        "event": {
          "@context": {
            "@vocab": "https://schema.org/",
            "atlas": "https://atlas-protocol.org/v1/vocab#"
          },
          "@type": "Event",
          "@id": "atlas:luma:evt_abcdef123",
          "name": "DeFi Demo Day — April Edition",
          "description": "Showcase your DeFi project to investors and fellow builders. 5-minute demos, Q&A, and afterparty.",
          "startDate": "2026-04-22T17:00:00-07:00",
          "endDate": "2026-04-22T21:00:00-07:00",
          "location": {
            "@type": "Place",
            "name": "Galvanize SF",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "44 Tehama St",
              "addressLocality": "San Francisco",
              "addressRegion": "CA",
              "postalCode": "94105",
              "addressCountry": "US"
            },
            "geo": {
              "@type": "GeoCoordinates",
              "latitude": 37.7873,
              "longitude": -122.3964
            }
          },
          "organizer": {
            "@type": "Organization",
            "name": "DeFi Builders SF",
            "url": "https://lu.ma/defi-sf"
          },
          "image": "https://images.lumacdn.com/event-covers/defi-demo-day.jpg",
          "url": "https://lu.ma/defi-demo-day-april",
          "eventStatus": "EventScheduled",
          "eventAttendanceMode": "OfflineEventAttendanceMode",
          "atlas:id": "019514b3-aabb-7def-8a9b-ffeeddccbbaa",
          "atlas:source_platform": "luma",
          "atlas:source_event_id": "evt_abcdef123",
          "atlas:organizer_id": "019514b3-0000-7def-8a9b-112233445566",
          "atlas:organizer_verified": true,
          "atlas:categories": ["technology", "networking"],
          "atlas:tags": ["defi", "demo-day", "investors"],
          "atlas:availability": "available",
          "atlas:price_range": {
            "min_price": 25.00,
            "max_price": 25.00,
            "currency": "USD",
            "includes_fees": false
          },
          "atlas:ticket_types_count": 1,
          "atlas:purchase_endpoint": "https://api.lemonade.social/atlas/v1/events/019514b3-aabb-7def-8a9b-ffeeddccbbaa/purchase",
          "atlas:currency": "USD",
          "atlas:accepts_payment_methods": ["tempo_usdc", "stripe_spt"],
          "atlas:last_synced": "2026-03-19T09:45:00Z",
          "atlas:created_at": "2026-03-10T08:00:00Z",
          "atlas:updated_at": "2026-03-19T09:45:00Z"
        },
        "relevance_score": 0.82,
        "distance_km": 4.1,
        "source": "registry"
      }
    ],
    "facets": {
      "categories": [
        {"value": "technology", "count": 18},
        {"value": "networking", "count": 15},
        {"value": "web3", "count": 12},
        {"value": "social", "count": 5}
      ],
      "source_platforms": [
        {"value": "eventbrite", "count": 10},
        {"value": "luma", "count": 8},
        {"value": "atlas_direct", "count": 3},
        {"value": "meetup", "count": 2}
      ],
      "price_ranges": [
        {"value": "free", "count": 7},
        {"value": "1-25", "count": 6},
        {"value": "26-50", "count": 5},
        {"value": "51-100", "count": 5}
      ]
    },
    "response_time_ms": 142
  }
}
```

---

## 10. AtlasDiscountValidation

Request and response format for validating discount codes before or during purchase.

### 10.1 Endpoint

```
POST /atlas/v1/events/{event_id}/discounts/validate
```

### 10.2 Request Field Definitions

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `code` | string | REQUIRED | 1-32 chars, alphanumeric + hyphens | Discount code to validate |
| `ticket_type_id` | string | REQUIRED | UUID v7 | Ticket type to apply discount to |
| `quantity` | integer | REQUIRED | >= 1 | Number of tickets |

### 10.3 Response Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `valid` | boolean | REQUIRED | Whether the discount code is valid |
| `code` | string | REQUIRED | Echo of the submitted code |
| `discount` | object or null | REQUIRED | Discount details (null if invalid) |
| `discount.type` | string | REQUIRED if valid | `"percentage"`, `"fixed"`, `"bogo"` (buy one get one) |
| `discount.value` | number | REQUIRED if valid | Percentage (0-100) or fixed amount |
| `discount.description` | string | REQUIRED if valid | Human-readable description |
| `discount.max_uses` | integer or null | OPTIONAL | Total uses allowed (null = unlimited) |
| `discount.remaining_uses` | integer or null | OPTIONAL | Uses remaining |
| `discount.valid_from` | string or null | OPTIONAL | ISO 8601, discount start |
| `discount.valid_until` | string or null | OPTIONAL | ISO 8601, discount expiry |
| `discount.applicable_ticket_types` | array of string or null | OPTIONAL | Ticket type IDs this applies to (null = all) |
| `discount.minimum_quantity` | integer | OPTIONAL | Min tickets for discount to apply |
| `pricing_preview` | object or null | REQUIRED if valid | Price with discount applied |
| `pricing_preview.original_base_price` | number | REQUIRED | Base price without discount |
| `pricing_preview.discounted_base_price` | number | REQUIRED | Base price after discount |
| `pricing_preview.savings` | number | REQUIRED | Total savings amount |
| `pricing_preview.fees_total` | number | REQUIRED | Fees on discounted price |
| `pricing_preview.total_price` | number | REQUIRED | Final price with discount and fees |
| `pricing_preview.currency` | string | REQUIRED | ISO 4217 |
| `error` | object or null | REQUIRED if invalid | Error details |
| `error.reason` | string | REQUIRED if invalid | `"invalid_code"`, `"expired"`, `"max_uses_reached"`, `"not_applicable"`, `"minimum_not_met"` |
| `error.message` | string | REQUIRED if invalid | Human-readable error |

### 10.4 Complete Example: Valid Discount

**Request:**
```json
{
  "code": "EARLY20",
  "ticket_type_id": "019514a2-aaaa-7def-8a9b-111111111111",
  "quantity": 2
}
```

**Response:**
```json
{
  "valid": true,
  "code": "EARLY20",
  "discount": {
    "type": "percentage",
    "value": 20,
    "description": "Early bird — 20% off",
    "max_uses": 100,
    "remaining_uses": 43,
    "valid_from": "2026-03-01T00:00:00Z",
    "valid_until": "2026-04-01T00:00:00Z",
    "applicable_ticket_types": [
      "019514a2-aaaa-7def-8a9b-111111111111",
      "019514a2-bbbb-7def-8a9b-222222222222"
    ],
    "minimum_quantity": 1
  },
  "pricing_preview": {
    "original_base_price": 50.00,
    "discounted_base_price": 40.00,
    "savings": 10.00,
    "fees_total": 2.221,
    "total_price": 42.221,
    "currency": "USD"
  },
  "error": null
}
```

### 10.5 Complete Example: Invalid Discount

**Request:**
```json
{
  "code": "SUMMER50",
  "ticket_type_id": "019514a2-aaaa-7def-8a9b-111111111111",
  "quantity": 2
}
```

**Response:**
```json
{
  "valid": false,
  "code": "SUMMER50",
  "discount": null,
  "pricing_preview": null,
  "error": {
    "reason": "expired",
    "message": "This discount code expired on 2026-02-28."
  }
}
```

### 10.6 Complete Example: BOGO Discount

**Request:**
```json
{
  "code": "BOGO-APRIL",
  "ticket_type_id": "019514a2-aaaa-7def-8a9b-111111111111",
  "quantity": 2
}
```

**Response:**
```json
{
  "valid": true,
  "code": "BOGO-APRIL",
  "discount": {
    "type": "bogo",
    "value": 1,
    "description": "Buy one, get one free",
    "max_uses": 50,
    "remaining_uses": 12,
    "valid_from": "2026-04-01T00:00:00Z",
    "valid_until": "2026-04-30T23:59:59Z",
    "applicable_ticket_types": null,
    "minimum_quantity": 2
  },
  "pricing_preview": {
    "original_base_price": 50.00,
    "discounted_base_price": 25.00,
    "savings": 25.00,
    "fees_total": 1.381,
    "total_price": 26.381,
    "currency": "USD"
  },
  "error": null
}
```

---

## Appendix A: Atlas Category Taxonomy

The standard categories for `atlas:categories`. Platforms MAY map their own categories to these.

| Category | Description |
|----------|-------------|
| `technology` | Tech meetups, hackathons, conferences |
| `networking` | Professional and social networking |
| `web3` | Blockchain, crypto, DeFi, NFT events |
| `music` | Concerts, festivals, DJ sets |
| `arts` | Visual arts, theater, film |
| `food-drink` | Tastings, food festivals, pop-ups |
| `sports` | Sporting events, fitness, outdoor |
| `education` | Workshops, courses, lectures |
| `business` | Business conferences, trade shows |
| `social` | Parties, mixers, community gatherings |
| `charity` | Fundraisers, volunteer events |
| `family` | Kid-friendly, family events |
| `health-wellness` | Yoga, meditation, wellness retreats |
| `gaming` | Esports, board games, LAN parties |
| `science` | Science talks, demos, exhibitions |
| `other` | Events that do not fit other categories |

## Appendix B: ID Format Reference

| Entity | Prefix | Format | Example |
|--------|--------|--------|---------|
| Event | `evt_` or none | UUID v7 | `019514a2-7c3b-7def-8a9b-1234567890ab` |
| Ticket Type | `tt_` | UUID v7 | `019514a2-aaaa-7def-8a9b-111111111111` |
| Organizer | none | UUID v7 | `019514a2-1111-7def-8a9b-abcdef012345` |
| Agent | `agt_` | UUID v7 | `019514a2-ffff-7def-8a9b-666666666666` |
| Challenge | `ch_` | UUID v7 | `019514a3-dddd-7def-8a9b-444444444444` |
| Hold | `hold_` | UUID v7 | `019514a3-eeee-7def-8a9b-555555555555` |
| Receipt | `rcpt_` | UUID v7 | `019514a4-1111-7def-8a9b-aaaaaaaaaaaa` |
| Ticket | `tkt_` | UUID v7 | `019514a4-2222-7def-8a9b-bbbbbbbbbbbb` |
| Global Event ID | `atlas:` | `atlas:{platform}:{source_id}` | `atlas:eventbrite:987654321` |
