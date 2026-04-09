# ATLAS Protocol: JSON Schemas

**Version 0.1 | March 2026**

**Authors:** Lemonade

---

## Overview

ATLAS defines nine core schemas. Each schema specifies the data contract between protocol participants: platforms, agents, registries, and smart contracts. All schemas use JSON. Event listings use JSON-LD to extend Schema.org for web compatibility. Timestamps follow ISO 8601. Monetary amounts are strings to avoid floating-point precision errors.

Related specs: ARCHITECTURE.md (system design), PROTOCOL-SPEC.md (API contracts), PROGRESSIVE-DECENTRALIZATION.md (trust migration).

---

## 1. AtlasManifest

The well-known endpoint response. Every ATLAS-compliant domain serves this at `/.well-known/atlas.json`. Agents read it to discover platform capabilities, event feed URLs, settlement preferences, and signing keys for receipt verification.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `atlas` | string | yes | Protocol version. Current: `"1.0"`. |
| `name` | string | yes | Platform or space display name. |
| `url` | string | yes | Platform homepage URL. |
| `logo` | string | no | URL to platform logo (PNG or SVG, min 128x128). |
| `capabilities` | string[] | yes | Supported protocol features: `"listing"`, `"purchase"`, `"settlement"`. |
| `endpoints` | object | yes | API endpoint URLs. Contains `events_url` (event feed) and `purchase_url` (402 flow base). |
| `settlement` | object | yes | Settlement configuration. Contains `chains` (string array of chain identifiers) and `token` (settlement token, e.g. `"USDC"`). |
| `fee_model` | string | yes | Either `"inclusive"` (fees included in listed price) or `"additive"` (fees added at checkout). |
| `signing_keys` | object[] | yes | Array of JWK public keys used to sign W3C Verifiable Credential receipts. Each key includes `kid`, `kty`, `crv`, `x`, `y`. |

```json
{
  "atlas": "1.0",
  "name": "Brooklyn Jazz Collective",
  "url": "https://bjc.events",
  "logo": "https://bjc.events/logo.png",
  "capabilities": ["listing", "purchase", "settlement"],
  "endpoints": {
    "events_url": "https://bjc.events/atlas/events",
    "purchase_url": "https://bjc.events/atlas/purchase"
  },
  "settlement": {
    "chains": ["base", "megaeth", "worldchain", "arbitrum"],
    "token": "USDC"
  },
  "fee_model": "inclusive",
  "signing_keys": [
    {
      "kid": "bjc-2026-04",
      "kty": "EC",
      "crv": "P-256",
      "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
      "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"
    }
  ]
}
```

---

## 2. AtlasEvent

The canonical event listing. Uses JSON-LD extending `schema.org/Event` with ATLAS namespace fields. Published to IPFS at creation time. Indexed by the ATLAS registry. Agents consume this schema for discovery, display, and purchase routing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `@context` | string[] | yes | JSON-LD contexts: `"https://schema.org"` and `"https://atlas.events/v1"`. |
| `@type` | string | yes | Always `"Event"`. |
| `name` | string | yes | Event title. |
| `startDate` | string | yes | ISO 8601 start timestamp with timezone offset. |
| `endDate` | string | no | ISO 8601 end timestamp with timezone offset. |
| `location` | object | yes | Schema.org Place object with `@type`, `name`, and `address`. |
| `atlas:availability` | string | yes | One of `"available"`, `"sold_out"`, `"cancelled"`, `"draft"`. |
| `atlas:ticketTypes` | AtlasTicketType[] | yes | Array of ticket type objects (see Schema 3). |
| `atlas:settlement` | object | yes | Contains `chains` (string array) and `token` (string). |
| `atlas:ipfs_cid` | string | yes | Content identifier on IPFS. Derived from listing content. |
| `atlas:organizer_id` | string | yes | ATLAS organizer identifier (e.g. `"org_abc123"`). |
| `atlas:categories` | string[] | no | Event categories for search filtering (e.g. `"music"`, `"jazz"`, `"nightlife"`). |
| `atlas:last_synced` | string | no | ISO 8601 timestamp of the last registry sync. Set by the registry, not the organizer. |

