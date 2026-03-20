# IMPL: Phase 1 — Event Source Connectors (Eventbrite, Lu.ma)

> **Type:** Implementation Handover
> **Author:** Bridge Agent
> **Date:** 2026-03-19
> **Status:** READY FOR ROUTING
> **Repo(s):** `lemonade-backend`, `web-new`
> **Branch:** `feat/event-source-connectors`

---

## 1. Summary

Add two event-platform connector plugins (Eventbrite, Lu.ma) to the existing ConnectorPlugin system. Each connector syncs external events into Lemonade as native Event documents, with optional attendee and ticket-type synchronization. A new `ExternalEventMapping` model tracks which external events map to which Lemonade events per connection, enabling idempotent re-sync. A shared `event-sync-utils.ts` module handles the common logic of creating/updating Lemonade events from normalized external data.

All actions include `triggerTypes: ['ai']` so they auto-register as MCP tools via the existing `tool-registrar.ts` pipeline.

> **Meetup connector deferred to Phase 5.** Eventbrite + Lu.ma cover the highest-value segments (tech/AI + general events). Meetup is mostly free events behind a Meetup Pro API paywall ($200/yr) — lower priority for launch.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Connector Registry (src/connectors/index.ts)           │
│  ├── google-sheets (existing)                           │
│  ├── airtable (existing)                                │
│  ├── eventbrite (NEW)                                   │
│  └── luma (NEW)                                         │
└───────────┬─────────────────────────────────────────────┘
            │ executeAction()
            ▼
┌─────────────────────────────────────────────────────────┐
│  event-sync-utils.ts (NEW shared module)                │
│  - normalizeExternalEvent() → NormalizedEvent           │
│  - upsertLemonadeEvent() → creates/updates Event doc    │
│  - upsertTicketTypes() → creates/updates ticket types   │
│  - upsertAttendees() → imports attendees via existing   │
│    importGuestsByEmail()                                │
└───────────┬─────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  ExternalEventMapping (NEW model)                       │
│  Maps: (connectionId, externalPlatform, externalEventId)│
│  → lemonadeEventId                                      │
│  Enables idempotent sync (update, not duplicate)        │
└─────────────────────────────────────────────────────────┘
```

---

## 3. New Model: ExternalEventMapping

### File: `lemonade-backend/src/app/models/external-event-mapping.ts` (NEW)

```typescript
import { Field, ObjectType, registerEnumType } from 'type-graphql';
import { getModelForClass, index, modelOptions, prop } from '@typegoose/typegoose';
import { Types } from 'mongoose';

export enum ExternalPlatform {
  eventbrite = 'eventbrite',
  luma = 'luma',
  meetup = 'meetup',        // Reserved for Phase 5
  dice = 'dice',            // Reserved for Phase 5
  resident_advisor = 'resident_advisor', // Reserved for Phase 5
  webhook = 'webhook',      // Reserved for Phase 5 (generic)
  api = 'api',              // Reserved for Phase 5 (generic)
}

registerEnumType(ExternalPlatform, { name: 'ExternalPlatform' });

@ObjectType()
@index({ connectionId: 1, externalPlatform: 1, externalEventId: 1 }, { unique: true })
@index({ lemonadeEventId: 1 })
@index({ connectionId: 1 })
@modelOptions({ schemaOptions: { collection: 'external_event_mappings' } })
export class ExternalEventMapping {
  @Field()
  _id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  connectionId!: Types.ObjectId;

  @Field(() => ExternalPlatform)
  @prop({ required: true, type: String, enum: ExternalPlatform })
  externalPlatform!: ExternalPlatform;

  @Field()
  @prop({ required: true })
  externalEventId!: string;

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  lemonadeEventId!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  spaceId!: Types.ObjectId;

  /** Raw external event URL for reference/linking */
  @Field({ nullable: true })
  @prop()
  externalUrl?: string;

  /** External event title at last sync (for display without re-fetching) */
  @Field({ nullable: true })
  @prop()
  externalTitle?: string;

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop()
  updated_at?: Date;

  /** Last time this mapping was synced */
  @Field({ nullable: true })
  @prop({ type: Date })
  lastSyncedAt?: Date;

  /** Connector tier that was active when this mapping was created (for future Phase 5 limits) */
  @Field({ nullable: true })
  @prop()
  tier?: string;

  /** > AUDIT FIX R2 [E2]: Track external event sync status. When source event is
   *  cancelled/deleted, set to 'source_cancelled'. The Atlas Registry health check
   *  will stop returning cancelled events. */
  @Field({ nullable: true })
  @prop()
  status?: string;  // 'active' | 'source_cancelled'
}

export { ExternalEventMapping as TExternalEventMapping };

export const ExternalEventMappingModel = getModelForClass(ExternalEventMapping);

export default ExternalEventMappingModel;
```

**Key design notes:**
- Unique compound index `(connectionId, externalPlatform, externalEventId)` prevents duplicate mappings
- `tier` field is nullable — reserved for Phase 5 subscription-tier enforcement
- `spaceId` enables querying all mapped events for a space (for UI listing)

> **AUDIT FIX R2 [E13]:** Synced events are DISCOVERY-ONLY for launch. No Atlas Direct Ticketing
> on synced events. Add `atlas_direct_ticketing_eligible` field to ExternalEventMapping:

```typescript
  /** > AUDIT FIX R2 [E13]: Synced events are discovery-only for launch.
   *  Only native Lemonade events (no ExternalEventMapping record) are eligible
   *  for Atlas Direct Ticketing. This flag defaults to false and must not be
   *  set to true for any synced event at launch. */
  @Field({ nullable: true })
  @prop({ default: false })
  atlas_direct_ticketing_eligible?: boolean;
```

**E13 Launch Decision:** For launch, `atlas_direct_ticketing_eligible` is always `false` on synced events.
The Atlas purchase flow must check: if an `ExternalEventMapping` record exists for the event AND
`atlas_direct_ticketing_eligible !== true`, reject with "This event is managed on an external platform.
Purchase tickets at {externalUrl}." Only native Lemonade events (no ExternalEventMapping record) are
eligible for Atlas Direct Ticketing. Dual-mode (selling on both Atlas and external platform) may be
added in a future phase with proper inventory sync.

---

### 3.1 Connection Model Changes (MODIFY existing model)

> **AUDIT FIX R2 [E1]:** Add `externalAccountId` field and unique compound index to prevent the
> same external platform account from being connected to multiple Spaces.

#### File: `lemonade-backend/src/app/models/connection.ts` (MODIFY)

**Verified existing fields** (`connection.ts`): `connectorType` (string, required), `spaceId` (ObjectId, required), `installedBy` (string, required), `status` (ConnectionStatus enum), `enabled` (boolean). Existing unique index: `(spaceId, connectorType)`.

Add the following field to the `Connection` class:

```typescript
  /** > AUDIT FIX R2 [E1]: Platform-side user ID, populated during OAuth callback
   *  or API key validation. Used with the compound index below to prevent the
   *  same external account from connecting to multiple Spaces.
   *  - Eventbrite: fetched from GET /v3/users/me/ → response.id
   *  - Lu.ma: the API key itself (one API key = one user)
   *  - Meetup (Phase 5): from OAuth token user info */
  @Field({ nullable: true })
  @prop()
  externalAccountId?: string;
```

Add the following index decorator to the `Connection` class:

```typescript
// > AUDIT FIX R2 [E1]: Prevent same external account on multiple Spaces.
// sparse: true so existing connections without externalAccountId are not affected.
@index({ connectorType: 1, externalAccountId: 1 }, { unique: true, sparse: true })
```

> **AUDIT FIX R3 [F1]:** Known limitation: The `externalAccountId` uniqueness check prevents
> the same platform account from connecting to multiple Spaces, but does not prevent the same
> person from creating multiple platform accounts (e.g., multiple Eventbrite accounts).
> **Mitigations:**
> 1. Self-purchase exclusion (Phase 4, P4-C1) prevents reward gaming through own events.
> 2. Registry dedup (E8) prevents search flooding from duplicate events.
> 3. Max 3 Spaces per user — enforce in Space creation resolver: query `SpaceModel.countDocuments({ owner: userId })` and reject if >= 3. This limits the blast radius of multi-account attacks.
>
> ~~Full mitigation requires identity verification (KYC), deferred to a future phase.~~
>
> **AUDIT FIX R4 [SV-2]:** This limitation is now RESOLVED for Self-verified users.
> Self.xyz verification = one verified identity per person. The new
> `selfVerifiedIdentityId` field + unique compound index on Connection prevents
> a Self-verified user from having event connectors on more than 1 Space globally,
> regardless of how many Lemonade accounts or platform accounts they create.
> Unverified users retain the weaker `externalAccountId` constraint above.

Add the following field for E4 audit logging:

```typescript
  /** > AUDIT FIX R2 [E4]: Track which Lemonade user connected this external account,
   *  for detecting OAuth token theft (same externalAccountId previously connected
   *  by a different user). */
  @Field({ nullable: true })
  @prop()
  connectedByUserId?: string;

  /** > AUDIT FIX R4 [SV-2]: Self.xyz verified identity ID. Populated during
   *  connectPlatform if the user has completed Self verification. Used with the
   *  compound index below to enforce: max 1 Space with event connectors per
   *  verified identity globally. This resolves R3 known limitation F1
   *  (multi-account bypass) — Self-verified users cannot create multiple verified
   *  Spaces with event connectors. Unverified users keep the existing weaker
   *  externalAccountId constraint. */
  @Field({ nullable: true })
  @prop()
  selfVerifiedIdentityId?: string;
