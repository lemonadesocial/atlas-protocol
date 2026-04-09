# ATLAS Protocol Specification

**Version 1.0 | April 2026**

**Status:** Draft

---

## 1. Well-Known Endpoint

Every ATLAS-compliant domain MUST serve a manifest at `/.well-known/atlas.json`. The manifest declares the domain's identity, event feed URL, supported protocol capabilities, and settlement methods.

### 1.1 Transport Requirements

All requests MUST use HTTPS. Servers MUST reject plain HTTP with a 301 redirect to the HTTPS equivalent.

Response headers:

```
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=3600
```

The CORS header permits any agent or client to read the manifest without preflight restrictions. The cache directive sets a one-hour TTL. Servers MAY use a shorter `max-age` but MUST NOT exceed 86400 (24 hours).

### 1.2 Manifest Format

```json
{
  "atlas": "1.0",
  "name": "Brooklyn Jazz Collective",
  "did": "did:web:bjc.events",
  "events_url": "https://bjc.events/atlas/v1/events",
  "capabilities": ["listing", "purchase", "settlement"],
  "settlement": {
    "methods": ["base-usdc", "megaeth-usdc", "worldchain-usdc", "arbitrum-usdc", "ethereum-usdc"],
    "fee_model": "inclusive"
  },
  "signing_keys": [
    {
      "kid": "key-2026-04",
      "kty": "EC",
      "crv": "P-256",
      "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
      "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
      "alg": "ES256",
      "use": "sig"
    }
  ]
}
```

Field definitions:

- `atlas`: Protocol version string. MAJOR.MINOR format (see Section 6).
- `name`: Human-readable name of the platform or organizer.
- `did`: Decentralized Identifier for receipt verification. MUST be `did:web` format.
- `events_url`: Absolute URL to the event feed endpoint.
- `capabilities`: Array of supported protocol stages. Valid values: `listing`, `purchase`, `settlement`.
- `settlement.methods`: Array of accepted settlement chains. Format: `{chain}-usdc`.
- `settlement.fee_model`: Either `inclusive` (price includes fees) or `exclusive` (fees added at checkout).
- `signing_keys`: Array of JWK public keys used for receipt signing. Supports multiple active keys during rotation.

---

## 2. Registry Search API

The ATLAS Registry exposes a RESTful search endpoint for event discovery. The registry aggregates events from well-known endpoints, OAuth imports, platform feeds, and IPFS-published listings.

### 2.1 Endpoint

```
GET /atlas/v1/search
```

### 2.2 Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `lat` | float | Yes (with `lng`) | Latitude of search center |
| `lng` | float | Yes (with `lat`) | Longitude of search center |
| `radius` | integer | No | Search radius in kilometers. Default: 50. Max: 500. |
| `start_after` | ISO 8601 | No | Events starting after this datetime |
| `start_before` | ISO 8601 | No | Events starting before this datetime |
| `category` | string | No | Comma-separated category slugs (e.g., `music,jazz`) |
| `q` | string | No | Free-text search query |
| `page` | integer | No | Page number. Default: 1. |
| `per_page` | integer | No | Results per page. Default: 20. Max: 100. |

### 2.3 Response Format

```json
{
  "atlas_version": "1.0",
  "total": 142,
  "page": 1,
  "per_page": 20,
  "results": [
    {
      "@context": ["https://schema.org", "https://atlas.events/v1"],
      "@type": "Event",
      "atlas:id": "evt_abc123",
      "name": "Late Night Jazz at Nublu",
      "startDate": "2026-04-15T21:00:00-04:00",
      "location": {
        "@type": "Place",
        "name": "Nublu",
        "address": "151 Avenue C, New York, NY 10009",
        "geo": { "latitude": 40.7243, "longitude": -73.9782 }
      },
      "atlas:availability": "available",
      "atlas:ticketTypes": [
        {
          "name": "General Admission",
          "price": { "amount": "25.00", "currency": "USD" },
          "available": 47,
          "atlas:purchaseUrl": "https://bjc.events/atlas/v1/purchase/evt_abc123"
        }
      ],
      "atlas:settlement": {
        "chains": ["base", "megaeth", "worldchain", "arbitrum"],
        "token": "USDC"
      },
      "atlas:ipfs_cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      "atlas:promoted": false,
      "atlas:source": {
        "platform": "bjc.events",
        "last_synced": "2026-04-14T18:00:00Z"
      }
    }
  ]
}
```