```json
{
  "@context": ["https://schema.org", "https://atlas.events/v1"],
  "@type": "Event",
  "name": "Late Night Jazz at Nublu",
  "startDate": "2026-04-15T21:00:00-04:00",
  "endDate": "2026-04-16T01:00:00-04:00",
  "location": {
    "@type": "Place",
    "name": "Nublu",
    "address": "151 Avenue C, New York, NY 10009"
  },
  "atlas:availability": "available",
  "atlas:ticketTypes": [
    {
      "ticket_type_id": "tt_ga_001",
      "name": "General Admission",
      "description": "Standard entry. Doors open at 9 PM.",
      "price": {
        "amount": "25.00",
        "currency": "USD",
        "fees": [
          { "type": "protocol", "amount": "0.50", "description": "ATLAS 2% protocol fee" }
        ]
      },
      "availability": {
        "status": "available",
        "remaining": 47,
        "max_per_order": 4
      },
      "restrictions": {
        "age": 21,
        "transferable": true,
        "resellable": true,
        "max_markup_percent": 150,
        "royalty_bps": 500
      }
    }
  ],
  "atlas:settlement": {
    "chains": ["base", "megaeth", "worldchain", "arbitrum"],
    "token": "USDC"
  },
  "atlas:ipfs_cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  "atlas:organizer_id": "org_bjc_2026",
  "atlas:categories": ["music", "jazz", "nightlife"],
  "atlas:last_synced": "2026-04-14T12:00:00Z"
}
```

Existing Schema.org consumers see a valid Event object. ATLAS-aware agents read the `atlas:` fields for pricing, availability, and settlement routing.

---

## 3. AtlasTicketType

A single ticket tier within an event listing. Nested inside the `atlas:ticketTypes` array of AtlasEvent.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ticket_type_id` | string | yes | Unique identifier for this ticket type. |
| `name` | string | yes | Display name (e.g. "General Admission", "VIP"). |
| `description` | string | no | Human-readable description of what the ticket includes. |
| `price` | object | yes | Contains `amount` (string), `currency` (string), and `fees` (array of fee objects). |
| `price.amount` | string | yes | Face value. String to avoid floating-point errors. |
| `price.currency` | string | yes | ISO 4217 currency code (e.g. `"USD"`, `"EUR"`). |
| `price.fees` | object[] | no | Itemized fees. Each fee has `type`, `amount`, and `description`. |
| `availability` | object | yes | Contains `status`, `remaining`, and `max_per_order`. |
| `availability.status` | string | yes | One of `"available"`, `"sold_out"`, `"hidden"`. |
| `availability.remaining` | integer | yes | Tickets still available. Zero when sold out. |
| `availability.max_per_order` | integer | yes | Maximum tickets a single agent can hold per request. |
| `restrictions` | object | no | Resale and access rules. |
| `restrictions.age` | integer | no | Minimum age for entry. Null if no restriction. |
| `restrictions.transferable` | boolean | no | Whether the ticket can be transferred to another holder. Defaults to `true`. |
| `restrictions.resellable` | boolean | no | Whether the ticket can be listed for resale. Defaults to `true`. |
| `restrictions.max_markup_percent` | integer | no | Maximum resale price as percentage of face value (e.g. `150` = 1.5x). |
| `restrictions.royalty_bps` | integer | no | Basis points paid to organizer on resale (e.g. `500` = 5%). |

```json
{
  "ticket_type_id": "tt_vip_002",
  "name": "VIP Table",
  "description": "Reserved table for 4. Includes bottle service.",
  "price": {
    "amount": "150.00",
    "currency": "USD",
    "fees": [
      { "type": "protocol", "amount": "3.00", "description": "ATLAS 2% protocol fee" },
      { "type": "service", "amount": "5.00", "description": "Platform service fee" }
    ]
  },
  "availability": {
    "status": "available",
    "remaining": 8,
    "max_per_order": 2
  },
  "restrictions": {
    "age": 21,
    "transferable": false,
    "resellable": false,
    "max_markup_percent": null,
    "royalty_bps": null
  }
}
```

---

## 4. AtlasPurchaseChallenge

The 402 Payment Required response body. Returned when an agent requests a ticket hold. Contains everything the agent needs to execute payment: amount, destination, chain, and an optional Stripe SPT intent for fiat buyers.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hold_id` | string | yes | Unique hold identifier. Used to complete the purchase. |
| `hold_expires` | string | yes | ISO 8601 timestamp. Hold releases automatically after expiry (minimum 300 seconds). |
| `payment` | object | yes | Payment instructions. |
| `payment.amount` | string | yes | Total USDC amount due (string for precision). |
| `payment.currency` | string | yes | Always `"USDC"` for on-chain settlement. |
| `payment.destination` | string | yes | EVM address of the FeeRouter contract on the specified chain. |
| `payment.chain` | string | yes | Settlement chain identifier (e.g. `"base"`, `"arbitrum"`). |
| `payment.stripe_spt_intent` | string | no | Stripe SPT PaymentIntent ID for fiat payment. Null if Stripe is not configured. |
| `required_credential_type` | string | no | Identity credential required for purchase (e.g. `"world_id"`, `"civic"`). Null if none required. |