```

Add the following index decorator to the `Connection` class (in addition to the existing E1 index):

```typescript
// > AUDIT FIX R4 [SV-2]: Enforce max 1 Space with event connectors per Self-verified identity.
// sparse: true so unverified users (null selfVerifiedIdentityId) are not affected.
// This prevents the same verified person from connecting event connectors on multiple Spaces
// even if they create multiple Lemonade accounts.
@index({ connectorType: 1, selfVerifiedIdentityId: 1 }, { unique: true, sparse: true })
```

> **AUDIT FIX R4 [SV-2]:** `connectPlatform` flow enforcement for Self-verified users.
> In the `connectPlatform` resolver (where the Connection is created/validated), add
> the following check BEFORE creating the connection:
>
> ```typescript
> // > AUDIT FIX R4 [SV-2]: If user is Self-verified, enforce global limit:
> // > max 1 Space with event connectors per verified identity.
> // > Read the user's Self verification status from the existing Self.xyz integration.
> // > Agent MUST grep for `self` or `selfxyz` or `self_xyz` or `verified` in the
> // > User model to find the existing field name.
> if (user.selfVerifiedIdentityId && ['eventbrite', 'luma'].includes(connectorType)) {
>   const existingVerifiedConnection = await ConnectionModel.findOne({
>     _id: { $ne: currentConnectionId }, // Exclude self during re-auth
>     connectorType: { $in: ['eventbrite', 'luma'] },
>     selfVerifiedIdentityId: user.selfVerifiedIdentityId,
>   }).lean();
>
>   if (existingVerifiedConnection) {
>     throw new Error(
>       'Your verified identity already has event connectors on another Space. '
>       + 'Self-verified users are limited to 1 Space with event connectors. '
>       + 'Disconnect the connector on the other Space first.',
>     );
>   }
>
>   // Store the verified identity ID on the new connection
>   connectionUpdate.selfVerifiedIdentityId = user.selfVerifiedIdentityId;
> }
> ```
>
> **Design rationale:** The unique compound index `(connectorType, selfVerifiedIdentityId)`
> with `sparse: true` is the DB-level safety net. The application-level check above provides
> a clear user-facing error message. Unverified users (null `selfVerifiedIdentityId`) are
> unaffected by this constraint and continue using the weaker `externalAccountId` check from E1.

#### Migration: `lemonade-backend/src/db/migrations/{timestamp}-add-connection-self-verified-identity-index.ts` (NEW)

> **AUDIT FIX R4 [SV-2]:** Migration for Self-verified identity unique compound index.

```typescript
import { type Db } from 'mongodb';

export async function up(db: Db): Promise<void> {
  // > AUDIT FIX R4 [SV-2]: Unique compound index to prevent same Self-verified
  // > identity from having event connectors on multiple Spaces.
  await db.collection('connections').createIndex(
    { connectorType: 1, selfVerifiedIdentityId: 1 },
    { unique: true, sparse: true },
  );
}

export async function down(db: Db): Promise<void> {
  await db.collection('connections').dropIndex('connectorType_1_selfVerifiedIdentityId_1');
}
```

#### Migration: `lemonade-backend/src/db/migrations/{timestamp}-add-connection-external-account-id-index.ts` (NEW)

```typescript
import { type Db } from 'mongodb';

export async function up(db: Db): Promise<void> {
  // > AUDIT FIX R2 [E1]: Unique compound index to prevent same external account on multiple Spaces
  await db.collection('connections').createIndex(
    { connectorType: 1, externalAccountId: 1 },
    { unique: true, sparse: true },
  );
}

export async function down(db: Db): Promise<void> {
  await db.collection('connections').dropIndex('connectorType_1_externalAccountId_1');
}
```

---

## 4. Shared Event Sync Utilities

### File: `lemonade-backend/src/connectors/event-sync-utils.ts` (NEW)

This module provides the shared logic all event connectors use to create/update Lemonade events.

```typescript
import { Types } from 'mongoose';
import { nanoid } from 'nanoid';

import EventModel from '../app/models/event';
import { EventTicketTypeModel } from '../app/models/event-ticket-type';
import { ExternalEventMappingModel, ExternalPlatform } from '../app/models/external-event-mapping';
import { importGuestsByEmail, type ImportGuest } from './guest-utils';
import { slugify } from '../app/utils/string';

// ─── Normalized Types ──────────────────────────────────────────────────────────

export interface NormalizedEvent {
  externalId: string;
  title: string;
  description?: string;           // HTML description
  descriptionPlainText?: string;   // Plain-text fallback
  start: Date;
  end: Date;
  coverUrl?: string;
  virtual: boolean;
  virtualUrl?: string;
  address?: {
    street_1?: string;
    street_2?: string;
    city?: string;
    region?: string;
    postal?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    title?: string;               // Venue name
  };
  externalUrl?: string;
  currency?: string;              // ISO 4217
  published?: boolean;            // Default: false (let organizer review before publishing)
}

export interface NormalizedTicketType {
  externalId: string;
  title: string;
  description?: string;
  free: boolean;
  /** Price in the smallest currency unit (cents). String for BigInt compat with EventTicketPrice.cost */
  priceCents?: string;
  currency?: string;
  capacity?: number;
  salesStart?: Date;
  salesEnd?: Date;
}

export interface NormalizedAttendee {
  email: string;
  ticketTypeName?: string;        // External ticket type name (matched by title)
}

// ─── Free Event Detection ───────────────────────────────────────────────────────

/**
 * > **AUDIT FIX R4 [FT-2]:** Determines if an event is free based on its ticket types.
 * An event is considered free if ALL of its ticket types have cost "0" (or are marked free).
 * Free events are discovery-only. Agents discover them via Atlas search but are directed
 * to source platform for claiming. The `atlas:purchase_endpoint` field should be
 * omitted/null in the Atlas event output for free events.
 */
export function isEventFree(ticketTypes: NormalizedTicketType[]): boolean {
  if (ticketTypes.length === 0) return true; // No ticket types = free event
  return ticketTypes.every((tt) => tt.free || tt.priceCents === '0' || !tt.priceCents);
}

// ─── Upsert Event ──────────────────────────────────────────────────────────────

export interface UpsertEventOptions {
  connectionId: Types.ObjectId;
  spaceId: Types.ObjectId;
  hostUserId: Types.ObjectId;
  platform: ExternalPlatform;
  normalized: NormalizedEvent;
}

export interface UpsertEventResult {
  eventId: Types.ObjectId;
  created: boolean;               // true if newly created, false if updated
  externalUrl?: string;
  /** > AUDIT FIX R2 [E3]: Expose sync freshness so agents/Registry can see data age */
  lastSyncedAt: Date;
}

/**
 * Creates or updates a Lemonade Event from normalized external event data.
 * Uses ExternalEventMapping to determine if the event already exists.
 *
 * Events are created as unpublished by default — the organizer should
 * review and publish manually (or via a separate action).
 */
export async function upsertLemonadeEvent(opts: UpsertEventOptions): Promise<UpsertEventResult> {
  const { connectionId, spaceId, hostUserId, platform, normalized } = opts;

  // Check for existing mapping
  const existing = await ExternalEventMappingModel.findOne({
    connectionId,
    externalPlatform: platform,
    externalEventId: normalized.externalId,
  }).lean();

  const eventFields: Record<string, unknown> = {
    title: normalized.title,
    start: normalized.start,
    end: normalized.end,
    ...(normalized.description !== undefined && { description: normalized.description }),
    ...(normalized.descriptionPlainText !== undefined && { description_plain_text: normalized.descriptionPlainText }),
    ...(normalized.coverUrl !== undefined && { cover: normalized.coverUrl }),
    ...(normalized.virtual !== undefined && { virtual: normalized.virtual }),
    ...(normalized.virtualUrl !== undefined && { virtual_url: normalized.virtualUrl }),
    ...(normalized.address && {
      address: normalized.address,
      ...(normalized.address.latitude != null && normalized.address.longitude != null && {
        latitude: normalized.address.latitude,
        longitude: normalized.address.longitude,
        location: {
          type: 'Point',
          coordinates: [normalized.address.longitude, normalized.address.latitude],
        },
      }),
    }),
  };

  if (existing) {
    // > **AUDIT FIX [P1-M3]:** Check if the event was manually edited locally since
    // > last sync. If so, skip the update to avoid overwriting manual edits.
    const existingEvent = await EventModel.findById(existing.lemonadeEventId, { updated_at: 1 }).lean();
    if (existingEvent?.updated_at && existing.lastSyncedAt && existingEvent.updated_at > existing.lastSyncedAt) {
      // Event was modified locally after last sync — skip update, only refresh mapping timestamp
      await ExternalEventMappingModel.updateOne(
        { _id: existing._id },
        { $set: { lastSyncedAt: new Date(), externalTitle: normalized.title, updated_at: new Date() } },
      );

      const syncTime = new Date();
      return { eventId: existing.lemonadeEventId, created: false, externalUrl: normalized.externalUrl, lastSyncedAt: syncTime };
    }

    // Update existing event
    await EventModel.updateOne(
      { _id: existing.lemonadeEventId },
      { $set: { ...eventFields, updated_at: new Date() } },
    );

    const syncTime = new Date();
    await ExternalEventMappingModel.updateOne(
      { _id: existing._id },
      { $set: { lastSyncedAt: syncTime, externalTitle: normalized.title, updated_at: new Date() } },
    );

    return { eventId: existing.lemonadeEventId, created: false, externalUrl: normalized.externalUrl, lastSyncedAt: syncTime };
  }

  // Create new event
  // > **AUDIT FIX [P1-C1]:** `slugify` does NOT add nanoid suffixes — it only
  // > kebab-cases the string. Append `-${nanoid(8)}` to guarantee uniqueness.
  // > Verified: `src/app/utils/string.ts:19-29` — no randomness added.
  const event = await EventModel.create({
    ...eventFields,
    slug: `${slugify(normalized.title)}-${nanoid(8)}`,
    host: hostUserId,
    space: spaceId,
    published: normalized.published ?? false,
    created_at: new Date(),
  });

  // Create mapping
  const syncTime = new Date();
  await ExternalEventMappingModel.create({
    connectionId,
    externalPlatform: platform,
    externalEventId: normalized.externalId,
    lemonadeEventId: event._id,
    spaceId,
    externalUrl: normalized.externalUrl,
    externalTitle: normalized.title,
    lastSyncedAt: syncTime,
  });

  return { eventId: event._id, created: true, externalUrl: normalized.externalUrl, lastSyncedAt: syncTime };
}

