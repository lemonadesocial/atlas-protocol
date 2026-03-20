# PRD: MongoDB to PostgreSQL Migration

**Status:** Draft -- pending audit
**Author:** Agent G
**Date:** 2026-03-19

---

## 1. Overview

### Why migrate

Lemonade stores all data in MongoDB. This works well for flexible-schema documents (events with nested page configs, user profiles, AI conversations) but creates friction for:

- **Relational queries** -- tickets joined to payments joined to events joined to spaces require multi-stage aggregation pipelines that are slow and hard to maintain
- **Financial data** -- payment amounts stored as strings in MongoDB lack native decimal arithmetic, CHECK constraints, and transactional guarantees across related records
- **Analytics** -- time-series queries (ticket sold charts, checkin timelines, revenue aggregations) run as MongoDB aggregation pipelines that cannot use indexes efficiently

### Current state

lemonade-backend already has a PostgreSQL connection via pg-promise v10.11.0 (`src/app/helpers/pg.ts:1-18`). Existing schemas:

| Schema | Purpose | Tables |
|--------|---------|--------|
| `ai.` | AI credits, usage tracking | credit_transactions, usage_logs (partitioned) |
| `api.` | API key logs, quota tracking | api_key_logs (partitioned), api_quota_usage + materialized views |
| `public.` | CQRS read models (already synced from MongoDB) | event_guests, event_summary, space_subscribers, user_profiles, event_organizers, space_admins, tickets, payments |

The `public.` read models (`src/sql/migrations/1772700000000-create-public-read-models.sql`, `1777700000000-add-tickets-payments-read-models.sql`) already sync Ticket, Payment, EventCheckin, and SpaceMember data from MongoDB to PostgreSQL via `src/app/services/read-model-sync.ts`. This migration builds on that foundation.

### What this migration adds

Two new schemas (this PRD). Atlas schema is handled separately via `IMPL-POSTGRESQL-MIGRATION.md`.

| Schema | Purpose |
|--------|---------|
| `events.` | Authoritative store for tickets, payments, check-ins, guest lists, event insights |
| `spaces.` | Authoritative store for space subscribers, space insights |

### What stays on MongoDB (and why)

| Collection | Reason |
|------------|--------|
| `events` | 100+ fields, deeply nested page configs (broadcasts, sessions, rewards, ticket_sales), flexible schema that changes frequently. ~1316 lines in model file (`src/app/models/event.ts`). |
| `spaces` | Complex nested config (theme, social links, sendgrid settings, subscription fields, asset library, page_config). ~200+ fields (`src/app/models/space.ts`). |
| `users` | Variable profiles, OAuth tokens, wallet addresses, notification preferences |
| AI conversations | Unstructured, variable-length message arrays |
| `event_ticket_types` | Nested prices array, offers, self_verification objects, frequently updated with new fields (`src/app/models/event-ticket-type.ts`) |
| `new_payment_accounts` | Union-typed account_info (Stripe vs blockchain vs escrow vs relay vs stake) with provider-specific nested objects (`src/app/models/new-payment-account.ts`) |
| `external_event_mappings` | References Event documents, external platform configs |
| `page_configs` | 30+ section types, deeply nested theme/layout objects |
| `event_attestations` | Blockchain attestation UIDs, variable nested arrays |
| `event_ticket_categories` | Simple lookup table tightly coupled to event_ticket_types |
| `event_application_questions` / `event_application_answers` | Flexible form schema |
| `event_cohost_requests` | Low volume, simple state machine |
| `event_invitations` / `event_invitation_urls` | Tightly coupled to Event invited/accepted arrays |
| `event_questions` / `event_votings` | Live event features, low volume |
| `event_session_reservations` | References Event sessions subdocument |
| `event_reward_uses` | References Event rewards subdocument |
| `event_feedbacks` | Low volume, simple schema |
| `space_members` | Complex role/state machine, tightly coupled to Space |
| `space_tags` / `space_categories` | Low volume lookups |
| `space_event_requests` / `space_verification_submissions` | Low volume workflows |
| `space_nfts` / `space_nft_contracts` / `space_nft_traits` | Blockchain metadata |
| `subscription_records` | Low volume, Stripe integration |
| `point_trackings` | Low volume engagement data |
| `preview_links` | Low volume, simple schema |

**Principle:** Migrate high-volume, read-heavy, relational, and financial data. Leave flexible-schema, low-volume, and deeply-nested documents on MongoDB.

---

## 2. Schema Design

### 2.1 events. schema

#### events.guest_lists

Source: `EventJoinRequest` model (`src/app/models/event-join-request.ts`)
- Collection: `event_join_requests`
- Referenced by 40 files across services, resolvers, controllers, jobs
- States: pending, approved, declined