```json
{
  "hold_id": "hold_xyz789",
  "hold_expires": "2026-04-14T21:10:00Z",
  "payment": {
    "amount": "25.00",
    "currency": "USDC",
    "destination": "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    "chain": "base",
    "stripe_spt_intent": "spt_intent_abc123"
  },
  "required_credential_type": null
}
```

The agent reads the `chain` and `destination` fields, then sends USDC on the specified chain. For fiat buyers, the agent completes the `stripe_spt_intent` through Stripe's API. The hold prevents double-selling during the payment window.

---

## 5. AtlasCredential

A W3C Verifiable Credential serving as the purchase receipt and ticket. Signed by the issuing platform using ES256. Published to IPFS. Verifiable offline without contacting the issuing platform.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `@context` | string[] | yes | VC contexts: `"https://www.w3.org/2018/credentials/v1"` and `"https://atlas.events/v1"`. |
| `type` | string[] | yes | Always `["VerifiableCredential", "AtlasTicketReceipt"]`. |
| `id` | string | yes | Unique credential URI (e.g. `"urn:atlas:receipt:rec_abc123"`). |
| `issuer` | string | yes | DID of the issuing platform (e.g. `"did:web:bjc.events"`). |
| `issuanceDate` | string | yes | ISO 8601 timestamp of issuance. |
| `credentialSubject` | object | yes | Ticket details. |
| `credentialSubject.event_id` | string | yes | ATLAS event identifier. |
| `credentialSubject.ticket_type` | string | yes | Ticket type identifier matching `ticket_type_id` in the listing. |
| `credentialSubject.holder` | string | yes | Holder identifier (wallet address or DID). |
| `credentialSubject.settlement_tx_hash` | string | yes | On-chain transaction hash of the USDC settlement. |
| `proof` | object | yes | ES256 digital signature. |
| `proof.type` | string | yes | Always `"EcdsaSecp256r1Signature2019"`. |
| `proof.created` | string | yes | ISO 8601 timestamp when the signature was created. |
| `proof.verificationMethod` | string | yes | DID URL referencing the signing key (resolves via `did:web` to the manifest's `signing_keys`). |
| `proof.proofValue` | string | yes | Base64url-encoded ES256 signature. |

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://atlas.events/v1"
  ],
  "type": ["VerifiableCredential", "AtlasTicketReceipt"],
  "id": "urn:atlas:receipt:rec_abc123",
  "issuer": "did:web:bjc.events",
  "issuanceDate": "2026-04-14T21:05:30Z",
  "credentialSubject": {
    "event_id": "evt_abc123",
    "ticket_type": "tt_ga_001",
    "holder": "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
    "settlement_tx_hash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
  },
  "proof": {
    "type": "EcdsaSecp256r1Signature2019",
    "created": "2026-04-14T21:05:30Z",
    "verificationMethod": "did:web:bjc.events#bjc-2026-04",
    "proofValue": "z3FXs1GYbKm...truncated...7dN2p"
  }
}
```

Verification flow: resolve `did:web:bjc.events` to fetch the manifest, match `kid` from `verificationMethod` against `signing_keys`, verify the ES256 signature over the credential body. The receipt CID is stored in ERC-721 token metadata at Stage 2.

---

## 6. AtlasSearchQuery

Query parameters for the ATLAS registry search endpoint (`GET /v1/search`). All parameters are passed as URL query strings. The registry returns an AtlasSearchResult.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` | number | no | Latitude of search center. Required if `lng` is provided. |
| `lng` | number | no | Longitude of search center. Required if `lat` is provided. |
| `radius` | string | no | Search radius with unit (e.g. `"10km"`, `"5mi"`). Defaults to `"25km"`. |
| `start_after` | string | no | ISO 8601 date. Only return events starting after this date. |
| `start_before` | string | no | ISO 8601 date. Only return events starting before this date. |
| `category` | string | no | Category filter. Matches against `atlas:categories`. |
| `page` | integer | no | Page number for pagination. Defaults to `1`. |
| `per_page` | integer | no | Results per page. Defaults to `20`. Maximum `100`. |