// ─── Atlas Schema Mapping for Free Events ──────────────────────────────────────

/**
 * > **AUDIT FIX R4 [FT-2]:** When mapping synced events to the Atlas event schema
 * (for Registry indexing / agent discovery), check `isEventFree(ticketTypes)`.
 * If the event is free, omit the `atlas:purchase_endpoint` field entirely (set to null).
 *
 * Free events are discovery-only. Agents discover them via Atlas search but are
 * directed to the source platform for claiming. This prevents bots from flooding
 * Atlas Direct Ticketing with free ticket claims (no payment barrier = pure DB flooding).
 *
 * Usage in schema mapper (when building Atlas event output):
 * ```typescript
 * const atlasEvent = {
 *   ...baseFields,
 *   'atlas:purchase_endpoint': isEventFree(ticketTypes) ? null : purchaseEndpointUrl,
 * };
 * ```
 *
 * Combined with Phase 2 FT-2 fix (purchase controller rejects free tickets with redirect),
 * this ensures free events never enter the Atlas payment flow.
 */

// ─── Upsert Ticket Types ──────────────────────────────────────────────────────

export interface UpsertTicketTypesOptions {
  eventId: Types.ObjectId;
  ticketTypes: NormalizedTicketType[];
  defaultCurrency?: string;
}

/**
 * Creates or updates ticket types for a synced event.
 * Matches existing ticket types by title (case-insensitive).
 */
export async function upsertTicketTypes(opts: UpsertTicketTypesOptions): Promise<{ created: number; updated: number }> {
  const { eventId, ticketTypes, defaultCurrency } = opts;

  const existingTypes = await EventTicketTypeModel.find({ event: eventId }, { _id: 1, title: 1 }).lean();
  const existingByTitle = new Map(existingTypes.map((t) => [(t.title || '').toLowerCase(), t._id]));

  let created = 0;
  let updated = 0;

  for (let i = 0; i < ticketTypes.length; i++) {
    const tt = ticketTypes[i];
    const existingId = existingByTitle.get(tt.title.toLowerCase());

    const currency = tt.currency || defaultCurrency || 'USD';
    const prices = tt.free
      ? [{ default: true, currency, cost: '0' }]
      : tt.priceCents
        ? [{ default: true, currency, cost: tt.priceCents }]
        : [{ default: true, currency, cost: '0' }];

    if (existingId) {
      await EventTicketTypeModel.updateOne(
        { _id: existingId },
        {
          $set: {
            description: tt.description,
            prices,
            ...(tt.capacity != null && { ticket_limit: tt.capacity }),
            updated_at: new Date(),
          },
        },
      );
      updated++;
    } else {
      await EventTicketTypeModel.create({
        event: eventId,
        title: tt.title,
        description: tt.description,
        active: true,
        default: i === 0 && existingTypes.length === 0, // First type is default only if no existing types
        prices,
        ...(tt.capacity != null && { ticket_limit: tt.capacity }),
        position: existingTypes.length + i,
        created_at: new Date(),
      });
      created++;
    }
  }

  return { created, updated };
}

// ─── Sync Attendees ────────────────────────────────────────────────────────────

/**
 * Imports attendees into a Lemonade event using the existing importGuestsByEmail utility.
 * Deduplicates against existing join requests automatically.
 */
export async function syncAttendees(
  eventId: Types.ObjectId,
  attendees: NormalizedAttendee[],
): Promise<{ imported: number; skipped: number; failed: number }> {
  if (attendees.length === 0) {
    return { imported: 0, skipped: 0, failed: 0 };
  }

  const guests: ImportGuest[] = attendees.map((a) => ({
    email: a.email,
    ticketType: a.ticketTypeName,
  }));

  const result = await importGuestsByEmail(eventId.toString(), guests);

  return {
    imported: result.recordsProcessed,
    skipped: result.skipped,
    failed: result.recordsFailed,
  };
}
```

---

## 5. Eventbrite Connector

### File: `lemonade-backend/src/connectors/eventbrite/index.ts` (NEW)

**API reference:** Eventbrite REST API v3 (`https://www.eventbriteapi.com/v3/`)

**Auth:** OAuth2 (no PKCE). Eventbrite uses standard authorization code flow.
- Authorization URL: `https://www.eventbrite.com/oauth/authorize`
- Token URL: `https://www.eventbrite.com/oauth/token`
- Scopes: Not granular in Eventbrite OAuth — one scope covers all.
- Token refresh: Eventbrite tokens do NOT expire (long-lived). No refresh_token is issued. The connector must handle this gracefully (refreshToken is a no-op that returns the same token).

**Config vars already in `src/config/index.ts:35-36`:**
- `EVENTBRITE_API_KEY` (used as `client_id`)
- `EVENTBRITE_CLIENT_SECRET`

> **AUDIT FIX R3 [F10]:** Add missing `ConnectionModel` import for OAuth callback duplicate check.
> **AUDIT FIX R3 [F11]:** Add missing `redis` import for distributed locking in `executeAction`.

**Required imports** (add at top of `src/connectors/eventbrite/index.ts`):

```typescript
import { ConnectionModel } from '../../app/models/connection';
import { redis } from '../../app/helpers/redis';
```

### Manifest

```typescript
manifest: {
  id: 'eventbrite',
  name: 'Eventbrite',
  description: 'Import events, ticket types, and attendees from Eventbrite.',
  icon: 'eventbrite',
  category: 'events',
  authType: 'oauth2',
  oauthConfig: {
    authorizationUrl: 'https://www.eventbrite.com/oauth/authorize',
    tokenUrl: 'https://www.eventbrite.com/oauth/token',
    scopes: [],  // Eventbrite does not use granular scopes
    pkce: false,
  },
  capabilities: ['canImport', 'canSync'],
  // > **AUDIT FIX [P1-M4]:** Removed `webhookEvents` — webhook support is not
  // > implemented in this phase. Don't advertise capabilities that don't work.
  configSchema: [
    {
      key: 'organizationId',
      label: 'Eventbrite Organization',
      type: 'select',
      required: true,
      fetchOptions: 'listOrganizations',
    },
  ],
},
```

### Actions

| Action ID | Name | triggerTypes | Description |
|-----------|------|-------------|-------------|
| `sync-events` | Sync Events | `['manual', 'scheduled', 'ai']` | Fetches all events from the connected Eventbrite organization and creates/updates corresponding Lemonade events. |
| `sync-attendees` | Sync Attendees | `['manual', 'scheduled', 'ai']` | Imports attendees from a specific Eventbrite event into the mapped Lemonade event. |
| `sync-ticket-types` | Sync Ticket Types | `['manual', 'ai']` | Imports ticket classes from a specific Eventbrite event as Lemonade ticket types. |
| `list-events` | List Eventbrite Events | `['ai']` | Lists events from the connected Eventbrite organization (read-only, no sync). |

### Action Input Schemas

```typescript
actions: [
  {
    id: 'sync-events',
    name: 'Sync Events',
    description: 'Import all events from Eventbrite into Lemonade. Creates new events or updates existing ones.',
    inputSchema: [
      { name: 'status', type: 'string', description: 'Filter by status: live, draft, ended, all (default: live)', required: false, default: 'live' },
      { name: 'syncTicketTypes', type: 'boolean', description: 'Also sync ticket types for each event (default: true)', required: false, default: true },
    ],
    outputType: 'data',
    triggerTypes: ['manual', 'scheduled', 'ai'],
    requiredCapabilities: ['canImport'],
  },
  {
    id: 'sync-attendees',
    name: 'Sync Attendees',
    description: 'Import attendees from a specific Eventbrite event into the corresponding Lemonade event.',
    inputSchema: [
      { name: 'externalEventId', type: 'string', description: 'Eventbrite event ID to sync attendees from', required: true },
      { name: 'status', type: 'string', description: 'Filter by attendee status: attending, not_attending, all (default: attending)', required: false, default: 'attending' },
    ],
    outputType: 'confirmation',
    triggerTypes: ['manual', 'scheduled', 'ai'],
    requiredCapabilities: ['canImport'],
  },
  {
    id: 'sync-ticket-types',
    name: 'Sync Ticket Types',
    description: 'Import ticket classes from an Eventbrite event as Lemonade ticket types.',
    inputSchema: [
      { name: 'externalEventId', type: 'string', description: 'Eventbrite event ID to sync ticket types from', required: true },
    ],
    outputType: 'confirmation',
    triggerTypes: ['manual', 'ai'],
    requiredCapabilities: ['canImport'],
  },
  {
    id: 'list-events',
    name: 'List Eventbrite Events',
    description: 'List events from the connected Eventbrite organization without syncing.',
    inputSchema: [
      { name: 'status', type: 'string', description: 'Filter by status: live, draft, ended, all (default: live)', required: false, default: 'live' },
    ],
    outputType: 'data',
    triggerTypes: ['ai'],
    requiredCapabilities: ['canImport'],
  },
],
```