The `results` array contains `AtlasEvent` objects in JSON-LD format, extending `schema.org/Event` with ATLAS-namespaced fields. Promoted results include `"atlas:promoted": true` and MUST be labeled as such in agent output.

### 2.4 Service Level Agreement

The registry MUST serve 95th percentile search responses in under 2 seconds. Responses exceeding 3 seconds trigger operational alerts. The registry uses Elasticsearch for full-text and geo queries, with Redis caching for hot event data.

### 2.5 Ranking

Results are ranked by six factors in priority order: relevance to query text, geographic proximity, temporal proximity (sooner events rank higher), organizer reputation, listing freshness, and promotion bid amount. Ranking is a competitive function, not a protocol-level specification. Different registry nodes MAY implement different ranking algorithms over the same underlying data.

---

## 3. HTTP 402 Purchase Flow

ATLAS uses HTTP 402 (Payment Required) as the foundation of its ticket purchase protocol. The flow has three steps: hold, pay, confirm.

### 3.1 Step 1: Hold Request

The agent sends a POST to the event's `atlas:purchaseUrl` with ticket selection.

**Request:**

```http
POST /atlas/v1/purchase/evt_abc123 HTTP/1.1
Host: bjc.events
Content-Type: application/json
Atlas-Version: 1.0
Atlas-Agent-Id: agent_claude_xyz
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "ticket_type": "General Admission",
  "quantity": 2,
  "preferred_chain": "base"
}
```

**Response:**

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "atlas:holdId": "hold_xyz789",
  "atlas:holdExpires": "2026-04-14T21:10:00Z",
  "atlas:holdTTL": 300,
  "atlas:payment": {
    "amount": "50.00",
    "currency": "USDC",
    "destination": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
    "chain": "base",
    "chain_id": 8453,
    "memo": "hold_xyz789",
    "stripe_spt_intent": "spt_intent_abc123"
  },
  "atlas:tickets": [
    {
      "ticket_type": "General Admission",
      "unit_price": "25.00",
      "quantity": 2,
      "subtotal": "50.00"
    }
  ]
}
```

### 3.2 Hold Mechanism

The server locks the requested inventory for the duration of the hold. Rules:

- Minimum TTL: 300 seconds (5 minutes). Servers MAY offer longer holds but MUST NOT go below 300 seconds.
- Automatic release: inventory returns to available stock when `atlas:holdExpires` passes without payment.
- One payment per hold: each `holdId` accepts exactly one settlement. The on-chain FeeRouter contract rejects duplicate settlement attempts for the same hold.

### 3.3 Hold Conflict Handling

When requested inventory overlaps with an existing hold, the server responds with 409 Conflict:

```json
{
  "error": "hold_conflict",
  "message": "Requested tickets are held by another buyer.",
  "retry_after": 180,
  "available": 3
}
```

The `retry_after` field indicates the maximum seconds until the conflicting hold expires. The `available` field reports current unreserved inventory. Agents SHOULD retry after the indicated interval or adjust quantity to fit available stock.

### 3.4 Step 2: Payment

The agent completes payment through one of two methods.

**On-chain USDC transfer.** The agent (or its payment service) sends USDC on the specified chain to the `destination` address. The `memo` field (hold ID) MUST be included in the transaction data for matching. The server monitors the chain for incoming transfers and matches by recipient address, amount, and memo.

**Stripe SPT.** The agent completes the Stripe Stablecoin Payment Token intent using the `stripe_spt_intent` ID. The attendee pays in local currency. Stripe converts to USDC. The server receives a webhook confirming settlement.

### 3.5 Step 3: Confirmation

After payment verification, the server responds with 200 OK and a receipt.

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "atlas:status": "confirmed",
  "atlas:holdId": "hold_xyz789",
  "atlas:receipt": { ... },
  "atlas:tickets": [
    {
      "ticket_id": "tkt_001",
      "ticket_type": "General Admission",
      "event_id": "evt_abc123",
      "holder": "did:web:alice.example.com",
      "token_id": 42,
      "chain": "base"
    }
  ],
  "atlas:settlement": {
    "tx_hash": "0xabc...def",
    "chain": "base",
    "block_number": 12345678,
    "amount": "50.00",
    "currency": "USDC"
  }
}
```