```json
{
  "lat": 40.7128,
  "lng": -74.006,
  "radius": "10km",
  "start_after": "2026-04-15",
  "start_before": "2026-04-22",
  "category": "music",
  "page": 1,
  "per_page": 20
}
```

When sent as a GET request:
```
GET /v1/search?lat=40.7128&lng=-74.006&radius=10km&start_after=2026-04-15&start_before=2026-04-22&category=music&page=1&per_page=20
```

---

## 7. AtlasSearchResult

The registry search response. Contains pagination metadata and an array of AtlasEvent objects. Promoted results are included alongside organic results, flagged with a `promoted` field.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `total` | integer | yes | Total number of matching events across all pages. |
| `page` | integer | yes | Current page number. |
| `per_page` | integer | yes | Results per page (matches the request or default). |
| `results` | AtlasEvent[] | yes | Array of AtlasEvent objects. Promoted events include an extra `atlas:promoted` field set to `true`. |

```json
{
  "total": 43,
  "page": 1,
  "per_page": 20,
  "results": [
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
          "ticket_type_id": "tt_ga_001",
          "name": "General Admission",
          "price": { "amount": "25.00", "currency": "USD", "fees": [] },
          "availability": { "status": "available", "remaining": 47, "max_per_order": 4 },
          "restrictions": { "age": 21, "transferable": true, "resellable": true, "max_markup_percent": 150, "royalty_bps": 500 }
        }
      ],
      "atlas:settlement": { "chains": ["base", "megaeth", "worldchain", "arbitrum"], "token": "USDC" },
      "atlas:ipfs_cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      "atlas:organizer_id": "org_bjc_2026",
      "atlas:categories": ["music", "jazz", "nightlife"],
      "atlas:last_synced": "2026-04-14T12:00:00Z"
    }
  ]
}
```

---

## 8. AtlasCampaign