```sql
CREATE TABLE IF NOT EXISTS events.guest_lists (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id          VARCHAR(24) NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_id          VARCHAR(24) NOT NULL,
  user_id           VARCHAR(24),
  email             VARCHAR(255),
  state             VARCHAR(16) NOT NULL DEFAULT 'pending',
  decided_at        TIMESTAMPTZ,
  decided_by        VARCHAR(24),
  metadata          JSONB,
  requested_tickets JSONB,
  payment_id        VARCHAR(24),
  ticket_issued     BOOLEAN,

  CONSTRAINT chk_guest_lists_state CHECK (state IN ('pending', 'approved', 'declined'))
);

CREATE INDEX idx_guest_lists_event_state ON events.guest_lists (event_id, state);
CREATE INDEX idx_guest_lists_user ON events.guest_lists (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_guest_lists_email ON events.guest_lists (email) WHERE email IS NOT NULL;
CREATE INDEX idx_guest_lists_payment ON events.guest_lists (payment_id DESC) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_guest_lists_event_created ON events.guest_lists (event_id, created_at);
```

**Field mapping from MongoDB:**

| MongoDB field | PG column | Type | Notes |
|---------------|-----------|------|-------|
| `_id` | `mongo_id` | VARCHAR(24) | ObjectId hex string |
| `created_at` | `created_at` | TIMESTAMPTZ | |
| `event` | `event_id` | VARCHAR(24) | Ref to Event (stays on MongoDB) |
| `user` | `user_id` | VARCHAR(24) | Ref to User (stays on MongoDB) |
| `email` | `email` | VARCHAR(255) | |
| `state` | `state` | VARCHAR(16) | Enum: pending, approved, declined |
| `decided_at` | `decided_at` | TIMESTAMPTZ | |
| `decided_by` | `decided_by` | VARCHAR(24) | |
| `metadata` | `metadata` | JSONB | Flexible key-value |
| `requested_tickets` | `requested_tickets` | JSONB | Array of {ticket_type, count, metadata} |
| `payment_id` | `payment_id` | VARCHAR(24) | Ref to NewPayment. Becomes FK to events.payments after migration. |
| `ticket_issued` | `ticket_issued` | BOOLEAN | |

#### events.check_ins

Source: `EventCheckin` model (`src/app/models/event-checkin.ts`)
- Collection: `event_checkins`
- Referenced by 29 files
- Used heavily in analytics (time-series aggregations in `event-insight.ts`)

```sql
CREATE TABLE IF NOT EXISTS events.check_ins (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id          VARCHAR(24) NOT NULL UNIQUE,
  active            BOOLEAN NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL,
  created_by        VARCHAR(24) NOT NULL,
  event_id          VARCHAR(24) NOT NULL,
  user_id           VARCHAR(24),
  email             VARCHAR(255),
  ticket_id         VARCHAR(24) NOT NULL,
  updated_at        TIMESTAMPTZ,
  updated_by        VARCHAR(24)
);

CREATE INDEX idx_check_ins_event_ticket_active ON events.check_ins (event_id, ticket_id, active DESC);
CREATE INDEX idx_check_ins_event_created ON events.check_ins (event_id, created_at);
CREATE INDEX idx_check_ins_user ON events.check_ins (user_id DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_check_ins_email ON events.check_ins (email DESC) WHERE email IS NOT NULL;
CREATE INDEX idx_check_ins_ticket ON events.check_ins (ticket_id DESC);
```

**Field mapping from MongoDB:**

| MongoDB field | PG column | Type | Notes |
|---------------|-----------|------|-------|
| `_id` | `mongo_id` | VARCHAR(24) | |
| `active` | `active` | BOOLEAN | |
| `created_at` | `created_at` | TIMESTAMPTZ | |
| `created_by` | `created_by` | VARCHAR(24) | Ref to User |
| `event` | `event_id` | VARCHAR(24) | Ref to Event |
| `user` | `user_id` | VARCHAR(24) | Deprecated field, still populated |
| `email` | `email` | VARCHAR(255) | Deprecated field, still populated |
| `ticket` | `ticket_id` | VARCHAR(24) | Ref to Ticket. Becomes FK to events.tickets after migration. |
| `updated_at` | `updated_at` | TIMESTAMPTZ | |
| `updated_by` | `updated_by` | VARCHAR(24) | |

#### events.tickets

Source: `Ticket` model (`src/app/models/ticket.ts`)
- Collection: `tickets`
- Referenced by **130 files** -- the most interconnected model in the codebase
- Complex aggregation pipelines with $lookup to new_payments, spaces, events
- Transaction-wrapped bulk writes (`syncTicketCounters`, `assignTicketsToUsers`, `createTickets`)