### OAuth Implementation

```typescript
getAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: eventbriteApiKey ?? '',
    redirect_uri: redirectUri,
    state,
  });

  return `${this.manifest.oauthConfig!.authorizationUrl}?${params.toString()}`;
},

async handleCallback(code: string, redirectUri: string): Promise<TokenSet> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: eventbriteApiKey ?? '',
    client_secret: eventbriteClientSecret ?? '',
    redirect_uri: redirectUri,
  });

  const res = await fetch(this.manifest.oauthConfig!.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Eventbrite token exchange failed: ${text}`);
  }

  const data = (await res.json()) as { access_token: string; token_type?: string };

  // > **AUDIT FIX R2 [E1]:** Fetch the external account ID from Eventbrite to populate
  // > Connection.externalAccountId. This enables the unique compound index check.
  const meRes = await fetch('https://www.eventbriteapi.com/v3/users/me/', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  if (!meRes.ok) {
    throw new Error(`Failed to fetch Eventbrite user identity: ${await meRes.text()}`);
  }
  const meData = (await meRes.json()) as { id: string; emails?: { email: string; primary: boolean }[] };
  const externalAccountId = meData.id;

  // > **AUDIT FIX R2 [E1]:** Check if this external account is already connected
  // > to another Space. The unique index is a safety net; this check provides
  // > a clear user-facing error message.
  // > **AUDIT FIX R3 [F18]:** Exclude the current connection being set up from the
  // > duplicate check to avoid self-matching during re-authorization flows.
  const existingConnection = await ConnectionModel.findOne({
    _id: { $ne: currentConnectionId },
    connectorType: 'eventbrite',
    externalAccountId,
  }).lean();
  if (existingConnection) {
    throw new Error(
      'This Eventbrite account is already connected to another Space. Disconnect it there first.',
    );
  }

  // > **AUDIT FIX R2 [E4]:** Send email notification to the Eventbrite account owner
  // > when their account is connected (if email available from API response).
  // > **AUDIT FIX R3 [F10]:** Removed phantom `sendPlatformConnectedNotification` call —
  // > this function is never defined anywhere in the codebase. Replace with a TODO.
  const primaryEmail = meData.emails?.find((e) => e.primary)?.email;
  if (primaryEmail) {
    // TODO: Add email notification when platform account is connected (future enhancement).
    // Should notify: "Your Eventbrite account was connected to Space {spaceName} on Lemonade."
    // Use existing SendGrid email service. Include disconnect link.
    logger.info({ email: primaryEmail, platform: 'Eventbrite', externalAccountId }, 'Platform connected — email notification deferred (not yet implemented)');
  }

  // Store externalAccountId on the Connection record (done by the caller via
  // the returned metadata, or by updating the Connection after this callback).
  // The caller must call:
  //   ConnectionModel.updateOne({ _id: connectionId }, { $set: { externalAccountId, connectedByUserId } })

  return {
    accessToken: data.access_token,
    // Eventbrite tokens are long-lived — no refresh token or expiry
    tokenType: data.token_type ?? 'bearer',
    // > AUDIT FIX R2 [E1]: Pass externalAccountId back to be stored on Connection
    _meta: { externalAccountId },
  };
},

async refreshToken(tokenSet: TokenSet): Promise<TokenSet> {
  // Eventbrite tokens do not expire — return as-is
  return tokenSet;
},

async revokeToken(_tokenSet: TokenSet): Promise<void> {
  // Eventbrite does not provide a revocation endpoint
},
```

### Key API Calls (implement in `executeAction`)

**List organizations:**
```
GET https://www.eventbriteapi.com/v3/users/me/organizations/
Authorization: Bearer {token}
→ { organizations: [{ id, name }] }
```

**List events:**
```
GET https://www.eventbriteapi.com/v3/organizations/{org_id}/events/?status={status}&expand=venue,ticket_classes
Authorization: Bearer {token}
→ { events: [...], pagination: { page_count, page_number, has_more_items } }
```

**Get event detail:**
```
GET https://www.eventbriteapi.com/v3/events/{event_id}/?expand=venue,ticket_classes
```

**List attendees:**
```
GET https://www.eventbriteapi.com/v3/events/{event_id}/attendees/?status=attending
→ { attendees: [{ profile: { email, name }, ticket_class_name }], pagination: ... }
```

**List ticket classes:**
```
GET https://www.eventbriteapi.com/v3/events/{event_id}/ticket_classes/
→ { ticket_classes: [{ id, name, description, free, cost: { major_value, currency }, capacity }] }
```

### Eventbrite-to-NormalizedEvent Mapping

```typescript
function normalizeEventbriteEvent(eb: EventbriteEvent): NormalizedEvent {
  return {
    externalId: eb.id,
    title: eb.name?.text ?? 'Untitled Event',
    description: eb.description?.html,
    descriptionPlainText: eb.description?.text,
    start: new Date(eb.start.utc),
    end: new Date(eb.end.utc),
    coverUrl: eb.logo?.original?.url,
    virtual: eb.online_event === true,
    virtualUrl: eb.online_event ? eb.url : undefined,
    address: eb.venue ? {
      street_1: eb.venue.address?.address_1,
      street_2: eb.venue.address?.address_2,
      city: eb.venue.address?.city,
      region: eb.venue.address?.region,
      postal: eb.venue.address?.postal_code,
      country: eb.venue.address?.country,
      latitude: eb.venue.latitude ? parseFloat(eb.venue.latitude) : undefined,
      longitude: eb.venue.longitude ? parseFloat(eb.venue.longitude) : undefined,
      title: eb.venue.name,
    } : undefined,
    externalUrl: eb.url,
    currency: eb.currency,
  };
}

// > **AUDIT FIX R2 [E2]:** Only sync events with status 'live' or 'started'.
// > Skip 'draft', 'ended', 'completed', 'canceled' events.
// > On re-sync: if a previously synced event is now cancelled/deleted on Eventbrite,
// > update the Lemonade event state to 'cancelled' and the ExternalEventMapping
// > status to 'source_cancelled'.
const EVENTBRITE_SYNCABLE_STATUSES = new Set(['live', 'started']);

function isEventbriteSyncable(event: EventbriteEvent): boolean {
  return EVENTBRITE_SYNCABLE_STATUSES.has(event.status);
}

/**
 * > **AUDIT FIX R4 [FT-5]:** Free event sync cap — max 50 per connection.
 * Separates events into paid and free buckets. Paid events are always synced (no cap).
 * Free events are capped at 50 per connection, selecting the 50 most recent by start date.
 * Returns the events to sync and a warning message if any free events were skipped.
 */
const MAX_FREE_EVENTS_PER_CONNECTION = 50;

function applyFreeEventCap(
  events: EventbriteEvent[],
): { toSync: EventbriteEvent[]; skippedFreeCount: number } {
  const paid: EventbriteEvent[] = [];
  const free: EventbriteEvent[] = [];

  for (const ev of events) {
    const isFree = ev.ticket_classes?.every(
      (tc) => tc.free === true || !tc.cost || tc.cost.value === 0,
    ) ?? true; // No ticket classes = free
    if (isFree) {
      free.push(ev);
    } else {
      paid.push(ev);
    }
  }

  // Sort free events by start date descending (most recent first)
  free.sort((a, b) => new Date(b.start.utc).getTime() - new Date(a.start.utc).getTime());

  const cappedFree = free.slice(0, MAX_FREE_EVENTS_PER_CONNECTION);
  const skippedFreeCount = Math.max(0, free.length - MAX_FREE_EVENTS_PER_CONNECTION);

  return { toSync: [...paid, ...cappedFree], skippedFreeCount };
}

// In syncEventbriteEvents(), after filtering with isEventbriteSyncable():
//   const syncable = allEvents.filter(isEventbriteSyncable);
//   const { toSync, skippedFreeCount } = applyFreeEventCap(syncable);
//   // ... sync toSync events ...
//   // Append warning to ActionResult message if skippedFreeCount > 0:
//   if (skippedFreeCount > 0) {
//     message += ` ${skippedFreeCount} free events skipped (max ${MAX_FREE_EVENTS_PER_CONNECTION} synced per connection). Paid events always synced.`;
//   }

/**
 * > AUDIT FIX R2 [E2]: Handle cancelled/deleted events during re-sync.
 * If an event was previously synced but is now cancelled on Eventbrite,
 * update the Lemonade event and mapping accordingly.
 */
async function handleCancelledEventbriteEvents(
  token: string,
  orgId: string,
  connectionId: Types.ObjectId,
  spaceId: Types.ObjectId,
): Promise<{ cancelled: number }> {
  // Fetch ALL events (including cancelled) from Eventbrite
  const allEvents = await fetchEventbriteEvents(token, orgId, 'all');
  const cancelledExternalIds = allEvents
    .filter((e) => e.status === 'canceled' || e.status === 'ended' || e.status === 'completed')
    .map((e) => e.id);

  if (cancelledExternalIds.length === 0) return { cancelled: 0 };

  // Find mappings for these cancelled events
  const mappings = await ExternalEventMappingModel.find({
    connectionId,
    externalPlatform: 'eventbrite',
    externalEventId: { $in: cancelledExternalIds },
    status: { $ne: 'source_cancelled' },
  }).lean();

  let cancelled = 0;
  for (const mapping of mappings) {
    await EventModel.updateOne(
      { _id: mapping.lemonadeEventId },
      { $set: { state: 'cancelled', updated_at: new Date() } },
    );
    await ExternalEventMappingModel.updateOne(
      { _id: mapping._id },
      { $set: { status: 'source_cancelled', updated_at: new Date() } },
    );
    cancelled++;
  }

  return { cancelled };
}