An ad-network promotion campaign. Created by organizers (or their agents) to bid for placement in agent search results. Settlement occurs on-chain through `PromotionSettlement.sol` when a promoted ticket sells. The bid splits 60% to the referring agent, 30% to the protocol treasury, 10% to the registry node.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `campaign_id` | string | yes | Unique campaign identifier. |
| `event_id` | string | yes | ATLAS event being promoted. |
| `bid_per_sale` | string | yes | USDC amount paid per ticket sale (string for precision). |
| `currency` | string | yes | Always `"USDC"`. |
| `total_budget` | string | yes | Maximum USDC spend for the campaign. |
| `spent` | string | yes | USDC spent so far. |
| `remaining` | string | yes | USDC remaining (`total_budget - spent`). |
| `status` | string | yes | One of `"active"`, `"paused"`, `"exhausted"`, `"ended"`. |
| `targeting` | object | yes | Audience targeting parameters. |
| `targeting.categories` | string[] | no | Event categories to match against user queries. |
| `targeting.geography` | object | no | Contains `lat`, `lng`, and `radius_km`. |
| `targeting.age_range` | object | no | Contains `min` and `max` integers. |
| `start_date` | string | yes | ISO 8601 campaign start timestamp. |
| `end_date` | string | yes | ISO 8601 campaign end timestamp. |

```json
{
  "campaign_id": "camp_abc123",
  "event_id": "evt_xyz789",
  "bid_per_sale": "2.00",
  "currency": "USDC",
  "total_budget": "100.00",
  "spent": "0.00",
  "remaining": "100.00",
  "status": "active",
  "targeting": {
    "categories": ["music", "jazz"],
    "geography": { "lat": 40.7128, "lng": -74.006, "radius_km": 50 },
    "age_range": { "min": 21, "max": 45 }
  },
  "start_date": "2026-04-01T00:00:00Z",
  "end_date": "2026-04-15T21:00:00Z"
}
```

Campaigns pause automatically when `remaining` reaches zero. Agents receive promoted listings in the same API response as organic results with a `promoted` flag.

---

## 9. AtlasMessage

An XMTP message within the ATLAS communication layer. Organizer agents send messages to guest segments through encrypted XMTP channels. Each message carries a type that determines how the recipient's client renders it.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message_id` | string | yes | Unique message identifier. |
| `type` | string | yes | One of `"event_announcement"`, `"promotion"`, `"rsvp"`, `"check_in"`, `"follow_up"`. |
| `sender` | string | yes | XMTP address of the sender (organizer or agent). |
| `recipient` | string | yes | XMTP address of the recipient (guest). |
| `body` | string | yes | Plain text message content. Encrypted in transit by XMTP. |
| `metadata` | object | no | Type-specific structured data. |
| `metadata.event_id` | string | no | Related ATLAS event identifier. |
| `metadata.ticket_type` | string | no | Related ticket type identifier. |
| `metadata.campaign_id` | string | no | Promotion campaign that triggered this message. |
| `metadata.discount_code` | string | no | Discount code included in the message. |
| `created_at` | string | yes | ISO 8601 timestamp of message creation. |

```json
{
  "message_id": "msg_def456",
  "type": "promotion",
  "sender": "0x1234abcd5678ef901234abcd5678ef901234abcd",
  "recipient": "0x9876fedc5432ba109876fedc5432ba109876fedc",
  "body": "New jazz night: April 15 at Nublu. $25 GA. Use code JAZZ5 for $5 off.",
  "metadata": {
    "event_id": "evt_abc123",
    "ticket_type": "tt_ga_001",
    "campaign_id": "camp_abc123",
    "discount_code": "JAZZ5"
  },
  "created_at": "2026-04-10T14:30:00Z"
}
```

All message content is end-to-end encrypted by XMTP. Lemonade, XMTP network nodes, and IPFS cannot read message content. Guests opt in at purchase time and can revoke consent at any point.

---

## Schema Versioning

All schemas are versioned through the `atlas` field in AtlasManifest and the `@context` URL in JSON-LD types. The current version is `1.0`. Breaking changes increment the major version. Additive changes (new optional fields) increment the minor version. Agents should ignore unrecognized fields for forward compatibility.

---

*For API endpoints that consume and produce these schemas, see PROTOCOL-SPEC.md. For system architecture, see ARCHITECTURE.md. For fee calculations referenced in ticket pricing, see FEE-STRUCTURE.md.*