```sql
CREATE TABLE IF NOT EXISTS events.tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id          VARCHAR(24) NOT NULL UNIQUE,
  shortid           VARCHAR(16) UNIQUE,
  active            BOOLEAN NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_id          VARCHAR(24) NOT NULL,
  type_id           VARCHAR(24) NOT NULL,
  accepted          BOOLEAN,
  acquired_by       VARCHAR(24),
  cancelled_by      VARCHAR(24),
  cancelled_at      TIMESTAMPTZ,
  acquired_by_email VARCHAR(255),
  assigned_email    VARCHAR(255),
  assigned_to       VARCHAR(24),
  invited_by        VARCHAR(24),
  payment_id        VARCHAR(24),
  metadata          JSONB,
  upgrade_history   JSONB
);

CREATE INDEX idx_tickets_event_type_created ON events.tickets (event_id, type_id, created_at);
CREATE INDEX idx_tickets_event_created ON events.tickets (event_id, created_at);
CREATE INDEX idx_tickets_event_assigned ON events.tickets (event_id, assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_tickets_event_assigned_email ON events.tickets (event_id, assigned_email) WHERE assigned_email IS NOT NULL;
CREATE INDEX idx_tickets_type_active ON events.tickets (type_id) WHERE active = true;
CREATE INDEX idx_tickets_payment_active ON events.tickets (payment_id) WHERE active = true AND payment_id IS NOT NULL;
CREATE INDEX idx_tickets_acquired_active ON events.tickets (acquired_by) WHERE active = true;
CREATE INDEX idx_tickets_acquired_email_active ON events.tickets (acquired_by_email) WHERE active = true;
CREATE INDEX idx_tickets_assigned_to ON events.tickets (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_tickets_assigned_email ON events.tickets (assigned_email) WHERE assigned_email IS NOT NULL;
CREATE INDEX idx_tickets_shortid ON events.tickets (shortid) WHERE shortid IS NOT NULL;
CREATE INDEX idx_tickets_metadata_buyer_name ON events.tickets USING GIN ((metadata->>'buyer_name') gin_trgm_ops) WHERE metadata IS NOT NULL;
CREATE INDEX idx_tickets_assigned_email_trgm ON events.tickets USING GIN (assigned_email gin_trgm_ops) WHERE assigned_email IS NOT NULL;
CREATE INDEX idx_tickets_acquired_email_trgm ON events.tickets USING GIN (acquired_by_email gin_trgm_ops) WHERE acquired_by_email IS NOT NULL;
```

**Field mapping from MongoDB:**

| MongoDB field | PG column | Type | Notes |
|---------------|-----------|------|-------|
| `_id` | `mongo_id` | VARCHAR(24) | |
| `shortid` | `shortid` | VARCHAR(16) | nanoid(16) |
| `active` | `active` | BOOLEAN | Inactive tickets represent cancelled, refunded, or expired tickets. Preserve the active flag from MongoDB during backfill. |
| `created_at` | `created_at` | TIMESTAMPTZ | |
| `event` | `event_id` | VARCHAR(24) | Ref to Event (stays on MongoDB) |
| `type` | `type_id` | VARCHAR(24) | Ref to EventTicketType (stays on MongoDB) |
| `accepted` | `accepted` | BOOLEAN | |
| `acquired_by` | `acquired_by` | VARCHAR(24) | Ref to User |
| `cancelled_by` | `cancelled_by` | VARCHAR(24) | |
| `cancelled_at` | `cancelled_at` | TIMESTAMPTZ | |
| `acquired_by_email` | `acquired_by_email` | VARCHAR(255) | |
| `assigned_email` | `assigned_email` | VARCHAR(255) | |
| `assigned_to` | `assigned_to` | VARCHAR(24) | Ref to User |
| `invited_by` | `invited_by` | VARCHAR(24) | Ref to User |
| `payment_id` | `payment_id` | VARCHAR(24) | Ref to NewPayment. Becomes FK to events.payments. |
| `metadata` | `metadata` | JSONB | {buyer_name, source, transaction_id, gated_wallet, ...} |
| `upgrade_history` | `upgrade_history` | JSONB | Array of {updated_by, updated_at, from_type, to_type} |

**Note on text search:** MongoDB has a text index on `metadata.buyer_name`, `assigned_email`, `acquired_by_email`. PostgreSQL uses `pg_trgm` GIN indexes (already enabled in migration `1778000000000`).

#### events.payments

Source: `NewPayment` model (`src/app/models/new-payment.ts`)
- Collection: `new_payments`
- Referenced by **95 files** -- second most interconnected model
- States: created, initialized, failed, await_capture, succeeded, refunded, cancelled
- Integrates with Stripe, blockchain (direct, escrow, relay, stake), Safe

```sql
CREATE TABLE IF NOT EXISTS events.payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id              VARCHAR(24) NOT NULL UNIQUE,
  stamps                JSONB NOT NULL,
  amount                NUMERIC(78,0) NOT NULL,
  fee                   NUMERIC(78,0),
  currency              VARCHAR(16) NOT NULL,
  state                 VARCHAR(16) NOT NULL,
  user_id               VARCHAR(24),
  buyer_email           VARCHAR(255),
  buyer_name            VARCHAR(255),
  account_id            VARCHAR(24) NOT NULL,
  ref_type              VARCHAR(16) NOT NULL,
  ref_event_id          VARCHAR(24),
  ref_ticket_type_ids   TEXT[],
  ref_ticket_counts     INT[],
  billing_email         VARCHAR(255),
  billing_firstname     VARCHAR(255),
  billing_lastname      VARCHAR(255),
  billing_address       JSONB,
  transfer_metadata     JSONB,
  transfer_params       JSONB,
  failure_reason        TEXT,
  attempting_refund     BOOLEAN,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_payments_state CHECK (state IN ('created', 'initialized', 'failed', 'await_capture', 'succeeded', 'refunded', 'cancelled'))
);

CREATE INDEX idx_payments_state ON events.payments (state);
CREATE INDEX idx_payments_buyer_email ON events.payments (buyer_email) WHERE buyer_email IS NOT NULL;
CREATE INDEX idx_payments_event ON events.payments (ref_event_id) WHERE ref_event_id IS NOT NULL;
CREATE INDEX idx_payments_auth_expiration ON events.payments ((transfer_metadata->>'authorization_expiration') DESC) WHERE transfer_metadata ? 'authorization_expiration';
CREATE INDEX idx_payments_tx_hash ON events.payments ((transfer_metadata->>'tx_hash')) WHERE transfer_metadata ? 'tx_hash';
CREATE INDEX idx_payments_user ON events.payments (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_payments_event_state ON events.payments (ref_event_id, state);
CREATE INDEX idx_payments_event_created ON events.payments (ref_event_id, created_at);
```