function normalizeEventbriteTicketClass(tc: EventbriteTicketClass): NormalizedTicketType {
  return {
    externalId: tc.id,
    title: tc.name,
    description: tc.description,
    free: tc.free === true,
    priceCents: tc.cost ? tc.cost.value.toString() : undefined,  // Eventbrite cost.value is already in cents
    currency: tc.cost?.currency,
    capacity: tc.capacity,
    salesStart: tc.sales_start ? new Date(tc.sales_start) : undefined,
    salesEnd: tc.sales_end ? new Date(tc.sales_end) : undefined,
  };
}
```

### Eventbrite TypeScript interfaces (for API responses)

```typescript
interface EventbriteName { text: string; html: string; }
interface EventbriteDateTime { timezone: string; local: string; utc: string; }
interface EventbriteLogo { original: { url: string }; }
interface EventbriteVenueAddress {
  address_1?: string; address_2?: string; city?: string;
  region?: string; postal_code?: string; country?: string;
}
interface EventbriteVenue {
  id: string; name?: string; latitude?: string; longitude?: string;
  address?: EventbriteVenueAddress;
}
interface EventbriteCost { value: number; currency: string; major_value: string; display: string; }
interface EventbriteTicketClass {
  id: string; name: string; description?: string; free?: boolean;
  cost?: EventbriteCost; capacity?: number;
  sales_start?: string; sales_end?: string;
}
interface EventbriteEvent {
  id: string; name: EventbriteName; description?: EventbriteName;
  url: string; start: EventbriteDateTime; end: EventbriteDateTime;
  currency?: string; online_event?: boolean;
  logo?: EventbriteLogo; venue?: EventbriteVenue;
  ticket_classes?: EventbriteTicketClass[];
  status: string; // 'draft' | 'live' | 'started' | 'ended' | 'completed' | 'canceled'
}
interface EventbriteAttendee {
  id: string; status: string;
  profile: { email: string; name?: string; first_name?: string; last_name?: string; };
  ticket_class_name?: string;
}
interface EventbritePagination {
  page_count: number; page_number: number; has_more_items: boolean;
  object_count: number;
}
```

### executeAction Dispatch

> **AUDIT FIX [P1-H1]:** The core `executeAction` method was never shown. Added dispatch
> body following the Google Sheets pattern (`google-sheets/index.ts:219-238`) and
> Airtable pattern (`airtable/index.ts:298-317`): if-chain on `actionId`.

```typescript
async executeAction(
  actionId: string,
  params: Record<string, unknown>,
  context: ActionContext,
): Promise<ActionResult> {
  const token = context.credentials.tokenSet?.accessToken;
  if (!token) {
    return { success: false, error: 'No access token available' };
  }

  // > **AUDIT FIX [P1-H3]:** Acquire distributed lock to prevent race condition
  // > on concurrent sync (manual + scheduled running simultaneously).
  if (actionId.startsWith('sync-')) {
    const lockKey = `connector-sync:${context.connectionId}`;
    const acquired = await redis.set(lockKey, '1', 'EX', 300, 'NX');
    if (!acquired) {
      return { success: false, error: 'Sync already in progress for this connection' };
    }
    try {
      return await this._dispatchAction(actionId, token, params, context);
    } finally {
      await redis.del(lockKey);
    }
  }

  return this._dispatchAction(actionId, token, params, context);
},

async _dispatchAction(
  actionId: string,
  token: string,
  params: Record<string, unknown>,
  context: ActionContext,
): Promise<ActionResult> {
  const orgId = context.config?.organizationId as string;
  if (!orgId) {
    return { success: false, error: 'organizationId is required in connector config' };
  }

  // > **AUDIT FIX [P1-H4]:** `installedBy` is a string but `hostUserId` must be ObjectId.
  // > Convert explicitly with validation.
  const installedBy = context.connection.installedBy;
  if (!Types.ObjectId.isValid(installedBy)) {
    return { success: false, error: `Invalid installedBy value: ${installedBy}` };
  }
  const hostUserId = new Types.ObjectId(installedBy);

  if (actionId === 'sync-events') {
    return syncEventbriteEvents(token, orgId, params, context, hostUserId);
  }

  if (actionId === 'sync-attendees') {
    return syncEventbriteAttendees(token, params, context);
  }

  if (actionId === 'sync-ticket-types') {
    return syncEventbriteTicketTypes(token, params, context);
  }

  if (actionId === 'list-events') {
    return listEventbriteEvents(token, orgId, params);
  }

  return { success: false, error: `Unknown action: ${actionId}` };
},
```

### fetchConfigOptions

> **AUDIT FIX [P1-H2]:** The manifest declares `fetchOptions: 'listOrganizations'` but
> the method was never implemented. Added following the Google Sheets pattern
> (`google-sheets/index.ts:176-217`).

```typescript
async fetchConfigOptions(
  optionKey: string,
  credentials: DecryptedCredentials,
  _config?: Record<string, unknown>,
): Promise<SelectOption[]> {
  const token = credentials.tokenSet?.accessToken;
  if (!token) return [];

  if (optionKey === 'listOrganizations') {
    const res = await fetch(
      'https://www.eventbriteapi.com/v3/users/me/organizations/',
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch Eventbrite organizations: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      organizations: { id: string; name: string }[];
    };

    return (data.organizations ?? []).map((org) => ({
      value: org.id,
      label: org.name,
    }));
  }

  return [];
},
```

### Webhook Support (optional — implement if time permits)

Eventbrite webhooks use a signature header `X-Eventbrite-Signature` (HMAC-SHA256). The connector should implement `verifyWebhookSignature` and `handleWebhook` for:
- `event.created` / `event.updated` → auto-sync the affected event
- `order.placed` / `attendee.updated` → auto-sync attendees

If webhook support is deferred, omit `verifyWebhookSignature` and `handleWebhook` methods.

---

## 6. Lu.ma Connector

### File: `lemonade-backend/src/connectors/luma/index.ts` (NEW)

**API reference:** Lu.ma API v2 (`https://api.lu.ma/public/v2/`)

**Auth:** API key (Bearer token). Lu.ma does NOT have an OAuth2 flow for third-party apps. Users generate API keys from their Lu.ma settings.

**IMPORTANT LIMITATION:** Lu.ma's public API is limited. As of 2026-03, the documented endpoints are:
- `GET /public/v2/event/get?event_id={id}` — Get single event by API ID
- `GET /public/v2/event/get?url={slug}` — Get single event by URL slug
- `GET /public/v2/calendar/list-events?calendar_api_id={id}` — List events for a calendar
- `GET /public/v2/event/get-guests?event_api_id={id}` — Get event guests

Lu.ma does NOT expose:
- Ticket type/pricing details via API
- Bulk organization-level event listing (only per-calendar)
- Webhook subscriptions
- OAuth2

### Manifest

```typescript
manifest: {
  id: 'luma',
  name: 'Lu.ma',
  description: 'Import events and guest lists from Lu.ma calendars.',
  icon: 'luma',
  category: 'events',
  authType: 'api_key',
  capabilities: ['canImport', 'canSync'],
  configSchema: [
    {
      key: 'calendarApiId',
      label: 'Lu.ma Calendar',
      type: 'text',
      required: true,
      // No fetchOptions — user must paste their calendar API ID
      // Found at: Lu.ma dashboard → Calendar settings → API
    },
  ],
},
```

### Actions

| Action ID | Name | triggerTypes | Description |
|-----------|------|-------------|-------------|
| `sync-events` | Sync Events | `['manual', 'scheduled', 'ai']` | Fetches all events from the configured Lu.ma calendar and creates/updates corresponding Lemonade events. |
| `sync-guests` | Sync Guests | `['manual', 'scheduled', 'ai']` | Imports guests (RSVPs) from a specific Lu.ma event into the mapped Lemonade event. |
| `list-events` | List Lu.ma Events | `['ai']` | Lists events from the configured Lu.ma calendar without syncing. |

### Action Input Schemas

```typescript
actions: [
  {
    id: 'sync-events',
    name: 'Sync Events',
    description: 'Import all events from your Lu.ma calendar into Lemonade.',
    inputSchema: [
      { name: 'after', type: 'string', description: 'Only sync events starting after this ISO date (default: now)', required: false },
    ],
    outputType: 'data',
    triggerTypes: ['manual', 'scheduled', 'ai'],
    requiredCapabilities: ['canImport'],
  },
  {
    id: 'sync-guests',
    name: 'Sync Guests',
    description: 'Import guests from a specific Lu.ma event into the corresponding Lemonade event.',
    inputSchema: [
      { name: 'externalEventId', type: 'string', description: 'Lu.ma event API ID to sync guests from', required: true },
    ],
    outputType: 'confirmation',
    triggerTypes: ['manual', 'scheduled', 'ai'],
    requiredCapabilities: ['canImport'],
  },
  {
    id: 'list-events',
    name: 'List Lu.ma Events',
    description: 'List events from the configured Lu.ma calendar without syncing.',
    inputSchema: [],
    outputType: 'data',
    triggerTypes: ['ai'],
    requiredCapabilities: ['canImport'],
  },
],
```

### Auth Implementation (API Key)

Since Lu.ma uses API keys, the OAuth methods become no-ops / error throwers:

```typescript
getAuthUrl(): string {
  throw new Error('Lu.ma uses API key authentication, not OAuth2');
},

async handleCallback(): Promise<TokenSet> {
  throw new Error('Lu.ma uses API key authentication, not OAuth2');
},

async refreshToken(tokenSet: TokenSet): Promise<TokenSet> {
  return tokenSet; // API keys don't expire
},

async revokeToken(): Promise<void> {
  // API keys are managed by the user in Lu.ma settings
},
```

**Credential storage:** The API key is stored via the existing `api_key` auth flow. The connection setup UI will show a text input for the API key. The ActionContext will have `credentials.apiKey` populated.

> **AUDIT FIX R3 [F11]:** Add missing `redis` import for distributed locking in `executeAction`.

**Required imports** (add at top of `src/connectors/luma/index.ts`):

```typescript
import { redis } from '../../app/helpers/redis';
```

> **AUDIT FIX R2 [E1]:** For Lu.ma, the API key itself serves as the unique external account
> identifier (one API key = one user). During connection setup (when API key is first stored),
> hash the API key with SHA-256 to produce the `externalAccountId`:
>
> ```typescript
> import { createHash } from 'crypto';
> const externalAccountId = createHash('sha256').update(apiKey).digest('hex');
> ```
>
> Before saving the connection, check for an existing connection with the same
> `(connectorType: 'luma', externalAccountId)`. If one exists, reject:
> "This Lu.ma account is already connected to another Space. Disconnect it there first."
>
> **AUDIT FIX R3 [F18]:** Exclude the current connection ID from this duplicate check
> (`_id: { $ne: currentConnectionId }`) to avoid self-matching during re-authorization flows.
>
> Store the hashed value (not the raw API key) as `externalAccountId` on the Connection record.

> **AUDIT FIX R2 [E4]:** Log `connectedByUserId` (the Lemonade user performing the connection)
> on the Connection record. If the same `externalAccountId` was previously connected by a
> different Lemonade user and then disconnected, log a warning for review. Lu.ma does not
> expose the account owner's email, so email notification is not possible for Lu.ma connections.

### executeAction Dispatch

> **AUDIT FIX [P1-H1]:** Added `executeAction` dispatch for Lu.ma connector following
> the same if-chain pattern as Google Sheets (`google-sheets/index.ts:219-238`).
> Also includes distributed lock (P1-H3) and ObjectId conversion (P1-H4).

```typescript
async executeAction(
  actionId: string,
  params: Record<string, unknown>,
  context: ActionContext,
): Promise<ActionResult> {
  const apiKey = context.credentials.apiKey;
  if (!apiKey) {
    return { success: false, error: 'No API key available' };
  }

  const calendarApiId = context.config?.calendarApiId as string;
  if (!calendarApiId) {
    return { success: false, error: 'calendarApiId is required in connector config' };
  }

  // > **AUDIT FIX [P1-H3]:** Distributed lock for concurrent sync prevention.
  if (actionId.startsWith('sync-')) {
    const lockKey = `connector-sync:${context.connectionId}`;
    const acquired = await redis.set(lockKey, '1', 'EX', 300, 'NX');
    if (!acquired) {
      return { success: false, error: 'Sync already in progress for this connection' };
    }
    try {
      return await this._dispatchAction(actionId, apiKey, calendarApiId, params, context);
    } finally {
      await redis.del(lockKey);
    }
  }

  return this._dispatchAction(actionId, apiKey, calendarApiId, params, context);
},

async _dispatchAction(
  actionId: string,
  apiKey: string,
  calendarApiId: string,
  params: Record<string, unknown>,
  context: ActionContext,
): Promise<ActionResult> {
  // > **AUDIT FIX [P1-H4]:** Convert `installedBy` string to ObjectId with validation.
  const installedBy = context.connection.installedBy;
  if (!Types.ObjectId.isValid(installedBy)) {
    return { success: false, error: `Invalid installedBy value: ${installedBy}` };
  }
  const hostUserId = new Types.ObjectId(installedBy);

  if (actionId === 'sync-events') {
    return syncLumaEvents(apiKey, calendarApiId, params, context, hostUserId);
  }

  if (actionId === 'sync-guests') {
    return syncLumaGuests(apiKey, params, context);
  }

  if (actionId === 'list-events') {
    return listLumaEvents(apiKey, calendarApiId, params);
  }

  return { success: false, error: `Unknown action: ${actionId}` };
},
```

### Key API Calls

**List calendar events:**
```
GET https://api.lu.ma/public/v2/calendar/list-events?calendar_api_id={calendarApiId}&after={isoDate}
Headers: x-luma-api-key: {apiKey}
→ { entries: [{ api_id, event: { api_id, name, description, start_at, end_at, cover_url, url, geo_address_json, ... } }], has_more, next_cursor }
```

> **AUDIT FIX [P1-M2]:** Lu.ma pagination must use cursor loop. Implement as:

```typescript
async function fetchAllLumaCalendarEvents(
  apiKey: string,
  calendarApiId: string,
  after?: string,
): Promise<LumaCalendarEntry[]> {
  const allEntries: LumaCalendarEntry[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ calendar_api_id: calendarApiId });
    if (after) params.set('after', after);
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(
      `https://api.lu.ma/public/v2/calendar/list-events?${params.toString()}`,
      { headers: { 'x-luma-api-key': apiKey } },
    );

    if (!res.ok) {
      throw new Error(`Lu.ma list-events failed: ${await res.text()}`);
    }

    const data = (await res.json()) as LumaListResponse<LumaCalendarEntry>;
    allEntries.push(...data.entries);
    cursor = data.has_more ? data.next_cursor : undefined;

    // Rate limit: 1-second delay between paginated requests
    if (cursor) await new Promise((r) => setTimeout(r, 1000));
  } while (cursor);

  return allEntries;
}
```

**Get event guests:**
```
GET https://api.lu.ma/public/v2/event/get-guests?event_api_id={eventApiId}
Headers: x-luma-api-key: {apiKey}
→ { entries: [{ guest: { api_id, name, email, approval_status } }], has_more, next_cursor }
```

> **AUDIT FIX [P1-M2]:** Same cursor pagination pattern applies to guest fetching:

```typescript
async function fetchAllLumaGuests(
  apiKey: string,
  eventApiId: string,
): Promise<LumaGuest[]> {
  const allGuests: LumaGuest[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ event_api_id: eventApiId });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(
      `https://api.lu.ma/public/v2/event/get-guests?${params.toString()}`,
      { headers: { 'x-luma-api-key': apiKey } },
    );

    if (!res.ok) {
      throw new Error(`Lu.ma get-guests failed: ${await res.text()}`);
    }

    const data = (await res.json()) as LumaListResponse<{ guest: LumaGuest }>;
    allGuests.push(...data.entries.map((e) => e.guest));
    cursor = data.has_more ? data.next_cursor : undefined;

    if (cursor) await new Promise((r) => setTimeout(r, 1000));
  } while (cursor);

  return allGuests;
}
```

### Lu.ma-to-NormalizedEvent Mapping

```typescript
import { marked } from 'marked';  // > **AUDIT FIX [P1-M1]:** Add `marked@^12.0.0` to package.json dependencies

