# ATLAS Connector Architecture

> How ATLAS imports events from external platforms. Each platform gets a connector: a standardized adapter that fetches events, normalizes them into the ATLAS schema, and keeps them in sync.

## Table of Contents

1. [Connector Interface](#1-connector-interface)
2. [OAuth Flow](#2-oauth-flow)
3. [Event Normalization](#3-event-normalization)
4. [Sync Architecture](#4-sync-architecture)
5. [IPFS Publishing](#5-ipfs-publishing)
6. [Error Handling](#6-error-handling)
7. [Adding a New Connector](#7-adding-a-new-connector)

---

## 1. Connector Interface

Every platform connector implements the `AtlasConnector` interface. ATLAS treats all platforms uniformly. Each adapter handles platform-specific API details.

```typescript
interface AtlasConnector {
  readonly platformId: string;  // "eventbrite", "luma", "meetup", "partiful"
  getAuthUrl(organizerId: string, scopes: string[]): string;
  exchangeCode(code: string): Promise<OAuthTokens>;
  refreshToken(tokens: OAuthTokens): Promise<OAuthTokens>;
  verifyOwnership(tokens: OAuthTokens): Promise<OwnershipResult>;
  fetchEvents(tokens: OAuthTokens): Promise<PlatformEvent[]>;
  syncEvent(tokens: OAuthTokens, platformEventId: string): Promise<PlatformEvent>;
  mapToAtlasEvent(event: PlatformEvent): AtlasEvent;
}

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;        // Unix timestamp in seconds
  token_type: string;         // "Bearer"
  scope?: string;
  raw: Record<string, unknown>; // Platform-specific extra fields
}
```

The `raw` field preserves platform-specific token data that ATLAS does not model directly. Connectors read from `raw` when they need non-standard fields.

---

## 2. OAuth Flow

ATLAS does not require platforms to opt in. Organizers authorize access themselves. The flow follows standard OAuth 2.0 with PKCE.

**Authorization sequence:** The organizer clicks "Connect Eventbrite" in the ATLAS dashboard. ATLAS generates an authorization URL with a PKCE challenge. The organizer authenticates on the platform and grants permissions. The platform redirects back to ATLAS with an authorization code. ATLAS exchanges the code for access and refresh tokens, encrypts them at rest (AES-256-GCM), and stores them per organizer. The connector calls `verifyOwnership()`, then runs `fetchEvents()` immediately. Events appear in ATLAS within seconds.

### Token Lifecycle

| Stage | Action |
|-------|--------|
| Initial grant | Store access token, refresh token, expiration timestamp |
| Before each API call | Check `expires_at`. If within 5 minutes of expiry, refresh first |
| Refresh | Call platform token endpoint with refresh token. Store new pair |
| Refresh failure | Mark connection `stale`. Notify organizer to re-authorize |
| Revocation | Organizer disconnects. ATLAS deletes all stored tokens |

Tokens never leave the ATLAS backend. They are not exposed to agents, frontends, or third parties.

---

## 3. Event Normalization

Each connector transforms platform-specific event data into the `AtlasEvent` JSON-LD schema. Every agent, registry node, and IPFS listing uses this same format.

### AtlasEvent Schema (Core Fields)

```json
{
  "@context": "https://atlas.events/schema/v1",
  "@type": "AtlasEvent",
  "event_id": "evt_abc123",
  "source": { "platform": "eventbrite", "platform_event_id": "987654321", "last_synced": "2026-04-09T12:00:00Z" },
  "title": "Late Night Jazz at Nublu",
  "start": "2026-04-15T21:00:00-04:00",
  "end": "2026-04-16T01:00:00-04:00",
  "location": { "name": "Nublu", "address": "151 Avenue C, New York, NY 10009", "geo": { "lat": 40.7234, "lng": -73.9788 } },
  "ticket_types": [{ "name": "General Admission", "price": "25.00", "currency": "USD", "available": 47 }],
  "categories": ["music", "jazz", "nightlife"],
  "content_hash": "sha256:a1b2c3..."
}
```

The schema requires only `event_id`, `title`, `start`, and `source`. All other fields accept null.

### Field Mapping: Eventbrite

| Eventbrite Field | AtlasEvent Field | Notes |
|-----------------|------------------|-------|
| `name.text` | `title` | Plain text extraction |
| `description.html` | `description` | Stripped to plain text |
| `start.utc` / `end.utc` | `start` / `end` | Converted to ISO 8601 with timezone |
| `venue.address` | `location.address` | Concatenated from structured fields |
| `venue.latitude` / `longitude` | `location.geo` | Direct mapping |
| `ticket_classes[]` | `ticket_types[]` | Price in minor units converted to decimal |
| `category_id` | `categories` | Mapped from Eventbrite category taxonomy |

### Field Mapping: Lu.ma

| Lu.ma Field | AtlasEvent Field | Notes |
|------------|------------------|-------|
| `name` | `title` | Direct mapping |
| `description_md` | `description` | Markdown stripped to plain text |
| `start_at` / `end_at` | `start` / `end` | Already ISO 8601 |
| `geo_address_json` | `location` | Parsed from JSON object |
| `ticket_info` | `ticket_types[]` | Free events get price "0.00" |

### Field Mapping: Meetup

| Meetup Field | AtlasEvent Field | Notes |
|-------------|------------------|-------|
| `name` | `title` | Direct mapping |
| `description` | `description` | HTML stripped |
| `dateTime` | `start` | GraphQL API returns ISO 8601 |
| `duration` | `end` | Computed: start + duration |
| `venue` | `location` | Address and geo from venue object |
| `feeInfo` | `ticket_types[]` | Single ticket type per event |

---

## 4. Sync Architecture

After the initial import, each connector syncs on a recurring interval. Default: 15 minutes. Configurable range: 5 minutes to 24 hours.

### Change Detection

ATLAS computes a SHA-256 hash of each event's normalized fields (title, description, start, end, location, ticket types, pricing) on every sync. If the hash matches the stored hash, ATLAS skips that event. No writes, no IPFS republish, no registry update.

### Sync Pipeline

1. Scheduler triggers sync for the organizer's connection
2. Connector calls `fetchEvents()` with stored tokens
3. Each event mapped via `mapToAtlasEvent()`
4. Content hash compared against stored hash
5. Changed events: update registry, republish to IPFS, generate new CID
6. Unchanged events: skip. Deleted events: mark cancelled (not removed). New events: full publish pipeline.

### Hot Data: Availability and Pricing

Ticket availability and pricing change frequently. The sync pipeline treats these as "hot" fields. They update in the registry index immediately, before the IPFS listing is republished. Agents get fresh availability within one sync interval.

### Purchase Reflection

When a ticket is purchased through ATLAS for a connected event, the connector reflects the purchase back to the source platform. The organizer sees the sale in their native dashboard.

---

## 5. IPFS Publishing

Every normalized event is published to IPFS. The listing becomes permanent, content-addressed, and accessible without the ATLAS registry.

**Pipeline:** The connector produces a validated `AtlasEvent` JSON-LD object. ATLAS submits it to the IPFS cluster (minimum 3 nodes, geographically distributed). The cluster returns a CID. The CID is stored in the registry index. At Stage 4, the CID is written to the `RegistryPointer.sol` smart contract on-chain.

The CID is deterministic. Identical content always produces the same CID. Updated content produces a new CID. Old CIDs remain valid on IPFS. Listings are append-only.

**Fallback resolution:** If the ATLAS registry goes offline, agents query the `RegistryPointer` contract on-chain, retrieve the CID, and fetch the listing from any public IPFS gateway. The data layer and registry layer are decoupled by design.

---

## 6. Error Handling

Connectors operate against third-party APIs. Failures are expected.

**API rate limits.** Each connector tracks rate limit headers (`X-RateLimit-Remaining`, `Retry-After`). When limits approach, the connector backs off exponentially. Normal intervals resume once the window resets.

**Token expiration.** Access token expired with a valid refresh token: auto-refresh, sync continues. Refresh token expired or revoked: mark connection `stale`, notify organizer. Platform returns 401 on a valid token: retry once, then mark `stale`. Stale connections stop syncing. Existing data remains in the registry. The `last_synced` timestamp signals data age.

**Network failures.** Transient errors (timeouts, 5xx) trigger retries with exponential backoff. Maximum 3 retries per sync cycle. Failed cycles are skipped and retried at the next scheduled interval.

**Partial sync recovery.** If a sync fails midway (e.g., 50 of 80 events processed), ATLAS records a checkpoint. The next cycle resumes from the checkpoint. Checkpoints expire after 1 hour and trigger a full re-sync.

---

## 7. Adding a New Connector

Four steps to add a platform.

**Step 1: Implement the adapter.** Create a class implementing `AtlasConnector`. Handle the platform's OAuth flow, API pagination, and data format. Write `mapToAtlasEvent()` to transform platform fields into the ATLAS schema.

**Step 2: Register in the connector registry.**

```typescript
connectorRegistry.register("partiful", new PartifulConnector());
```

**Step 3: Configure OAuth credentials.** Store the platform's client ID and secret in the ATLAS secrets manager. Configure the callback URL and required scopes.

**Step 4: Deploy and test.** Deploy to staging. Verify the full cycle: OAuth grant, event import, normalization, IPFS publish, sync, and purchase reflection. Promote to production after validation.

No protocol changes required. No schema changes. No agent SDK updates. The connector registry is the only integration point.

---

*For the AtlasEvent schema, see SCHEMAS.md. For the registry API, see PROTOCOL-SPEC.md Section 3.4. For the IPFS data layer, see ARCHITECTURE.md Section 2.*