**Field mapping from MongoDB:**

| MongoDB field | PG column | Type | Notes |
|---------------|-----------|------|-------|
| `_id` | `mongo_id` | VARCHAR(24) | |
| `stamps` | `stamps` | JSONB | Map of state -> timestamp |
| (derived) | `created_at` | TIMESTAMPTZ | Derived from the earliest timestamp in the `stamps` map (e.g., `stamps.created` or the minimum value). For backfill, use `MIN(stamps[*])`. For new inserts, use `NOW()`. |
| `amount` | `amount` | NUMERIC(78,0) | Bigint string in Mongo, stored as NUMERIC for arithmetic |
| `fee` | `fee` | NUMERIC(78,0) | |
| `currency` | `currency` | VARCHAR(16) | |
| `state` | `state` | VARCHAR(16) | Enum with CHECK constraint |
| `user` | `user_id` | VARCHAR(24) | |
| `buyer_info.email` | `buyer_email` | VARCHAR(255) | Flattened from nested object |
| `buyer_info.name` | `buyer_name` | VARCHAR(255) | Flattened from nested object |
| `account` | `account_id` | VARCHAR(24) | Ref to NewPaymentAccount (stays on MongoDB) |
| `ref_type` | `ref_type` | VARCHAR(16) | Always 'ticket' currently |
| `ref_data.event` | `ref_event_id` | VARCHAR(24) | Flattened from TicketRefData |
| `ref_data.ticket_types` | `ref_ticket_type_ids` | TEXT[] | Flattened from TicketRefData |
| `ref_data.ticket_counts` | `ref_ticket_counts` | INT[] | Flattened from TicketRefData |
| `billing_info` | `billing_*` columns | Various | Flattened; address as JSONB |
| `transfer_metadata` | `transfer_metadata` | JSONB | Stripe or blockchain metadata |
| `transfer_params` | `transfer_params` | JSONB | Stripe or blockchain params |
| `failure_reason` | `failure_reason` | TEXT | |
| `attempting_refund` | `attempting_refund` | BOOLEAN | |

**Note on amount types:** MongoDB stores `amount` and `fee` as strings representing bigint values (for blockchain precision). PostgreSQL NUMERIC(78,0) handles this natively without string conversion. The existing `public.payments` read model uses NUMERIC(78,0) for the same reason (`src/sql/migrations/1777700000000-add-tickets-payments-read-models.sql`).

#### events.event_insights

Source: Aggregated from Ticket, EventCheckin, and Track (page views) data.
- Currently computed on-the-fly in `src/graphql/resolvers/event-insight.ts` via MongoDB aggregation pipelines
- Track data already lives in PostgreSQL (`src/app/services/track.ts`)
- No dedicated MongoDB model -- this is a new materialized view

```sql
CREATE MATERIALIZED VIEW events.event_insights AS
SELECT
  eg.mongo_event_id AS event_id,
  COUNT(DISTINCT t.id) FILTER (WHERE t.active = true) AS total_tickets,
  COUNT(DISTINCT t.id) FILTER (WHERE t.active = true AND t.payment_id IS NOT NULL) AS paid_tickets,
  COUNT(DISTINCT t.id) FILTER (WHERE t.active = true AND t.payment_id IS NULL) AS free_tickets,
  COUNT(DISTINCT ci.id) FILTER (WHERE ci.active = true) AS total_checkins,
  SUM(p.amount) FILTER (WHERE p.state = 'succeeded') AS total_revenue,
  p.currency AS revenue_currency,
  MIN(t.created_at) AS first_ticket_at,
  MAX(t.created_at) AS last_ticket_at
FROM events.tickets t
LEFT JOIN events.payments p ON t.payment_id = p.mongo_id
LEFT JOIN events.check_ins ci ON ci.ticket_id = t.mongo_id AND ci.active = true
LEFT JOIN public.event_summary eg ON t.event_id = eg.mongo_event_id
GROUP BY eg.mongo_event_id, p.currency;

CREATE UNIQUE INDEX idx_event_insights_event ON events.event_insights (event_id, revenue_currency);
```

**Refresh strategy:** Refresh after ticket/payment/checkin writes using `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Can be triggered by the existing `read-model-sync.ts` hooks or a scheduled job.

**ObjectId join note:** Backfill and sync must convert MongoDB ObjectIds to hex strings using `toHexString()`. Verify join correctness with test data before enabling PG reads.

**Multi-currency note:** One event can produce multiple rows if tickets are sold in different currencies. Callers should SUM across currencies or filter by specific currency.

### 2.2 spaces. schema

#### spaces.subscribers

Source: `SpaceMember` model (`src/app/models/space-member.ts`)
- Collection: `space_members`
- A PostgreSQL read model (`public.space_subscribers`) already exists and syncs via `read-model-sync.ts`
- This authoritative table replaces the read model

```sql
CREATE TABLE IF NOT EXISTS spaces.subscribers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id          VARCHAR(24) NOT NULL UNIQUE,
  user_id           VARCHAR(24),
  user_name         VARCHAR(255),
  email             VARCHAR(255),
  space_id          VARCHAR(24) NOT NULL,
  role              VARCHAR(24) NOT NULL,
  state             VARCHAR(16) NOT NULL,
  visible           BOOLEAN,
  decided_by        VARCHAR(24),
  role_changed_at   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_subscribers_state CHECK (state IN ('invited', 'requested', 'rejected', 'joined'))
);