function normalizeLumaEvent(entry: LumaCalendarEntry): NormalizedEvent {
  const ev = entry.event;
  const geo = ev.geo_address_json ? JSON.parse(ev.geo_address_json) : null;

  return {
    externalId: ev.api_id,
    title: ev.name ?? 'Untitled Event',
    // Lu.ma returns markdown — convert to HTML for Lemonade's frontend renderer
    description: ev.description_md ? marked.parse(ev.description_md) : undefined,
    descriptionPlainText: ev.description_md?.replace(/[#*_~`>\[\]()!-]/g, ''),
    start: new Date(ev.start_at),
    end: new Date(ev.end_at),
    coverUrl: ev.cover_url,
    virtual: ev.event_type === 'online',
    virtualUrl: ev.meeting_url || ev.zoom_meeting_url,
    address: geo ? {
      street_1: geo.address,
      city: geo.city,
      region: geo.region,
      postal: geo.postal_code,
      country: geo.country,
      latitude: geo.latitude,
      longitude: geo.longitude,
      title: geo.place_name || geo.full_address,
    } : undefined,
    externalUrl: ev.url ? `https://lu.ma/${ev.url}` : undefined,
  };
}
```

> **AUDIT FIX R2 [E2]:** Lu.ma event status filtering. Skip events where `end_at < now`
> (past events). Check for any cancellation indicators in the API response. On re-sync,
> if a previously synced Lu.ma event is no longer returned by the calendar API (deleted)
> or its `end_at` is in the past, update the Lemonade event to `cancelled` and set
> ExternalEventMapping `status: 'source_cancelled'`.

```typescript
function isLumaEventSyncable(event: LumaEvent): boolean {
  // Skip past events
  if (new Date(event.end_at) < new Date()) return false;
  // Lu.ma does not have an explicit status field — events that are
  // cancelled are typically removed from the calendar listing.
  // If the event has an end_at in the future, it is considered syncable.
  return true;
}

/**
 * > **AUDIT FIX R4 [FT-5]:** Free event sync cap — max 50 per connection.
 * Lu.ma does not expose ticket pricing via API, so ALL Lu.ma events are treated
 * as "free" for the purpose of this cap (no price data = assume free).
 * Cap: max 50 Lu.ma events synced per connection, sorted by start_at descending.
 * If Lu.ma adds ticket pricing to their API in the future, this can be refined
 * to only cap truly-free events and let paid events through uncapped.
 *
 * NOTE: If the organizer also has an Eventbrite connection with paid events,
 * those paid events are unaffected by this Lu.ma cap.
 */
const LUMA_MAX_FREE_EVENTS_PER_CONNECTION = 50;

function applyLumaFreeEventCap(
  entries: LumaCalendarEntry[],
): { toSync: LumaCalendarEntry[]; skippedFreeCount: number } {
  // Sort by start_at descending (most recent first)
  const sorted = [...entries].sort(
    (a, b) => new Date(b.event.start_at).getTime() - new Date(a.event.start_at).getTime(),
  );

  const capped = sorted.slice(0, LUMA_MAX_FREE_EVENTS_PER_CONNECTION);
  const skippedFreeCount = Math.max(0, sorted.length - LUMA_MAX_FREE_EVENTS_PER_CONNECTION);

  return { toSync: capped, skippedFreeCount };
}

// In syncLumaEvents(), after filtering with isLumaEventSyncable():
//   const syncable = allEntries.filter((e) => isLumaEventSyncable(e.event));
//   const { toSync, skippedFreeCount } = applyLumaFreeEventCap(syncable);
//   // ... sync toSync events ...
//   // Append warning to ActionResult message if skippedFreeCount > 0:
//   if (skippedFreeCount > 0) {
//     message += ` ${skippedFreeCount} free events skipped (max ${LUMA_MAX_FREE_EVENTS_PER_CONNECTION} synced per connection). Paid events always synced.`;
//   }

/**
 * > AUDIT FIX R2 [E2]: Handle disappeared/past Lu.ma events during re-sync.
 * Compare currently listed events against existing mappings. Any mapping whose
 * external event is no longer listed (or is now past) gets marked as source_cancelled.
 */
async function handleRemovedLumaEvents(
  currentExternalIds: Set<string>,
  connectionId: Types.ObjectId,
): Promise<{ cancelled: number }> {
  const mappings = await ExternalEventMappingModel.find({
    connectionId,
    externalPlatform: 'luma',
    status: { $ne: 'source_cancelled' },
  }).lean();

  let cancelled = 0;
  for (const mapping of mappings) {
    if (!currentExternalIds.has(mapping.externalEventId)) {
      await EventModel.updateOne(
        { _id: mapping.lemonadeEventId },
        { $set: { state: 'cancelled', updated_at: new Date() } },
      );
      await ExternalEventMappingModel.updateOne(
        { _id: mapping._id },
        { $set: { status: 'source_cancelled', updated_at: new Date() } },
      );
      cancelled++;
    }
  }

  return { cancelled };
}
```

### Lu.ma TypeScript interfaces

```typescript
interface LumaEvent {
  api_id: string;
  name?: string;
  description_md?: string;
  start_at: string;        // ISO 8601
  end_at: string;
  cover_url?: string;
  url?: string;            // slug, e.g. "my-event-abc123"
  event_type?: string;     // 'online' | 'in-person' | 'hybrid'
  meeting_url?: string;
  zoom_meeting_url?: string;
  geo_address_json?: string; // JSON-stringified geo object
  geo_latitude?: string;
  geo_longitude?: string;
}

interface LumaCalendarEntry {
  api_id: string;
  event: LumaEvent;
}

interface LumaGuest {
  api_id: string;
  name?: string;
  email: string;
  approval_status: string;  // 'approved' | 'pending_approval' | 'declined' | 'waitlisted'
}

interface LumaListResponse<T> {
  entries: T[];
  has_more: boolean;
  next_cursor?: string;
}
```

### Known Limitations (document in connector description)

1. **No ticket type sync** — Lu.ma does not expose ticket/pricing data via API
2. **No webhooks** — Lu.ma does not support webhook subscriptions
3. **Calendar-scoped only** — Events must belong to a Lu.ma calendar; there is no "all my events" endpoint
4. **Rate limits** — Lu.ma API is rate-limited; implement 1-second delay between paginated requests
5. **Description format** — Lu.ma returns markdown, not HTML. Convert to HTML before storing using the `marked` library (already a common dep, or add `marked@^12.0.0` as a lightweight alternative). Call `marked.parse(ev.description_md)` and store the result in `description`. Store the raw markdown in `description_plain_text` as a fallback. Do NOT store raw markdown in `description` — Lemonade's frontend renders HTML.

---

## 6.1 Connect Platform Security (applies to ALL connectors)

> **AUDIT FIX R2 [E4]:** Rate limit `connectPlatform` mutation to prevent rapid credential
> testing from stolen OAuth tokens or API keys.

```typescript
// In the connectPlatform resolver or controller, before initiating OAuth or storing API key:

// > AUDIT FIX R2 [E4]: Rate limit connection attempts to 5 per hour per user.
const rateLimitKey = `connect-platform:${userId}`;
const attempts = await redis.incr(rateLimitKey);
if (attempts === 1) {
  await redis.expire(rateLimitKey, 3600); // 1 hour TTL
}
if (attempts > 5) {
  throw new Error('Too many connection attempts. Please try again later (max 5 per hour).');
}

// > AUDIT FIX R2 [E4]: After successful connection, log the connecting user's identity.
// > If the same externalAccountId was previously connected by a different user and
// > then disconnected, flag for security review.
const previousConnection = await ConnectionModel.findOne({
  connectorType,
  externalAccountId,
  connectedByUserId: { $ne: userId },
}).lean();

if (previousConnection) {
  logger.warn(
    {
      connectorType,
      externalAccountId,
      currentUserId: userId,
      previousUserId: previousConnection.connectedByUserId,
    },
    'SECURITY: External account previously connected by different user — flagging for review',
  );
  // Optionally: create a security audit log entry for manual review
}
```

---

## 7. Scheduled Sync

> **AUDIT FIX [P1-C2]:** The codebase uses per-file job definitions in `src/app/jobs/`.
> A `connector-sync.ts` job ALREADY EXISTS at `src/app/jobs/connector-sync.ts` (verified).
> It accepts `{ connectionId, actionId }` and calls `actionExecutor.execute()`.
> Do NOT modify `agenda.ts` directly. Instead, create a new scheduler job file that
> finds eligible connections and enqueues individual `connector-sync` jobs for each.

### File: `lemonade-backend/src/app/jobs/connector-event-sync-scheduler.ts` (NEW)

This job runs on a schedule and enqueues individual `connector-sync` jobs per connection.

```typescript
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import { logger } from '../helpers/pino';
import { JobName } from '../models/job';
import { ConnectionModel, ConnectionStatus } from '../models/connection';
import agenda from '../helpers/agenda';

/**
 * Scheduler job: finds all enabled event-connector connections and enqueues
 * individual connector-sync jobs for each. This follows the existing pattern
 * where connector-sync.ts handles single-connection execution.
 *
 * Pattern reference: src/app/jobs/connector-sync.ts (existing single-job executor)
 */
const handler: JobHandler<void> = async function handler(_job) {
  const connections = await ConnectionModel.find({
    enabled: true,
    status: { $in: [ConnectionStatus.active, ConnectionStatus.connected] },
    connectorType: { $in: ['eventbrite', 'luma'] },
  }).lean();

  for (const conn of connections) {
    try {
      // Enqueue individual connector-sync job (existing job type)
      await agenda.now(JobName.CONNECTOR_SYNC, {
        connectionId: conn._id,
        actionId: 'sync-events',
      });
    } catch (err) {
      logger.error(
        { err, connectionId: conn._id.toString() },
        'Failed to enqueue event sync job',
      );
    }
  }
};

const definition: JobDefinition<void> = {
  name: 'connector-event-sync-scheduler' as JobName,
  handler,
  schedule: { interval: '6 hours' },
};

export default definition;
```

### File: `lemonade-backend/src/app/models/job.ts` (MODIFY)

Add the new job name to the `JobName` enum:

```typescript
// Add to JobName enum:
CONNECTOR_EVENT_SYNC_SCHEDULER = 'connector-event-sync-scheduler',
```

**Design notes:**
- The scheduler enqueues individual `connector-sync` jobs per connection, leveraging the existing `connector-sync.ts` job which handles credential refresh, logging, and error recording via `actionExecutor.execute()`
- Default schedule: every 6 hours. Per-connection override via `Connection.syncSchedule` (cron string) is a Phase 2 enhancement
- The 6-hour interval is conservative to avoid API rate limits across platforms
- **Per-connector rate limit constants** (define in each connector's index.ts):
  - Eventbrite: 2000 requests/hour (generous), implement exponential backoff on 429 with `Retry-After` header
  - Lu.ma: ~60 requests/minute (undocumented), 1-second delay between paginated requests
  - All connectors: on 429 response, respect `Retry-After` header; if absent, wait `min(2^attempt * 1000, 30000)` ms

---

## 9. Registration Changes

### File: `lemonade-backend/src/connectors/index.ts` (MODIFY)

Add imports and registrations:

```typescript
// Add these imports (after existing AirtableConnector import)
import EventbriteConnector from './eventbrite';
import LumaConnector from './luma';

// Add these registrations (after existing register calls)
register(EventbriteConnector);
register(LumaConnector);
```

No config changes needed — Eventbrite vars already exist at `src/config/index.ts:35-36`. Lu.ma uses user-provided API keys (no app-level credentials).

---

## 9. Frontend Changes

### File: `web-new/lib/components/features/upgrade-to-pro/utils.ts` (MODIFY)

Add new entries to `CONNECTOR_ICON_MAP`:

```typescript
export const CONNECTOR_ICON_MAP: Record<string, string> = {
  // ... existing entries ...
  eventbrite: `${ASSET_PREFIX}/assets/images/connectors/connector-eventbrite.png`,
  luma: `${ASSET_PREFIX}/assets/images/connectors/connector-luma.png`,
};
```

### New Icon Assets (2 files)

Create or source PNG icons (recommended 112x112px for 2x density on the 56x56 display):

- `web-new/public/assets/images/connectors/connector-eventbrite.png`
- `web-new/public/assets/images/connectors/connector-luma.png`

Source icons from each platform's brand kit:
- Eventbrite: Orange flame mark
- Lu.ma: Purple calendar mark

### No Other Frontend Changes Required

The existing `ConnectorCard` and `ConnectorDetail` components are fully generic. They read connector manifests from the backend, display icons from `CONNECTOR_ICON_MAP`, and render actions dynamically. No new components are needed. The `ConnectorDetail` component already handles:
- Action listing with trigger type badges
- Run button UI
- Activity log table from `ConnectionLogsDocument`
- Config field rendering from `configSchema`

The only UI gap: the API key auth flow for Lu.ma. Check if the existing connection setup flow handles `authType: 'api_key'` connectors. If not, a small addition is needed in the connect flow to show a text input instead of initiating an OAuth redirect. **This must be verified by the implementing agent** — grep for `authType` handling in the connector setup components.

---

## 10. New Files Summary

| File | Repo | Description |
|------|------|-------------|
| `src/app/models/external-event-mapping.ts` | lemonade-backend | Mongoose model for external-to-Lemonade event mapping |
| `src/connectors/event-sync-utils.ts` | lemonade-backend | Shared upsert logic for event/ticket/attendee sync |
| `src/connectors/eventbrite/index.ts` | lemonade-backend | Eventbrite ConnectorPlugin implementation |
| `src/connectors/luma/index.ts` | lemonade-backend | Lu.ma ConnectorPlugin implementation |
| `src/app/jobs/connector-event-sync-scheduler.ts` | lemonade-backend | Scheduler job that enqueues per-connection sync jobs |
| `src/db/migrations/{ts}-add-connection-external-account-id-index.ts` | lemonade-backend | **AUDIT FIX R2 [E1]:** Migration for unique compound index on Connection |
| `src/db/migrations/{ts}-add-connection-self-verified-identity-index.ts` | lemonade-backend | **AUDIT FIX R4 [SV-2]:** Migration for Self-verified identity unique compound index on Connection |
| `public/assets/images/connectors/connector-eventbrite.png` | web-new | Eventbrite icon |
| `public/assets/images/connectors/connector-luma.png` | web-new | Lu.ma icon |

## 11. Modified Files Summary

| File | Repo | Change |
|------|------|--------|
| `src/connectors/index.ts` | lemonade-backend | Import + register 2 new connectors |
| `src/app/models/job.ts` | lemonade-backend | Add `CONNECTOR_EVENT_SYNC_SCHEDULER` to JobName enum |
| `src/app/models/connection.ts` | lemonade-backend | **AUDIT FIX R2 [E1/E4]:** Add `externalAccountId`, `connectedByUserId` fields + unique compound index. **AUDIT FIX R4 [SV-2]:** Add `selfVerifiedIdentityId` field + unique compound index |
| `lib/components/features/upgrade-to-pro/utils.ts` | web-new | Add 2 entries to `CONNECTOR_ICON_MAP` |

## 13. Migration

### File: `lemonade-backend/src/db/migrations/{timestamp}-create-external-event-mappings-indexes.ts` (NEW)

```typescript
import { type Db } from 'mongodb';

export async function up(db: Db): Promise<void> {
  await db.collection('external_event_mappings').createIndex(
    { connectionId: 1, externalPlatform: 1, externalEventId: 1 },
    { unique: true },
  );
  await db.collection('external_event_mappings').createIndex(
    { lemonadeEventId: 1 },
  );
  await db.collection('external_event_mappings').createIndex(
    { connectionId: 1 },
  );
}

export async function down(db: Db): Promise<void> {
  await db.collection('external_event_mappings').dropIndexes();
}
```

Note: Typegoose `@index` decorators create indexes at app startup. The migration is a safety net to ensure indexes exist before the app first runs with the new code.

---

## 13. Environment Variables Required

| Variable | Required By | Notes |
|----------|------------|-------|
| `EVENTBRITE_API_KEY` | Eventbrite connector | Already defined in config (line 35). Acts as OAuth client_id. |
| `EVENTBRITE_CLIENT_SECRET` | Eventbrite connector | Already defined in config (line 36). |

Lu.ma does not require application-level credentials — each user provides their own API key.

---

> **AUDIT FIX [P1-M1]:** Added dependencies section — `marked` was referenced but never listed.

## 14. New Dependencies (lemonade-backend)

| Package | Version | Purpose |
|---------|---------|---------|
| `marked` | `^12.0.0` | Convert Lu.ma markdown descriptions to HTML for Lemonade's frontend renderer |
| `nanoid` | `^5.0.0` | Generate unique slug suffixes to prevent duplicate key errors on Event.slug |

Install: `yarn add marked nanoid --ignore-engines`

---

## 15. Testing Strategy

### Unit Tests (one file per connector)

- `src/connectors/eventbrite/__tests__/index.test.ts`
- `src/connectors/luma/__tests__/index.test.ts`
- `src/connectors/__tests__/event-sync-utils.test.ts`

Each connector test file should cover:
1. **Manifest correctness** — category is `'events'`, all actions have `'ai'` in triggerTypes
2. **Normalization** — external API response maps correctly to NormalizedEvent
3. **Upsert idempotency** — calling sync-events twice with same data creates 1 event, not 2
4. **Error handling** — API failures return `{ success: false, error: '...' }` not thrown exceptions
5. **Pagination** — multi-page API responses are fully consumed
6. **Missing data** — null/undefined fields in API responses don't crash normalization

### Integration Test (manual, against real APIs)

Not automated. Document manual test steps:
1. Create Eventbrite/Lu.ma test accounts with sample events
2. Connect each via the UI
3. Run sync-events and verify Lemonade events are created
4. Run sync-events again and verify events are updated (not duplicated)
5. Run sync-attendees/sync-guests/sync-rsvps and verify guest import

---

## 16. Implementation Order

Execute in this order to minimize blocked dependencies:

1. **ExternalEventMapping model** — other modules depend on it
2. **event-sync-utils.ts** — shared by all connectors
3. **Eventbrite connector** — most complete API, best reference implementation
4. **Lu.ma connector** — simplest (API key auth, limited API)
5. **Register connectors** in `index.ts`
6. **Agenda job** — scheduled sync
7. **Migration** — create indexes
8. **Frontend** — icons + CONNECTOR_ICON_MAP entries
9. **Tests**

---

## 17. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Eventbrite API rate limits (varies by plan) | Medium | Implement exponential backoff on 429 responses. Batch pagination delays. |
| Lu.ma API instability (not officially versioned) | Medium | Pin to `/v2/` prefix. Wrap all API calls in try/catch. Log response shapes for debugging. |
| Meetup deferred to Phase 5 | Low | Scope decision — Meetup Pro paywall ($200/yr) limits organizer adoption. Covered in Phase 5 IMPL. |
| Eventbrite long-lived tokens becoming invalid | Low | Check for 401 responses in `executeAction` and set connection status to `expired`. |
| Slug collisions on synced events | Low | `slugify` does NOT add nanoid suffixes (verified `src/app/utils/string.ts:19-29`). Fixed: append `-${nanoid(8)}` after slugifying in `upsertLemonadeEvent`. |
| **AUDIT FIX R2 [E13]:** Dual-ticketing overselling | Critical | Synced events are DISCOVERY-ONLY for launch. No Atlas Direct Ticketing on synced events. `atlas_direct_ticketing_eligible` defaults to `false`. |
| **AUDIT FIX R2 [E1]:** Same external account on multiple Spaces | Critical | Unique compound index `(connectorType, externalAccountId)` on Connection model. Validated during OAuth callback / API key setup. |
| **AUDIT FIX R2 [E2]:** Syncing cancelled/deleted events | High | Status filter during sync (Eventbrite: only `live`/`started`; Lu.ma: skip past events). Re-sync marks cancelled events as `source_cancelled`. |
| **AUDIT FIX R2 [E4]:** OAuth token theft | Medium | Rate limit `connectPlatform` (5/hr/user), log `connectedByUserId`, email notification to platform account owner. |
| **AUDIT FIX R4 [FT-2]:** Free events entering Atlas payment flow | Critical | `isEventFree()` check in schema mapper omits `atlas:purchase_endpoint` for free events. Combined with Phase 2 purchase controller redirect. |
| **AUDIT FIX R4 [FT-5]:** Free event spam via connector sync | High | Max 50 free events synced per connection. Paid events uncapped. Most recent 50 by start date. Warning logged in ActionResult. |
| **AUDIT FIX R4 [SV-2]:** Multi-account bypass (R3 F1 resolution) | Critical | `selfVerifiedIdentityId` field + unique compound index on Connection. Self-verified users limited to 1 Space with event connectors globally. |

---

## Execution Status

| Step | Status | Agent | Notes |
|------|--------|-------|-------|
| ExternalEventMapping model | NOT STARTED | — | — |
| event-sync-utils.ts | NOT STARTED | — | — |
| Eventbrite connector | NOT STARTED | — | — |
| Lu.ma connector | NOT STARTED | — | — |
| Connector registration | NOT STARTED | — | — |
| Agenda scheduled sync | NOT STARTED | — | — |
| Migration | NOT STARTED | — | — |
| Frontend icons + map | NOT STARTED | — | — |
| Tests | NOT STARTED | — | — |
