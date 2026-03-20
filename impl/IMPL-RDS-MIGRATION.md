# IMPL: MongoDB to RDS Migration (Events + Spaces)

Migrate Ticket, NewPayment, EventCheckin, EventJoinRequest, and SpaceMember from MongoDB to PostgreSQL (Amazon RDS) as authoritative stores. Create materialized views for event and space insights.

PRD: `atlas-protocol/PRD-POSTGRESQL-MIGRATION.md`
Reference IMPL: `atlas-protocol/impl/IMPL-POSTGRESQL-MIGRATION.md` (Atlas migration -- follow same patterns)

---

## 0. Critical: pg-promise, Not Knex

lemonade-backend uses **pg-promise v10.11.0**, not Knex. All PostgreSQL patterns in this IMPL use pg-promise conventions:

- Connection: `import { db, pgp } from '../helpers/pg'` (`src/app/helpers/pg.ts:1-18`)
- Queries: `db.one(sql, params)`, `db.any(sql, params)`, `db.none(sql, params)`, `db.oneOrNone(sql, params)`
- Transactions: `db.tx(async (t) => { ... })`
- Parameterization: `$1, $2, ...` positional placeholders
- Bulk inserts: `pgp.helpers.insert(rows, columnSet)`
- No query builder -- raw parameterized SQL throughout

### Decimal Type Convention

Three distinct numeric types:

- **`NUMERIC(78,0)`** -- blockchain token amounts (variable precision). Used for `amount`, `fee` in payments. Range: up to 78 digits.
- **`DECIMAL(12,2)`** -- fiat USD dollar amounts (not used in this migration's tables, but noted for consistency with Atlas IMPL)
- **`DECIMAL(20,0)`** -- USDC micro-unit amounts (not used in this migration's tables, but noted for consistency)

### SQL Safety Rules

ALL queries MUST use positional parameters (`$1`, `$2`, ...). For IN clauses with arrays, use `ANY($1)` with an array parameter. NEVER interpolate values into SQL strings.

### updated_at Convention

Every UPDATE statement that modifies a row MUST explicitly set `updated_at = NOW()`. No database triggers. This keeps behavior explicit and auditable.

### JSONB Array Append Pattern [FIX-3]

MongoDB `$push` to append to an array field has no direct PostgreSQL equivalent. Use the `||` JSONB concatenation operator with `COALESCE` to handle NULL arrays:

```sql
-- Append to JSONB array (e.g., upgrade_history on tickets):
UPDATE events.tickets SET
  upgrade_history = COALESCE(upgrade_history, '[]'::jsonb) || $1::jsonb,
  updated_at = NOW()
WHERE mongo_id = $2
```

Where `$1` is the new element wrapped in an array: `JSON.stringify([{ updated_by, updated_at, from_type, to_type }])`.

Services that use `$push` and need this pattern:
- `src/graphql/resolvers/ticket.ts` -- `upgradeTicket()` pushes to `upgrade_history`
- Any future array append on JSONB columns

**NEVER** use `|| $1::jsonb` without `COALESCE` -- if the column is NULL, `NULL || value` returns NULL and silently drops the new element.

### JSONB Merge NULL Safety [FIX-6]

When merging JSONB objects (e.g., updating stamps on payments), always wrap with COALESCE:

```sql
-- WRONG: returns NULL if stamps is NULL
UPDATE events.payments SET stamps = stamps || $1::jsonb ...

-- CORRECT: handles NULL stamps
UPDATE events.payments SET stamps = COALESCE(stamps, '{}'::jsonb) || $1::jsonb ...
```

Apply this pattern to ALL JSONB merge operations in the codebase. The stamps column is NOT NULL in the DDL, but defensive coding prevents data corruption if a bug inserts a NULL.

### MongoDB $unwind to SQL JOIN Mapping [FIX-7]

MongoDB `$unwind` has two distinct behaviors:

- **`{ $unwind: '$field' }`** (no options) -- equivalent to **INNER JOIN**. Documents without the field or with an empty array are dropped.
- **`{ $unwind: { path: '$field', preserveNullAndEmptyArrays: true } }`** -- equivalent to **LEFT JOIN**. Documents without the field are preserved with NULL.

Before converting any aggregation pipeline, check the `$unwind` options:
- `preserveNullAndEmptyArrays: true` -> `LEFT JOIN`
- No such option or `false` -> `INNER JOIN` (or `JOIN`)

Failure to check this will silently drop rows when documents have no matching related record.

### Text Search Behavior Difference [FIX-8]

MongoDB text indexes (`$text: { $search }`) support phrase search (quoted strings like `"exact phrase"`). PostgreSQL `pg_trgm` ILIKE does NOT support phrase search -- it matches substrings only.

Known behavior difference:
- MongoDB `$text: { $search: '"John Smith" }` -- matches exact phrase "John Smith"
- PostgreSQL `ILIKE '%John Smith%'` -- matches any string containing "John Smith" as a substring (similar but not identical semantics)

If exact phrase search is required in the future, use `tsvector`/`tsquery` full-text search instead of `pg_trgm`. For the current use cases (buyer_name, email search), ILIKE substring matching is functionally equivalent and acceptable.

### ObjectId Timestamp Extraction [FIX-1, FIX-2]

MongoDB ObjectIds encode their creation timestamp in the first 4 bytes (8 hex characters). Extract with:

```typescript
function objectIdToDate(id: string): Date {
  return new Date(parseInt(id.substring(0, 8), 16) * 1000);
}
```

Use this for:
- **SpaceMember** -- has NO `created_at` field in Mongoose. Always derive from ObjectId.
- **NewPayment** -- `created_at` is derived, not stored. Always derive from ObjectId (never fall back to `new Date()`).
- **Backfill scripts** -- any model where `created_at` may be missing or unreliable.

---

## 1. Scope

### Models that move to RDS

| # | Mongoose Model | MongoDB Collection | PostgreSQL Table | Source File | Service/Resolver Files |
|---|---|---|---|---|---|
| 1 | EventJoinRequest | event_join_requests | events.guest_lists | `src/app/models/event-join-request.ts` | 23 |
| 2 | Ticket | tickets | events.tickets | `src/app/models/ticket.ts` | 49 |
| 3 | NewPayment | new_payments | events.payments | `src/app/models/new-payment.ts` | 22 |
| 4 | EventCheckin | event_checkins | events.check_ins | `src/app/models/event-checkin.ts` | 10 |
| 5 | SpaceMember | space_members | spaces.subscribers | `src/app/models/space-member.ts` | 21 |
| 6 | (computed) | -- | events.event_insights | Materialized view from tickets/payments/checkins | -- |
| 7 | (computed) | -- | spaces.space_insights | Materialized view from events/subscribers | -- |

### Models that stay on MongoDB

| Model | Reason |
|---|---|
| Event (`src/app/models/event.ts`) | 1316 lines, deeply nested page configs, broadcasts, sessions, rewards. Flexible schema changes frequently. |
| Space (`src/app/models/space.ts`) | 200+ fields, complex nested config (theme, sendgrid, subscriptions, asset library, page_config). |
| User | Variable profiles, OAuth tokens, wallet addresses, notification preferences. |
| EventTicketType (`src/app/models/event-ticket-type.ts`) | Nested prices array, offers, self_verification objects. Config data, not transactional. |
| NewPaymentAccount (`src/app/models/new-payment-account.ts`) | Union-typed account_info (Stripe vs blockchain vs escrow vs relay vs stake). |
| ExternalEventMapping | External platform connector configs. |
| PageConfig | 30+ section types, deeply nested theme/layout objects. |
| All Atlas models | Already on PostgreSQL via separate IMPL (`IMPL-POSTGRESQL-MIGRATION.md`). |
| AI models (conversations, credits) | Already on PostgreSQL (`ai.` schema) or unstructured. |

### Existing PostgreSQL read models being replaced

The `public.*` read model tables (created by `src/sql/migrations/1772700000000-create-public-read-models.sql` and `1777700000000-add-tickets-payments-read-models.sql`) already sync data from MongoDB via `src/app/services/read-model-sync.ts`. After this migration completes (Phase B.4), these public read model tables are retired and replaced by the authoritative `events.*` and `spaces.*` tables.

During the migration, both coexist. The `read-model-sync.ts` fire-and-forget triggers continue running until Phase B.4.

---

## 2. PostgreSQL Schema -- events.* (Complete DDL)

### events.guest_lists

Source: `EventJoinRequest` model (`src/app/models/event-join-request.ts`)

**MongoDB field mapping:**

| MongoDB field | PG column | PG type | Notes |
|---|---|---|---|
| `_id` | `mongo_id` | VARCHAR(24) | ObjectId hex string |
| `created_at` | `created_at` | TIMESTAMPTZ | Default: Date.now in Mongoose |
| `event` | `event_id` | VARCHAR(24) | Ref to Event (stays MongoDB) |
| `user` | `user_id` | VARCHAR(24) | Ref to User (stays MongoDB), nullable |
| `email` | `email` | VARCHAR(255) | Nullable |
| `state` | `state` | VARCHAR(16) | Enum: pending, approved, declined. Default: pending |
| `decided_at` | `decided_at` | TIMESTAMPTZ | Nullable |
| `decided_by` | `decided_by` | VARCHAR(24) | Nullable |
| `metadata` | `metadata` | JSONB | Mixed type in Mongoose, nullable |
| `requested_tickets` | `requested_tickets` | JSONB | Array of {ticket_type: ObjectId hex, count: number, metadata: {gated_wallet?}} |
| `payment_id` | `payment_id` | VARCHAR(24) | Ref to NewPayment, nullable |
| `ticket_issued` | `ticket_issued` | BOOLEAN | Nullable |

**MongoDB indexes:**
- `{ event: 1, state: 1 }` -- compound
- `{ user: 1 }` -- partial: user exists
- `{ email: 1 }` -- partial: email exists
- `{ payment_id: -1 }` -- partial: payment_id exists

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
  updated_at        TIMESTAMPTZ,

  CONSTRAINT chk_guest_lists_state CHECK (state IN ('pending', 'approved', 'declined'))
);

CREATE INDEX idx_guest_lists_event_state ON events.guest_lists (event_id, state);
CREATE INDEX idx_guest_lists_user ON events.guest_lists (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_guest_lists_email ON events.guest_lists (email) WHERE email IS NOT NULL;
CREATE INDEX idx_guest_lists_payment ON events.guest_lists (payment_id DESC) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_guest_lists_event_created ON events.guest_lists (event_id, created_at);
```

### events.check_ins

Source: `EventCheckin` model (`src/app/models/event-checkin.ts`)

**MongoDB field mapping:**

| MongoDB field | PG column | PG type | Notes |
|---|---|---|---|
| `_id` | `mongo_id` | VARCHAR(24) | |
| `active` | `active` | BOOLEAN | Required |
| `created_at` | `created_at` | TIMESTAMPTZ | Required |
| `created_by` | `created_by` | VARCHAR(24) | Ref to User |
| `event` | `event_id` | VARCHAR(24) | Ref to Event |
| `user` | `user_id` | VARCHAR(24) | Deprecated, still populated |
| `email` | `email` | VARCHAR(255) | Deprecated, still populated |
| `ticket` | `ticket_id` | VARCHAR(24) | Ref to Ticket |
| `updated_at` | `updated_at` | TIMESTAMPTZ | Nullable |
| `updated_by` | `updated_by` | VARCHAR(24) | Nullable |

**MongoDB indexes:**
- `{ event: -1, ticket: -1, active: -1 }` -- compound descending
- `{ event: 1, created_at: 1 }` -- compound
- `{ user: -1 }` -- partial: user exists
- `{ email: -1 }` -- partial: email exists
- `{ ticket: -1 }` -- descending

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

### events.tickets

Source: `Ticket` model (`src/app/models/ticket.ts`)

**MongoDB field mapping:**

| MongoDB field | PG column | PG type | Notes |
|---|---|---|---|
| `_id` | `mongo_id` | VARCHAR(24) | |
| `shortid` | `shortid` | VARCHAR(16) | nanoid(16), unique sparse |
| `active` | `active` | BOOLEAN | Required |
| `created_at` | `created_at` | TIMESTAMPTZ | Default: Date.now |
| `event` | `event_id` | VARCHAR(24) | Ref to Event |
| `type` | `type_id` | VARCHAR(24) | Ref to EventTicketType (stays MongoDB) |
| `accepted` | `accepted` | BOOLEAN | Nullable |
| `acquired_by` | `acquired_by` | VARCHAR(24) | Ref to User, nullable |
| `cancelled_by` | `cancelled_by` | VARCHAR(24) | Nullable |
| `cancelled_at` | `cancelled_at` | TIMESTAMPTZ | Nullable |
| `acquired_by_email` | `acquired_by_email` | VARCHAR(255) | Nullable |
| `assigned_email` | `assigned_email` | VARCHAR(255) | Nullable |
| `assigned_to` | `assigned_to` | VARCHAR(24) | Ref to User, nullable |
| `invited_by` | `invited_by` | VARCHAR(24) | Ref to User, nullable |
| `payment_id` | `payment_id` | VARCHAR(24) | Ref to NewPayment, nullable |
| `metadata` | `metadata` | JSONB | {buyer_name, source, transaction_id, gated_wallet, ...} |
| `upgrade_history` | `upgrade_history` | JSONB | Array of {updated_by, updated_at, from_type, to_type} |

**MongoDB indexes:**
- `{ shortid: 1 }` -- sparse, unique
- `{ event: 1, type: 1, created_at: 1 }` -- compound
- `{ event: 1, created_at: 1 }` -- compound
- `{ event: 1, assigned_to: 1 }` -- partial: assigned_to exists
- `{ event: 1, assigned_email: 1 }` -- partial: assigned_email exists
- `{ type: 1 }` -- partial: active = true
- `{ payment_id: 1 }` -- partial: active = true, payment_id exists
- `{ acquired_by: 1 }` -- partial: active = true
- `{ acquired_by_email: 1 }` -- partial: active = true
- `{ assigned_to: 1 }` -- partial: assigned_to exists
- `{ assigned_email: 1 }` -- partial: assigned_email exists
- Text index on `metadata.buyer_name`, `assigned_email`, `acquired_by_email` -- partial: active = true

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
  upgrade_history   JSONB,
  updated_at        TIMESTAMPTZ
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

**Note on text search:** MongoDB text index on `metadata.buyer_name`, `assigned_email`, `acquired_by_email` maps to `pg_trgm` GIN indexes (extension already enabled by migration `1778000000000-add-event-guests-search-index.sql`).

### events.payments

Source: `NewPayment` model (`src/app/models/new-payment.ts`)

**MongoDB field mapping:**

| MongoDB field | PG column | PG type | Notes |
|---|---|---|---|
| `_id` | `mongo_id` | VARCHAR(24) | |
| `stamps` | `stamps` | JSONB | Map of state name to timestamp |
| (derived) | `created_at` | TIMESTAMPTZ | [FIX-2] Derived from ObjectId timestamp: `new Date(parseInt(doc._id.toString().substring(0, 8), 16) * 1000)`. This is always accurate because ObjectIds encode their creation timestamp. Do NOT fall back to `new Date()` which would capture current time instead of original creation time. For new inserts (Phase B.3), use `NOW()`. |
| `amount` | `amount` | NUMERIC(78,0) | BigInt string in Mongo |
| `fee` | `fee` | NUMERIC(78,0) | Nullable |
| `currency` | `currency` | VARCHAR(16) | |
| `state` | `state` | VARCHAR(16) | Enum with CHECK |
| `user` | `user_id` | VARCHAR(24) | Nullable |
| `buyer_info.email` | `buyer_email` | VARCHAR(255) | Flattened |
| `buyer_info.name` | `buyer_name` | VARCHAR(255) | Flattened |
| `account` | `account_id` | VARCHAR(24) | Ref to NewPaymentAccount (stays MongoDB) |
| `ref_type` | `ref_type` | VARCHAR(16) | Always 'ticket' |
| `ref_data.event` | `ref_event_id` | VARCHAR(24) | Flattened |
| `ref_data.ticket_types` | `ref_ticket_type_ids` | TEXT[] | Flattened |
| `ref_data.ticket_counts` | `ref_ticket_counts` | INT[] | Flattened |
| `billing_info.email` | `billing_email` | VARCHAR(255) | Flattened |
| `billing_info.firstname` | `billing_firstname` | VARCHAR(255) | Flattened |
| `billing_info.lastname` | `billing_lastname` | VARCHAR(255) | Flattened |
| `billing_info` (address) | `billing_address` | JSONB | Remaining address fields |
| `transfer_metadata` | `transfer_metadata` | JSONB | Stripe or blockchain metadata |
| `transfer_params` | `transfer_params` | JSONB | Stripe or blockchain params |
| `failure_reason` | `failure_reason` | TEXT | Nullable |
| `attempting_refund` | `attempting_refund` | BOOLEAN | Nullable |

**MongoDB indexes:**
- `{ state: 1 }`
- `{ 'buyer_info.email': 1 }` -- partial: buyer_info.email exists
- `{ 'ref_data.event': 1 }` -- partial: ref_data.event exists
- `{ 'transfer_metadata.authorization_expiration': -1 }` -- sparse
- `{ 'transfer_metadata.tx_hash': 1 }` -- unique, sparse
- `{ user: 1 }` -- partial: user exists

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
  updated_at            TIMESTAMPTZ,

  CONSTRAINT chk_payments_state CHECK (state IN ('created', 'initialized', 'failed', 'await_capture', 'succeeded', 'refunded', 'cancelled'))
);

CREATE INDEX idx_payments_state ON events.payments (state);
CREATE INDEX idx_payments_buyer_email ON events.payments (buyer_email) WHERE buyer_email IS NOT NULL;
CREATE INDEX idx_payments_event ON events.payments (ref_event_id) WHERE ref_event_id IS NOT NULL;
CREATE INDEX idx_payments_auth_expiration ON events.payments ((transfer_metadata->>'authorization_expiration') DESC) WHERE transfer_metadata ? 'authorization_expiration';
CREATE UNIQUE INDEX idx_payments_tx_hash ON events.payments ((transfer_metadata->>'tx_hash')) WHERE transfer_metadata ? 'tx_hash';
CREATE INDEX idx_payments_user ON events.payments (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_payments_event_state ON events.payments (ref_event_id, state);
CREATE INDEX idx_payments_event_created ON events.payments (ref_event_id, created_at);
```

### events.event_insights (Materialized View)

Aggregated from tickets, payments, check_ins, and public.event_summary. No dedicated MongoDB model -- currently computed on-the-fly in `src/graphql/resolvers/event-insight.ts`.

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

**Refresh strategy:** `REFRESH MATERIALIZED VIEW CONCURRENTLY events.event_insights` after ticket/payment/checkin writes. Triggered by dual-write helpers or scheduled job (every 5 minutes during high-traffic periods).

---

## 3. PostgreSQL Schema -- spaces.* (Complete DDL)

### spaces.subscribers

Source: `SpaceMember` model (`src/app/models/space-member.ts`)

**MongoDB field mapping:**

| MongoDB field | PG column | PG type | Notes |
|---|---|---|---|
| `_id` | `mongo_id` | VARCHAR(24) | |
| `user` | `user_id` | VARCHAR(24) | Ref to User, nullable |
| `user_name` | `user_name` | VARCHAR(255) | Fallback display name |
| `email` | `email` | VARCHAR(255) | Nullable |
| `space` | `space_id` | VARCHAR(24) | Ref to Space (stays MongoDB) |
| `role` | `role` | VARCHAR(24) | admin, creator, ambassador, subscriber, unsubscriber |
| `state` | `state` | VARCHAR(16) | invited, requested, rejected, joined |
| `visible` | `visible` | BOOLEAN | Nullable |
| `decided_by` | `decided_by` | VARCHAR(24) | Nullable |
| `role_changed_at` | `role_changed_at` | TIMESTAMPTZ | Default: Date.now |
| `deleted_at` | `deleted_at` | TIMESTAMPTZ | Soft delete |
| (none) | `created_at` | TIMESTAMPTZ | [FIX-1] SpaceMember has NO `created_at` field in Mongoose. Derived from ObjectId timestamp during backfill: `new Date(parseInt(doc._id.toString().substring(0, 8), 16) * 1000)`. For new inserts (Phase B.3), use `NOW()`. |

**MongoDB indexes:**
- `{ space: 1, role: 1 }` -- compound
- `{ space: 1, state: 1 }` -- compound
- `{ user: 1 }` -- partial: user exists
- `{ email: 1 }` -- partial: email exists
- `{ space: 1, user: 1, role: 1 }` -- unique, partial: user exists
- `{ space: 1, email: 1, role: 1 }` -- unique, partial: email exists

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
  updated_at        TIMESTAMPTZ,

  CONSTRAINT chk_subscribers_state CHECK (state IN ('invited', 'requested', 'rejected', 'joined'))
);

CREATE INDEX idx_subscribers_space_role ON spaces.subscribers (space_id, role);
CREATE INDEX idx_subscribers_space_state ON spaces.subscribers (space_id, state);
CREATE INDEX idx_subscribers_user ON spaces.subscribers (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_subscribers_email ON spaces.subscribers (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_subscribers_space_user_role ON spaces.subscribers (space_id, user_id, role) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_subscribers_space_email_role ON spaces.subscribers (space_id, email, role) WHERE email IS NOT NULL;
```

### spaces.space_insights (Materialized View)

Aggregated from public.event_summary and spaces.subscribers.

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

### Foreign key strategy

FK constraints are deferred until Phase B.3 (after dual-write is stable). During Phase B.0-B.2, VARCHAR(24) columns reference MongoDB ObjectIds without SQL FK constraints. In Phase B.3:

```sql
-- Add FK without scanning existing rows
ALTER TABLE events.tickets
  ADD CONSTRAINT fk_tickets_payment FOREIGN KEY (payment_id) REFERENCES events.payments (mongo_id) NOT VALID;

-- Validate in a separate transaction (lighter lock)
ALTER TABLE events.tickets VALIDATE CONSTRAINT fk_tickets_payment;
```

Same pattern for events.check_ins.ticket_id -> events.tickets.mongo_id and events.guest_lists.payment_id -> events.payments.mongo_id.

---

## 4. Migration Files

Follow existing convention: raw `.sql` files in `lemonade-backend/src/sql/migrations/`, timestamp-prefixed, tracked by `ai.pg_migrations` table via `src/app/helpers/pg-migrate.ts`.

Existing migrations end at `1779300000000`. The PRD specifies `1780000000000` for this migration.

### Migration 1: Create events and spaces schemas + tables

**File:** `src/sql/migrations/1780000000000-create-events-spaces-schemas.sql`

Contents:
```sql
-- Schema creation
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS spaces;

-- events.guest_lists (from EventJoinRequest)
-- [full DDL from Section 2 above]

-- events.check_ins (from EventCheckin)
-- [full DDL from Section 2 above]

-- events.tickets (from Ticket)
-- [full DDL from Section 2 above]

-- events.payments (from NewPayment)
-- [full DDL from Section 2 above]

-- spaces.subscribers (from SpaceMember)
-- [full DDL from Section 3 above]
```

**Down file:** `src/sql/migrations/1780000000000-create-events-spaces-schemas.down.sql`
```sql
-- Staging: DROP tables
DROP TABLE IF EXISTS spaces.subscribers;
DROP TABLE IF EXISTS events.payments;
DROP TABLE IF EXISTS events.tickets;
DROP TABLE IF EXISTS events.check_ins;
DROP TABLE IF EXISTS events.guest_lists;
-- Do not drop schemas; materialized views may reference them

-- Production (use instead of DROP):
-- ALTER TABLE events.guest_lists RENAME TO _deleted_guest_lists_YYYYMMDD;
-- ... same for each table
-- Schedule final deletion 30 days after rename.
```

### Migration 2: Create materialized views

**File:** `src/sql/migrations/1780100000000-create-events-spaces-materialized-views.sql`

Contents: event_insights and space_insights materialized views with unique indexes (DDL from Sections 2 and 3).

**Down file:** `src/sql/migrations/1780100000000-create-events-spaces-materialized-views.down.sql`
```sql
DROP MATERIALIZED VIEW IF EXISTS spaces.space_insights;
DROP MATERIALIZED VIEW IF EXISTS events.event_insights;
```

---

## 5. Dual-Write Helpers

### Architecture

After a MongoDB write succeeds, upsert to PostgreSQL. Non-blocking during Phase B.1/B.2 (MongoDB is primary). Blocking during Phase B.3 (PostgreSQL is primary).

### Feature flag

```typescript
// src/config/index.ts
export const pgDualWriteEnabled = env.get('PG_DUAL_WRITE_ENABLED').default('false').asBool();
export const pgReadEnabled = env.get('PG_READ_ENABLED').default('false').asBool();
export const pgPrimaryEnabled = env.get('PG_PRIMARY_ENABLED').default('false').asBool();
```

### Dual-write service pattern

**New file:** `src/app/services/pg-sync.ts`

This service provides upsert helpers for each migrated model. It follows the same fire-and-forget pattern as the existing `read-model-sync.ts` (`src/app/services/read-model-sync.ts`), with Prometheus metrics.

```typescript
import { db, pgp } from '../helpers/pg';
import { pgDualWriteEnabled } from '../../config';
import { logger } from '../helpers/logger';
import { Counter, Histogram } from 'prom-client';

const syncTotal = new Counter({
  name: 'pg_sync_total',
  help: 'Total pg sync operations',
  labelNames: ['table', 'status'],
});

const syncDuration = new Histogram({
  name: 'pg_sync_duration_seconds',
  help: 'Duration of pg sync operations',
  labelNames: ['table'],
});

// ---------------------------------------------------------------------------
// events.tickets
// ---------------------------------------------------------------------------
export async function syncTicketToPg(doc: {
  _id: { toHexString(): string } | string;
  shortid?: string;
  active: boolean;
  created_at: Date;
  event: { toHexString(): string } | string;
  type: { toHexString(): string } | string;
  accepted?: boolean;
  acquired_by?: { toHexString(): string } | string | null;
  cancelled_by?: { toHexString(): string } | string | null;
  cancelled_at?: Date | null;
  acquired_by_email?: string | null;
  assigned_email?: string | null;
  assigned_to?: { toHexString(): string } | string | null;
  invited_by?: { toHexString(): string } | string | null;
  payment_id?: { toHexString(): string } | string | null;
  metadata?: Record<string, unknown> | null;
  upgrade_history?: unknown[] | null;
}): Promise<void> {
  const hex = (v: unknown) =>
    v && typeof v === 'object' && 'toHexString' in v
      ? (v as { toHexString(): string }).toHexString()
      : (v as string | null) ?? null;

  await db.none(
    `INSERT INTO events.tickets (
      mongo_id, shortid, active, created_at, event_id, type_id,
      accepted, acquired_by, cancelled_by, cancelled_at,
      acquired_by_email, assigned_email, assigned_to, invited_by,
      payment_id, metadata, upgrade_history, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW()
    )
    ON CONFLICT (mongo_id) DO UPDATE SET
      shortid = EXCLUDED.shortid,
      active = EXCLUDED.active,
      accepted = EXCLUDED.accepted,
      acquired_by = EXCLUDED.acquired_by,
      cancelled_by = EXCLUDED.cancelled_by,
      cancelled_at = EXCLUDED.cancelled_at,
      acquired_by_email = EXCLUDED.acquired_by_email,
      assigned_email = EXCLUDED.assigned_email,
      assigned_to = EXCLUDED.assigned_to,
      invited_by = EXCLUDED.invited_by,
      payment_id = EXCLUDED.payment_id,
      metadata = EXCLUDED.metadata,
      upgrade_history = EXCLUDED.upgrade_history,
      updated_at = NOW()`,
    [
      hex(doc._id), doc.shortid ?? null, doc.active, doc.created_at,
      hex(doc.event), hex(doc.type),
      doc.accepted ?? null, hex(doc.acquired_by), hex(doc.cancelled_by),
      doc.cancelled_at ?? null, doc.acquired_by_email ?? null,
      doc.assigned_email ?? null, hex(doc.assigned_to), hex(doc.invited_by),
      hex(doc.payment_id), doc.metadata ? JSON.stringify(doc.metadata) : null,
      doc.upgrade_history ? JSON.stringify(doc.upgrade_history) : null,
    ],
  );
}

// ---------------------------------------------------------------------------
// events.payments
// ---------------------------------------------------------------------------
export async function syncPaymentToPg(doc: {
  _id: { toHexString(): string } | string;
  stamps: Record<string, Date>;
  amount: string;
  fee?: string | null;
  currency: string;
  state: string;
  user?: { toHexString(): string } | string | null;
  buyer_info?: { email?: string; name?: string } | null;
  account: { toHexString(): string } | string;
  ref_type: string;
  ref_data?: {
    event?: { toHexString(): string } | string | null;
    ticket_types?: ({ toHexString(): string } | string)[];
    ticket_counts?: number[];
  } | null;
  billing_info?: {
    email?: string; firstname?: string; lastname?: string;
    [k: string]: unknown;
  } | null;
  transfer_metadata?: Record<string, unknown> | null;
  transfer_params?: Record<string, unknown> | null;
  failure_reason?: string | null;
  attempting_refund?: boolean | null;
}): Promise<void> {
  const hex = (v: unknown) =>
    v && typeof v === 'object' && 'toHexString' in v
      ? (v as { toHexString(): string }).toHexString()
      : (v as string | null) ?? null;

  const hexArr = (arr?: unknown[]) =>
    arr?.map((v) => hex(v)) ?? null;

  // [FIX-2] Derive created_at from ObjectId timestamp (always accurate).
  // ObjectIds encode their creation timestamp in the first 4 bytes.
  // NEVER fall back to new Date() -- that captures current time, not original creation.
  const idStr = typeof doc._id === 'string' ? doc._id : doc._id.toHexString();
  const createdAt = new Date(parseInt(idStr.substring(0, 8), 16) * 1000);

  // Flatten billing_info: extract known fields, remainder as JSONB
  const { email: bEmail, firstname: bFirst, lastname: bLast, ...billingRest } =
    doc.billing_info ?? {};

  await db.none(
    `INSERT INTO events.payments (
      mongo_id, stamps, amount, fee, currency, state, user_id,
      buyer_email, buyer_name, account_id, ref_type, ref_event_id,
      ref_ticket_type_ids, ref_ticket_counts,
      billing_email, billing_firstname, billing_lastname, billing_address,
      transfer_metadata, transfer_params, failure_reason, attempting_refund,
      created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW()
    )
    ON CONFLICT (mongo_id) DO UPDATE SET
      stamps = EXCLUDED.stamps,
      amount = EXCLUDED.amount,
      fee = EXCLUDED.fee,
      state = EXCLUDED.state,
      user_id = EXCLUDED.user_id,
      buyer_email = EXCLUDED.buyer_email,
      buyer_name = EXCLUDED.buyer_name,
      transfer_metadata = EXCLUDED.transfer_metadata,
      transfer_params = EXCLUDED.transfer_params,
      failure_reason = EXCLUDED.failure_reason,
      attempting_refund = EXCLUDED.attempting_refund,
      updated_at = NOW()`,
    [
      hex(doc._id), JSON.stringify(doc.stamps), doc.amount,
      doc.fee ?? null, doc.currency, doc.state, hex(doc.user),
      doc.buyer_info?.email ?? null, doc.buyer_info?.name ?? null,
      hex(doc.account), doc.ref_type,
      hex(doc.ref_data?.event),
      hexArr(doc.ref_data?.ticket_types),
      doc.ref_data?.ticket_counts ?? null,
      bEmail ?? null, bFirst ?? null, bLast ?? null,
      Object.keys(billingRest).length > 0 ? JSON.stringify(billingRest) : null,
      doc.transfer_metadata ? JSON.stringify(doc.transfer_metadata) : null,
      doc.transfer_params ? JSON.stringify(doc.transfer_params) : null,
      doc.failure_reason ?? null, doc.attempting_refund ?? null,
      createdAt,
    ],
  );
}

// ---------------------------------------------------------------------------
// events.check_ins
// ---------------------------------------------------------------------------
export async function syncCheckinToPg(doc: {
  _id: { toHexString(): string } | string;
  active: boolean;
  created_at: Date;
  created_by: { toHexString(): string } | string;
  event: { toHexString(): string } | string;
  user?: { toHexString(): string } | string | null;
  email?: string | null;
  ticket: { toHexString(): string } | string;
  updated_at?: Date | null;
  updated_by?: { toHexString(): string } | string | null;
}): Promise<void> {
  const hex = (v: unknown) =>
    v && typeof v === 'object' && 'toHexString' in v
      ? (v as { toHexString(): string }).toHexString()
      : (v as string | null) ?? null;

  await db.none(
    `INSERT INTO events.check_ins (
      mongo_id, active, created_at, created_by, event_id, user_id,
      email, ticket_id, updated_at, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (mongo_id) DO UPDATE SET
      active = EXCLUDED.active,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by`,
    [
      hex(doc._id), doc.active, doc.created_at, hex(doc.created_by),
      hex(doc.event), hex(doc.user), doc.email ?? null,
      hex(doc.ticket), doc.updated_at ?? null, hex(doc.updated_by),
    ],
  );
}

// ---------------------------------------------------------------------------
// events.guest_lists
// ---------------------------------------------------------------------------
export async function syncGuestListToPg(doc: {
  _id: { toHexString(): string } | string;
  created_at: Date;
  event: { toHexString(): string } | string;
  user?: { toHexString(): string } | string | null;
  email?: string | null;
  state: string;
  decided_at?: Date | null;
  decided_by?: { toHexString(): string } | string | null;
  metadata?: Record<string, unknown> | null;
  requested_tickets?: unknown[] | null;
  payment_id?: { toHexString(): string } | string | null;
  ticket_issued?: boolean | null;
}): Promise<void> {
  const hex = (v: unknown) =>
    v && typeof v === 'object' && 'toHexString' in v
      ? (v as { toHexString(): string }).toHexString()
      : (v as string | null) ?? null;

  await db.none(
    `INSERT INTO events.guest_lists (
      mongo_id, created_at, event_id, user_id, email, state,
      decided_at, decided_by, metadata, requested_tickets,
      payment_id, ticket_issued, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    ON CONFLICT (mongo_id) DO UPDATE SET
      state = EXCLUDED.state,
      decided_at = EXCLUDED.decided_at,
      decided_by = EXCLUDED.decided_by,
      metadata = EXCLUDED.metadata,
      requested_tickets = EXCLUDED.requested_tickets,
      payment_id = EXCLUDED.payment_id,
      ticket_issued = EXCLUDED.ticket_issued,
      updated_at = NOW()`,
    [
      hex(doc._id), doc.created_at, hex(doc.event), hex(doc.user),
      doc.email ?? null, doc.state, doc.decided_at ?? null,
      hex(doc.decided_by),
      doc.metadata ? JSON.stringify(doc.metadata) : null,
      doc.requested_tickets ? JSON.stringify(doc.requested_tickets) : null,
      hex(doc.payment_id), doc.ticket_issued ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// spaces.subscribers
// ---------------------------------------------------------------------------
export async function syncSubscriberToPg(doc: {
  _id: { toHexString(): string } | string;
  user?: { toHexString(): string } | string | null;
  user_name?: string | null;
  email?: string | null;
  space: { toHexString(): string } | string;
  role: string;
  state: string;
  visible?: boolean | null;
  decided_by?: { toHexString(): string } | string | null;
  role_changed_at?: Date | null;
  deleted_at?: Date | null;
}): Promise<void> {
  const hex = (v: unknown) =>
    v && typeof v === 'object' && 'toHexString' in v
      ? (v as { toHexString(): string }).toHexString()
      : (v as string | null) ?? null;

  // [FIX-1] SpaceMember has NO created_at field in Mongoose.
  // Derive from ObjectId timestamp (first 4 bytes encode creation time).
  const idStr = typeof doc._id === 'string' ? doc._id : doc._id.toHexString();
  const createdAt = new Date(parseInt(idStr.substring(0, 8), 16) * 1000);

  await db.none(
    `INSERT INTO spaces.subscribers (
      mongo_id, user_id, user_name, email, space_id, role, state,
      visible, decided_by, role_changed_at, deleted_at, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    ON CONFLICT (mongo_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      user_name = EXCLUDED.user_name,
      email = EXCLUDED.email,
      role = EXCLUDED.role,
      state = EXCLUDED.state,
      visible = EXCLUDED.visible,
      decided_by = EXCLUDED.decided_by,
      role_changed_at = EXCLUDED.role_changed_at,
      deleted_at = EXCLUDED.deleted_at,
      updated_at = NOW()`,
    [
      hex(doc._id), hex(doc.user), doc.user_name ?? null,
      doc.email ?? null, hex(doc.space), doc.role, doc.state,
      doc.visible ?? null, hex(doc.decided_by),
      doc.role_changed_at ?? null, doc.deleted_at ?? null,
      createdAt,
    ],
  );
}

// ---------------------------------------------------------------------------
// Fire-and-forget wrappers (guarded by feature flag)
// ---------------------------------------------------------------------------
function fireAndForget(table: string, fn: () => Promise<void>): void {
  if (!pgDualWriteEnabled) return;
  const end = syncDuration.startTimer({ table });
  fn()
    .then(() => {
      syncTotal.inc({ table, status: 'success' });
      end();
    })
    .catch((err) => {
      syncTotal.inc({ table, status: 'error' });
      end();
      logger.error({ err, table }, 'pg dual-write failed');
    });
}

export function pgSyncTicketAfterWrite(doc: Parameters<typeof syncTicketToPg>[0]): void {
  fireAndForget('events.tickets', () => syncTicketToPg(doc));
}

export function pgSyncPaymentAfterWrite(doc: Parameters<typeof syncPaymentToPg>[0]): void {
  fireAndForget('events.payments', () => syncPaymentToPg(doc));
}

export function pgSyncCheckinAfterWrite(doc: Parameters<typeof syncCheckinToPg>[0]): void {
  fireAndForget('events.check_ins', () => syncCheckinToPg(doc));
}

export function pgSyncGuestListAfterWrite(doc: Parameters<typeof syncGuestListToPg>[0]): void {
  fireAndForget('events.guest_lists', () => syncGuestListToPg(doc));
}

export function pgSyncSubscriberAfterWrite(doc: Parameters<typeof syncSubscriberToPg>[0]): void {
  fireAndForget('spaces.subscribers', () => syncSubscriberToPg(doc));
}

export function pgSyncTicketsAfterBulkWrite(docs: Parameters<typeof syncTicketToPg>[0][]): void {
  if (!pgDualWriteEnabled) return;
  const end = syncDuration.startTimer({ table: 'events.tickets' });
  Promise.all(docs.map((d) => syncTicketToPg(d)))
    .then(() => {
      syncTotal.inc({ table: 'events.tickets', status: 'success' }, docs.length);
      end();
    })
    .catch((err) => {
      syncTotal.inc({ table: 'events.tickets', status: 'error' });
      end();
      logger.error({ err }, 'pg bulk ticket dual-write failed');
    });
}
```

### Dual-write failure recovery [FIX-4]

Fire-and-forget means a failed PostgreSQL write is logged but not retried inline. To prevent silent data loss, the reconciliation job (Section 9) MUST do more than report count mismatches -- it must also **repair** them by re-syncing missing records from MongoDB to PostgreSQL. See `repairMissing()` in Section 9.

The recovery chain:
1. Dual-write fails -> error logged, Prometheus counter incremented
2. Reconciliation job runs every 15 minutes -> detects missing records
3. `repairMissing()` queries MongoDB for records not in PostgreSQL -> inserts them
4. Maximum recovery latency: 15 minutes (reconciliation interval)

This is acceptable for Phase B.1/B.2 where MongoDB is still primary and no reads come from PostgreSQL until consistency is verified.

### Where to add dual-write calls

Each write path in existing services gets a fire-and-forget call after the MongoDB write succeeds:

| Model | File | Write Operation | Add Call |
|---|---|---|---|
| Ticket | `src/app/services/ticket.ts` | `createTickets()` | `pgSyncTicketsAfterBulkWrite(createdTickets)` after `TicketModel.create()` |
| Ticket | `src/app/services/ticket.ts` | `assignTicketsToUsers()` | `pgSyncTicketsAfterBulkWrite(updatedTickets)` after `bulkWrite()` |
| Ticket | `src/app/services/ticket.ts` | `updateOne()/updateMany()` calls | `pgSyncTicketAfterWrite(updated)` after each |
| Ticket | `src/graphql/resolvers/ticket.ts` | `cancelTickets()`, `upgradeTicket()` | `pgSyncTicketAfterWrite()` after mutation |
| NewPayment | `src/app/services/new-payment/index.ts` | `createPayment()` | `pgSyncPaymentAfterWrite(payment)` |
| NewPayment | `src/app/services/new-payment/abstract.ts` | State transitions (`updateOne`) | `pgSyncPaymentAfterWrite(updated)` |
| NewPayment | `src/app/services/new-payment/services/*/index.ts` | Integration-specific state changes | `pgSyncPaymentAfterWrite()` |
| EventCheckin | `src/graphql/resolvers/event-checkin.ts` | `createEventCheckin()`, `updateEventCheckin()` | `pgSyncCheckinAfterWrite(checkin)` |
| EventJoinRequest | `src/app/services/event-join-request.ts` | `create()`, `updateOne()` | `pgSyncGuestListAfterWrite(request)` |
| EventJoinRequest | `src/graphql/resolvers/event-join-request.ts` | `decideUserJoinRequests()` | `pgSyncGuestListAfterWrite()` |
| SpaceMember | `src/app/services/space.ts` | `create()`, `updateOne()`, `bulkWrite()` | `pgSyncSubscriberAfterWrite(member)` |
| SpaceMember | `src/graphql/resolvers/space-member.ts` | mutations | `pgSyncSubscriberAfterWrite()` |

---

## 6. Service Rewrites -- Phase B.2 (Read from PostgreSQL)

For each service file that reads from a migrated model, this section shows the current Mongoose query and its pg-promise equivalent. Grouped by model, sorted simplest to hardest.

### Pattern: Feature-flagged read with fallback

Follow the existing pattern from `src/app/services/read-model-read.ts`:

```typescript
import { pgReadEnabled } from '../../config';

async function getTicketsByEvent(eventId: string): Promise<Ticket[]> {
  if (pgReadEnabled) {
    try {
      return await db.any(
        `SELECT * FROM events.tickets WHERE event_id = $1 AND active = true ORDER BY created_at`,
        [eventId],
      );
    } catch (err) {
      logger.error({ err, eventId }, 'PG ticket read failed, falling back to MongoDB');
      pgFallbackTotal.inc({ resolver: 'getTicketsByEvent' });
    }
  }
  // MongoDB fallback
  return TicketModel.find({ event: eventId, active: true }).sort({ created_at: 1 }).lean();
}
```

### 6.1 SpaceMember / subscribers (5 files -- simplest)

**Minimal rewrite.** `read-model-sync.ts` already syncs to `public.space_subscribers`. Main change: point reads to `spaces.subscribers` instead. Then deprecate `public.space_subscribers`.

**`src/app/services/space.ts`**

```typescript
// BEFORE: Get subscribers by space
const members = await SpaceMemberModel.find({
  space: spaceId,
  role: { $in: ['subscriber', 'ambassador'] },
  state: 'joined',
}).lean();

// AFTER
const members = await db.any(
  `SELECT * FROM spaces.subscribers
   WHERE space_id = $1 AND role = ANY($2) AND state = 'joined'`,
  [spaceId.toHexString(), ['subscriber', 'ambassador']],
);
```

```typescript
// BEFORE: Count by role
const count = await SpaceMemberModel.countDocuments({ space: spaceId, role, state: 'joined' });

// AFTER
const { count } = await db.one<{ count: number }>(
  `SELECT COUNT(*)::INT AS count FROM spaces.subscribers
   WHERE space_id = $1 AND role = $2 AND state = 'joined'`,
  [spaceId.toHexString(), role],
);
```

```typescript
// BEFORE: Find user membership
const member = await SpaceMemberModel.findOne({ space: spaceId, user: userId }).lean();

// AFTER
const member = await db.oneOrNone(
  `SELECT * FROM spaces.subscribers WHERE space_id = $1 AND user_id = $2`,
  [spaceId.toHexString(), userId.toHexString()],
);
```

```typescript
// BEFORE: Unique compound check (upsert pattern)
await SpaceMemberModel.findOneAndUpdate(
  { space: spaceId, user: userId, role },
  { $setOnInsert: { state: 'joined', created_at: new Date() } },
  { upsert: true, new: true },
);

// AFTER (Phase B.3 -- PG primary)
const member = await db.one(
  `INSERT INTO spaces.subscribers (mongo_id, space_id, user_id, role, state, created_at)
   VALUES ($1, $2, $3, $4, 'joined', NOW())
   ON CONFLICT (space_id, user_id, role) WHERE user_id IS NOT NULL
   DO NOTHING
   RETURNING *`,
  [new Types.ObjectId().toHexString(), spaceId.toHexString(), userId.toHexString(), role],
);
```

**Files to modify (SpaceMember reads):**
- `src/app/services/space.ts` -- member lookups, role checks, subscriber lists
- `src/app/services/access-control/space.ts` -- role-based permission checks
- `src/graphql/resolvers/space-member.ts` -- `listSpaceMembers()`, `countDocuments()`
- `src/graphql/resolvers/space-insight.ts` -- member statistics via `readSpaceStatisticsFromPg()` (already PG)
- `src/app/controllers/api/v1/subscribers.ts` -- API v1 list endpoint

### 6.2 EventCheckin / check_ins (10 files)

**`src/graphql/resolvers/event-checkin.ts`** -- CORE resolver

```typescript
// BEFORE: Get checkins with ticket+user population
const checkins = await EventCheckinModel.aggregate([
  { $match: { event: eventObjectId } },
  { $lookup: { from: 'tickets', localField: 'ticket', foreignField: '_id', as: 'ticket_doc' } },
  { $unwind: '$ticket_doc' },
  { $lookup: { from: 'users', localField: 'ticket_doc.assigned_to', foreignField: '_id', as: 'user_doc' } },
  { $sort: { created_at: -1 } },
  { $skip: offset },
  { $limit: limit },
]);

// AFTER: SQL JOIN (ticket stays in events.tickets)
const checkins = await db.any(
  `SELECT ci.*, t.mongo_id AS ticket_mongo_id, t.assigned_to, t.assigned_email, t.shortid
   FROM events.check_ins ci
   JOIN events.tickets t ON ci.ticket_id = t.mongo_id
   WHERE ci.event_id = $1
   ORDER BY ci.created_at DESC
   OFFSET $2 LIMIT $3`,
  [eventId, offset, limit],
);
```

```typescript
// BEFORE: Create checkin
const checkin = new EventCheckinModel({
  active: true,
  created_at: new Date(),
  created_by: userId,
  event: eventId,
  ticket: ticketId,
  user: ticketUser,
  email: ticketEmail,
});
await checkin.save({ session });

// AFTER (Phase B.3 -- PG primary)
const checkin = await db.one(
  `INSERT INTO events.check_ins (
    mongo_id, active, created_at, created_by, event_id, user_id, email, ticket_id
  ) VALUES ($1, true, NOW(), $2, $3, $4, $5, $6)
  RETURNING *`,
  [new Types.ObjectId().toHexString(), userId, eventId, ticketUser, ticketEmail, ticketId],
);
```

```typescript
// BEFORE: Toggle checkin active state
await EventCheckinModel.updateOne(
  { _id: checkinId },
  { active: !currentActive, updated_at: new Date(), updated_by: userId },
);

// AFTER
await db.none(
  `UPDATE events.check_ins SET active = NOT active, updated_at = NOW(), updated_by = $1
   WHERE mongo_id = $2`,
  [userId, checkinId],
);
```

**`src/graphql/resolvers/event-insight.ts`** -- checkin chart data

```typescript
// BEFORE: Time-series aggregation
const items = await EventCheckinModel.find({
  event: eventId,
  active: true,
  created_at: { $gte: start, $lte: end },
}).select('created_at').lean();

// AFTER
const items = await db.any(
  `SELECT created_at FROM events.check_ins
   WHERE event_id = $1 AND active = true AND created_at BETWEEN $2 AND $3
   ORDER BY created_at`,
  [eventId, start, end],
);
```

**`src/app/services/event-guest.ts`** -- checkin counting

```typescript
// BEFORE
const checkinCount = await EventCheckinModel.countDocuments({ event: eventId, active: true });

// AFTER
const { count } = await db.one<{ count: number }>(
  `SELECT COUNT(*)::INT AS count FROM events.check_ins WHERE event_id = $1 AND active = true`,
  [eventId],
);
```

**Files to modify (EventCheckin reads):**
- `src/graphql/resolvers/event-checkin.ts` -- checkin CRUD, aggregate with $lookup
- `src/graphql/resolvers/event-insight.ts` -- getEventCheckinChartData
- `src/graphql/resolvers/event-guest.ts` -- checkin status in guest lists
- `src/graphql/resolvers/ticket-exporter.ts` -- checkin data for export
- `src/graphql/resolvers/ai-tool.ts` -- AI checkin queries
- `src/app/services/event-guest.ts` -- checkin counting
- `src/app/services/event-checkin-exporter.ts` -- export pipeline
- `src/app/services/read-model-sync.ts` -- upsertEventGuest references checkin
- `src/app/controllers/forest/event/export/event-checkin.ts` -- admin export
- `src/app/jobs/user-delete.ts` -- cascade delete

### 6.3 Event insights (materialized view)

**`src/graphql/resolvers/event-insight.ts`** -- ticket sold chart, currently uses TicketModel.find

```typescript
// BEFORE: getEventTicketSoldChartData
const items = await TicketModel.find({
  event: eventId,
  active: true,
  created_at: { $gte: start, $lte: end },
  ...(types ? { type: { $in: types } } : {}),
}).select('created_at type').lean();

// AFTER: Direct query on events.tickets
const items = await db.any(
  `SELECT created_at, type_id AS type
   FROM events.tickets
   WHERE event_id = $1 AND active = true
     AND created_at BETWEEN $2 AND $3
     ${types ? 'AND type_id = ANY($4)' : ''}
   ORDER BY created_at`,
  types ? [eventId, start, end, types] : [eventId, start, end],
);
```

For summary statistics, query the materialized view:

```typescript
// BEFORE: Multiple countDocuments + aggregate calls
const totalTickets = await TicketModel.countDocuments({ event: eventId, active: true });
const paidTickets = await TicketModel.countDocuments({ event: eventId, active: true, payment_id: { $exists: true } });
const checkins = await EventCheckinModel.countDocuments({ event: eventId, active: true });

// AFTER: Single materialized view query
const insight = await db.oneOrNone(
  `SELECT * FROM events.event_insights WHERE event_id = $1`,
  [eventId],
);
// Returns: { total_tickets, paid_tickets, free_tickets, total_checkins, total_revenue, ... }
```

### 6.4 EventJoinRequest / guest_lists (23 files)

**`src/app/services/event-join-request.ts`** -- CORE service

```typescript
// BEFORE: Get join requests with payment lookup
const requests = await EventJoinRequestModel.aggregate([
  { $match: { event: eventObjectId, state: 'approved' } },
  { $lookup: { from: 'new_payments', localField: 'payment_id', foreignField: '_id', as: 'payment' } },
  { $unwind: { path: '$payment', preserveNullAndEmptyArrays: true } },
  { $sort: { created_at: -1 } },
  { $skip: offset },
  { $limit: limit },
]);

// AFTER: SQL LEFT JOIN [FIX-7: preserveNullAndEmptyArrays: true -> LEFT JOIN]
const requests = await db.any(
  `SELECT gl.*, p.state AS payment_state, p.amount AS payment_amount, p.currency AS payment_currency
   FROM events.guest_lists gl
   LEFT JOIN events.payments p ON gl.payment_id = p.mongo_id
   WHERE gl.event_id = $1 AND gl.state = 'approved'
   ORDER BY gl.created_at DESC
   OFFSET $2 LIMIT $3`,
  [eventId, offset, limit],
);
```

```typescript
// BEFORE: Count by state
const counts = await EventJoinRequestModel.aggregate([
  { $match: { event: eventObjectId } },
  { $group: { _id: '$state', count: { $sum: 1 } } },
]);

// AFTER
const counts = await db.any<{ state: string; count: number }>(
  `SELECT state, COUNT(*)::INT AS count FROM events.guest_lists
   WHERE event_id = $1 GROUP BY state`,
  [eventId],
);
```

```typescript
// BEFORE: Get user's join request
const request = await EventJoinRequestModel.findOne({ event: eventId, user: userId }).lean();

// AFTER
const request = await db.oneOrNone(
  `SELECT * FROM events.guest_lists WHERE event_id = $1 AND user_id = $2`,
  [eventId, userId],
);
```

```typescript
// BEFORE: Export pipeline with nested lookups
const pipeline = getExportPipeline(eventId);
const cursor = EventJoinRequestModel.aggregate(pipeline).cursor({ batchSize: 1000 });
await cursor.eachAsync(async (doc) => { /* stream to CSV */ });

// AFTER: SQL query with JOINs, streamed via pg-promise QueryStream
const qs = new pgp.pg.QueryStream(
  `SELECT gl.*, p.amount, p.currency, p.state AS payment_state
   FROM events.guest_lists gl
   LEFT JOIN events.payments p ON gl.payment_id = p.mongo_id
   WHERE gl.event_id = $1
   ORDER BY gl.created_at`,
  [eventId],
);
const stream = await db.stream(qs, (s) => {
  s.on('data', (row) => { /* stream to CSV */ });
});
```

**Files to modify (EventJoinRequest reads):**
- `src/app/services/event-join-request.ts` -- core queries, aggregation pipelines
- `src/app/services/event-guest.ts` -- join request in guest context
- `src/app/services/event-application-exporter.ts` -- export pipelines
- `src/app/services/new-payment/abstract.ts` -- join request state checks
- `src/app/services/new-payment/services/escrow/index.ts` -- escrow join request lookups
- `src/graphql/resolvers/event-join-request.ts` -- CRUD queries
- `src/graphql/resolvers/event-guest.ts` -- guest list aggregation
- `src/graphql/resolvers/event.ts` -- join request in event context
- `src/graphql/resolvers/ticket.ts` -- join request state checks
- `src/graphql/resolvers/event-invitation.ts` -- invitation join request refs
- `src/graphql/resolvers/ticket-exporter.ts` -- export aggregation
- `src/graphql/resolvers/event-application.ts` -- application export
- `src/graphql/resolvers/ai-tool.ts` -- AI join request queries
- `src/app/controllers/event/export/join-requests.ts` -- CSV export with cursor
- `src/app/controllers/event/export/guests.ts` -- guest export
- `src/app/jobs/event-join-request-created.ts` -- notification job (findById)
- `src/app/jobs/user-delete.ts` -- cascade delete

### 6.5 NewPayment / payments (22 files)

**`src/app/services/new-payment/index.ts`** -- CORE service

```typescript
// BEFORE: Get payment with account population
const payment = await NewPaymentModel.findOne({ _id: paymentId }).populate('account').lean();

// AFTER: JOIN with payment_accounts (stays MongoDB for account details)
// Phase B.2: Read payment from PG, but account stays MongoDB
const pgPayment = await db.oneOrNone(
  `SELECT * FROM events.payments WHERE mongo_id = $1`,
  [paymentId],
);
// Account must still be fetched from MongoDB:
const account = await NewPaymentAccountModel.findById(pgPayment.account_id).lean();
```

```typescript
// BEFORE: Find payments by event
const payments = await NewPaymentModel.find({
  'ref_data.event': eventId,
  state: 'succeeded',
}).lean();

// AFTER
const payments = await db.any(
  `SELECT * FROM events.payments WHERE ref_event_id = $1 AND state = 'succeeded'`,
  [eventId],
);
```

```typescript
// BEFORE: Payment state transition
await NewPaymentModel.updateOne(
  { _id: paymentId },
  {
    state: 'succeeded',
    'stamps.succeeded': new Date(),
    transfer_metadata: { ...existing, tx_hash: txHash },
  },
);

// AFTER (Phase B.3 -- PG primary)
await db.none(
  `UPDATE events.payments SET
     state = 'succeeded',
     stamps = COALESCE(stamps, '{}'::jsonb) || $1::jsonb,  -- [FIX-6] NULL-safe JSONB merge
     transfer_metadata = $2::jsonb,
     updated_at = NOW()
   WHERE mongo_id = $3`,
  [JSON.stringify({ succeeded: new Date() }), JSON.stringify(transferMetadata), paymentId],
);
```

**`src/graphql/resolvers/event-payment-summary.ts`** -- payment analytics

```typescript
// BEFORE: Aggregate payments by event
const summary = await NewPaymentModel.aggregate([
  { $match: { 'ref_data.event': eventObjectId, state: 'succeeded' } },
  { $group: { _id: '$currency', total: { $sum: { $toLong: '$amount' } }, count: { $sum: 1 } } },
]);

// AFTER: Native SQL SUM on NUMERIC
const summary = await db.any(
  `SELECT currency, SUM(amount)::TEXT AS total, COUNT(*)::INT AS count
   FROM events.payments
   WHERE ref_event_id = $1 AND state = 'succeeded'
   GROUP BY currency`,
  [eventId],
);
```

**`src/graphql/resolvers/new-payment.ts`** -- user payment queries

```typescript
// BEFORE: getMyPayments with $lookup
const payments = await NewPaymentModel.aggregate([
  { $match: { user: userObjectId } },
  { $lookup: { from: 'new_payment_accounts', localField: 'account', foreignField: '_id', as: 'account_doc' } },
  { $unwind: '$account_doc' },
  { $sort: { 'stamps.created': -1 } },
  { $skip: offset },
  { $limit: limit },
]);

// AFTER: Payment from PG, account from MongoDB
const payments = await db.any(
  `SELECT * FROM events.payments WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT $3`,
  [userId, offset, limit],
);
// Batch-fetch accounts from MongoDB:
const accountIds = [...new Set(payments.map((p) => p.account_id))];
const accounts = await NewPaymentAccountModel.find({ _id: { $in: accountIds } }).lean();
const accountMap = new Map(accounts.map((a) => [a._id.toHexString(), a]));
// Attach accounts to payments
```

**Files to modify (NewPayment reads):**
- `src/app/services/new-payment/index.ts` -- payment lookups, state checks
- `src/app/services/new-payment/common.ts` -- `getPopulatedPayment()` (populate account)
- `src/app/services/event-payment.ts` -- event payment accounting
- `src/app/services/payment-exporter.ts` -- export pipeline
- `src/app/services/atlas/payment-verify.ts` -- payment verification
- `src/app/services/atlas/solana-payment-verifier.ts` -- Solana verification
- `src/app/services/atlas/purchase.ts` -- purchase flow
- `src/graphql/resolvers/new-payment.ts` -- user payments, payment detail
- `src/graphql/resolvers/event-payment.ts` -- event payment queries
- `src/graphql/resolvers/event-payment-summary.ts` -- payment analytics
- `src/graphql/resolvers/event-staking.ts` -- staking payments
- `src/graphql/resolvers/ticket.ts` -- payment in ticket context
- `src/graphql/resolvers/ai-tool.ts` -- AI payment queries
- `src/graphql-admin/resolvers/admin-payment.ts` -- admin operations
- `src/app/controllers/forest/new-payment/export.ts` -- admin export
- `src/app/controllers/forest/new-payment/verify.ts` -- admin verification
- `src/app/jobs/atlas-fee-reconciliation.ts` -- fee reconciliation
- `src/app/jobs/ticket-crypto-receipt.ts` -- crypto receipt
- `src/app/jobs/event-ticket-mail.ts` -- ticket mail

### 6.6 Ticket / tickets (40 files -- most complex)

**`src/app/services/ticket.ts`** (757 lines) -- CORE service

```typescript
// BEFORE: createTickets with session
const tickets = await TicketModel.create(
  Array(count).fill(null).map(() => ({
    active: true,
    event: eventId,
    type: ticketTypeId,
    acquired_by: userId,
    acquired_by_email: email,
    payment_id: paymentId,
    metadata: { source: 'payment', buyer_name: name },
  })),
  { session },
);

// AFTER (Phase B.3 -- PG primary)
const ticketRows = Array(count).fill(null).map(() => ({
  mongo_id: new Types.ObjectId().toHexString(),
  shortid: nanoid(16),
  active: true,
  event_id: eventId,
  type_id: ticketTypeId,
  acquired_by: userId,
  acquired_by_email: email,
  payment_id: paymentId,
  metadata: JSON.stringify({ source: 'payment', buyer_name: name }),
}));
const cs = new pgp.helpers.ColumnSet(
  ['mongo_id', 'shortid', 'active', 'event_id', 'type_id', 'acquired_by',
   'acquired_by_email', 'payment_id', 'metadata'],
  { table: { table: 'tickets', schema: 'events' } },
);
await t.none(pgp.helpers.insert(ticketRows, cs) + ' RETURNING *');
```

```typescript
// BEFORE: syncTicketCounters -- aggregate by type with count
const counters = await TicketModel.aggregate([
  { $match: { event: eventObjectId, active: true } },
  { $group: { _id: '$type', count: { $sum: 1 } } },
]);

// AFTER
const counters = await db.any<{ type_id: string; count: number }>(
  `SELECT type_id, COUNT(*)::INT AS count FROM events.tickets
   WHERE event_id = $1 AND active = true GROUP BY type_id`,
  [eventId],
);
```

```typescript
// BEFORE: assignTicketsToUsers -- bulkWrite with updateOne operations
const ops: AnyBulkWriteOperation<Ticket>[] = assignments.map(({ ticketId, userId, email }) => ({
  updateOne: {
    filter: { _id: ticketId },
    update: { $set: { assigned_to: userId, assigned_email: email, accepted: true } },
  },
}));
await TicketModel.bulkWrite(ops, { session });

// AFTER: Batch UPDATE using CASE or individual updates in transaction
await db.tx(async (t) => {
  for (const { ticketId, userId, email } of assignments) {
    await t.none(
      `UPDATE events.tickets SET
         assigned_to = $1, assigned_email = $2, accepted = true, updated_at = NOW()
       WHERE mongo_id = $3`,
      [userId, email, ticketId],
    );
  }
});
```

```typescript
// BEFORE: Text search on ticket metadata
const tickets = await TicketModel.find({
  event: eventId,
  active: true,
  $text: { $search: searchQuery },
}).lean();

// AFTER: pg_trgm ILIKE search [FIX-8: known behavior difference]
// ILIKE does NOT support phrase search like MongoDB $text does.
// "John Smith" matches as substring, not as exact phrase.
// If exact phrase search is needed later, use tsvector/tsquery full-text search.
const tickets = await db.any(
  `SELECT * FROM events.tickets
   WHERE event_id = $1 AND active = true
     AND (
       metadata->>'buyer_name' ILIKE $2
       OR assigned_email ILIKE $2
       OR acquired_by_email ILIKE $2
     )`,
  [eventId, `%${searchQuery}%`],
);
```

```typescript
// BEFORE: Complex aggregation with $lookup for event guest export
const pipeline = [
  { $match: { event: eventObjectId, active: true } },
  { $lookup: { from: 'new_payments', localField: 'payment_id', foreignField: '_id', as: 'payment' } },
  { $unwind: { path: '$payment', preserveNullAndEmptyArrays: true } },
  { $lookup: { from: 'users', localField: 'assigned_to', foreignField: '_id', as: 'user' } },
  { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
  { $lookup: { from: 'event_ticket_types', localField: 'type', foreignField: '_id', as: 'ticket_type' } },
  { $unwind: { path: '$ticket_type', preserveNullAndEmptyArrays: true } },
  { $sort: { created_at: -1 } },
];

// AFTER: SQL JOINs (ticket_type stays on MongoDB, must be fetched separately)
const tickets = await db.any(
  `SELECT t.*, p.amount, p.currency, p.state AS payment_state, p.buyer_email, p.buyer_name
   FROM events.tickets t
   LEFT JOIN events.payments p ON t.payment_id = p.mongo_id
   WHERE t.event_id = $1 AND t.active = true
   ORDER BY t.created_at DESC`,
  [eventId],
);
// EventTicketType stays on MongoDB -- batch fetch:
const typeIds = [...new Set(tickets.map((t) => t.type_id))];
const types = await EventTicketTypeModel.find({ _id: { $in: typeIds } }).lean();
const typeMap = new Map(types.map((tt) => [tt._id.toHexString(), tt]));
// User stays on MongoDB -- batch fetch if needed for assigned_to
```

**Files to modify (Ticket reads) -- phased rollout per PRD Section 3:**

**Phase B.2a: Analytics/insight reads (lowest risk):**
- `src/graphql/resolvers/event-insight.ts` -- getEventTicketSoldChartData, ticket counts
- `src/graphql/resolvers/space-insight.ts` -- getSpaceStatistics, getTopSpaceEventAttendees

**Phase B.2b: Export reads:**
- `src/app/services/ticket-detail-exporter.ts` -- ticket export pipeline
- `src/app/services/event-checkin-exporter.ts` -- checkin+ticket export
- `src/app/services/payment-exporter.ts` -- payment+ticket export
- `src/graphql/resolvers/ticket-exporter.ts` -- export resolver

**Phase B.2c: Core reads:**
- `src/app/services/ticket.ts` -- syncTicketCounters, getTickets, findOne
- `src/app/services/event-guest.ts` -- guest list with ticket data
- `src/app/services/event-payment.ts` -- payment+ticket queries
- `src/app/services/event.ts` -- ticket limit checks
- `src/app/services/pass.ts` -- pass generation
- `src/app/services/email/event-email.ts` -- email templates

**Phase B.2d: Resolver reads:**
- `src/graphql/resolvers/ticket.ts` -- getMyTickets, getTickets, buyTickets
- `src/graphql/resolvers/event.ts` -- ticket counts in event context
- `src/graphql/resolvers/event-guest.ts` -- guest list
- `src/graphql/resolvers/event-checkin.ts` -- ticket lookups in checkin
- `src/graphql/resolvers/event-join-request.ts` -- ticket state checks
- `src/graphql/resolvers/event-rsvp.ts` -- RSVP ticket operations
- `src/graphql/resolvers/token-reward.ts` -- token gating
- `src/graphql/resolvers/donation.ts` -- donation tickets
- `src/graphql/resolvers/email.ts` -- email templates
- `src/graphql/resolvers/event-eas.ts` -- attestation tickets
- `src/graphql/resolvers/ai-tool.ts` -- AI ticket queries
- `src/graphql-admin/resolvers/admin-ticket.ts` -- admin operations
- `src/graphql-admin/resolvers/admin-event.ts` -- admin event tickets
- `src/app/controllers/ticket/info.ts` -- ticket info
- `src/app/controllers/forest/ticket/rsvp.ts` -- admin RSVP
- `src/app/controllers/forest/event/export/accepted.ts` -- admin export
- `src/app/controllers/event/export/guests.ts` -- guest export
- `src/app/controllers/event/pass/common.ts` -- pass generation

---

## 7. GraphQL Resolver Updates

Summary of resolver changes per model. Each resolver query/mutation that directly queries a migrated model must switch from Mongoose to pg-promise.

### event-checkin.ts

| Query/Mutation | Current (Mongoose) | After (pg-promise) |
|---|---|---|
| `getEventCheckins` | `EventCheckinModel.aggregate([$match, $lookup tickets, $lookup users])` | `db.any('SELECT ci.*, t.* FROM events.check_ins ci JOIN events.tickets t ...')` + MongoDB user fetch |
| `createEventCheckin` | `new EventCheckinModel().save({ session })` | `db.one('INSERT INTO events.check_ins ... RETURNING *')` (Phase B.3) |
| `updateEventCheckin` | `EventCheckinModel.updateOne({ _id }, { active, updated_at, updated_by })` | `db.none('UPDATE events.check_ins SET active = $1 ...')` |

### event-insight.ts

| Query | Current | After |
|---|---|---|
| `getEventTicketSoldChartData` | `TicketModel.find({ event, active, created_at range })` | `db.any('SELECT ... FROM events.tickets WHERE ...')` |
| `getEventCheckinChartData` | `EventCheckinModel.find({ event, active, created_at range })` | `db.any('SELECT ... FROM events.check_ins WHERE ...')` |
| `getEventViewChartData` | `track.getEventViewTracks()` | No change (already PG) |

### event-join-request.ts

| Query/Mutation | Current | After |
|---|---|---|
| `getEventJoinRequests` | `EventJoinRequestModel.aggregate([$match, $lookup payments])` | `db.any('SELECT gl.*, p.* FROM events.guest_lists gl LEFT JOIN events.payments p ...')` |
| `getMyEventJoinRequest` | `EventJoinRequestModel.findOne({ event, user })` | `db.oneOrNone('SELECT * FROM events.guest_lists WHERE ...')` |
| `decideUserJoinRequests` | `EventJoinRequestModel.updateOne({ _id }, { state, decided_at, decided_by })` | `db.none('UPDATE events.guest_lists SET state = $1 ...')` (Phase B.3) |

### new-payment.ts

| Query/Mutation | Current | After |
|---|---|---|
| `getMyPayments` | `NewPaymentModel.aggregate([$match user, $lookup accounts, $sort, $skip, $limit])` | `db.any('SELECT * FROM events.payments WHERE user_id = $1 ...')` + MongoDB account fetch |
| `getNewPayment` | `NewPaymentModel.findOne({ _id }).populate('account')` | `db.oneOrNone('SELECT * FROM events.payments WHERE mongo_id = $1')` + MongoDB account |
| `cancelPayment` | `NewPaymentModel.updateOne({ _id }, { state, stamps })` | `db.none('UPDATE events.payments SET state = ...')` (Phase B.3) |

### ticket.ts

| Query/Mutation | Current | After |
|---|---|---|
| `getMyTickets` | `TicketModel.find({ assigned_to/acquired_by, active }).populate('type event')` | `db.any('SELECT * FROM events.tickets WHERE ...')` + MongoDB type/event fetch |
| `getTickets` | `TicketModel.aggregate([$match, $lookup, $text])` | `db.any('SELECT * FROM events.tickets WHERE ... ILIKE ...')` |
| `buyTickets` | `TicketModel.create([...], { session })` | `pgp.helpers.insert(rows, cs)` in `db.tx()` (Phase B.3) |
| `cancelTickets` | `TicketModel.updateMany({ _id: { $in } }, { active: false, cancelled_* })` | `db.none('UPDATE events.tickets SET active = false ... WHERE mongo_id = ANY($1)')` |
| `upgradeTicket` | `TicketModel.updateOne({ _id }, { type, $push: upgrade_history })` | [FIX-3] `db.none('UPDATE events.tickets SET type_id = $1, upgrade_history = COALESCE(upgrade_history, ''[]''::jsonb) \|\| $2::jsonb, updated_at = NOW() WHERE mongo_id = $3', [newTypeId, JSON.stringify([{updated_by, updated_at, from_type, to_type}]), ticketId])` |

### space-member.ts

| Query/Mutation | Current | After |
|---|---|---|
| `listSpaceMembers` | `SpaceMemberModel.find/aggregate({ space, role, state })` | `db.any('SELECT * FROM spaces.subscribers WHERE ...')` |
| `addSpaceMember` | `SpaceMemberModel.create/findOneAndUpdate` | `db.one('INSERT INTO spaces.subscribers ... ON CONFLICT ...')` (Phase B.3) |
| `updateSpaceMember` | `SpaceMemberModel.updateOne({ _id }, { role/state })` | `db.none('UPDATE spaces.subscribers SET ...')` |
| `deleteSpaceMember` | `SpaceMemberModel.deleteOne({ _id })` | `db.none('UPDATE spaces.subscribers SET deleted_at = NOW() WHERE ...')` |

### space-insight.ts

| Query | Current | After |
|---|---|---|
| `getSpaceStatistics` | `readSpaceStatisticsFromPg()` with MongoDB fallback | Already PG via read-model-read.ts -- point to spaces.subscribers instead of public.space_subscribers |
| `getSpaceMembersLeaderboard` | `SpaceMemberModel.aggregate([$match, $lookup users, $sort])` | `db.any('SELECT ss.* FROM spaces.subscribers ss WHERE ...')` + MongoDB user fetch |
| `getSpaceMemberAmountByDate` | `SpaceMemberModel.aggregate([$match role+date, $group by date])` | `db.any('SELECT DATE(role_changed_at) AS date, COUNT(*)::INT ... GROUP BY date')` |

---

## 8. Backfill Scripts

**New file:** `src/scripts/pg-backfill.ts`

General approach: cursor-paginated batch reads from MongoDB, upsert into PostgreSQL via the dual-write helpers from Section 5.

```typescript
import { db, pgp } from '../app/helpers/pg';
import { TicketModel } from '../app/models/ticket';
import { NewPaymentModel } from '../app/models/new-payment';
import { EventCheckinModel } from '../app/models/event-checkin';
import { EventJoinRequestModel } from '../app/models/event-join-request';
import { SpaceMemberModel } from '../app/models/space-member';
import {
  syncTicketToPg, syncPaymentToPg, syncCheckinToPg,
  syncGuestListToPg, syncSubscriberToPg,
} from '../app/services/pg-sync';
import { logger } from '../app/helpers/logger';

const BATCH_SIZE = 1000;

async function backfillTable(
  modelName: string,
  model: { find: Function },
  syncFn: (doc: any) => Promise<void>,
): Promise<void> {
  let lastId: string | null = null;
  let total = 0;

  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await model.find(query).sort({ _id: 1 }).limit(BATCH_SIZE).lean();
    if (docs.length === 0) break;

    for (const doc of docs) {
      try {
        await syncFn(doc);
      } catch (err) {
        logger.error({ err, modelName, docId: doc._id?.toString() }, 'backfill row failed');
      }
    }

    lastId = docs[docs.length - 1]._id.toString();
    total += docs.length;
    logger.info({ modelName, total, lastId }, 'backfill batch complete');
  }

  logger.info({ modelName, total }, 'backfill complete');
}

async function main(): Promise<void> {
  const table = process.argv[2];
  const tables: Record<string, () => Promise<void>> = {
    tickets: () => backfillTable('tickets', TicketModel, syncTicketToPg),
    payments: () => backfillTable('payments', NewPaymentModel, syncPaymentToPg),
    check_ins: () => backfillTable('check_ins', EventCheckinModel, syncCheckinToPg),
    guest_lists: () => backfillTable('guest_lists', EventJoinRequestModel, syncGuestListToPg),
    subscribers: () => backfillTable('subscribers', SpaceMemberModel, syncSubscriberToPg),
  };

  if (table && tables[table]) {
    await tables[table]();
  } else if (!table) {
    // Backfill all in order (simplest to largest)
    for (const [name, fn] of Object.entries(tables)) {
      logger.info({ table: name }, 'starting backfill');
      await fn();
    }
  } else {
    console.error(`Unknown table: ${table}. Options: ${Object.keys(tables).join(', ')}`);
    process.exit(1);
  }
}

main()
  .then(() => { logger.info('backfill complete'); process.exit(0); })
  .catch((err) => { logger.error({ err }, 'backfill failed'); process.exit(1); });
```

### Per-table specifics

| Table | Source Collection | Key Conversions | Expected Volume |
|---|---|---|---|
| events.tickets | tickets | ObjectId -> hex string, Date -> TIMESTAMPTZ, metadata subdoc -> JSONB | High |
| events.payments | new_payments | amount/fee string -> NUMERIC(78,0), nested buyer_info -> flat columns, nested ref_data -> flat columns, derive created_at from stamps | High |
| events.check_ins | event_checkins | ObjectId refs -> hex strings | High |
| events.guest_lists | event_join_requests | requested_tickets array -> JSONB, metadata -> JSONB | Medium |
| spaces.subscribers | space_members | ObjectId refs -> hex strings | Medium |

### Idempotency

All upserts use `ON CONFLICT (mongo_id) DO UPDATE` (or `DO NOTHING` where appropriate). Running a script multiple times produces the same result.

### Running

```bash
# Backfill all tables
yarn ts-node src/scripts/pg-backfill.ts

# Backfill specific table
yarn ts-node src/scripts/pg-backfill.ts tickets
yarn ts-node src/scripts/pg-backfill.ts payments
```

### Post-backfill: Refresh materialized views

```bash
yarn ts-node -e "
  const { db } = require('./src/app/helpers/pg');
  db.none('REFRESH MATERIALIZED VIEW CONCURRENTLY events.event_insights')
    .then(() => db.none('REFRESH MATERIALIZED VIEW CONCURRENTLY spaces.space_insights'))
    .then(() => { console.log('done'); process.exit(0); });
"
```

---

## 9. Data Consistency Checks

**New file:** `src/app/jobs/pg-reconciliation.ts`

Periodic job that compares MongoDB and PostgreSQL record counts. Follows the existing pattern from `read-model-sync.ts` reconciliation (`reconcile()` function).

```typescript
import { db } from '../helpers/pg';
import { TicketModel } from '../models/ticket';
import { NewPaymentModel } from '../models/new-payment';
import { EventCheckinModel } from '../models/event-checkin';
import { EventJoinRequestModel } from '../models/event-join-request';
import { SpaceMemberModel } from '../models/space-member';
import { Gauge } from 'prom-client';
import { logger } from '../helpers/logger';

const discrepancyGauge = new Gauge({
  name: 'pg_migration_reconcile_discrepancy',
  help: 'Count difference between MongoDB and PostgreSQL',
  labelNames: ['table'],
});

interface ReconcileResult {
  table: string;
  mongoCount: number;
  pgCount: number;
  discrepancy: number;
  percentDiff: number;
}

const tables = [
  { table: 'events.tickets', model: TicketModel },
  { table: 'events.payments', model: NewPaymentModel },
  { table: 'events.check_ins', model: EventCheckinModel },
  { table: 'events.guest_lists', model: EventJoinRequestModel },
  { table: 'spaces.subscribers', model: SpaceMemberModel },
];

export async function reconcileAll(): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];

  for (const { table, model } of tables) {
    const mongoCount = await model.countDocuments();
    const { count: pgCount } = await db.one<{ count: number }>(
      `SELECT COUNT(*)::INT AS count FROM ${table}`,
    );
    const discrepancy = Math.abs(mongoCount - pgCount);
    const percentDiff = mongoCount > 0 ? (discrepancy / mongoCount) * 100 : 0;

    discrepancyGauge.set({ table }, discrepancy);

    if (percentDiff > 1) {
      logger.warn({ table, mongoCount, pgCount, discrepancy, percentDiff }, 'reconciliation discrepancy > 1%');
    }

    results.push({ table, mongoCount, pgCount, discrepancy, percentDiff });
  }

  return results;
}
```

### Auto-repair for missing records [FIX-4, FIX-10]

The reconciliation job MUST not just report -- it must **repair** missing records. For each table, query MongoDB for records whose `_id` hex string is not present in PostgreSQL, then insert them using the dual-write sync functions.

```typescript
import {
  syncTicketToPg, syncPaymentToPg, syncCheckinToPg,
  syncGuestListToPg, syncSubscriberToPg,
} from './pg-sync';

const REPAIR_BATCH = 500;

async function repairMissing(
  table: string,
  model: { find: Function },
  pgTable: string,
  syncFn: (doc: any) => Promise<void>,
): Promise<number> {
  // Get all mongo_ids present in PG
  const pgIds = await db.any<{ mongo_id: string }>(
    `SELECT mongo_id FROM ${pgTable}`,
  );
  const pgIdSet = new Set(pgIds.map((r) => r.mongo_id));

  // Scan MongoDB in batches, find missing
  let lastId: string | null = null;
  let repaired = 0;

  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await model.find(query).sort({ _id: 1 }).limit(REPAIR_BATCH).lean();
    if (docs.length === 0) break;

    for (const doc of docs) {
      const mongoId = doc._id.toString();
      if (!pgIdSet.has(mongoId)) {
        try {
          await syncFn(doc);
          repaired++;
        } catch (err) {
          logger.error({ err, table, mongoId }, 'repair insert failed');
        }
      }
    }

    lastId = docs[docs.length - 1]._id.toString();
  }

  if (repaired > 0) {
    logger.warn({ table, repaired }, 'repaired missing records');
  }
  return repaired;
}

export async function reconcileAndRepair(): Promise<void> {
  const results = await reconcileAll();
  for (const r of results) {
    if (r.discrepancy > 0) {
      const tableConfig = tables.find((t) => t.table === r.table);
      if (!tableConfig) continue;
      const syncFn = {
        'events.tickets': syncTicketToPg,
        'events.payments': syncPaymentToPg,
        'events.check_ins': syncCheckinToPg,
        'events.guest_lists': syncGuestListToPg,
        'spaces.subscribers': syncSubscriberToPg,
      }[r.table];
      if (syncFn) {
        await repairMissing(r.table, tableConfig.model, r.table, syncFn);
      }
    }
  }
}
```

Register as Agenda job, run every 15 minutes during Phase B.1/B.2:

```typescript
agenda.define('pg-reconciliation', async () => {
  await reconcileAndRepair();  // [FIX-10] reconcile AND repair, not just report
});
agenda.every('15 minutes', 'pg-reconciliation');
```

### Checksum comparison for critical fields

For payments (financial data), periodic spot-check:

```typescript
export async function checksumPayments(sampleSize = 100): Promise<void> {
  // Random sample from PostgreSQL
  const pgSample = await db.any(
    `SELECT mongo_id, amount, state FROM events.payments ORDER BY RANDOM() LIMIT $1`,
    [sampleSize],
  );

  for (const pg of pgSample) {
    const mongo = await NewPaymentModel.findById(pg.mongo_id).lean();
    if (!mongo) {
      logger.error({ mongoId: pg.mongo_id }, 'payment exists in PG but not MongoDB');
      continue;
    }
    if (mongo.amount !== pg.amount.toString() || mongo.state !== pg.state) {
      logger.error(
        { mongoId: pg.mongo_id, mongoAmount: mongo.amount, pgAmount: pg.amount, mongoState: mongo.state, pgState: pg.state },
        'payment field mismatch',
      );
    }
  }
}
```

---

## 10. Feature Flags

### Configuration

```typescript
// src/config/index.ts -- add alongside existing READ_MODEL_* flags

// Phase B.1: Dual-write (MongoDB primary, PG secondary)
export const pgDualWriteEnabled = env.get('PG_DUAL_WRITE_ENABLED').default('false').asBool();

// Phase B.2: Read from PostgreSQL (with MongoDB fallback)
export const pgReadEnabled = env.get('PG_READ_ENABLED').default('false').asBool();

// Phase B.3: PostgreSQL primary (PG writes first, MongoDB secondary)
export const pgPrimaryEnabled = env.get('PG_PRIMARY_ENABLED').default('false').asBool();
```

### How flags are checked in services

```typescript
// Phase B.1: Dual-write guard (in pg-sync.ts fire-and-forget wrappers)
if (!pgDualWriteEnabled) return;

// Phase B.2: Read guard (in every read path)
if (pgReadEnabled) {
  try {
    return await pgQuery();
  } catch (err) {
    logger.error({ err }, 'PG read failed, falling back');
    pgFallbackTotal.inc({ resolver: name });
  }
}
return mongoQuery();

// Phase B.3: Primary write guard (in service write paths)
if (pgPrimaryEnabled) {
  const result = await pgWrite();     // PG first
  mongoWriteAsync(result);             // MongoDB async copy
  return result;
} else {
  const result = await mongoWrite();   // MongoDB first
  pgSyncAfterWrite(result);            // PG async copy (dual-write)
  return result;
}
```

### Deployment

Set via environment variables in CDK/ECS task definitions:

```
# Phase B.1 (after backfill)
PG_DUAL_WRITE_ENABLED=true

# Phase B.2 (after consistency verified)
PG_READ_ENABLED=true

# Phase B.3 (after B.2 stable on staging/production)
PG_PRIMARY_ENABLED=true

# Phase B.4 (cutover)
# Remove dual-write code, remove feature flags
```

---

## 11. Rollback Strategy

### Phase B.1 (dual-write): Zero-risk rollback

Set `PG_DUAL_WRITE_ENABLED=false`, redeploy. MongoDB data is untouched. PostgreSQL data may be stale but is not authoritative.

### Phase B.2 (PG reads): Instant rollback

Set `PG_READ_ENABLED=false`. All reads revert to MongoDB immediately. The feature-flagged read pattern (Section 6) ensures this works without code changes.

### Phase B.3 (PG primary): Rollback with reconciliation

Set `PG_PRIMARY_ENABLED=false`. Falls back to MongoDB writes. Writes that happened during the PG-primary window need reconciliation:

1. Identify writes that went to PG but not MongoDB (check `updated_at` in PG after the rollback timestamp)
2. Run a reverse sync: PG -> MongoDB for those records
3. Re-enable dual-write to keep PG in sync

### Phase B.4 (cutover): Full rollback requires restore

If rollback is needed after cutover:
1. Stop writes
2. Restore MongoDB from the read-only archive (kept for 30 days)
3. Run reverse sync for any post-cutover PG writes
4. Re-enable MongoDB write paths (kept behind feature flag for 30 days after cutover)

**Mitigation:** Keep MongoDB write paths in code for 30 days after Phase B.4. Only remove after confidence period.

---

## 12. Testing Strategy

### Unit tests

Replace Mongoose model mocks with pg-promise mocks. Follow the pattern from `IMPL-POSTGRESQL-MIGRATION.md` Section 7.

```typescript
// BEFORE (Mongoose)
sandbox.stub(TicketModel, 'find').returns({
  sort: () => ({ lean: () => Promise.resolve([mockTicket]) }),
} as any);

// AFTER (pg-promise)
const mockDb = createMockDb(sandbox);
sandbox.stub(pgHelper, 'db').value(mockDb);

mockDb.any
  .withArgs(sinon.match(/FROM events\.tickets/), sinon.match.array)
  .resolves([mockTicketRow]);
```

### Integration tests

Run against real PostgreSQL (Docker in CI):

```yaml
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

Run migrations before test suite. Test data consistency between MongoDB and PostgreSQL during dual-write.

### Aggregation equivalence tests

For each MongoDB aggregation pipeline replaced by SQL, write a test that:
1. Seeds identical data in both MongoDB and PostgreSQL
2. Runs the MongoDB aggregation
3. Runs the equivalent SQL query
4. Asserts identical results

Critical aggregations:
- `ticket.ts:syncTicketCounters` -- GROUP BY with COUNT
- `event-insight.ts:getEventTicketSoldChartData` -- time-series with date filtering
- `event-insight.ts:getEventCheckinChartData` -- time-series
- `space-insight.ts:getSpaceStatistics` -- multi-table JOIN with SUM/COUNT
- `event-payment-summary.ts` -- GROUP BY currency with SUM on NUMERIC

### Load tests

Verify PostgreSQL handles query volume under dual-write load. Monitor:
- Query latency P50/P95/P99
- Connection pool utilization
- Lock contention during concurrent writes

---

## 13. Infrastructure Requirements

### RDS capacity

Existing RDS instance serves `ai.` and `api.` schemas. Verify:
- Storage: tickets and payments are the largest collections
- IOPS: sufficient for dual-write (temporarily doubles write load)
- Multi-AZ: enabled for production

### Connection pool sizing

Current: pg-promise defaults (~10 connections). After migration needs ~30:

```typescript
// src/app/helpers/pg.ts -- update pool config
export const db = pgp({
  ...config,
  max: 30,
  idleTimeoutMillis: 30000,
});
```

### Monitoring

Extend existing Prometheus metrics:
- `pg_sync_total` (table, status) -- dual-write success/error counts
- `pg_sync_duration_seconds` (table) -- dual-write latency
- `pg_migration_reconcile_discrepancy` (table) -- count mismatch
- Connection pool: `db.$pool.totalCount`, `db.$pool.idleCount`, `db.$pool.waitingCount`
- Table sizes: `pg_total_relation_size()` for capacity planning

---

## 14. Timeline and Execution Order

### Phase B.0: Migrations + models

- Create events and spaces schemas (migration file)
- Create all tables and indexes
- Create materialized views
- Write pg-sync.ts dual-write helpers
- Write pg-backfill.ts script
- Write pg-reconciliation.ts job

### Phase B.1: Dual-write helpers

- Add `pgSyncTicketAfterWrite()` calls to ticket write paths
- Add `pgSyncPaymentAfterWrite()` calls to payment write paths
- Add `pgSyncCheckinAfterWrite()` calls to checkin write paths
- Add `pgSyncGuestListAfterWrite()` calls to join request write paths
- Add `pgSyncSubscriberAfterWrite()` calls to space member write paths
- Enable `PG_DUAL_WRITE_ENABLED=true`
- Run backfill scripts for all tables
- Enable reconciliation job

### Phase B.2: Service rewrites (read from PostgreSQL)

Execution order within Phase B.2 (simplest to hardest):

1. **Subscribers** (21 files) -- fewest references, existing PG sync infrastructure
2. **Check-ins** (10 files) -- simple lookups, time-series queries
3. **Event insights** (materialized view) -- mostly reads, already partially on PG
4. **Guest lists** (23 files) -- moderate complexity, some aggregation pipelines
5. **Payments** (22 files) -- state machine, complex queries, financial data
6. **Tickets** (49 files) -- most complex, 2-3 weeks, phased rollout: [FIX-5, FIX-9]
   - B.2a: Analytics/insight reads
   - B.2b: Export reads
   - B.2c: Core service reads
   - B.2d: Resolver reads

### Phase B.3: Primary switch

- Enable `PG_PRIMARY_ENABLED=true`
- PostgreSQL writes first, MongoDB async secondary
- Add FK constraints with NOT VALID + VALIDATE CONSTRAINT
- Monitor for 1 week on staging, then production

### Phase B.4: Cutover

- Stop MongoDB writes
- Remove dual-write code
- Remove feature flags
- Retire `public.*` read model tables
- Retire `read-model-sync.ts` triggers for migrated models
- Keep MongoDB collections as read-only archive for 30 days

---

## 15. What Does NOT Change

| Component | Reason |
|---|---|
| Event model (`src/app/models/event.ts`) | 1316 lines, deeply nested, flexible schema |
| Space model (`src/app/models/space.ts`) | 200+ fields, complex nested config |
| User model | Variable profiles, OAuth tokens |
| EventTicketType (`src/app/models/event-ticket-type.ts`) | Nested prices, config data not transactional |
| NewPaymentAccount (`src/app/models/new-payment-account.ts`) | Union-typed account_info |
| ExternalEventMapping | External connector configs |
| PageConfig | Deeply nested section types |
| All Atlas models | Already on PostgreSQL via `IMPL-POSTGRESQL-MIGRATION.md` |
| AI models (conversations, credits) | Already on PostgreSQL (`ai.` schema) or unstructured |
| Connector models | Non-financial, MongoDB references |
| Track service (`src/app/services/track.ts`) | Already PostgreSQL |
| Read model sync infrastructure (`read-model-sync.ts`) | Stays active until Phase B.4, then retired |
| GraphQL type definitions | Field names exposed to GraphQL remain the same |
| Agenda job definitions | Job handlers delegate to services, scheduling unchanged |
| Redis caching | Unchanged |

---

## Execution Status

| Task | Status | Agent |
|---|---|---|
| IMPL document | Complete | -- |
| Migration SQL files (2 files) | Not started | -- |
| pg-sync.ts (dual-write helpers) | Not started | -- |
| pg-backfill.ts (backfill script) | Not started | -- |
| pg-reconciliation.ts (consistency checks) | Not started | -- |
| Feature flag config additions | Not started | -- |
| Ticket service reads rewrite | Not started | -- |
| Payment service reads rewrite | Not started | -- |
| EventCheckin service reads rewrite | Not started | -- |
| EventJoinRequest service reads rewrite | Not started | -- |
| SpaceMember service reads rewrite | Not started | -- |
| Ticket dual-write integration | Not started | -- |
| Payment dual-write integration | Not started | -- |
| EventCheckin dual-write integration | Not started | -- |
| EventJoinRequest dual-write integration | Not started | -- |
| SpaceMember dual-write integration | Not started | -- |
| Resolver updates (all models) | Not started | -- |
| Test updates | Not started | -- |
| Backfill execution | Not started | -- |
| Materialized view refresh | Not started | -- |