CREATE INDEX idx_subscribers_space_role ON spaces.subscribers (space_id, role);
CREATE INDEX idx_subscribers_space_state ON spaces.subscribers (space_id, state);
CREATE INDEX idx_subscribers_user ON spaces.subscribers (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_subscribers_email ON spaces.subscribers (email) WHERE email IS NOT NULL;
```

**Note:** PostgreSQL does not support WHERE clauses in table-level UNIQUE constraints. Use partial unique indexes instead:

```sql
CREATE UNIQUE INDEX uq_subscribers_space_user_role ON spaces.subscribers (space_id, user_id, role) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_subscribers_space_email_role ON spaces.subscribers (space_id, email, role) WHERE email IS NOT NULL;
```

#### spaces.space_insights

Source: Aggregated from events.tickets, events.check_ins, events.payments, and public.event_summary.
- Currently computed in `src/graphql/resolvers/space-insight.ts` via multi-model MongoDB aggregation
- `read-model-read.ts` already provides a PostgreSQL path (feature-flagged)

```sql
CREATE MATERIALIZED VIEW spaces.space_insights AS
SELECT
  es.mongo_space_id AS space_id,
  COUNT(DISTINCT es.id) AS total_events,
  COUNT(DISTINCT es.id) FILTER (WHERE es.status = 'ended') AS past_events,
  COUNT(DISTINCT es.id) FILTER (WHERE es.status = 'upcoming') AS upcoming_events,
  COALESCE(SUM(es.total_tickets), 0) AS total_tickets,
  COALESCE(SUM(es.total_checkins), 0) AS total_checkins,
  COALESCE(SUM(es.total_revenue), 0) AS total_revenue,
  COUNT(DISTINCT ss.id) FILTER (WHERE ss.state = 'joined') AS total_members
FROM public.event_summary es
LEFT JOIN spaces.subscribers ss ON es.mongo_space_id = ss.space_id
GROUP BY es.mongo_space_id;

CREATE UNIQUE INDEX idx_space_insights_space ON spaces.space_insights (space_id);
```

### 2.3 Foreign key strategy

FK constraints are deferred until Phase B.3 (after dual-write is stable). During Phase B.0-B.2, VARCHAR(24) columns reference MongoDB ObjectIds without SQL FK constraints. In Phase B.3, add FK constraints with `NOT VALID` (skips existing row validation), then `VALIDATE CONSTRAINT` separately. Example:

```sql
-- Phase B.3: add FK without scanning existing rows
ALTER TABLE events.tickets
  ADD CONSTRAINT fk_tickets_payment FOREIGN KEY (payment_id) REFERENCES events.payments (mongo_id) NOT VALID;

-- Then validate in a separate transaction (takes a lighter lock)
ALTER TABLE events.tickets VALIDATE CONSTRAINT fk_tickets_payment;
```

### 2.4 atlas. schema

Atlas schema (10 tables) is defined in `atlas-protocol/impl/IMPL-POSTGRESQL-MIGRATION.md`. Implementation follows that IMPL directly.

**Coordination note:** Atlas tables are created in the same migration cycle as `events.*` and `spaces.*` tables, using the `atlas.` schema namespace on the same RDS instance.

---

## 3. Migration Strategy

### Phase A: Infrastructure (human devs)

**Scope:** RDS provisioning and schema creation. No code changes.

1. Provision new database on existing RDS instance (or confirm capacity)
2. Create schemas:
   ```sql
   CREATE SCHEMA IF NOT EXISTS events;
   CREATE SCHEMA IF NOT EXISTS spaces;
   ```
3. Verify connection pool config in `src/app/helpers/pg.ts` -- currently uses pg-promise defaults (10 connections). May need tuning for additional write load.
4. Add any new environment variables to CDK/ECS task definitions if using a separate database
5. Enable `pg_trgm` extension (already enabled by migration `1778000000000`)

**Deliverables:** RDS ready, schemas created, connection verified from staging.

### Phase B: Events + Spaces tables (agents -- after Phase A infra is ready)

**Scope:** Migrate Ticket, NewPayment, EventCheckin, EventJoinRequest, and SpaceMember from MongoDB to PostgreSQL as authoritative store.

#### Phase B.0: Create tables
- Migration file: `1780000000000-create-events-spaces-schemas.sql`
- Creates all `events.*` and `spaces.*` tables from Section 2

#### Phase B.1: Dual-write (MongoDB primary, PostgreSQL secondary)
- Modify write paths to INSERT/UPDATE into PostgreSQL after MongoDB write succeeds
- Leverage existing `read-model-sync.ts` patterns -- the sync infrastructure already exists
- All reads still come from MongoDB
- Monitor PostgreSQL write latency and error rate

**Key services to modify for dual-write:**

| Model | Primary write service | Files |
|-------|----------------------|-------|
| Ticket | `src/app/services/ticket.ts` | createTickets, assignTicketsToUsers, syncTicketCounters |
| NewPayment | `src/app/services/new-payment/index.ts`, `abstract.ts` | createPayment, cancelPayment, state transitions |
| EventCheckin | `src/graphql/resolvers/event-checkin.ts` | create/update checkins |
| EventJoinRequest | `src/app/services/event-join-request.ts` | create/decide requests |
| SpaceMember | Write paths via space-member model | state transitions |

#### Phase B.2: Read from PostgreSQL, write to both
- Switch read queries to PostgreSQL
- Keep dual-write active
- Feature flag: `PG_READ_ENABLED` (similar to existing `READ_MODEL_READ_ENABLED` in `read-model-read.ts:1`)
- Monitor read latency, verify data consistency
- Fallback to MongoDB reads if PostgreSQL fails (pattern already exists in `read-model-read.ts`)

**Services to modify for PG reads (by model, sorted by file count):**

Ticket (130 files -- phased rollout):
- Phase B.2a: Analytics/insight reads (`event-insight.ts`, `space-insight.ts`) -- lowest risk, already partially on PG
- Phase B.2b: Export reads (`ticket-detail-exporter.ts`, `event-checkin-exporter.ts`, `payment-exporter.ts`)
- Phase B.2c: Core reads (`ticket.ts`, `event-guest.ts`, `event-payment.ts`)
- Phase B.2d: Resolver reads (all GraphQL resolvers)

NewPayment (95 files -- phased):
- Phase B.2a: Analytics reads (`event-payment-summary.ts`, `space-payment.ts`)
- Phase B.2b: Core reads (`new-payment/index.ts`, `event-payment.ts`)

EventCheckin (29 files), EventJoinRequest (40 files), SpaceMember: Single rollout each.

#### Phase B.3: PostgreSQL primary, MongoDB secondary
- Swap write order: PostgreSQL first, then async MongoDB write
- If PostgreSQL write fails, do not write to MongoDB (maintain consistency)
- MongoDB receives fire-and-forget copies for backward compatibility

#### Phase B.4: Stop MongoDB writes
- Remove dual-write code
- PostgreSQL is sole authoritative store
- MongoDB collections become read-only archives
- Remove `public.` read model tables (replaced by `events.` and `spaces.` authoritative tables)
- Retire `read-model-sync.ts`

---

## 4. Dual-Write Strategy

### Architecture

```
             Phase B.1                    Phase B.2
Request --> MongoDB (write) ------> MongoDB (write)
              |                        |
              v                        v
           PG (async write)         PG (async write)
              |                        |
            [monitor]               PG (read) <-- feature flag
                                       |
                                    [fallback to Mongo if PG fails]

             Phase B.3                    Phase B.4
Request --> PG (write) -----------> PG (write)
              |                        |
              v                     [reads from PG]
           MongoDB (async copy)
              |
           PG (read)
```

### Dual-write implementation pattern

Follow the existing `read-model-sync.ts` pattern. After a MongoDB write succeeds, upsert to PostgreSQL:

```typescript
// Example: after ticket creation in MongoDB
async function syncTicketToPg(mongoTicket: TicketDocument): Promise<void> {
  await db.none(
    `INSERT INTO events.tickets (mongo_id, shortid, active, created_at, event_id, type_id, ...)
     VALUES ($1, $2, $3, $4, $5, $6, ...)
     ON CONFLICT (mongo_id) DO UPDATE SET
       active = EXCLUDED.active,
       assigned_to = EXCLUDED.assigned_to,
       ...`,
    [mongoTicket._id.toHexString(), mongoTicket.shortid, mongoTicket.active, ...]
  );
}
```

### Consistency guarantees

- Eventual consistency during dual-write phases (B.1, B.2, B.3)
- Strong consistency after cutover (B.4)
- If PostgreSQL write fails during B.1/B.2: log error, do not block request (MongoDB is still primary)
- If PostgreSQL write fails during B.3: fail the request (PostgreSQL is primary)

**Dual-write SLA:** PostgreSQL write must complete within 1 second of MongoDB write. If PostgreSQL write fails, log error and continue (non-blocking). The reconciliation job catches missed writes within 15 minutes.

---

## 5. Data Backfill

For each table, a backfill script reads all MongoDB documents and upserts into PostgreSQL.

### General approach

```typescript
async function backfillTable(
  MongoModel: mongoose.Model<any>,
  pgTable: string,
  mapFn: (doc: any) => Record<string, any>,
  columnSet: pgPromise.ColumnSet,
): Promise<void> {
  const batchSize = 1000;
  let lastId: string | null = null;
  let total = 0;

  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await MongoModel.find(query).sort({ _id: 1 }).limit(batchSize).lean();
    if (docs.length === 0) break;

    const rows = docs.map(mapFn);
    const insert = pgp.helpers.insert(rows, columnSet) +
      ' ON CONFLICT (mongo_id) DO NOTHING';
    await db.none(insert);

    lastId = docs[docs.length - 1]._id.toString();
    total += docs.length;
  }
  logger.info({ table: pgTable, total }, 'backfill complete');
}
```

### Per-table specifics

| Table | Source collection | Estimated rows | Key conversions |
|-------|------------------|----------------|-----------------|
| events.tickets | tickets | High volume | ObjectId -> VARCHAR(24), Date -> TIMESTAMPTZ, metadata subdoc -> JSONB |
| events.payments | new_payments | High volume | amount/fee string -> NUMERIC(78,0), nested buyer_info -> flat columns, nested ref_data -> flat columns |
| events.check_ins | event_checkins | High volume | ObjectId refs -> VARCHAR(24) |
| events.guest_lists | event_join_requests | Medium volume | requested_tickets array -> JSONB, metadata -> JSONB |
| spaces.subscribers | space_members | Medium volume | ObjectId refs -> VARCHAR(24) |

### Idempotency

All backfill scripts use `ON CONFLICT (mongo_id) DO NOTHING` or `DO UPDATE`. Running a script multiple times produces the same result. This allows:
- Restarting after failures
- Running incremental backfills during dual-write phase
- Verifying data by re-running and checking for conflicts

### ObjectId conversion

MongoDB `_id` (ObjectId) -> PostgreSQL `mongo_id` (VARCHAR(24)) via `doc._id.toHexString()`. This preserves the original ID for cross-system lookups during the transition period. The `id` column (UUID) is the PostgreSQL-native primary key.

### Date conversion

MongoDB Date objects map directly to PostgreSQL TIMESTAMPTZ. No conversion needed -- pg-promise handles this natively.

### Null/missing fields

MongoDB documents with missing optional fields map to NULL in PostgreSQL. The backfill `mapFn` uses `doc.field ?? null` for optional columns.

---

## 6. Service Rewrite Scope

### Ticket model (130 files)

**Critical path -- rewrite in phases:**

| Category | File count | Priority |
|----------|-----------|----------|
| Services (core business logic) | 20+ | P0 |
| GraphQL resolvers | 20+ | P0 |
| Export controllers | 5 | P1 |
| Admin resolvers | 3 | P1 |
| Jobs | 10+ | P1 |
| Forest/admin controllers | 5 | P2 |
| Connectors | 2 | P2 |
| MongoDB migrations | 15+ | No rewrite (historical) |
| Models/types | 10+ | Types stay, model replaced |

**Key files requiring complex rewrites:**
- `src/app/services/ticket.ts` (757 lines) -- aggregation pipelines -> SQL JOINs, bulk writes -> batch INSERT/UPDATE
- `src/graphql/resolvers/event-insight.ts` -- MongoDB aggregation -> materialized view queries
- `src/graphql/resolvers/space-insight.ts` -- multi-model aggregation -> SQL JOINs

### NewPayment model (95 files)

| Category | File count | Priority |
|----------|-----------|----------|
| Payment service (index, abstract, common, helper) | 4 | P0 |
| Payment integrations (stripe, direct, contract, escrow, relay, stake) | 6 | P0 |
| Core services | 10+ | P0 |
| GraphQL resolvers | 10+ | P0 |
| Admin resolvers | 3 | P1 |
| Controllers | 10+ | P1 |
| Jobs | 8+ | P1 |

### EventJoinRequest model (40 files)

**Primary rewrite target:** `src/app/services/event-join-request.ts` -- the base query file that agents need to convert first.

| Category | File count | Priority |
|----------|-----------|----------|
| Services | 9 | P0 |
| GraphQL resolvers | 7 | P0 |
| Controllers | 3 | P1 |
| Jobs | 2 | P1 |

### EventCheckin model (29 files)

| Category | File count | Priority |
|----------|-----------|----------|
| Services | 8 | P0 |
| GraphQL resolvers | 7 | P0 |
| Admin resolvers | 1 | P1 |
| Controllers | 1 | P1 |
| Jobs | 1 | P1 |

### SpaceMember (subscriber) model

Minimal rewrite -- `read-model-sync.ts` already syncs to PostgreSQL. Main change: point `read-model-read.ts` to `spaces.subscribers` instead of `public.space_subscribers`, then deprecate the public read model.

### Total service rewrite estimate

| Model | Files to rewrite | Complexity |
|-------|-----------------|------------|
| Ticket | ~80 (excl. migrations, types) | High -- aggregation pipelines, transactions, bulk ops |
| NewPayment | ~55 (excl. migrations, types) | High -- state machine, payment integrations |
| EventJoinRequest | ~21 | Medium -- some aggregation pipelines |
| EventCheckin | ~18 | Medium -- time-series aggregations |
| SpaceMember | ~5 | Low -- existing PG sync |
| **Total** | **~179** | |

---

## 7. Rollback Plan

### During dual-write (Phases C.1 through C.3)

MongoDB retains all authoritative data. If PostgreSQL has issues:

1. Disable feature flag `PG_READ_ENABLED` -- reads revert to MongoDB
2. Stop PostgreSQL writes (disable dual-write)
3. Diagnose and fix PostgreSQL issue
4. Re-enable dual-write
5. Run backfill to sync any MongoDB writes that happened while PG was down
6. Re-enable PG reads

**Data loss risk:** Zero. MongoDB is the source of truth until Phase B.4.

### After cutover (Phase B.4)

PostgreSQL is the sole authoritative store. Rollback requires:

1. Stop writes
2. Restore MongoDB from the last dual-write state (kept as read-only archive)
3. Run a reverse sync: PostgreSQL -> MongoDB for any writes after cutover
4. Re-enable MongoDB write paths

**Mitigation:** Keep MongoDB write paths in code (behind feature flag) for 30 days after cutover. Only remove after confidence period.

---

## 8. Testing Strategy

### Unit tests

Replace Mongoose model mocks with pg-promise mocks:

```typescript
// Before (Mongoose)
jest.spyOn(TicketModel, 'find').mockResolvedValue([mockTicket]);