### 3.6 Idempotency

All purchase requests MUST include an `Idempotency-Key` header containing a UUID v4 value. Servers store idempotency keys for 24 hours, scoped per agent. A duplicate request with the same key returns the original response without creating a new hold or charging again. After 24 hours, the key expires and the same UUID can produce a new transaction.

---

## 4. Receipt Format

Every completed ATLAS purchase produces a cryptographic receipt. The receipt is a W3C Verifiable Credential signed by the issuing platform. It serves as the ticket. It can be verified offline, does not require the issuing platform to be online at check-in, and cannot be forged.

### 4.1 Credential Structure

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://atlas.events/credentials/v1"
  ],
  "type": ["VerifiableCredential", "AtlasTicketReceipt"],
  "issuer": "did:web:bjc.events",
  "issuanceDate": "2026-04-14T21:05:30Z",
  "credentialSubject": {
    "id": "did:web:alice.example.com",
    "event_id": "evt_abc123",
    "event_name": "Late Night Jazz at Nublu",
    "ticket_type": "General Admission",
    "quantity": 2,
    "ticket_ids": ["tkt_001", "tkt_002"],
    "settlement": {
      "tx_hash": "0xabc...def",
      "chain": "base",
      "chain_id": 8453,
      "amount": "50.00",
      "currency": "USDC"
    }
  },
  "atlas:ipfs_cid": "bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3ez67xkqluuaks21r4",
  "proof": {
    "type": "EcdsaSecp256r1Signature2019",
    "created": "2026-04-14T21:05:30Z",
    "verificationMethod": "did:web:bjc.events#key-2026-04",
    "proofPurpose": "assertionMethod",
    "jws": "eyJhbGciOiJFUzI1NiJ9...<signature>"
  }
}
```

### 4.2 Signing Algorithm

All receipts MUST be signed using ES256: ECDSA with the P-256 curve and SHA-256 hash. The signing key is a JWK listed in the issuer's `/.well-known/atlas.json` manifest under `signing_keys`.

### 4.3 Verification Flow

Receipt verification follows four steps:

1. Extract the `issuer` DID from the credential.
2. Resolve the DID using DID:web resolution. For `did:web:bjc.events`, fetch `https://bjc.events/.well-known/atlas.json`.
3. Match the `verificationMethod` key ID against the `signing_keys` array in the manifest.
4. Verify the JWS signature using the matched public key. Confirm the `issuanceDate` is not in the future.

No network call to the issuing platform is required beyond the initial DID resolution. Once an agent caches the manifest (with its 1-hour TTL), verification is fully offline.

### 4.4 Key Rotation

Platforms rotate signing keys without invalidating existing receipts. The rotation protocol:

1. Add the new key to `signing_keys` in the manifest alongside existing keys.
2. Begin signing new receipts with the new key.
3. Remove the old key from the manifest after 24 hours.
4. Old receipts remain verifiable: the `verificationMethod` references a specific `kid`, and verifiers SHOULD cache previously seen keys for receipts issued before rotation.

