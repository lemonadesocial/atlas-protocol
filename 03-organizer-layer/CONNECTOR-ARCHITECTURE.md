# Atlas Connector Architecture

> Technical design for platform connectors: the standardized interface that lets Atlas import events from any source, normalize them into a unified schema, and keep them in sync.

## Table of Contents

1. [Connector Interface](#1-connector-interface)
2. [Atlas Event Schema](#2-atlas-event-schema)
3. [Per-Platform Connectors](#3-per-platform-connectors)
4. [Sync Architecture](#4-sync-architecture)
5. [Data Flow Pipeline](#5-data-flow-pipeline)
6. [Event Ownership Verification](#6-event-ownership-verification)
7. [Direct Ticketing Integration](#7-direct-ticketing-integration)
8. [Security](#8-security)
9. [Error Handling and Monitoring](#9-error-handling-and-monitoring)

---

## 1. Connector Interface

Every platform connector implements the `AtlasConnector` interface. This abstraction allows Atlas to treat all platforms uniformly while each adapter handles platform-specific API quirks.

### Core Interface

```typescript
/**
 * Core connector interface. Every platform adapter implements this.
 * Located: atlas-backend/src/connectors/interface.ts
 */

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;       // Unix timestamp (seconds)
  token_type: string;        // "Bearer"
  scope?: string;
  raw: Record<string, unknown>; // Platform-specific extra fields
}

interface ConnectorCapabilities {
  oauth: boolean;            // Supports OAuth 2.0 (vs API key)
  import_events: boolean;
  import_ticket_types: boolean;
  import_pricing: boolean;
  import_attendance: boolean;
  webhooks: boolean;         // Real-time sync via webhooks
  purchase_api: boolean;     // Can Atlas buy tickets on this platform?
}

interface SyncResult<T> {
  data: T[];
  pagination?: {
    has_more: boolean;
    cursor?: string;          // Opaque cursor for next page
    total?: number;
  };
  rate_limit?: {
    remaining: number;
    reset_at: number;         // Unix timestamp
  };
}

interface AtlasConnector {
  /** Platform identifier (e.g., 'eventbrite', 'luma', 'meetup') */
  readonly platform: string;

  /** What this connector supports */
  getCapabilities(): ConnectorCapabilities;

  /** Initiate OAuth flow — returns authorization URL */
  getAuthorizationUrl(userId: string, redirectUri: string): Promise<string>;

  /** Exchange OAuth callback code for tokens */
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;

  /** Refresh expired tokens */
  refreshTokens(tokens: OAuthTokens): Promise<OAuthTokens>;

  /** Revoke tokens on disconnect */
  revokeTokens(tokens: OAuthTokens): Promise<void>;

  /** Import all events for this organizer */
  syncEvents(tokens: OAuthTokens, cursor?: string): Promise<SyncResult<RawPlatformEvent>>;

  /** Import ticket types for a specific event */
  syncTicketTypes(tokens: OAuthTokens, externalEventId: string): Promise<SyncResult<RawPlatformTicketType>>;

  /** Import attendance/RSVPs for a specific event */
  syncAttendance(tokens: OAuthTokens, externalEventId: string, cursor?: string): Promise<SyncResult<RawPlatformAttendee>>;

  /** Register a webhook for real-time updates (if supported) */
  registerWebhook(tokens: OAuthTokens, externalEventId: string, callbackUrl: string): Promise<WebhookRegistration>;

  /** Parse incoming webhook payload into a normalized event */
  parseWebhook(headers: Record<string, string>, body: unknown): Promise<WebhookEvent>;
}
```

### Raw Platform Types (Pre-Normalization)

```typescript
/**
 * Raw data from platform APIs, before normalization.
 * Each connector returns these; the Normalizer transforms them to Atlas schema.
 */

interface RawPlatformEvent {
  external_id: string;          // Platform's event ID
  platform: string;             // 'eventbrite' | 'luma' | 'meetup' | ...
  raw_data: Record<string, unknown>; // Full API response (stored for debugging)
  // Minimum required fields (connectors must extract these):
  title: string;
  description?: string;
  start_datetime: string;       // ISO 8601
  end_datetime?: string;        // ISO 8601
  timezone?: string;            // IANA timezone
  location?: RawLocation;
  cover_image_url?: string;
  status: string;               // Platform-native status string
  url?: string;                 // Link to event on platform
  organizer_name?: string;
  tags?: string[];
}

interface RawLocation {
  type: 'physical' | 'online' | 'hybrid';
  venue_name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;             // ISO 3166-1 alpha-2
  latitude?: number;
  longitude?: number;
  online_url?: string;          // Zoom/Meet/etc. link
}

interface RawPlatformTicketType {
  external_id: string;
  event_external_id: string;
  name: string;
  description?: string;
  price_cents: number;          // 0 for free
  currency: string;             // ISO 4217
  capacity?: number;            // null = unlimited
  per_order_limit?: number;
  is_free: boolean;
  sale_status: string;          // Platform-native: 'on_sale', 'sold_out', etc.
}

interface RawPlatformAttendee {
  external_id: string;
  event_external_id: string;
  ticket_type_external_id?: string;
  email: string;
  name?: string;
  rsvp_status?: string;        // 'yes', 'no', 'waitlist'
  checked_in?: boolean;
  order_id?: string;
}

interface WebhookRegistration {
  webhook_id: string;
  external_event_id: string;
  callback_url: string;
  actions: string[];            // e.g., ['order.placed', 'event.updated']
}

interface WebhookEvent {
  type: 'event.updated' | 'event.deleted' | 'ticket_type.updated' | 'ticket_type.deleted'
      | 'order.placed' | 'order.refunded' | 'attendee.updated';
  external_event_id: string;
  data: Record<string, unknown>;
}
```

---

## 2. Atlas Event Schema

The normalized schema that all events conform to after passing through the connector + normalizer.

```typescript
/**
 * Atlas Event Schema — the canonical representation of an event in Atlas.
 * This is what gets stored in the Atlas Registry and queried by agents.
 */

interface AtlasEvent {
  // Identity
  id: string;                    // Atlas-generated UUID
  external_ids: Record<string, string>; // { eventbrite: "123", luma: "abc" }
  source: AtlasEventSource;

  // Core fields
  title: string;
  description?: string;          // Markdown
  start_datetime: string;        // ISO 8601 with timezone
  end_datetime?: string;
  timezone: string;              // IANA (e.g., "America/New_York")
  status: AtlasEventStatus;

  // Location
  location: AtlasLocation;

  // Media
  cover_image_url?: string;
  gallery_urls?: string[];

  // Ticketing
  ticket_types: AtlasTicketType[];
  ticketing_mode: 'platform' | 'direct' | 'hybrid';
  purchase_url?: string;         // For platform-ticketed events (redirect)
  mpp_enabled: boolean;          // Can agents buy via MPP 402?

  // Organizer
  organizer_id: string;          // Atlas organizer ID
  organizer_name: string;
  organizer_reputation?: number; // 0-100

  // Discovery metadata
  tags: string[];
  category?: string;
  capacity?: number;
  tickets_remaining?: number;
  price_range?: {
    min_cents: number;
    max_cents: number;
    currency: string;
  };

  // Timestamps
  created_at: string;
  updated_at: string;
  synced_at: string;             // Last sync from platform
  indexed_at: string;            // Last indexed for agent discovery
}

type AtlasEventSource = 'eventbrite' | 'luma' | 'meetup' | 'atlas_direct' | 'webhook' | 'manual';

type AtlasEventStatus =
  | 'draft'        // Not yet published
  | 'published'    // Live and discoverable
  | 'started'      // Event is currently happening
  | 'ended'        // Event is over
  | 'canceled'     // Organizer canceled
  | 'sync_paused'; // OAuth token expired or platform error

interface AtlasLocation {
  type: 'physical' | 'online' | 'hybrid';
  venue_name?: string;
  full_address?: string;
  city?: string;
  state?: string;
  country?: string;              // ISO 3166-1 alpha-2
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  online_url?: string;
}

interface AtlasTicketType {
  id: string;                    // Atlas-generated
  external_id?: string;          // Platform ticket class ID
  title: string;
  description?: string;
  price_cents: number;           // 0 for free
  currency: string;              // ISO 4217, default "USD"
  capacity?: number;             // null = unlimited
  remaining?: number;
  per_person_limit?: number;
  is_free: boolean;
  sale_status: 'on_sale' | 'sold_out' | 'not_yet_on_sale' | 'ended';
  ticketing_mode: 'platform' | 'direct'; // Where purchase happens
}

interface AtlasAttendee {
  id: string;
  event_id: string;
  ticket_type_id?: string;
  email?: string;                // Hashed for privacy in discovery layer
  name?: string;
  status: 'confirmed' | 'pending' | 'canceled' | 'checked_in';
  source: AtlasEventSource;
  created_at: string;
}
```

---

## 3. Per-Platform Connectors

### 3.1 Eventbrite Connector

The reference connector. Lemonade already has a production Eventbrite integration that Atlas extends.

**Existing Lemonade Implementation:**
- OAuth config: `lemonade-backend/src/app/services/oauth2.ts` (lines 51-70)
- API client: `lemonade-backend/src/app/services/eventbrite.ts`
- Webhook handler: `lemonade-backend/src/app/controllers/webhooks/eventbrite.ts`
- GraphQL resolver: `lemonade-backend/src/graphql/resolvers/eventbrite.ts`

#### OAuth Configuration

```typescript
// Eventbrite OAuth 2.0 — extends existing Lemonade config
const EVENTBRITE_CONFIG = {
  authorization_endpoint: 'https://www.eventbrite.com/oauth/authorize',
  token_endpoint: 'https://www.eventbrite.com/oauth/token',
  userinfo_endpoint: 'https://www.eventbriteapi.com/v3/users/me/',
  scopes: ['eventbrite.organizer', 'eventbrite.event_read', 'webhook_manage'],
  token_auth_method: 'client_secret_post',
  // Eventbrite tokens do NOT expire — no refresh needed
  // But Atlas should still handle revocation gracefully
};
```

#### API Endpoints Used

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| Get organization | GET | `/v3/users/me/organizations/` | Returns org ID needed for event queries |
| List events | GET | `/v3/organizations/{org_id}/events/` | Paginated. Supports `status`, `order_by`, `page_size` |
| Get event | GET | `/v3/events/{event_id}/` | Full event details |
| List ticket classes | GET | `/v3/events/{event_id}/ticket_classes/` | Paginated via continuation token |
| Get venue | GET | `/v3/venues/{venue_id}/` | Address, coordinates |
| List orders | GET | `/v3/events/{event_id}/orders/` | Paginated. For attendance sync |
| Get order attendees | GET | `/v3/orders/{order_id}/attendees/` | Email, ticket class, RSVP status |
| Create webhook | POST | `/v3/organizations/{org_id}/webhooks/` | Actions: `order.placed`, `order.refunded`, `ticket_class.*` |
| Delete webhook | DELETE | `/v3/webhooks/{webhook_id}/` | Cleanup on disconnect |

#### Connector Implementation

```typescript
import { AtlasConnector, OAuthTokens, ConnectorCapabilities, SyncResult,
         RawPlatformEvent, RawPlatformTicketType, RawPlatformAttendee,
         WebhookRegistration, WebhookEvent } from '../interface';

export class EventbriteConnector implements AtlasConnector {
  readonly platform = 'eventbrite';

  private readonly baseUrl = 'https://www.eventbriteapi.com/v3';

  getCapabilities(): ConnectorCapabilities {
    return {
      oauth: true,
      import_events: true,
      import_ticket_types: true,
      import_pricing: true,
      import_attendance: true,
      webhooks: true,
      purchase_api: false,  // Eventbrite has no purchase API
    };
  }

  async getAuthorizationUrl(userId: string, redirectUri: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: process.env.EVENTBRITE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
    });

    return `https://www.eventbrite.com/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const response = await fetch('https://www.eventbrite.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.EVENTBRITE_CLIENT_ID!,
        client_secret: process.env.EVENTBRITE_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json();

    return {
      access_token: data.access_token,
      token_type: 'Bearer',
      // Eventbrite tokens do not expire
      raw: data,
    };
  }

  async refreshTokens(tokens: OAuthTokens): Promise<OAuthTokens> {
    // Eventbrite tokens do not expire — return as-is
    return tokens;
  }

  async revokeTokens(_tokens: OAuthTokens): Promise<void> {
    // Eventbrite does not have a token revocation endpoint.
    // Organizer must manually revoke via Eventbrite settings.
    // Atlas deletes stored tokens on its side.
  }

  async syncEvents(tokens: OAuthTokens, cursor?: string): Promise<SyncResult<RawPlatformEvent>> {
    const orgId = await this.getOrganizationId(tokens);

    const params = new URLSearchParams({ page_size: '50' });
    if (cursor) params.set('continuation', cursor);

    const response = await this.apiGet<{
      events: EventbriteApiEvent[];
      pagination: { continuation?: string };
    }>(`/organizations/${orgId}/events/`, tokens, params);

    return {
      data: response.events.map((event) => this.mapEvent(event)),
      pagination: response.pagination.continuation
        ? { has_more: true, cursor: response.pagination.continuation }
        : { has_more: false },
    };
  }

  async syncTicketTypes(
    tokens: OAuthTokens,
    externalEventId: string
  ): Promise<SyncResult<RawPlatformTicketType>> {
    const response = await this.apiGet<{
      ticket_classes: EventbriteTicketClass[];
      pagination: { continuation?: string };
    }>(`/events/${externalEventId}/ticket_classes/`, tokens);

    return {
      data: response.ticket_classes.map((tc) => ({
        external_id: tc.id,
        event_external_id: externalEventId,
        name: tc.name,
        description: tc.description,
        price_cents: tc.free ? 0 : (tc.cost?.value ?? 0) + (tc.fee?.value ?? 0),
        currency: tc.cost?.currency ?? 'USD',
        capacity: tc.maximum_quantity || undefined,
        per_order_limit: tc.maximum_quantity_per_order || undefined,
        is_free: tc.free,
        sale_status: 'on_sale', // Eventbrite doesn't have per-class sale status
      })),
      pagination: { has_more: false },
    };
  }

  async syncAttendance(
    tokens: OAuthTokens,
    externalEventId: string,
    cursor?: string
  ): Promise<SyncResult<RawPlatformAttendee>> {
    const params = new URLSearchParams();
    if (cursor) params.set('continuation', cursor);

    const response = await this.apiGet<{
      orders: { id: string; attendees: EventbriteAttendee[] }[];
      pagination: { continuation?: string };
    }>(`/events/${externalEventId}/orders/`, tokens, params);

    const attendees: RawPlatformAttendee[] = [];
    for (const order of response.orders) {
      if (!order.attendees) continue;
      for (const attendee of order.attendees) {
        attendees.push({
          external_id: attendee.id,
          event_external_id: externalEventId,
          ticket_type_external_id: attendee.ticket_class_id,
          email: attendee.profile.email,
          name: attendee.profile.first_name
            ? `${attendee.profile.first_name} ${attendee.profile.last_name ?? ''}`.trim()
            : undefined,
          order_id: order.id,
        });
      }
    }

    return {
      data: attendees,
      pagination: response.pagination.continuation
        ? { has_more: true, cursor: response.pagination.continuation }
        : { has_more: false },
    };
  }

  async registerWebhook(
    tokens: OAuthTokens,
    externalEventId: string,
    callbackUrl: string
  ): Promise<WebhookRegistration> {
    const orgId = await this.getOrganizationId(tokens);

    // Clean up existing webhooks for this event
    const existing = await this.apiGet<{ webhooks: { id: string; endpoint_url: string }[] }>(
      `/organizations/${orgId}/webhooks/`, tokens
    );

    for (const wh of existing.webhooks) {
      if (new URL(wh.endpoint_url).searchParams.get('external_event_id') === externalEventId) {
        await this.apiDelete(`/webhooks/${wh.id}/`, tokens);
      }
    }

    // Create new webhook
    const webhook = await this.apiPost<{ id: string }>(
      `/organizations/${orgId}/webhooks/`, tokens, {
        endpoint_url: callbackUrl,
        event_id: externalEventId,
        actions: 'order.placed,order.refunded,ticket_class.created,ticket_class.deleted,ticket_class.updated',
      }
    );

    return {
      webhook_id: webhook.id,
      external_event_id: externalEventId,
      callback_url: callbackUrl,
      actions: ['order.placed', 'order.refunded', 'ticket_class.created',
                'ticket_class.deleted', 'ticket_class.updated'],
    };
  }

  async parseWebhook(
    _headers: Record<string, string>,
    body: unknown
  ): Promise<WebhookEvent> {
    const payload = body as { api_url: string; config: { action: string } };

    const actionMap: Record<string, WebhookEvent['type']> = {
      'order.placed': 'order.placed',
      'order.refunded': 'order.refunded',
      'ticket_class.created': 'ticket_type.updated',
      'ticket_class.updated': 'ticket_type.updated',
      'ticket_class.deleted': 'ticket_type.deleted',
    };

    return {
      type: actionMap[payload.config.action] ?? 'event.updated',
      external_event_id: '', // Extracted from callback URL params
      data: payload as unknown as Record<string, unknown>,
    };
  }

  // --- Private helpers ---

  private async getOrganizationId(tokens: OAuthTokens): Promise<string> {
    const { organizations } = await this.apiGet<{
      organizations: { id: string }[];
    }>('/users/me/organizations/', tokens);

    if (!organizations[0]) throw new Error('No Eventbrite organization found');

    return organizations[0].id;
  }

  private mapEvent(event: EventbriteApiEvent): RawPlatformEvent {
    return {
      external_id: event.id,
      platform: 'eventbrite',
      raw_data: event as unknown as Record<string, unknown>,
      title: event.name.text,
      description: event.description?.text,
      start_datetime: event.start.utc,
      end_datetime: event.end.utc,
      timezone: event.start.timezone,
      location: event.venue ? {
        type: event.online_event ? 'online' : 'physical',
        venue_name: event.venue.name,
        address: event.venue.address?.localized_address_display,
        city: event.venue.address?.city,
        state: event.venue.address?.region,
        country: event.venue.address?.country,
        latitude: parseFloat(event.venue.latitude),
        longitude: parseFloat(event.venue.longitude),
      } : event.online_event ? { type: 'online' } : undefined,
      cover_image_url: event.logo?.url,
      status: event.status,
      url: event.url,
      tags: event.tags?.map((t: { display_name: string }) => t.display_name),
    };
  }

  private async apiGet<T>(path: string, tokens: OAuthTokens, params?: URLSearchParams): Promise<T> {
    const url = `${this.baseUrl}${path}${params ? `?${params}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) throw new Error(`Eventbrite API ${res.status}: ${await res.text()}`);

    return res.json() as Promise<T>;
  }

  private async apiPost<T>(path: string, tokens: OAuthTokens, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Eventbrite API ${res.status}: ${await res.text()}`);

    return res.json() as Promise<T>;
  }

  private async apiDelete(path: string, tokens: OAuthTokens): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) throw new Error(`Eventbrite API ${res.status}: ${await res.text()}`);
  }
}

// --- Eventbrite API response types ---

interface EventbriteApiEvent {
  id: string;
  name: { text: string };
  description?: { text: string };
  start: { utc: string; timezone: string };
  end: { utc: string; timezone: string };
  status: string;
  url: string;
  logo?: { url: string };
  venue?: {
    name: string;
    latitude: string;
    longitude: string;
    address: {
      localized_address_display: string;
      city: string;
      region: string;
      country: string;
    };
  };
  online_event: boolean;
  tags?: { display_name: string }[];
}

interface EventbriteTicketClass {
  id: string;
  name: string;
  description: string;
  free: boolean;
  maximum_quantity: number;
  maximum_quantity_per_order: number;
  cost?: { value: number; currency: string };
  fee?: { value: number; currency: string };
}

interface EventbriteAttendee {
  id: string;
  ticket_class_id: string;
  profile: {
    email: string;
    first_name?: string;
    last_name?: string;
  };
}
```

**Rate Limits:** 2,000 requests/hour per OAuth token. Atlas tracks remaining quota via response headers and backs off at 100 remaining.

**Known Limitations:**
- No purchase API. Agent discovery on Atlas can surface Eventbrite events, but purchase redirects to Eventbrite unless the organizer upgrades to Atlas Direct.
- Eventbrite tokens do not expire but can be revoked by the user on Eventbrite's settings page. Atlas must handle 401s gracefully.
- Pagination uses `continuation` tokens (not page numbers). Cannot skip to arbitrary pages.

---

### 3.2 Lu.ma Connector

Lu.ma does not have an official public API or OAuth flow. Integration is limited.

#### Integration Strategy

```
┌─────────────────────────────────────────────────────────┐
│                   Lu.ma Integration                      │
│                                                          │
│  Option A: API Key (current)                             │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Organizer provides Lu.ma API key (from settings)     │ │
│  │  → Atlas uses /api/public/v1/ endpoints              │ │
│  │  → Read-only: events + basic details                 │ │
│  │  → No attendance, no ticket purchase                 │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  Option B: Calendar URL (fallback)                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Organizer provides Lu.ma calendar/profile URL        │ │
│  │  → Atlas parses public event listings                │ │
│  │  → Very limited data: title, date, location          │ │
│  │  → Updated via polling (every 15 min)                │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  Option C: Future Official API (planned)                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ If Lu.ma launches partner API + OAuth:                │ │
│  │  → Atlas upgrades to full OAuth connector             │ │
│  │  → Same interface as Eventbrite connector             │ │
│  │  → Automatic migration for existing Lu.ma organizers  │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

#### Connector Implementation (Simplified)

```typescript
export class LumaConnector implements AtlasConnector {
  readonly platform = 'luma';

  private readonly baseUrl = 'https://api.lu.ma/public/v1';

  getCapabilities(): ConnectorCapabilities {
    return {
      oauth: false,           // API key only
      import_events: true,
      import_ticket_types: true,  // Limited
      import_pricing: true,       // Limited
      import_attendance: false,
      webhooks: false,        // Polling only
      purchase_api: false,
    };
  }

  async getAuthorizationUrl(_userId: string, _redirectUri: string): Promise<string> {
    // Lu.ma has no OAuth. Organizer manually provides API key.
    throw new Error('Lu.ma does not support OAuth. Use API key flow.');
  }

  async exchangeCode(_code: string, _redirectUri: string): Promise<OAuthTokens> {
    throw new Error('Lu.ma does not support OAuth.');
  }

  // For Lu.ma, "tokens" is just the API key wrapped in OAuthTokens shape
  async syncEvents(tokens: OAuthTokens, cursor?: string): Promise<SyncResult<RawPlatformEvent>> {
    const params = new URLSearchParams();
    if (cursor) params.set('pagination_cursor', cursor);

    const response = await fetch(`${this.baseUrl}/calendar/list-events?${params}`, {
      headers: { 'x-luma-api-key': tokens.access_token },
    });

    const data = await response.json() as {
      entries: LumaEvent[];
      has_more: boolean;
      next_cursor?: string;
    };

    return {
      data: data.entries.map((entry) => ({
        external_id: entry.api_id,
        platform: 'luma',
        raw_data: entry as unknown as Record<string, unknown>,
        title: entry.name,
        description: entry.description,
        start_datetime: entry.start_at,
        end_datetime: entry.end_at,
        timezone: entry.timezone,
        location: entry.geo_address_json ? {
          type: entry.meeting_url ? 'hybrid' : 'physical',
          address: entry.geo_address_json.full_address,
          city: entry.geo_address_json.city,
          country: entry.geo_address_json.country,
          online_url: entry.meeting_url,
        } : entry.meeting_url ? {
          type: 'online',
          online_url: entry.meeting_url,
        } : undefined,
        cover_image_url: entry.cover_url,
        status: entry.visibility === 'published' ? 'live' : 'draft',
        url: `https://lu.ma/${entry.url}`,
      })),
      pagination: data.has_more
        ? { has_more: true, cursor: data.next_cursor }
        : { has_more: false },
    };
  }

  async syncTicketTypes(
    tokens: OAuthTokens,
    externalEventId: string
  ): Promise<SyncResult<RawPlatformTicketType>> {
    const response = await fetch(`${this.baseUrl}/event/get-ticket-types?event_api_id=${externalEventId}`, {
      headers: { 'x-luma-api-key': tokens.access_token },
    });

    const data = await response.json() as { ticket_types: LumaTicketType[] };

    return {
      data: (data.ticket_types ?? []).map((tt) => ({
        external_id: tt.api_id,
        event_external_id: externalEventId,
        name: tt.name ?? 'General Admission',
        description: tt.description,
        price_cents: tt.price ? Math.round(tt.price * 100) : 0,
        currency: 'USD',
        capacity: tt.max_count ?? undefined,
        is_free: !tt.price || tt.price === 0,
        sale_status: 'on_sale',
      })),
      pagination: { has_more: false },
    };
  }

  async syncAttendance(): Promise<SyncResult<RawPlatformAttendee>> {
    // Lu.ma does not expose attendance data via public API
    return { data: [], pagination: { has_more: false } };
  }

  async registerWebhook(): Promise<WebhookRegistration> {
    throw new Error('Lu.ma does not support webhooks. Polling is used instead.');
  }

  async parseWebhook(): Promise<WebhookEvent> {
    throw new Error('Lu.ma does not support webhooks.');
  }

  // Token management is no-ops for API key connector
  async refreshTokens(tokens: OAuthTokens): Promise<OAuthTokens> { return tokens; }
  async revokeTokens(): Promise<void> { /* no-op: organizer regenerates API key on Lu.ma */ }
}

interface LumaEvent {
  api_id: string;
  name: string;
  description?: string;
  start_at: string;
  end_at: string;
  timezone: string;
  cover_url?: string;
  url: string;
  visibility: string;
  meeting_url?: string;
  geo_address_json?: {
    full_address: string;
    city: string;
    country: string;
  };
}

interface LumaTicketType {
  api_id: string;
  name?: string;
  description?: string;
  price?: number;
  max_count?: number;
}
```

---

### 3.3 Meetup Connector

Meetup provides a GraphQL API with OAuth 2.0.

#### OAuth Configuration

```typescript
const MEETUP_CONFIG = {
  authorization_endpoint: 'https://secure.meetup.com/oauth2/authorize',
  token_endpoint: 'https://secure.meetup.com/oauth2/access',
  api_endpoint: 'https://api.meetup.com/gql',
  scopes: ['ageless', 'event_management'],
  // Meetup tokens expire — refresh flow required
};
```

#### Connector Implementation

```typescript
export class MeetupConnector implements AtlasConnector {
  readonly platform = 'meetup';

  getCapabilities(): ConnectorCapabilities {
    return {
      oauth: true,
      import_events: true,
      import_ticket_types: false,  // Meetup has simple RSVP, rarely ticket tiers
      import_pricing: false,       // Most Meetup events are free or simple dues
      import_attendance: true,     // RSVP data
      webhooks: false,             // No webhook API — polling required
      purchase_api: false,
    };
  }

  async syncEvents(tokens: OAuthTokens, _cursor?: string): Promise<SyncResult<RawPlatformEvent>> {
    // Meetup uses GraphQL — query organizer's groups and their events
    const query = `
      query {
        self {
          groupMemberships(filter: { statuses: ORGANIZER }) {
            edges {
              node {
                group {
                  urlname
                  name
                  upcomingEvents(input: { first: 50 }) {
                    edges {
                      node {
                        id
                        title
                        description
                        dateTime
                        endTime
                        eventUrl
                        venue { name address city state country lat lon }
                        rsvpSettings { rsvpLimit }
                        going
                        imageUrl
                        eventType
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await this.graphqlQuery(tokens, query);
    const events: RawPlatformEvent[] = [];

    for (const membership of response.data.self.groupMemberships.edges) {
      const group = membership.node.group;
      for (const eventEdge of group.upcomingEvents.edges) {
        const event = eventEdge.node;
        events.push({
          external_id: event.id,
          platform: 'meetup',
          raw_data: event,
          title: event.title,
          description: event.description,
          start_datetime: event.dateTime,
          end_datetime: event.endTime,
          location: event.venue ? {
            type: event.eventType === 'ONLINE' ? 'online' : 'physical',
            venue_name: event.venue.name,
            address: event.venue.address,
            city: event.venue.city,
            state: event.venue.state,
            country: event.venue.country,
            latitude: event.venue.lat,
            longitude: event.venue.lon,
          } : { type: 'online' },
          cover_image_url: event.imageUrl,
          status: 'live',
          url: event.eventUrl,
          organizer_name: group.name,
        });
      }
    }

    return { data: events, pagination: { has_more: false } };
  }

  async syncAttendance(
    tokens: OAuthTokens,
    externalEventId: string,
  ): Promise<SyncResult<RawPlatformAttendee>> {
    const query = `
      query ($eventId: ID!) {
        event(id: $eventId) {
          rsvps(input: { first: 200 }) {
            edges {
              node {
                id
                member { id name }
                status
              }
            }
          }
        }
      }
    `;

    const response = await this.graphqlQuery(tokens, query, { eventId: externalEventId });

    return {
      data: response.data.event.rsvps.edges.map((edge: any) => ({
        external_id: edge.node.id,
        event_external_id: externalEventId,
        name: edge.node.member.name,
        rsvp_status: edge.node.status.toLowerCase(),
      })),
      pagination: { has_more: false },
    };
  }

  async syncTicketTypes(): Promise<SyncResult<RawPlatformTicketType>> {
    // Meetup does not have ticket type tiers — return a single free "RSVP" type
    return { data: [], pagination: { has_more: false } };
  }

  async registerWebhook(): Promise<WebhookRegistration> {
    throw new Error('Meetup does not support webhooks. Polling is used instead.');
  }

  async parseWebhook(): Promise<WebhookEvent> {
    throw new Error('Meetup does not support webhooks.');
  }

  // --- Helpers ---

  private async graphqlQuery(tokens: OAuthTokens, query: string, variables?: Record<string, unknown>) {
    const res = await fetch('https://api.meetup.com/gql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) throw new Error(`Meetup API ${res.status}: ${await res.text()}`);

    return res.json();
  }

  // OAuth methods follow standard pattern — omitted for brevity
  async getAuthorizationUrl(userId: string, redirectUri: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: process.env.MEETUP_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'ageless event_management',
    });

    return `https://secure.meetup.com/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const res = await fetch('https://secure.meetup.com/oauth2/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.MEETUP_CLIENT_ID!,
        client_secret: process.env.MEETUP_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const data = await res.json();

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      token_type: 'Bearer',
      raw: data,
    };
  }

  async refreshTokens(tokens: OAuthTokens): Promise<OAuthTokens> {
    const res = await fetch('https://secure.meetup.com/oauth2/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.MEETUP_CLIENT_ID!,
        client_secret: process.env.MEETUP_CLIENT_SECRET!,
        refresh_token: tokens.refresh_token!,
      }),
    });
    const data = await res.json();

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? tokens.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      token_type: 'Bearer',
      raw: data,
    };
  }

  async revokeTokens(_tokens: OAuthTokens): Promise<void> {
    // Meetup does not have a revocation endpoint.
    // Atlas deletes stored tokens on disconnect.
  }
}
```

**Rate Limits:** Meetup's GraphQL API has a complexity-based rate limit. Atlas keeps queries simple (no deeply nested pagination) to stay within limits.

---

### 3.4 Generic Webhook Connector

For platforms that do not have an official API but can send webhooks, Atlas provides a generic webhook connector. The organizer configures their platform to POST event data to an Atlas webhook endpoint.

```typescript
export class GenericWebhookConnector implements AtlasConnector {
  readonly platform = 'webhook';

  getCapabilities(): ConnectorCapabilities {
    return {
      oauth: false,
      import_events: false,     // Events arrive via webhook push
      import_ticket_types: false,
      import_pricing: false,
      import_attendance: false,
      webhooks: true,           // Inbound only
      purchase_api: false,
    };
  }

  /**
   * Generates a unique webhook URL for this organizer.
   * Organizer configures their platform to POST to this URL.
   */
  generateWebhookUrl(organizerId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    // Store token → organizerId mapping in DB
    return `https://api.atlas.events/webhooks/generic/${organizerId}?token=${token}`;
  }

  /**
   * Accepts any JSON payload and attempts to extract event data.
   * Uses a best-effort field mapping heuristic.
   */
  async parseWebhook(
    headers: Record<string, string>,
    body: unknown
  ): Promise<WebhookEvent> {
    const payload = body as Record<string, unknown>;

    // Heuristic field detection
    const title = payload.title ?? payload.name ?? payload.event_name ?? payload.summary;
    const start = payload.start ?? payload.start_date ?? payload.start_datetime ?? payload.date;
    const end = payload.end ?? payload.end_date ?? payload.end_datetime;

    return {
      type: 'event.updated',
      external_event_id: String(payload.id ?? payload.event_id ?? crypto.randomUUID()),
      data: {
        title: String(title ?? 'Untitled Event'),
        start_datetime: String(start),
        end_datetime: end ? String(end) : undefined,
        raw: payload,
      },
    };
  }

  // Most methods throw — webhook connector is push-only
  async getAuthorizationUrl(): Promise<string> { throw new Error('N/A'); }
  async exchangeCode(): Promise<OAuthTokens> { throw new Error('N/A'); }
  async refreshTokens(t: OAuthTokens): Promise<OAuthTokens> { return t; }
  async revokeTokens(): Promise<void> {}
  async syncEvents(): Promise<SyncResult<RawPlatformEvent>> {
    return { data: [], pagination: { has_more: false } };
  }
  async syncTicketTypes(): Promise<SyncResult<RawPlatformTicketType>> {
    return { data: [], pagination: { has_more: false } };
  }
  async syncAttendance(): Promise<SyncResult<RawPlatformAttendee>> {
    return { data: [], pagination: { has_more: false } };
  }
  async registerWebhook(): Promise<WebhookRegistration> {
    throw new Error('Generic webhook connector receives webhooks; it does not register them.');
  }
}
```

---

## 4. Sync Architecture

### Sync Modes

```
┌─────────────────────────────────────────────────────────────┐
│                    SYNC ARCHITECTURE                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  INITIAL SYNC (on OAuth connect)                      │   │
│  │                                                        │   │
│  │  Organizer authorizes → Atlas triggers full import     │   │
│  │  1. Fetch all events (paginated)                       │   │
│  │  2. For each event: fetch ticket types                 │   │
│  │  3. For each event: fetch attendance (if supported)    │   │
│  │  4. Normalize all → write to Atlas Registry            │   │
│  │  5. Register webhooks (if supported)                   │   │
│  │  6. Schedule polling job (if webhooks not supported)    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  WEBHOOK SYNC (real-time, Eventbrite)                  │   │
│  │                                                        │   │
│  │  Platform fires webhook → Atlas endpoint               │   │
│  │  1. Verify webhook authenticity (token match)          │   │
│  │  2. Parse payload via connector.parseWebhook()         │   │
│  │  3. Apply delta to Atlas Registry                      │   │
│  │  4. Update synced_at timestamp                         │   │
│  │  Latency: <5 seconds                                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  POLL SYNC (every 15 min, Lu.ma + Meetup)              │   │
│  │                                                        │   │
│  │  Agenda job fires every 15 minutes per connector       │   │
│  │  1. Fetch events from platform API                     │   │
│  │  2. Diff against Atlas Registry                        │   │
│  │  3. Apply inserts/updates/deletes                      │   │
│  │  4. Update synced_at timestamp                         │   │
│  │  Latency: up to 15 minutes                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  MANUAL SYNC (organizer-triggered)                     │   │
│  │                                                        │   │
│  │  Organizer clicks "Sync Now" on dashboard              │   │
│  │  Same as initial sync but incremental (diff-based)     │   │
│  │  Rate limited: max 1 manual sync per 5 minutes         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Sync State Machine

Each connected platform account has a sync state:

```typescript
type SyncState =
  | 'pending'        // OAuth completed, initial sync not yet started
  | 'syncing'        // Sync in progress
  | 'synced'         // Last sync succeeded
  | 'error'          // Last sync failed (retries scheduled)
  | 'paused'         // OAuth token expired or manually paused
  | 'disconnected';  // Organizer disconnected platform

interface PlatformConnection {
  organizer_id: string;
  platform: string;
  tokens_encrypted: string;      // AES-256-GCM encrypted
  sync_state: SyncState;
  last_synced_at?: Date;
  last_error?: string;
  retry_count: number;
  events_synced: number;
  webhook_ids: string[];         // Active webhooks on the platform
  created_at: Date;
  updated_at: Date;
}
```

### Conflict Resolution

When an event is updated on both Atlas and the platform simultaneously:

```
┌──────────────────────────────────────────────────────────┐
│                CONFLICT RESOLUTION                        │
│                                                           │
│  Atlas Direct events: Atlas is source of truth.           │
│  Platform-synced events: Platform is source of truth.     │
│                                                           │
│  Conflict scenario (platform-synced):                     │
│  1. Organizer updates event title on Eventbrite           │
│  2. Simultaneously, Atlas has a cached older version      │
│  3. Webhook arrives with new title                        │
│  4. Atlas overwrites its copy with platform data          │
│  5. Atlas-only fields (tags, Atlas category) preserved    │
│                                                           │
│  Conflict scenario (hybrid — upgraded to Direct):         │
│  1. Event exists on Eventbrite AND as Atlas Direct        │
│  2. Atlas Direct is primary (ticketing happens here)      │
│  3. Eventbrite sync continues for attendance tracking     │
│  4. Atlas Direct fields take precedence for title,        │
│     description, pricing                                  │
│  5. Eventbrite attendance data merged into Atlas records   │
└──────────────────────────────────────────────────────────┘
```

### Deduplication

When the same event exists on multiple platforms:

```typescript
interface DeduplicationResult {
  is_duplicate: boolean;
  confidence: number;         // 0.0 to 1.0
  matched_event_id?: string;  // Existing Atlas event ID
  match_reasons: string[];    // e.g., ["title_95%", "date_exact", "location_same_city"]
}

/**
 * Deduplication heuristic:
 * - Title similarity > 90% (Levenshtein distance)
 * - Start date within 1 hour
 * - Same city OR both online
 * - Confidence threshold: 0.85 to auto-merge, 0.6-0.85 to flag for organizer review
 */
async function checkDuplicate(event: RawPlatformEvent, organizerId: string): Promise<DeduplicationResult> {
  // Query Atlas Registry for organizer's events within +/- 24 hours
  // Compare title similarity, date proximity, location
  // Return confidence score
}
```

---

## 5. Data Flow Pipeline

### End-to-End Architecture

```
┌────────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Platform     │     │  Connector   │     │  Normalizer  │     │   Atlas      │     │   Atlas      │
│   APIs         │────▶│  Adapters    │────▶│              │────▶│   Registry   │────▶│   Discovery  │
│                │     │              │     │              │     │   (MongoDB)  │     │   Index      │
│ - Eventbrite   │     │ - EB Conn.   │     │ Raw → Atlas  │     │              │     │ (Search)     │
│ - Lu.ma        │     │ - Luma Conn. │     │ Schema       │     │ Canonical    │     │              │
│ - Meetup       │     │ - Meetup C.  │     │ transform    │     │ event store  │     │ Agent-facing │
│ - Webhooks     │     │ - Generic    │     │              │     │              │     │ query layer  │
└────────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                                         │
                                                                         ▼
                                                                ┌──────────────┐
                                                                │  Lemonade    │
                                                                │  Backend     │
                                                                │              │
                                                                │ Direct       │
                                                                │ Ticketing    │
                                                                │ Engine       │
                                                                └──────────────┘
```

### Normalizer

The normalizer transforms raw platform data into the Atlas Event Schema. It runs as a pure function with no side effects.

```typescript
/**
 * Normalizer: transforms raw platform events into Atlas events.
 * Stateless, deterministic, side-effect-free.
 */

interface NormalizerContext {
  organizer_id: string;
  platform: string;
  existing_event?: AtlasEvent;  // For updates — preserves Atlas-only fields
}

function normalizeEvent(raw: RawPlatformEvent, ctx: NormalizerContext): Partial<AtlasEvent> {
  return {
    external_ids: {
      ...(ctx.existing_event?.external_ids ?? {}),
      [ctx.platform]: raw.external_id,
    },
    source: raw.platform as AtlasEventSource,
    title: raw.title,
    description: raw.description,
    start_datetime: raw.start_datetime,
    end_datetime: raw.end_datetime,
    timezone: raw.timezone ?? ctx.existing_event?.timezone ?? 'UTC',
    status: normalizeStatus(raw.status, ctx.platform),
    location: normalizeLocation(raw.location),
    cover_image_url: raw.cover_image_url,
    ticketing_mode: ctx.existing_event?.ticketing_mode ?? 'platform',
    purchase_url: raw.url,
    mpp_enabled: ctx.existing_event?.ticketing_mode === 'direct',
    organizer_id: ctx.organizer_id,
    organizer_name: raw.organizer_name ?? ctx.existing_event?.organizer_name ?? '',
    tags: raw.tags ?? ctx.existing_event?.tags ?? [],
    updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  };
}

function normalizeStatus(platformStatus: string, platform: string): AtlasEventStatus {
  const statusMaps: Record<string, Record<string, AtlasEventStatus>> = {
    eventbrite: {
      draft: 'draft',
      live: 'published',
      started: 'started',
      ended: 'ended',
      canceled: 'canceled',
    },
    luma: {
      draft: 'draft',
      published: 'published',
    },
    meetup: {
      upcoming: 'published',
      past: 'ended',
      cancelled: 'canceled',
    },
  };

  return statusMaps[platform]?.[platformStatus] ?? 'published';
}

function normalizeLocation(raw?: RawLocation): AtlasLocation {
  if (!raw) return { type: 'physical' };

  return {
    type: raw.type,
    venue_name: raw.venue_name,
    full_address: raw.address,
    city: raw.city,
    state: raw.state,
    country: raw.country,
    coordinates: raw.latitude && raw.longitude
      ? { latitude: raw.latitude, longitude: raw.longitude }
      : undefined,
    online_url: raw.online_url,
  };
}
```

### Registry Write Path

```typescript
/**
 * Registry: stores normalized events and manages the sync lifecycle.
 */

async function upsertEvent(
  normalized: Partial<AtlasEvent>,
  platform: string,
  externalId: string,
  organizerId: string,
): Promise<AtlasEvent> {
  // Find existing event by external ID + platform + organizer
  const existing = await AtlasEventModel.findOne({
    [`external_ids.${platform}`]: externalId,
    organizer_id: organizerId,
  });

  if (existing) {
    // Update — merge normalized fields, preserve Atlas-only fields
    const updated = {
      ...existing.toObject(),
      ...normalized,
      // Preserve Atlas-only fields that platform doesn't know about:
      id: existing.id,
      tags: normalized.tags?.length ? normalized.tags : existing.tags,
      category: existing.category,
      ticketing_mode: existing.ticketing_mode,
      mpp_enabled: existing.mpp_enabled,
      created_at: existing.created_at,
    };

    await AtlasEventModel.updateOne({ id: existing.id }, { $set: updated });

    return updated as AtlasEvent;
  }

  // Insert new event
  const newEvent: AtlasEvent = {
    id: crypto.randomUUID(),
    ...normalized,
    ticketing_mode: 'platform',
    mpp_enabled: false,
    created_at: new Date().toISOString(),
    indexed_at: new Date().toISOString(),
  } as AtlasEvent;

  await AtlasEventModel.create(newEvent);

  // Trigger discovery indexing
  await indexForDiscovery(newEvent);

  return newEvent;
}
```

---

## 6. Event Ownership Verification

### Ownership Chain

```
┌──────────────────────────────────────────────────────────────────────┐
│                    OWNERSHIP VERIFICATION                            │
│                                                                      │
│   Step 1: Organizer authenticates on Atlas                           │
│           → Atlas knows: "This is user U"                            │
│                                                                      │
│   Step 2: Organizer completes OAuth with Eventbrite                  │
│           → Eventbrite says: "OAuth token T belongs to account A"    │
│                                                                      │
│   Step 3: Atlas fetches events using token T                         │
│           → Eventbrite says: "Account A owns events [E1, E2, E3]"   │
│                                                                      │
│   Step 4: Atlas records the chain:                                   │
│           User U → Platform Account A → Events [E1, E2, E3]         │
│                                                                      │
│   Verification: The OAuth flow IS the proof.                         │
│   Only the account owner can complete OAuth.                         │
│   Only the account owner's events are returned by the API.           │
└──────────────────────────────────────────────────────────────────────┘
```

### Ownership Model

```typescript
interface EventOwnership {
  atlas_event_id: string;
  organizer_id: string;           // Atlas user
  platform: string;               // 'eventbrite' | 'luma' | 'meetup' | 'atlas_direct'
  platform_account_id?: string;   // Platform-side account/org ID
  external_event_id?: string;     // Platform-side event ID
  ownership_type: 'sole' | 'cohost' | 'transferred';
  verified_at: string;            // ISO 8601
  verification_method: 'oauth' | 'api_key' | 'manual_claim';
}
```

### Edge Case Handling

**Co-hosted events:**
```
Organizer A connects Eventbrite → imports event E (they are primary host)
Organizer B connects Eventbrite → imports event E (they are co-host)

Atlas detects: same external_id, different organizer_ids
  → Both get ownership records with type 'sole' (A) and 'cohost' (B)
  → Event appears in both dashboards
  → Reward split: configurable by primary host (default 50/50)
  → Only primary host can upgrade to Direct Ticketing
```

**Transferred events:**
```
Organizer A imports event E
  → Later, A transfers event to B on Eventbrite
  → Next sync: A's token no longer returns E in their events list
  → Atlas marks A's ownership as 'transferred'
  → If B connects Atlas: B's sync picks up E, B gets ownership
  → If B never connects: event becomes orphaned after 30 days
```

---

## 7. Direct Ticketing Integration

When an organizer upgrades a platform-synced event to Atlas Direct Ticketing, Atlas provisions Lemonade ticketing infrastructure under the hood.

### Upgrade Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                UPGRADE TO DIRECT TICKETING                        │
│                                                                   │
│  1. Organizer clicks "Upgrade to Atlas Direct" on dashboard       │
│     │                                                             │
│     ▼                                                             │
│  2. Atlas creates Lemonade Event via backend API                  │
│     POST /graphql → aiCreateEvent mutation                        │
│     Input: title, description, start, end, location               │
│     (copied from synced event data)                               │
│     │                                                             │
│     ▼                                                             │
│  3. Atlas creates Lemonade Ticket Types                           │
│     POST /graphql → aiCreateEventTicketType mutation              │
│     For each synced ticket type:                                  │
│       { event, title, prices: [{ currency, cost }],               │
│         ticket_limit, ticket_limit_per }                          │
│     │                                                             │
│     ▼                                                             │
│  4. Atlas updates event record:                                   │
│     ticketing_mode: 'direct'  (was 'platform')                    │
│     mpp_enabled: true                                             │
│     lemonade_event_id: <new Lemonade event ID>                    │
│     │                                                             │
│     ▼                                                             │
│  5. Atlas publishes event via aiPublishEvent                      │
│     Event is now purchasable via MPP 402                          │
│     │                                                             │
│     ▼                                                             │
│  6. Platform sync continues for attendance tracking               │
│     But ticketing data now comes from Lemonade                    │
│     Atlas shows both data sources in dashboard                    │
└──────────────────────────────────────────────────────────────────┘
```

### Lemonade Backend Integration Points

Atlas Direct Ticketing maps to these Lemonade backend components:

| Atlas Operation | Lemonade Backend | File |
|---|---|---|
| Create event | `aiCreateEvent` mutation | `src/graphql/resolvers/ai-tool.ts` |
| Create ticket type | `aiCreateEventTicketType` mutation | `src/graphql/resolvers/ai-tool.ts` |
| Update ticket type | `aiUpdateEventTicketType` mutation | `src/graphql/resolvers/ai-tool.ts` |
| Publish event | `aiPublishEvent` mutation | `src/graphql/resolvers/ai-tool.ts` |
| Process ticket purchase | `createTickets` service | `src/app/services/ticket.ts` |
| Handle refund | Existing payment refund flow | `src/app/services/new-payment.ts` |
| Check-in | `EventCheckinModel` | `src/app/models/event-checkin.ts` |
| Event model | `EventModel` (Typegoose) | `src/app/models/event.ts` |
| Ticket type model | `EventTicketTypeModel` | `src/app/models/event-ticket-type.ts` |
| Ticket model | `TicketModel` | `src/app/models/ticket.ts` |

### Settlement Flow

```
Ticket purchased (USDC on Tempo)
  │
  ├─── 2% protocol fee → Atlas treasury wallet
  │
  └─── 98% → Organizer payout wallet (USDC on Tempo)
       │
       ├─── Instant: if organizer has Tempo wallet
       └─── Batched: if organizer uses external wallet (batched hourly to save gas)

Ticket purchased (Fiat via Stripe SPT)
  │
  ├─── Stripe processes card charge
  ├─── Stripe fee: ~2.9% + $0.30 (paid by buyer or absorbed by organizer — configurable)
  ├─── 2% protocol fee → Atlas treasury
  └─── Remainder → converted to USDC → organizer payout wallet
       (conversion via Tempo on-ramp, spread ~0.5%)
```

---

## 8. Security

### Token Storage

```typescript
/**
 * OAuth tokens are encrypted at rest using AES-256-GCM.
 * Encryption key stored in AWS SSM Parameter Store, rotated quarterly.
 */

interface EncryptedTokenStore {
  // Store
  async saveTokens(organizerId: string, platform: string, tokens: OAuthTokens): Promise<void>;

  // Retrieve + decrypt
  async getTokens(organizerId: string, platform: string): Promise<OAuthTokens | null>;

  // Delete (on disconnect)
  async deleteTokens(organizerId: string, platform: string): Promise<void>;
}

// Implementation uses:
// - AES-256-GCM encryption (crypto.createCipheriv)
// - Per-token IV (initialization vector)
// - Key from AWS SSM: /atlas/production/token-encryption-key
// - Encrypted blob stored in MongoDB (PlatformConnection.tokens_encrypted)
```

**Security properties:**
- Tokens never stored in plaintext
- Encryption key never in environment variables (SSM only)
- Key rotation: new key encrypts new tokens; old key kept for decryption during migration window
- Token access logged (audit trail)

### Scope Minimization

| Platform | Requested Scopes | Justification |
|----------|-------------------|---------------|
| Eventbrite | `eventbrite.organizer`, `eventbrite.event_read`, `webhook_manage` | Read events + manage webhooks. No write access to events. |
| Meetup | `ageless`, `event_management` | Read events + RSVPs. `ageless` prevents token expiry. |
| Google (future) | `calendar.readonly` | Read-only calendar access for event import. |

**Principle:** Request the minimum scopes needed. Never request write access to platform events unless Atlas needs to create/modify events on the platform (currently: never).

### Token Refresh

```typescript
/**
 * Token refresh middleware. Runs before every API call to a platform.
 * Handles expired tokens transparently.
 */

async function withFreshTokens<T>(
  organizerId: string,
  platform: string,
  connector: AtlasConnector,
  operation: (tokens: OAuthTokens) => Promise<T>
): Promise<T> {
  let tokens = await tokenStore.getTokens(organizerId, platform);
  if (!tokens) throw new Error(`No tokens for ${platform}`);

  // Check if tokens need refresh (60s buffer)
  if (tokens.expires_at && Date.now() / 1000 >= tokens.expires_at - 60) {
    if (tokens.refresh_token) {
      tokens = await connector.refreshTokens(tokens);
      await tokenStore.saveTokens(organizerId, platform, tokens);
    } else {
      // No refresh token and expired — mark connection as paused
      await updateConnectionState(organizerId, platform, 'paused');
      throw new Error(`${platform} token expired and no refresh token available`);
    }
  }

  try {
    return await operation(tokens);
  } catch (error: any) {
    // Handle 401 — token revoked on platform side
    if (error.status === 401 || error.message?.includes('401')) {
      await updateConnectionState(organizerId, platform, 'paused');
      throw new Error(`${platform} token revoked or invalid`);
    }
    throw error;
  }
}
```

### Platform API Rate Limit Compliance

```typescript
/**
 * Per-connector rate limiter using token bucket algorithm.
 * Prevents Atlas from exceeding platform API limits.
 */

interface RateLimiterConfig {
  platform: string;
  max_requests_per_hour: number;  // e.g., 2000 for Eventbrite
  burst_size: number;             // Max concurrent requests
}

const RATE_LIMITS: Record<string, RateLimiterConfig> = {
  eventbrite: { platform: 'eventbrite', max_requests_per_hour: 2000, burst_size: 20 },
  meetup:     { platform: 'meetup',     max_requests_per_hour: 500,  burst_size: 10 },
  luma:       { platform: 'luma',       max_requests_per_hour: 1000, burst_size: 10 },
};
```

### Webhook Verification

```typescript
/**
 * Verify incoming webhooks are authentic.
 * Each platform uses a different verification method.
 */

// Eventbrite: Token match (same as existing Lemonade implementation)
// The webhook URL includes a secret token parameter:
//   /webhooks/eventbrite?token={random_token}&event_id={id}
// On receive: compare URL token with stored event.eventbrite_token

// Generic webhooks: HMAC-SHA256 signature
// Organizer is given a signing secret on setup
// Webhook request must include X-Atlas-Signature header
// Atlas verifies: HMAC(secret, request_body) === signature
```

---

## 9. Error Handling and Monitoring

### Retry Strategy

```typescript
const RETRY_CONFIG = {
  initial_delay_ms: 5_000,      // 5 seconds
  max_delay_ms: 900_000,        // 15 minutes
  backoff_multiplier: 2,
  max_retries: 5,
  // After max_retries: mark connection as 'error', notify organizer
};
```

### Error Classification

| Error Type | Retry? | Organizer Notification? | Action |
|------------|--------|------------------------|--------|
| 401 Unauthorized | No | Yes — "Re-authorize {platform}" | Mark connection paused |
| 403 Forbidden | No | Yes — "Check permissions on {platform}" | Mark connection paused |
| 404 Not Found (event) | No | No — event deleted on platform | Remove from Atlas |
| 429 Rate Limited | Yes (with backoff) | No | Wait for rate limit reset |
| 500 Server Error | Yes (3 retries) | After 3 failures | Exponential backoff |
| Network timeout | Yes (3 retries) | After 3 failures | Exponential backoff |
| Invalid data | No | Yes — "Sync error for {event}" | Skip event, continue sync |

### Monitoring Metrics

```
atlas_connector_sync_total{platform, status}        # Counter: syncs attempted
atlas_connector_sync_duration_seconds{platform}      # Histogram: sync latency
atlas_connector_events_synced{platform}              # Gauge: events currently synced
atlas_connector_errors_total{platform, error_type}   # Counter: errors by type
atlas_connector_token_refresh_total{platform}        # Counter: token refreshes
atlas_connector_webhook_received_total{platform}     # Counter: webhooks received
atlas_connector_rate_limit_hits{platform}            # Counter: rate limit 429s
```

### Organizer-Facing Error States

The dashboard shows clear, actionable error states:

| State | Dashboard Display | CTA |
|-------|-------------------|-----|
| `synced` | "Synced 2 minutes ago" (green) | -- |
| `syncing` | "Syncing..." (blue spinner) | -- |
| `error` (retrying) | "Sync issue — retrying" (yellow) | -- |
| `error` (max retries) | "Sync failed — check connection" (red) | [Retry Now] |
| `paused` (token expired) | "Re-authorize required" (red) | [Re-connect {Platform}] |
| `disconnected` | "{Platform} disconnected" (gray) | [Reconnect] |