// After (pg-promise)
jest.spyOn(db, 'any').mockResolvedValue([mockTicketRow]);
```

### Integration tests

Run against a real PostgreSQL instance (Docker in CI, local for dev):

```yaml
# CI docker-compose addition
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: lemonade_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports:
      - "5433:5432"
```

Run migrations before test suite. Tear down after.

### Data consistency checks

During dual-write phases, run periodic consistency checks:

```sql
-- Compare record counts
SELECT 'tickets' AS table_name,
  (SELECT COUNT(*) FROM events.tickets) AS pg_count;
-- vs MongoDB: db.tickets.countDocuments()

-- Compare specific records by mongo_id
SELECT mongo_id, active, state, amount
FROM events.payments
WHERE mongo_id = $1;
-- vs MongoDB: NewPaymentModel.findById(id)
```

Expose as a health check endpoint or scheduled job with Prometheus metrics (similar to existing `read-model-sync.ts` discrepancy counters).

### Aggregation equivalence tests

For each MongoDB aggregation pipeline being replaced, write a test that:
1. Seeds identical data in both MongoDB and PostgreSQL
2. Runs the MongoDB aggregation
3. Runs the equivalent SQL query
4. Asserts identical results

Critical aggregations to test:
- `ticket.ts:syncTicketCounters` -- GROUP BY with COUNT
- `event-insight.ts:getEventTicketSoldChartData` -- time-series with date bucketing
- `event-insight.ts:getEventCheckinChartData` -- time-series
- `space-insight.ts:getSpaceStatistics` -- multi-table JOIN with SUM/AVG

---

## 9. Timeline

| Phase | Owner | Dependencies | Duration |
|-------|-------|-------------|----------|
| Phase A: Infrastructure | Human devs | None | 1-2 days |
| Phase B.0: Create events/spaces tables | Agents | Phase A | 1 day |
| Phase B.1: Dual-write (Mongo primary) | Agents | Phase B.0 | 1 week |
| Phase B.2: PG reads (phased rollout) | Agents | Phase B.1 + backfill complete | 2-3 weeks |
| Phase B.3: PG primary writes | Agents + human devs | Phase B.2 verified on staging | 1 week |
| Phase B.4: Cutover | Human devs | Phase B.3 verified on production | 1 day + 30-day confidence |

Phase B starts after Phase A completes. Atlas tables follow their own timeline per `IMPL-POSTGRESQL-MIGRATION.md`.

---

## 10. Infrastructure Requirements

### RDS instance

The existing RDS instance already serves `ai.` and `api.` schemas. Verify:
- Storage capacity for migrated data (tickets + payments are the largest collections)
- IOPS sufficient for dual-write load
- Multi-AZ for production reliability

### Connection pool sizing

Current: pg-promise defaults (~10 connections). After migration:
- Estimate: 20-30 connections needed (dual-write doubles write load temporarily)
- Configure in `src/app/helpers/pg.ts`:
  ```typescript
  export const db = pgp({
    ...config,
    max: 30, // pool size
    idleTimeoutMillis: 30000,
  });
  ```

### Monitoring

- **Query latency:** Track P50/P95/P99 for each migrated table
- **Connection pool usage:** `db.$pool.totalCount`, `db.$pool.idleCount`, `db.$pool.waitingCount`
- **Replication lag:** If using read replicas
- **Dual-write discrepancies:** Extend existing Prometheus counters from `read-model-sync.ts`
- **Table sizes:** `pg_total_relation_size()` for capacity planning

### Backups

- RDS automated backups: enabled, 7-day retention minimum
- Point-in-time recovery: enabled
- Pre-cutover snapshot: manual snapshot before Phase B.4

### Migration file naming

Follow existing convention in `src/sql/migrations/`:
- Format: `<unix_epoch_ms>-<description>.sql`
- Rollback: `<unix_epoch_ms>-<description>.down.sql`
- Runner: `src/app/helpers/pg-migrate.ts` (tracks applied migrations in `ai.pg_migrations`)
- CLI: `npm run pg-migrate:dev up|down [steps]`

---

## 11. Type Conventions

| Use case | PostgreSQL type | Example |
|----------|----------------|---------|
| Blockchain token amounts (variable precision) | NUMERIC(78,0) | payment amount, fee |
| MongoDB ObjectId references | VARCHAR(24) | event_id, user_id, ticket_id |

These conventions apply to the `events.*` and `spaces.*` tables in this PRD. Atlas tables follow their own type conventions defined in `IMPL-POSTGRESQL-MIGRATION.md`.