Multiple active keys during the rotation window prevent verification gaps.

### 4.5 IPFS Storage

Every receipt is published to IPFS and receives a content-addressed CID. The CID is included in the credential as `atlas:ipfs_cid`. The ticket holder can retrieve and verify their receipt from any IPFS gateway without contacting the issuing platform. In Stage 2 of progressive decentralization, receipt CIDs are stored in the ERC-721 ticket token metadata.

---

## 5. Request Headers

All ATLAS API requests use these headers.

| Header | Required | Format | Description |
|--------|----------|--------|-------------|
| `Atlas-Version` | Yes | `MAJOR.MINOR` | Protocol version the client expects (e.g., `1.0`) |
| `Atlas-Agent-Id` | Yes | `agent_{identifier}` | Registered agent identifier for tracking and rewards |
| `Idempotency-Key` | Purchase only | UUID v4 | Deduplication key for purchase requests (see Section 3.6) |
| `Content-Type` | Write requests | `application/json` | Required for POST/PUT/PATCH bodies |
| `Authorization` | Authenticated endpoints | `Bearer atlas_sk_live_...` | API key for authenticated operations |

Agent identity is tracked via `Atlas-Agent-Id`. The registry records which agent referred each transaction. Referral rewards (5% of protocol fees, perpetually) are calculated from this tracking and paid through the RewardLedger smart contract.

API keys use the prefix `atlas_sk_live_` for production secret keys, `atlas_pk_live_` for publishable keys, and `atlas_sk_test_` for testnet keys. Rotation is required every 90 days.

---

## 6. Versioning

ATLAS uses MAJOR.MINOR version numbers. The `Atlas-Version` header is required on every request.

### 6.1 Version Format

- MAJOR increments signal breaking changes. Clients MUST update.
- MINOR increments add fields or endpoints. Existing clients continue working.

Example: `1.0` to `1.1` adds a new optional field. `1.0` to `2.0` changes the purchase flow structure.

### 6.2 Deprecation Lifecycle

Each version passes through four stages:

| Stage | Duration | Behavior |
|-------|----------|----------|
| **Current** | Active development | Full read/write access. All new features land here. |
| **Supported** | 12 months after successor launches | Full read/write access. Security patches only. No new features. |
| **Deprecated** | 6 months after Supported ends | Read-only access. Write requests return 405 Method Not Allowed. Deprecation-Warning header included on all responses. |
| **Retired** | After Deprecated period ends | All requests return 410 Gone with a body pointing to the current version. |

Total minimum support window: 18 months from the day a version leaves Current status. Agents that pin to a specific version have at least 18 months to migrate.

### 6.3 Version Negotiation

If a client sends an `Atlas-Version` header for a Retired version, the server responds:

```json
{
  "error": "version_retired",
  "message": "ATLAS version 1.0 is retired.",
  "current_version": "2.0",
  "migration_guide": "https://atlas.events/docs/migrate/v1-to-v2"
}
```

If the header is missing, the server defaults to the latest Current version.

---

## 7. Error Codes

ATLAS defines six standard error responses. Each includes a machine-readable `error` code, a human-readable `message`, and retry semantics.

### 7.1 Error Response Format

```json
{
  "error": "error_code_string",
  "message": "Human-readable description.",
  "retry_after": 60,
  "details": {}
}
```

The `retry_after` field is present only for retryable errors. Value is in seconds.

### 7.2 Error Code Reference

| HTTP Status | Error Code | Meaning | Retryable | Retry Semantics |
|-------------|------------|---------|-----------|-----------------|
| 402 | `payment_required` | Ticket hold created. Payment needed to complete purchase. | No | Not an error. Follow the payment challenge in the response body. |
| 409 | `hold_conflict` | Requested inventory is held by another buyer. | Yes | Retry after `retry_after` seconds (hold expiration). |
| 410 | `hold_expired` | The referenced hold has expired. Inventory released. | No | Create a new hold request from scratch. |
| 422 | `invalid_request` | Request body or parameters failed validation. | No | Fix the request and resubmit. The `details` object lists specific field errors. |
| 429 | `rate_limited` | Agent exceeded request quota. | Yes | Retry after `retry_after` seconds. Exponential backoff recommended. |
| 503 | `service_unavailable` | Server is temporarily unable to process requests. | Yes | Retry after `retry_after` seconds. Exponential backoff with jitter. |

### 7.3 Validation Error Detail

The 422 response includes per-field errors in the `details` object:

```json
{
  "error": "invalid_request",
  "message": "Request validation failed.",
  "details": {
    "quantity": "Must be a positive integer.",
    "preferred_chain": "Unknown chain identifier. Supported: base, megaeth, worldchain, arbitrum, ethereum."
  }
}
```

### 7.4 Rate Limiting

Rate limits are scoped per agent (identified by `Atlas-Agent-Id`). Default limits:

- Search: 60 requests per minute
- Purchase: 10 requests per minute
- All other endpoints: 120 requests per minute

The server includes `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers on every response.

---

## 8. Security Summary

Transport: TLS 1.3 required. No unencrypted HTTP.

Authentication: API keys scoped per agent. Secret keys (`atlas_sk_live_`) for server-to-server calls. Publishable keys (`atlas_pk_live_`) for client-side search.

Purchase integrity: Idempotency keys prevent double charges. Hold mechanism prevents overselling. FeeRouter contract rejects duplicate settlements for the same hold ID.

Receipt integrity: ES256 signatures verified via DID:web resolution. Key rotation without verification gaps. Receipts stored on IPFS for permanent, platform-independent access.

Data privacy: Attendee PII encrypted at rest (AES-256-GCM). PII never stored in the registry, never written to logs, never included in IPFS listings. On-chain settlement data is public (amounts, addresses) but not linked to attendee identity unless the user explicitly connects them.

---

## Appendix A: Settlement Chains

| Chain | Chain ID | Type | USDC Source | Tx Fee | Block Time |
|-------|----------|------|-------------|--------|------------|
| Base | 8453 | OP Stack L2 | Native Circle | ~$0.01 | ~2 sec |
| MegaETH | TBD | EVM L2 | FastBridge | <$0.01 | ~10 ms |
| World Chain | 480 | OP Stack L2 | Canonical bridge | ~$0.01-0.03 | ~2 sec |
| Arbitrum | 42161 | Nitro L2 | Native Circle | ~$0.01 | ~0.25 sec |
| Ethereum L1 | 1 | Mainnet | Native Circle | $2-50 | ~12 sec |

Organizers select a settlement chain per event. Agents read the chain from the listing's `atlas:settlement` field and route payment to the correct contract address.

---

## Appendix B: Full Purchase Sequence Diagram

```
Agent                          Server                         Chain
  |                              |                              |
  |  POST /purchase (hold req)   |                              |
  |----------------------------->|                              |
  |                              |  Lock inventory              |
  |  402 + payment challenge     |                              |
  |<-----------------------------|                              |
  |                              |                              |
  |  USDC transfer (or Stripe)   |                              |
  |------------------------------------------------------------->|
  |                              |                              |
  |                              |  Monitor chain / webhook     |
  |                              |<-----------------------------|
  |                              |                              |
  |                              |  FeeRouter.split()           |
  |                              |----------------------------->|
  |                              |                              |
  |                              |  Mint receipt + publish IPFS |
  |  200 OK + receipt            |                              |
  |<-----------------------------|                              |
  |                              |                              |
```

---

*This specification defines the ATLAS Protocol API contracts. For data schemas, see SCHEMAS.md. For architecture details, see ARCHITECTURE.md. For progressive decentralization, see PROGRESSIVE-DECENTRALIZATION.md. For fee economics, see FEE-STRUCTURE.md.*
