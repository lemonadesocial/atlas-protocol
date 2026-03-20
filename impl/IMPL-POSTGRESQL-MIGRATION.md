# IMPL: Atlas PostgreSQL Migration

Pre-launch rework. Migrate all 10 Atlas models from MongoDB (Mongoose) to PostgreSQL (pg-promise). Financial models (fee distributions, balances, payouts, referrals, refunds, GMV, dust pool, free ticket rewards), ticket holds, and receipts all move to PostgreSQL. Tickets and Payments are also being migrated to RDS in the same infrastructure cycle, so the entire purchase flow can use PostgreSQL transactions.

---

## 0. Critical: pg-promise, Not Knex

lemonade-backend uses **pg-promise v10.11.0**, not Knex. All PostgreSQL patterns in this IMPL use pg-promise conventions:

- Connection: `import { db, pgp } from '../helpers/pg'`
- Queries: `db.one(sql, params)`, `db.any(sql, params)`, `db.none(sql, params)`
- Transactions: `db.tx(async (t) => { ... })`
- Parameterization: `$1, $2, ...` positional placeholders
- Bulk inserts: `pgp.helpers.insert(rows, columnSet)`
- No query builder -- raw parameterized SQL throughout

Reference: `lemonade-backend/src/app/helpers/pg.ts:1-18`

### Decimal Type Convention [FIX-2]

Two distinct DECIMAL types are used in this schema:

- **`DECIMAL(12,2)`** -- USD dollar amounts with 2 decimal places. Used for fields that represent human-readable dollar values: `total_price_usd`, `total_charged`. Range: up to $9,999,999,999.99.
- **`DECIMAL(20,0)`** -- USDC micro-unit amounts stored as whole numbers (no decimal places). Used for all `*_usdc` and `*_cents` fields: `gross_amount_usdc`, `protocol_fee_cents`, `accrued_usdc`, etc. These are integer representations where 1 USDC = 1,000,000 micro-units.

Never mix these types. If a field name ends in `_usd`, it uses `DECIMAL(12,2)`. If it ends in `_usdc` or `_cents`, it uses `DECIMAL(20,0)`.

### SQL Safety Rules [FIX-11]

ALL queries MUST use positional parameters (`$1`, `$2`, ...). For IN clauses with arrays, use `ANY($1)` with an array parameter. NEVER interpolate values into SQL strings.

```typescript
// CORRECT: parameterized
await db.any('SELECT * FROM atlas.fee_distributions WHERE payment_id = ANY($1)', [paymentIds]);

// WRONG: string interpolation
await db.any(`SELECT * FROM atlas.fee_distributions WHERE payment_id IN (${paymentIds.join(',')})`);
```

### JSONB Validation [FIX-7]

JSONB columns (`attendee_info`, `payment_recipient_addresses`, `vc_tickets`, `items`) are validated at the application layer before insert. No PostgreSQL CHECK constraints on JSONB -- they are fragile and hard to evolve. TypeScript interfaces enforce structure at compile time. The service layer validates shape before calling `db.none()`.

### updated_at Convention [FIX-9]

Every UPDATE statement that modifies a row MUST explicitly set `updated_at = NOW()`. No database triggers. This keeps behavior explicit and auditable.

Pattern for implementing agents to follow in every UPDATE:
```typescript
// ALWAYS include updated_at = NOW() in UPDATE statements
await t.none(
  `UPDATE atlas.reward_balances SET
     accrued_usdc = accrued_usdc + $1,
     updated_at = NOW()  -- mandatory on every UPDATE
   WHERE user_id = $2 AND space_id = $3 AND type = $4`,
  [amount, userId, spaceId, type],
);
```

---

## 1. Models to Migrate

10 Mongoose models migrate to PostgreSQL tables in a new `atlas` schema.

| # | Mongoose Model | MongoDB Collection | PostgreSQL Table | Phase |
|---|---|---|---|---|
| 1 | AtlasTicketHold | atlas_ticket_holds | atlas.ticket_holds | 2 |
| 2 | AtlasReceipt | atlas_receipts | atlas.receipts | 2 |
| 3 | AtlasFeeDistribution | atlas_fee_distributions | atlas.fee_distributions | 4 |
| 4 | AtlasRewardBalance | atlas_reward_balances | atlas.reward_balances | 4 |
| 5 | AtlasOrganizerMonthlyGmv | atlas_organizer_monthly_gmvs | atlas.organizer_monthly_gmv | 4 |
| 6 | AtlasDustPool | atlas_dust_pools | atlas.dust_pools | 4 |
| 7 | AtlasPayoutBatch | atlas_payout_batches | atlas.payout_batches | 4 |
| 8 | AtlasReferral | atlas_referrals | atlas.referrals | 4 |
| 9 | AtlasRefund | atlas_refunds | atlas.refunds | 4 |
| 10 | AtlasFreeTicketReward | atlas_free_ticket_rewards | atlas.free_ticket_rewards | 4 |

### Field Mapping: AtlasTicketHold -> atlas.ticket_holds

Source: `lemonade-backend/src/app/models/atlas-ticket-hold.ts:1-69`

AtlasTicketHold is a temporary hold with TTL cleanup. It stores event_id and ticket_type_id as string lookups (not Mongoose refs). It benefits from SQL: simple INSERT/UPDATE/DELETE, expiry cleanup via scheduled DELETE query, no MongoDB TTL index needed.

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | Replace MongoDB _id |
| hold_id | string | hold_id | VARCHAR(64) | UNIQUE NOT NULL | -- | |
| challenge_id | string | challenge_id | VARCHAR(64) | UNIQUE NOT NULL | -- | |
| event_id | string | event_id | VARCHAR(24) | NOT NULL | -- | String lookup, not Mongoose ref |
| ticket_type_id | string | ticket_type_id | VARCHAR(24) | NOT NULL | -- | String lookup, not Mongoose ref |
| quantity | number | quantity | SMALLINT | NOT NULL | -- | |
| agent_id | string | agent_id | VARCHAR(128) | NOT NULL | -- | |
| idempotency_key | string | idempotency_key | VARCHAR(128) | NOT NULL | -- | |
| total_price_usd | number | total_price_usd | DECIMAL(12,2) | NOT NULL | -- | USD dollars [FIX-2] |
| protocol_fee_cents | string | protocol_fee_cents | DECIMAL(20,0) | NOT NULL | -- | USDC micro-units |
| subtotal_cents | string | subtotal_cents | DECIMAL(20,0) | NOT NULL | -- | USDC micro-units |
| attendee_info | Array<{name,email}> | attendee_info | JSONB | NOT NULL | -- | App-layer validation [FIX-7] |
| discount_codes | string[] | discount_codes | TEXT[] | -- | -- | PostgreSQL array |
| ip_address | string | ip_address | INET | -- | -- | Use INET type |
| payment_recipient_addresses | Record<string,string> | payment_recipient_addresses | JSONB | -- | -- | App-layer validation [FIX-7] |
| status | enum | status | VARCHAR(16) | NOT NULL | -- | 'pending','consumed','expired' |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| expires_at | Date | expires_at | TIMESTAMPTZ | NOT NULL | -- | Cleanup via scheduled DELETE [FIX-5] |

Indexes:
- `UNIQUE (hold_id)`
- `UNIQUE (challenge_id)`
- `(agent_id, event_id)`
- `(agent_id, event_id, status)`
- `(event_id, status, expires_at)`
- `(expires_at)` -- for scheduled cleanup queries

### Field Mapping: AtlasReceipt -> atlas.receipts

Source: `lemonade-backend/src/app/models/atlas-receipt.ts:1-63`

Tickets and Payments are being migrated to RDS in the same infrastructure cycle. AtlasReceipt can therefore use PostgreSQL with full transactional safety.

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | |
| receipt_id | string | receipt_id | VARCHAR(64) | UNIQUE NOT NULL | -- | |
| status | enum | status | VARCHAR(16) | NOT NULL | -- | 'confirmed','pending','failed' |
| event | ObjectId (ref Event) | event_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId string |
| event_name | string | event_name | VARCHAR(512) | NOT NULL | -- | |
| agent_id | string | agent_id | VARCHAR(128) | NOT NULL | -- | |
| payment | ObjectId (ref NewPayment) | payment_id | VARCHAR(24) | NOT NULL | -- | See FK migration note below |
| tickets | ObjectId[] | ticket_ids | TEXT[] | NOT NULL | -- | See FK migration note below |
| total_charged | number | total_charged | DECIMAL(12,2) | NOT NULL | -- | USD dollars [FIX-2] |
| currency | string | currency | VARCHAR(8) | NOT NULL | -- | |
| payment_method | string | payment_method | VARCHAR(32) | NOT NULL | -- | |
| transaction_hash | string | transaction_hash | VARCHAR(128) | -- | -- | |
| stripe_payment_intent | string | stripe_payment_intent | VARCHAR(128) | -- | -- | |
| idempotency_key | string | idempotency_key | VARCHAR(128) | UNIQUE NOT NULL | -- | |
| vc_tickets | object[] | vc_tickets | JSONB | NOT NULL | -- | App-layer validation [FIX-7] |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |

**FK migration note for `payment_id` and `ticket_ids`:**
- **For launch:** these columns store MongoDB ObjectId strings as VARCHAR(24) / TEXT[]. No SQL FK constraint. Tickets and Payments are mid-migration to RDS.
- **After Tickets and Payments complete their RDS migration:** a follow-up migration converts these to proper UUID columns with `REFERENCES ... ON DELETE RESTRICT`. The migration: add UUID columns, backfill from VARCHAR via lookup, drop VARCHAR columns, rename UUID columns, add FK constraints.

Indexes:
- `UNIQUE (receipt_id)`
- `UNIQUE (idempotency_key)`
- `(event_id, created_at DESC)`
- `(agent_id, created_at DESC)`

### Field Mapping: AtlasFeeDistribution -> atlas.fee_distributions

Source: `lemonade-backend/src/app/models/atlas-fee-distribution.ts:1-141`

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | |
| payment_id | ObjectId | payment_id | VARCHAR(24) | UNIQUE NOT NULL | -- | MongoDB ObjectId ref |
| event_id | ObjectId | event_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| space_id | ObjectId | space_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| organizer_id | ObjectId (ref User) | organizer_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| attendee_id | ObjectId (ref User) | attendee_id | VARCHAR(24) | -- | -- | MongoDB ObjectId ref |
| gross_amount_usdc | string | gross_amount_usdc | DECIMAL(20,0) | NOT NULL | -- | Micro-units |
| protocol_fee_usdc | string | protocol_fee_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| treasury_share_usdc | string | treasury_share_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| organizer_cashback_usdc | string | organizer_cashback_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| attendee_cashback_usdc | string | attendee_cashback_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| referral_pool_usdc | string | referral_pool_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| organizer_volume_bonus_usdc | string | organizer_volume_bonus_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| attendee_discovery_bonus_usdc | string | attendee_discovery_bonus_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| boosted_delta_usdc | string | boosted_delta_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| organizer_verified | boolean | organizer_verified | BOOLEAN | NOT NULL | false | |
| attendee_verified | boolean | attendee_verified | BOOLEAN | NOT NULL | false | |
| payment_method | enum | payment_method | VARCHAR(16) | NOT NULL | -- | CHECK: 'tempo_usdc','base_usdc','stripe' [FIX-8] |
| status | enum | status | VARCHAR(24) | NOT NULL | -- | 'pending_hold','available','paid_out','clawed_back','partially_clawed_back','cancelled' |
| hold_expires_at | Date | hold_expires_at | TIMESTAMPTZ | NOT NULL | -- | |
| connection_id | ObjectId | connection_id | VARCHAR(24) | -- | -- | |
| refund_amount_usdc | string | refund_amount_usdc | DECIMAL(20,0) | -- | -- | |
| transaction_hash | string | transaction_hash | VARCHAR(128) | -- | -- | |
| stripe_payment_intent | string | stripe_payment_intent | VARCHAR(128) | -- | -- | |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| updated_at | Date | updated_at | TIMESTAMPTZ | -- | -- | |

Indexes:
- `UNIQUE (payment_id)`
- `(event_id)`
- `(space_id)`
- `(organizer_id, created_at DESC)`
- `(attendee_id, created_at DESC)`
- `(status)`
- `(status, hold_expires_at)`

### Field Mapping: AtlasRewardBalance -> atlas.reward_balances

Source: `lemonade-backend/src/app/models/atlas-reward-balance.ts:1-74`

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | |
| user | ObjectId (ref User) | user_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| space | ObjectId (ref Space) | space_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| type | enum | type | VARCHAR(16) | NOT NULL | -- | 'organizer','attendee' |
| accrued_usdc | string | accrued_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| paid_out_usdc | string | paid_out_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| pending_usdc | string | pending_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| clawed_back_usdc | string | clawed_back_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| negative_balance_usdc | string | negative_balance_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| cumulative_annual_usd | string | cumulative_annual_usd | DECIMAL(20,0) | NOT NULL | 0 | |
| last_payout_at | Date | last_payout_at | TIMESTAMPTZ | -- | -- | |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| updated_at | Date | updated_at | TIMESTAMPTZ | -- | -- | |

Indexes:
- `UNIQUE (user_id, space_id, type)`
- `(user_id, type)`

### Field Mapping: AtlasOrganizerMonthlyGmv -> atlas.organizer_monthly_gmv

Source: `lemonade-backend/src/app/models/atlas-organizer-monthly-gmv.ts:1-45`

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | |
| user | ObjectId (ref User) | user_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| year | number | year | SMALLINT | NOT NULL | -- | |
| month | number | month | SMALLINT | NOT NULL | -- | |
| gmv_usdc | string | gmv_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| ticket_count | number | ticket_count | INT | NOT NULL | 0 | |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| updated_at | Date | updated_at | TIMESTAMPTZ | -- | -- | |

Indexes:
- `UNIQUE (user_id, year, month)`

### Field Mapping: AtlasDustPool -> atlas.dust_pools

Source: `lemonade-backend/src/app/models/atlas-dust-pool.ts:1-35`

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | |
| month | string | month | VARCHAR(7) | UNIQUE NOT NULL | -- | Format: YYYY-MM |
| total_dust_usdc | string | total_dust_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| transaction_count | number | transaction_count | INT | NOT NULL | 0 | |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| updated_at | Date | updated_at | TIMESTAMPTZ | -- | -- | |

Indexes:
- `UNIQUE (month)`

### Field Mapping: AtlasPayoutBatch -> atlas.payout_batches

Source: `lemonade-backend/src/app/models/atlas-payout-batch.ts:1-109`

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | |
| period_start | Date | period_start | TIMESTAMPTZ | NOT NULL | -- | |
| period_end | Date | period_end | TIMESTAMPTZ | NOT NULL | -- | |
| status | enum | status | VARCHAR(24) | NOT NULL | 'pending' | 'pending','processing','completed','partially_failed','failed' |
| total_amount_usdc | string | total_amount_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| total_items | number | total_items | INT | NOT NULL | 0 | |
| succeeded_items | number | succeeded_items | INT | NOT NULL | 0 | |
| failed_items | number | failed_items | INT | NOT NULL | 0 | |
| items | AtlasPayoutItem[] | items | JSONB | NOT NULL | '[]' | Array of payout item objects |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| updated_at | Date | updated_at | TIMESTAMPTZ | -- | -- | |

Indexes:
- `(status)`
- `UNIQUE (period_start, period_end)`

Note: `items` stays as JSONB because it is a nested array of heterogeneous payout records. Each item contains: `user` (VARCHAR(24)), `amount_usdc` (string), `payout_method` (string), `wallet_address` (optional string), `tx_hash` (optional string), `stripe_transfer_id` (optional string), `status` (string, default 'pending'), `failure_reason` (optional string), `retry_count` (number, default 0), `processed_at` (optional timestamp).

### Field Mapping: AtlasReferral -> atlas.referrals

Source: `lemonade-backend/src/app/models/atlas-referral.ts:1-97`

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | |
| referrer_id | ObjectId (ref User) | referrer_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| referred_id | ObjectId (ref User) | referred_id | VARCHAR(24) | UNIQUE NOT NULL | -- | MongoDB ObjectId ref |
| referral_code | string | referral_code | VARCHAR(32) | NOT NULL | -- | |
| status | enum | status | VARCHAR(16) | NOT NULL | 'pending' | 'pending','milestone_1','milestone_2','capped','expired' |
| referred_tickets_sold | number | referred_tickets_sold | INT | NOT NULL | 0 | |
| referred_gmv_usdc | string | referred_gmv_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| referrer_earned_usdc | string | referrer_earned_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| referred_welcome_bonus_usdc | string | referred_welcome_bonus_usdc | DECIMAL(20,0) | NOT NULL | 0 | |
| milestone_1_at | Date | milestone_1_at | TIMESTAMPTZ | -- | -- | |
| milestone_2_at | Date | milestone_2_at | TIMESTAMPTZ | -- | -- | |
| welcome_bonus_paid_at | Date | welcome_bonus_paid_at | TIMESTAMPTZ | -- | -- | |
| requires_manual_review | boolean | requires_manual_review | BOOLEAN | NOT NULL | false | |
| referral_rewards_eligible | boolean | referral_rewards_eligible | BOOLEAN | NOT NULL | false | |
| referee_ip | string | referee_ip | INET | -- | -- | |
| manual_review_cleared_at | Date | manual_review_cleared_at | TIMESTAMPTZ | -- | -- | |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| updated_at | Date | updated_at | TIMESTAMPTZ | -- | -- | |

Indexes:
- `(referrer_id)`
- `UNIQUE (referred_id)`
- `(referral_code)`

### Field Mapping: AtlasRefund -> atlas.refunds

Source: `lemonade-backend/src/app/models/atlas-refund.ts:1-61`

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | |
| payment_id | ObjectId | payment_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| fee_distribution_id | ObjectId | fee_distribution_id | UUID | NOT NULL | -- | FK to atlas.fee_distributions |
| refund_type | enum | refund_type | VARCHAR(8) | NOT NULL | -- | 'full','partial' |
| refund_amount_usdc | string | refund_amount_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| refund_percent | number | refund_percent | DECIMAL(5,2) | NOT NULL | -- | CHECK: 0-100 [FIX-6] |
| organizer_clawback_usdc | string | organizer_clawback_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| attendee_clawback_usdc | string | attendee_clawback_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| treasury_clawback_usdc | string | treasury_clawback_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |

Indexes:
- `(payment_id)`
- `(fee_distribution_id)`
- `(created_at DESC)`

[FIX-3] `fee_distribution_id` is a true UUID FK to `atlas.fee_distributions.id` with `ON DELETE RESTRICT` -- a fee distribution that has refunds must never be deleted. All other foreign key references to MongoDB documents (payment_id, event_id, user_id, space_id as VARCHAR(24)) have NO SQL FK constraint because they reference documents in a different database.

### Field Mapping: AtlasFreeTicketReward -> atlas.free_ticket_rewards

Source: `lemonade-backend/src/app/models/atlas-free-ticket-reward.ts:1-77`

| Mongoose Field | Mongoose Type | PG Column | PG Type | Constraints | Default | Notes |
|---|---|---|---|---|---|---|
| _id | ObjectId | id | UUID | PK | gen_random_uuid() | |
| user_id | ObjectId (ref User) | user_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| event_id | ObjectId | event_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| space_id | ObjectId | space_id | VARCHAR(24) | NOT NULL | -- | MongoDB ObjectId ref |
| role | enum | role | VARCHAR(16) | NOT NULL | -- | 'attendee','organizer' |
| amount_usdc | string | amount_usdc | DECIMAL(20,0) | NOT NULL | -- | |
| self_verified | boolean | self_verified | BOOLEAN | NOT NULL | true | |
| status | enum | status | VARCHAR(16) | NOT NULL | -- | 'pending_hold','available','paid_out','cancelled' |
| hold_expires_at | Date | hold_expires_at | TIMESTAMPTZ | NOT NULL | -- | |
| created_at | Date | created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| updated_at | Date | updated_at | TIMESTAMPTZ | -- | -- | |

Indexes:
- `(user_id, created_at DESC)`
- `(event_id)`
- `(space_id)`
- `(status, hold_expires_at)`
- `(user_id, role, created_at DESC)`

---

## 2. Models That Stay on MongoDB

These models are NOT migrated as part of this IMPL:

**Infrastructure context:** Tickets and Payments are being migrated to RDS in the same infrastructure cycle. This eliminates the mixed-transaction concern that previously kept AtlasReceipt on MongoDB. All 10 Atlas models now move to PostgreSQL.

| Model | Why stays MongoDB (for now) |
|---|---|
| ExternalEventMapping | Phase 1 connector model. Non-financial. References Event documents by ObjectId with bidirectional lookups. No benefit from PostgreSQL. |
| Connection fields (atlas-related) | Connection model is core MongoDB document used across all of lemonade-backend. Adding atlas fields (connector_type, external_account_id, sync_state) to an existing Mongoose model is correct. |
| Event, EventTicketType, Ticket | Migrating to RDS separately. Until that migration lands, Atlas references these by ObjectId string (VARCHAR(24)). |
| NewPayment | Migrating to RDS separately. Same as above. |
| User, Space | Core identity models. Same reasoning. |
| AtlasAgentRegistration | Referenced by ticket-hold.ts but lives in the atlas-registry PostgreSQL database already. |
| AtlasPayoutSettings | Small config model (user preferences). Stays MongoDB -- only read (never aggregated). Could migrate later. |
| AtlasReferralCode | Small lookup model (user -> code mapping). Stays MongoDB -- only used for code generation/lookup. |
| UserSelfDisclosure | Core identity model. Not Atlas-specific. |

---

## 3. PostgreSQL Schema (DDL)

All tables go in the `atlas` schema, following the existing pattern of schema namespacing (`ai.`, `api.`, `public.`).

```sql
-- Migration: atlas-schema-phase-2
CREATE SCHEMA IF NOT EXISTS atlas;

-- All 10 Atlas models move to PostgreSQL.
-- Tickets and Payments are migrating to RDS in the same infrastructure cycle.
-- [FIX-4] No GIN index on ticket_ids -- no array containment queries exist in the codebase.

-- ============================================================
-- Phase 2: Ticket Holds + Receipts
-- ============================================================

CREATE TABLE IF NOT EXISTS atlas.ticket_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id VARCHAR(64) NOT NULL,
  challenge_id VARCHAR(64) NOT NULL,
  event_id VARCHAR(24) NOT NULL,
  ticket_type_id VARCHAR(24) NOT NULL,
  quantity SMALLINT NOT NULL,
  agent_id VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  total_price_usd DECIMAL(12,2) NOT NULL,           -- [FIX-2] USD dollars, not micro-units
  protocol_fee_cents DECIMAL(20,0) NOT NULL,
  subtotal_cents DECIMAL(20,0) NOT NULL,
  attendee_info JSONB NOT NULL,                      -- [FIX-7] app-layer validation
  discount_codes TEXT[],
  ip_address INET,
  payment_recipient_addresses JSONB,                 -- [FIX-7] app-layer validation
  status VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT uq_ticket_holds_hold_id UNIQUE (hold_id),
  CONSTRAINT uq_ticket_holds_challenge_id UNIQUE (challenge_id)
);

CREATE INDEX idx_ticket_holds_agent_event ON atlas.ticket_holds (agent_id, event_id);
CREATE INDEX idx_ticket_holds_agent_event_status ON atlas.ticket_holds (agent_id, event_id, status);
CREATE INDEX idx_ticket_holds_event_status_expires ON atlas.ticket_holds (event_id, status, expires_at);
CREATE INDEX idx_ticket_holds_expires ON atlas.ticket_holds (expires_at);


CREATE TABLE IF NOT EXISTS atlas.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  event_id VARCHAR(24) NOT NULL,
  event_name VARCHAR(512) NOT NULL,
  agent_id VARCHAR(128) NOT NULL,
  -- payment_id and ticket_ids: VARCHAR(24)/TEXT[] for launch (MongoDB ObjectId strings).
  -- After Tickets/Payments complete RDS migration: convert to UUID FKs with ON DELETE RESTRICT.
  payment_id VARCHAR(24) NOT NULL,
  ticket_ids TEXT[] NOT NULL,
  total_charged DECIMAL(12,2) NOT NULL,              -- [FIX-2] USD dollars, not micro-units
  currency VARCHAR(8) NOT NULL,
  payment_method VARCHAR(32) NOT NULL,
  transaction_hash VARCHAR(128),
  stripe_payment_intent VARCHAR(128),
  idempotency_key VARCHAR(128) NOT NULL,
  vc_tickets JSONB NOT NULL,                         -- [FIX-7] app-layer validation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_receipts_receipt_id UNIQUE (receipt_id),
  CONSTRAINT uq_receipts_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX idx_receipts_event_created ON atlas.receipts (event_id, created_at DESC);
CREATE INDEX idx_receipts_agent_created ON atlas.receipts (agent_id, created_at DESC);
```

```sql
-- Migration: atlas-schema-phase-4-core
-- ============================================================
-- Phase 4 Core: Fee Distributions, Reward Balances, GMV, Dust
-- ============================================================

CREATE TABLE IF NOT EXISTS atlas.fee_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id VARCHAR(24) NOT NULL,
  event_id VARCHAR(24) NOT NULL,
  space_id VARCHAR(24) NOT NULL,
  organizer_id VARCHAR(24) NOT NULL,
  attendee_id VARCHAR(24),
  gross_amount_usdc DECIMAL(20,0) NOT NULL,
  protocol_fee_usdc DECIMAL(20,0) NOT NULL,
  treasury_share_usdc DECIMAL(20,0) NOT NULL,
  organizer_cashback_usdc DECIMAL(20,0) NOT NULL,
  attendee_cashback_usdc DECIMAL(20,0) NOT NULL,
  referral_pool_usdc DECIMAL(20,0) NOT NULL,
  organizer_volume_bonus_usdc DECIMAL(20,0) NOT NULL,
  attendee_discovery_bonus_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  boosted_delta_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  organizer_verified BOOLEAN NOT NULL DEFAULT false,
  attendee_verified BOOLEAN NOT NULL DEFAULT false,
  payment_method VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL,
  hold_expires_at TIMESTAMPTZ NOT NULL,
  connection_id VARCHAR(24),
  refund_amount_usdc DECIMAL(20,0),
  transaction_hash VARCHAR(128),
  stripe_payment_intent VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT uq_fee_distributions_payment_id UNIQUE (payment_id),
  CONSTRAINT chk_fee_dist_payment_method CHECK (payment_method IN ('tempo_usdc', 'base_usdc', 'stripe'))  -- [FIX-8]
);

CREATE INDEX idx_fee_dist_event ON atlas.fee_distributions (event_id);
CREATE INDEX idx_fee_dist_space ON atlas.fee_distributions (space_id);
CREATE INDEX idx_fee_dist_organizer_created ON atlas.fee_distributions (organizer_id, created_at DESC);
CREATE INDEX idx_fee_dist_attendee_created ON atlas.fee_distributions (attendee_id, created_at DESC);
CREATE INDEX idx_fee_dist_status ON atlas.fee_distributions (status);
CREATE INDEX idx_fee_dist_status_hold ON atlas.fee_distributions (status, hold_expires_at);


CREATE TABLE IF NOT EXISTS atlas.reward_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(24) NOT NULL,
  space_id VARCHAR(24) NOT NULL,
  type VARCHAR(16) NOT NULL,
  accrued_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  paid_out_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  pending_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  clawed_back_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  negative_balance_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  cumulative_annual_usd DECIMAL(20,0) NOT NULL DEFAULT 0,
  last_payout_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT uq_reward_balances_user_space_type UNIQUE (user_id, space_id, type)
);

CREATE INDEX idx_reward_balances_user_type ON atlas.reward_balances (user_id, type);


CREATE TABLE IF NOT EXISTS atlas.organizer_monthly_gmv (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(24) NOT NULL,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL,
  gmv_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  ticket_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT uq_org_monthly_gmv_user_year_month UNIQUE (user_id, year, month)
);


CREATE TABLE IF NOT EXISTS atlas.dust_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month VARCHAR(7) NOT NULL,
  total_dust_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  transaction_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT uq_dust_pools_month UNIQUE (month)
);
```

```sql
-- Migration: atlas-schema-phase-4-secondary
-- ============================================================
-- Phase 4 Secondary: Payouts, Referrals, Refunds, Free Rewards
-- ============================================================

CREATE TABLE IF NOT EXISTS atlas.payout_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  total_amount_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  total_items INT NOT NULL DEFAULT 0,
  succeeded_items INT NOT NULL DEFAULT 0,
  failed_items INT NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT uq_payout_batches_period UNIQUE (period_start, period_end)
);

CREATE INDEX idx_payout_batches_status ON atlas.payout_batches (status);


CREATE TABLE IF NOT EXISTS atlas.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id VARCHAR(24) NOT NULL,
  referred_id VARCHAR(24) NOT NULL,
  referral_code VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  referred_tickets_sold INT NOT NULL DEFAULT 0,
  referred_gmv_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  referrer_earned_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  referred_welcome_bonus_usdc DECIMAL(20,0) NOT NULL DEFAULT 0,
  milestone_1_at TIMESTAMPTZ,
  milestone_2_at TIMESTAMPTZ,
  welcome_bonus_paid_at TIMESTAMPTZ,
  requires_manual_review BOOLEAN NOT NULL DEFAULT false,
  referral_rewards_eligible BOOLEAN NOT NULL DEFAULT false,
  referee_ip INET,
  manual_review_cleared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT uq_referrals_referred_id UNIQUE (referred_id)
);

CREATE INDEX idx_referrals_referrer ON atlas.referrals (referrer_id);
CREATE INDEX idx_referrals_code ON atlas.referrals (referral_code);


CREATE TABLE IF NOT EXISTS atlas.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id VARCHAR(24) NOT NULL,
  fee_distribution_id UUID NOT NULL REFERENCES atlas.fee_distributions(id) ON DELETE RESTRICT,  -- [FIX-3] never delete a fee distribution that has refunds
  refund_type VARCHAR(8) NOT NULL,
  refund_amount_usdc DECIMAL(20,0) NOT NULL,
  refund_percent DECIMAL(5,2) NOT NULL,
  organizer_clawback_usdc DECIMAL(20,0) NOT NULL,
  attendee_clawback_usdc DECIMAL(20,0) NOT NULL,
  treasury_clawback_usdc DECIMAL(20,0) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_refunds_percent CHECK (refund_percent >= 0 AND refund_percent <= 100)  -- [FIX-6]
);

CREATE INDEX idx_refunds_payment ON atlas.refunds (payment_id);
CREATE INDEX idx_refunds_fee_dist ON atlas.refunds (fee_distribution_id);
CREATE INDEX idx_refunds_created ON atlas.refunds (created_at DESC);


CREATE TABLE IF NOT EXISTS atlas.free_ticket_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(24) NOT NULL,
  event_id VARCHAR(24) NOT NULL,
  space_id VARCHAR(24) NOT NULL,
  role VARCHAR(16) NOT NULL,
  amount_usdc DECIMAL(20,0) NOT NULL,
  self_verified BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(16) NOT NULL,
  hold_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX idx_free_rewards_user_created ON atlas.free_ticket_rewards (user_id, created_at DESC);
CREATE INDEX idx_free_rewards_event ON atlas.free_ticket_rewards (event_id);
CREATE INDEX idx_free_rewards_space ON atlas.free_ticket_rewards (space_id);
CREATE INDEX idx_free_rewards_status_hold ON atlas.free_ticket_rewards (status, hold_expires_at);
CREATE INDEX idx_free_rewards_user_role_created ON atlas.free_ticket_rewards (user_id, role, created_at DESC);
```

---

## 4. Migration Files

Follow the existing pattern: raw `.sql` files in `lemonade-backend/src/sql/migrations/`, named with timestamp prefix, tracked by `ai.pg_migrations`.

Reference: `lemonade-backend/src/app/helpers/pg-migrate.ts:1-91`

### Migration 1: Atlas schema + ticket_holds + receipts (Phase 2)

**File:** `src/sql/migrations/1779000000000-create-atlas-schema-phase-2.sql`

Contents: CREATE SCHEMA atlas + ticket_holds table + receipts table with all indexes. Uses DECIMAL(12,2) for total_price_usd and total_charged [FIX-2]. receipt.payment_id and receipt.ticket_ids use VARCHAR(24)/TEXT[] for launch; converted to UUID FKs after Tickets/Payments RDS migration completes.

**Down file:** `src/sql/migrations/1779000000000-create-atlas-schema-phase-2.down.sql`
```sql
-- [FIX-12] Staging: DROP tables. Production: RENAME with 30-day retention.
-- Staging:
DROP TABLE IF EXISTS atlas.receipts;
DROP TABLE IF EXISTS atlas.ticket_holds;
-- Do not drop schema here; Phase 4 tables may exist

-- Production (use instead of DROP):
-- ALTER TABLE atlas.receipts RENAME TO _deleted_receipts_20260319;
-- ALTER TABLE atlas.ticket_holds RENAME TO _deleted_ticket_holds_20260319;
-- Schedule final deletion 30 days after rename.
```

### Migration 2: Phase 4 core tables

**File:** `src/sql/migrations/1779100000000-create-atlas-phase-4-core.sql`

Contents: the Phase 4 core DDL block (fee_distributions + reward_balances + organizer_monthly_gmv + dust_pools with all indexes and CHECK constraints).

**Down file:** `src/sql/migrations/1779100000000-create-atlas-phase-4-core.down.sql`
```sql
-- [FIX-12] Staging: DROP tables. Production: RENAME with 30-day retention.
-- Staging:
DROP TABLE IF EXISTS atlas.dust_pools;
DROP TABLE IF EXISTS atlas.organizer_monthly_gmv;
DROP TABLE IF EXISTS atlas.reward_balances;
DROP TABLE IF EXISTS atlas.fee_distributions;
-- Do not drop schema here; secondary tables may exist

-- Production (use instead of DROP):
-- ALTER TABLE atlas.fee_distributions RENAME TO _deleted_fee_distributions_20260319;
-- ALTER TABLE atlas.reward_balances RENAME TO _deleted_reward_balances_20260319;
-- ALTER TABLE atlas.organizer_monthly_gmv RENAME TO _deleted_organizer_monthly_gmv_20260319;
-- ALTER TABLE atlas.dust_pools RENAME TO _deleted_dust_pools_20260319;
-- Schedule final deletion 30 days after rename.
```

### Migration 3: Phase 4 secondary tables

**File:** `src/sql/migrations/1779200000000-create-atlas-phase-4-secondary.sql`

Contents: the Phase 4 secondary DDL block (payout_batches + referrals + refunds + free_ticket_rewards with all indexes, FK with ON DELETE RESTRICT, and CHECK constraints).

**Down file:** `src/sql/migrations/1779100000000-create-atlas-phase-4-secondary.down.sql`
```sql
-- [FIX-12] Staging: DROP tables. Production: RENAME with 30-day retention.
-- Staging:
DROP TABLE IF EXISTS atlas.free_ticket_rewards;
DROP TABLE IF EXISTS atlas.refunds;  -- must drop before fee_distributions due to FK
DROP TABLE IF EXISTS atlas.referrals;
DROP TABLE IF EXISTS atlas.payout_batches;

-- Production (use instead of DROP):
-- ALTER TABLE atlas.refunds RENAME TO _deleted_refunds_20260319;
-- ALTER TABLE atlas.free_ticket_rewards RENAME TO _deleted_free_ticket_rewards_20260319;
-- ALTER TABLE atlas.referrals RENAME TO _deleted_referrals_20260319;
-- ALTER TABLE atlas.payout_batches RENAME TO _deleted_payout_batches_20260319;
-- Schedule final deletion 30 days after rename.
```

---

## 5. Service Rewrites

For each service, the core change is: replace Mongoose model calls with parameterized SQL via `db` from `src/app/helpers/pg.ts`.

### Import change (all services)

```typescript
// BEFORE
import { AtlasFeeDistributionModel } from '../models/atlas-fee-distribution';

// AFTER
import { db } from '../helpers/pg';
```

### 5.1 atlas-fee.ts

Source: `lemonade-backend/src/app/services/atlas-fee.ts`

**Complexity: HIGH.** Most aggregation pipelines and BigInt string gymnastics live here.

#### getMonthlyBoostedTotal (line 68-82)

```typescript
// BEFORE: Mongoose aggregation
const result = await AtlasFeeDistributionModel.aggregate([
  { $match: { organizer_id: orgId, created_at: { $gte: startOfMonth } } },
  { $group: { _id: null, total: { $sum: { $toLong: '$boosted_delta_usdc' } } } },
]);

// AFTER: SQL SUM on DECIMAL column
const result = await db.oneOrNone<{ total: string }>(
  `SELECT COALESCE(SUM(boosted_delta_usdc), 0)::TEXT AS total
   FROM atlas.fee_distributions
   WHERE organizer_id = $1 AND created_at >= $2`,
  [orgId.toHexString(), startOfMonth],
);
const total = BigInt(result?.total ?? '0');
```

The `$toLong` conversion is eliminated because `boosted_delta_usdc` is now `DECIMAL(20,0)` -- SQL SUM works natively.

#### checkUnredeemedBalanceCap (line 92-94)

```typescript
// BEFORE
const balance = await AtlasRewardBalanceModel.findOne({ user, space, type }).lean();

// AFTER
const balance = await db.oneOrNone(
  `SELECT * FROM atlas.reward_balances WHERE user_id = $1 AND space_id = $2 AND type = $3`,
  [user.toHexString(), space.toHexString(), type],
);
```

#### getDiscoveryMultiplier (line 127)

```typescript
// BEFORE
const count = await AtlasFeeDistributionModel.countDocuments({ event_id: eventId });

// AFTER
const { count } = await db.one<{ count: number }>(
  `SELECT COUNT(*)::INT AS count FROM atlas.fee_distributions WHERE event_id = $1`,
  [eventId.toHexString()],
);
```

#### processAtlasFee -- dust pool upsert (line 165-182)

```typescript
// BEFORE: Mongoose updateOne with aggregation pipeline + $toLong + $add + $ifNull + $toString
await AtlasDustPoolModel.updateOne(
  { month: monthKey },
  [{ $set: {
    total_dust_usdc: { $toString: { $add: [{ $toLong: { $ifNull: ['$total_dust_usdc', '0'] } }, toLiteral(dustAmount)] } },
    transaction_count: { $add: [{ $ifNull: ['$transaction_count', 0] }, 1] },
    updated_at: new Date(),
  }}],
  { upsert: true },
);

// AFTER: PostgreSQL upsert with native DECIMAL arithmetic
await db.none(
  `INSERT INTO atlas.dust_pools (month, total_dust_usdc, transaction_count)
   VALUES ($1, $2, 1)
   ON CONFLICT (month) DO UPDATE SET
     total_dust_usdc = atlas.dust_pools.total_dust_usdc + EXCLUDED.total_dust_usdc,
     transaction_count = atlas.dust_pools.transaction_count + 1,
     updated_at = NOW()`,
  [monthKey, dustAmount.toString()],
);
```

This pattern eliminates ALL `$toLong/$toString/$ifNull/$add` chains. DECIMAL columns support native arithmetic.

#### processAtlasFee -- create fee record + credit balances (line 352-428)

```typescript
// BEFORE: Mongoose withTransaction wrapping create + upsert aggregation pipelines
await withTransaction(async (session) => {
  await AtlasFeeDistributionModel.create([{ ...feeData }], { session });
  await AtlasRewardBalanceModel.updateOne(
    { user: organizerId, space: spaceId, type: 'organizer' },
    [{ $set: { accrued_usdc: { $toString: { $add: [{ $toLong: { $ifNull: ['$accrued_usdc', '0'] } }, toLiteral(orgTotal)] } } } }],
    { upsert: true, session },
  );
  // ... same for attendee balance
});

// AFTER: pg-promise transaction with native arithmetic
await db.tx(async (t) => {
  await t.none(
    `INSERT INTO atlas.fee_distributions (
      payment_id, event_id, space_id, organizer_id, attendee_id,
      gross_amount_usdc, protocol_fee_usdc, treasury_share_usdc,
      organizer_cashback_usdc, attendee_cashback_usdc, referral_pool_usdc,
      organizer_volume_bonus_usdc, attendee_discovery_bonus_usdc, boosted_delta_usdc,
      organizer_verified, attendee_verified, payment_method, status, hold_expires_at,
      connection_id, transaction_hash, stripe_payment_intent
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      paymentId.toHexString(), eventId.toHexString(), spaceId.toHexString(),
      organizerId.toHexString(), attendeeId?.toHexString() ?? null,
      feeData.gross_amount_usdc, feeData.protocol_fee_usdc, feeData.treasury_share_usdc,
      feeData.organizer_cashback_usdc, feeData.attendee_cashback_usdc, feeData.referral_pool_usdc,
      feeData.organizer_volume_bonus_usdc, feeData.attendee_discovery_bonus_usdc, feeData.boosted_delta_usdc,
      feeData.organizer_verified, feeData.attendee_verified, feeData.payment_method,
      feeData.status, feeData.hold_expires_at,
      feeData.connection_id?.toHexString() ?? null,
      feeData.transaction_hash ?? null, feeData.stripe_payment_intent ?? null,
    ],
  );

  if (orgTotal > 0n) {
    await t.none(
      `INSERT INTO atlas.reward_balances (user_id, space_id, type, accrued_usdc)
       VALUES ($1, $2, 'organizer', $3)
       ON CONFLICT (user_id, space_id, type) DO UPDATE SET
         accrued_usdc = atlas.reward_balances.accrued_usdc + EXCLUDED.accrued_usdc,
         updated_at = NOW()`,
      [organizerId.toHexString(), spaceId.toHexString(), orgTotal.toString()],
    );
  }

  if (attTotal > 0n) {
    await t.none(
      `INSERT INTO atlas.reward_balances (user_id, space_id, type, accrued_usdc)
       VALUES ($1, $2, 'attendee', $3)
       ON CONFLICT (user_id, space_id, type) DO UPDATE SET
         accrued_usdc = atlas.reward_balances.accrued_usdc + EXCLUDED.accrued_usdc,
         updated_at = NOW()`,
      [attendeeId.toHexString(), spaceId.toHexString(), attTotal.toString()],
    );
  }
});
```

The key simplification: `ON CONFLICT ... DO UPDATE SET field = table.field + EXCLUDED.field` replaces the entire `$toLong/$ifNull/$add/$toString` chain.

### 5.2 atlas-payout.ts

Source: `lemonade-backend/src/app/services/atlas-payout.ts`

#### createWeeklyPayoutBatch -- find eligible balances (line 45-47)

```typescript
// BEFORE: $expr with $toLong for BigInt comparison
const balances = await AtlasRewardBalanceModel.find({
  $expr: { $gte: [{ $toLong: '$pending_usdc' }, MIN_PAYOUT_USDC] },
});

// AFTER: Native DECIMAL comparison
const balances = await db.any(
  `SELECT * FROM atlas.reward_balances WHERE pending_usdc >= $1`,
  [MIN_PAYOUT_USDC.toString()],
);
```

#### processPayoutBatch -- update balance after payout (line 174-185)

```typescript
// BEFORE: Mongoose aggregation pipeline with $toLong/$max/$subtract chains
await AtlasRewardBalanceModel.updateOne(
  { user: item.user, type: 'organizer' },
  [{ $set: {
    paid_out_usdc: { $toString: { $add: [{ $toLong: '$paid_out_usdc' }, toLiteral(amount)] } },
    pending_usdc: { $toString: { $max: [0, { $subtract: [{ $toLong: '$pending_usdc' }, toLiteral(amount)] }] } },
    // ...
  }}],
);

// AFTER: Native SQL arithmetic
await t.none(
  `UPDATE atlas.reward_balances SET
     paid_out_usdc = paid_out_usdc + $1,
     pending_usdc = GREATEST(0, pending_usdc - $1),
     cumulative_annual_usd = cumulative_annual_usd + $1,
     last_payout_at = NOW(),
     updated_at = NOW()
   WHERE user_id = $2 AND type = 'organizer'`,
  [amount.toString(), item.user.toHexString()],
);
```

#### processPayoutBatch -- save batch status (line 147)

```typescript
// BEFORE: Mongoose .save() document method
batch.status = 'processing';
await batch.save();

// AFTER: Direct UPDATE
await db.none(
  `UPDATE atlas.payout_batches SET status = $1, updated_at = NOW() WHERE id = $2`,
  ['processing', batchId],
);
```

#### expireUnclaimedRewards (line 293-308)

```typescript
// BEFORE: $expr + $toLong for string-as-number comparison
const stale = await AtlasRewardBalanceModel.find({
  $expr: { $gt: [{ $toLong: '$pending_usdc' }, 0] },
  updated_at: { $lt: cutoff },
});

// AFTER: Native comparison
const stale = await db.any(
  `SELECT * FROM atlas.reward_balances WHERE pending_usdc > 0 AND updated_at < $1`,
  [cutoff],
);
```

### 5.3 atlas-referral.ts

Source: `lemonade-backend/src/app/services/atlas-referral.ts`

#### checkMilestones -- GMV aggregation (line 201-210)

```typescript
// BEFORE: Mongoose aggregate with $sum + $toLong
const gmvResult = await AtlasFeeDistributionModel.aggregate([
  { $match: { organizer_id: referredOrganizerId, attendee_id: { $ne: null, $ne: referredOrganizerId } } },
  { $group: { _id: null, total: { $sum: { $toLong: '$gross_amount_usdc' } } } },
]);

// AFTER: SQL SUM on DECIMAL
const gmvResult = await db.oneOrNone<{ total: string }>(
  `SELECT COALESCE(SUM(gross_amount_usdc), 0)::TEXT AS total
   FROM atlas.fee_distributions
   WHERE organizer_id = $1
     AND attendee_id IS NOT NULL
     AND attendee_id != $1`,
  [referredOrganizerId.toHexString()],
);
```

#### checkMilestones -- distinct attendee count (line 191-195)

```typescript
// BEFORE: Mongoose distinct
const attendees = await AtlasFeeDistributionModel.distinct('attendee_id', { organizer_id: referredOrganizerId });

// AFTER: SQL COUNT DISTINCT
const { count } = await db.one<{ count: number }>(
  `SELECT COUNT(DISTINCT attendee_id)::INT AS count
   FROM atlas.fee_distributions
   WHERE organizer_id = $1 AND attendee_id IS NOT NULL`,
  [referredOrganizerId.toHexString()],
);
```

#### checkMilestones -- credit milestone reward (line 232-242)

```typescript
// BEFORE: Mongoose updateOne with upsert + $toLong pipeline
await AtlasRewardBalanceModel.updateOne(
  { user: referrerId, space: spaceId, type: 'organizer' },
  [{ $set: { accrued_usdc: { $toString: { $add: [{ $toLong: { $ifNull: ['$accrued_usdc', '0'] } }, REWARD] } } } }],
  { upsert: true },
);

// AFTER: ON CONFLICT upsert
await db.none(
  `INSERT INTO atlas.reward_balances (user_id, space_id, type, accrued_usdc, pending_usdc)
   VALUES ($1, $2, 'organizer', $3, $3)
   ON CONFLICT (user_id, space_id, type) DO UPDATE SET
     accrued_usdc = atlas.reward_balances.accrued_usdc + EXCLUDED.accrued_usdc,
     pending_usdc = atlas.reward_balances.pending_usdc + EXCLUDED.pending_usdc,
     updated_at = NOW()`,
  [referrerId.toHexString(), spaceId.toHexString(), REWARD.toString()],
);
```

### 5.4 atlas-refund.ts

Source: `lemonade-backend/src/app/services/atlas-refund.ts`

#### handleAtlasRefund -- post-hold clawback with negative balance (line 93-132)

This is the most complex aggregation pipeline in the codebase: nested `$max/$subtract/$add/$toLong` chains for negative balance tracking.

```typescript
// BEFORE: Mongoose findOneAndUpdate with nested $max + $subtract + $toLong
await AtlasRewardBalanceModel.findOneAndUpdate(
  { user: organizerId, space: spaceId, type: 'organizer' },
  [{ $set: {
    clawed_back_usdc: { $toString: { $add: [{ $toLong: '$clawed_back_usdc' }, toLiteral(orgClawback)] } },
    pending_usdc: { $toString: { $max: [0, { $subtract: [{ $toLong: '$pending_usdc' }, toLiteral(orgClawback)] }] } },
    negative_balance_usdc: { $toString: { $add: [
      { $toLong: '$negative_balance_usdc' },
      { $max: [0, { $subtract: [toLiteral(orgClawback), { $toLong: '$pending_usdc' }] }] },
    ] } },
  }}],
);

// AFTER: Native SQL with GREATEST
await db.none(
  `UPDATE atlas.reward_balances SET
     clawed_back_usdc = clawed_back_usdc + $1,
     pending_usdc = GREATEST(0, pending_usdc - $1),
     negative_balance_usdc = negative_balance_usdc + GREATEST(0, $1 - pending_usdc),
     updated_at = NOW()
   WHERE user_id = $2 AND space_id = $3 AND type = 'organizer'`,
  [orgClawback.toString(), organizerId.toHexString(), spaceId.toHexString()],
);
```

The entire 15-line nested MongoDB pipeline reduces to a 4-line SQL UPDATE.

#### decrementGmv (line 154-163)

```typescript
// BEFORE: Mongoose updateOne with $max/$subtract
await AtlasOrganizerMonthlyGmvModel.updateOne(
  { user: organizerId, year, month },
  [{ $set: {
    gmv_usdc: { $toString: { $max: [0, { $subtract: [{ $toLong: '$gmv_usdc' }, toLiteral(refundAmount)] }] } },
    ticket_count: { $max: [0, { $subtract: ['$ticket_count', 1] }] },
  }}],
);

// AFTER
await db.none(
  `UPDATE atlas.organizer_monthly_gmv SET
     gmv_usdc = GREATEST(0, gmv_usdc - $1),
     ticket_count = GREATEST(0, ticket_count - 1),
     updated_at = NOW()
   WHERE user_id = $2 AND year = $3 AND month = $4`,
  [refundAmount.toString(), organizerId.toHexString(), year, month],
);
```

### 5.5 atlas-free-ticket-reward.ts

Source: `lemonade-backend/src/app/services/atlas-free-ticket-reward.ts`

Simplest migration. Only `countDocuments` and `create`.

```typescript
// BEFORE
const count = await AtlasFreeTicketRewardModel.countDocuments({ event_id: eventId });
await AtlasFreeTicketRewardModel.create({ user_id, event_id, space_id, role, amount_usdc, ... });

// AFTER
const { count } = await db.one<{ count: number }>(
  `SELECT COUNT(*)::INT AS count FROM atlas.free_ticket_rewards WHERE event_id = $1`,
  [eventId.toHexString()],
);
await db.none(
  `INSERT INTO atlas.free_ticket_rewards (user_id, event_id, space_id, role, amount_usdc, self_verified, status, hold_expires_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [userId.toHexString(), eventId.toHexString(), spaceId.toHexString(), role, amountUsdc, selfVerified, status, holdExpiresAt],
);
```

### 5.6 atlas-hold-transition.ts

Source: `lemonade-backend/src/app/services/atlas-hold-transition.ts`

#### transitionExpiredPaidHolds (line 11-73)

```typescript
// BEFORE
const expired = await AtlasFeeDistributionModel.find({
  status: AtlasFeeStatus.pending_hold,
  hold_expires_at: { $lt: new Date() },
});
for (const fee of expired) {
  await withTransaction(async (session) => {
    await AtlasFeeDistributionModel.updateOne({ _id: fee._id, status: 'pending_hold' }, { status: 'available', updated_at: new Date() }, { session });
    await AtlasRewardBalanceModel.updateOne(
      { user: fee.organizer_id, space: fee.space_id, type: 'organizer' },
      [{ $set: { pending_usdc: { $toString: { $add: [{ $toLong: '$pending_usdc' }, toLiteral(orgReward)] } } } }],
      { upsert: true, session },
    );
    // ... attendee, GMV updates
  });
}

// AFTER
const expired = await db.any(
  `SELECT * FROM atlas.fee_distributions WHERE status = 'pending_hold' AND hold_expires_at < NOW()`,
);
for (const fee of expired) {
  await db.tx(async (t) => {
    const updated = await t.result(
      `UPDATE atlas.fee_distributions SET status = 'available', updated_at = NOW()
       WHERE id = $1 AND status = 'pending_hold'`,
      [fee.id],
    );
    if (updated.rowCount === 0) continue; // Already transitioned by another process

    const orgReward = BigInt(fee.organizer_cashback_usdc) + BigInt(fee.organizer_volume_bonus_usdc);
    if (orgReward > 0n) {
      await t.none(
        `INSERT INTO atlas.reward_balances (user_id, space_id, type, pending_usdc)
         VALUES ($1, $2, 'organizer', $3)
         ON CONFLICT (user_id, space_id, type) DO UPDATE SET
           pending_usdc = atlas.reward_balances.pending_usdc + EXCLUDED.pending_usdc,
           updated_at = NOW()`,
        [fee.organizer_id, fee.space_id, orgReward.toString()],
      );
    }

    const attReward = BigInt(fee.attendee_cashback_usdc) + BigInt(fee.attendee_discovery_bonus_usdc);
    if (attReward > 0n && fee.attendee_id) {
      await t.none(
        `INSERT INTO atlas.reward_balances (user_id, space_id, type, pending_usdc)
         VALUES ($1, $2, 'attendee', $3)
         ON CONFLICT (user_id, space_id, type) DO UPDATE SET
           pending_usdc = atlas.reward_balances.pending_usdc + EXCLUDED.pending_usdc,
           updated_at = NOW()`,
        [fee.attendee_id, fee.space_id, attReward.toString()],
      );
    }

    // GMV upsert
    const feeDate = new Date(fee.created_at);
    await t.none(
      `INSERT INTO atlas.organizer_monthly_gmv (user_id, year, month, gmv_usdc, ticket_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (user_id, year, month) DO UPDATE SET
         gmv_usdc = atlas.organizer_monthly_gmv.gmv_usdc + EXCLUDED.gmv_usdc,
         ticket_count = atlas.organizer_monthly_gmv.ticket_count + 1,
         updated_at = NOW()`,
      [fee.organizer_id, feeDate.getFullYear(), feeDate.getMonth() + 1, fee.gross_amount_usdc],
    );
  });
}
```

### 5.7 atlas/purchase.ts

Source: `lemonade-backend/src/app/services/atlas/purchase.ts`

AtlasTicketHold and AtlasReceipt both move to PostgreSQL. Tickets and Payments are migrating to RDS in the same infrastructure cycle, so the entire purchase flow can use a single `db.tx()` transaction.

The purchase flow changes:

1. **Hold consumption** -- moves from Mongoose `findOneAndUpdate` to PostgreSQL `UPDATE ... RETURNING`
2. **Receipt creation** -- moves from Mongoose `create` to PostgreSQL `INSERT ... RETURNING`
3. **Ticket/Payment/EventTicketType operations** -- remain on MongoDB `withTransaction` until those models complete their RDS migration. Once they migrate, the entire purchase becomes a single `db.tx()`.
4. **Fee processing** -- fires asynchronously via Agenda job (`atlas-process-fee.ts`), writes to PostgreSQL. No change.

#### fulfillPurchase -- hold consumption + receipt creation

```typescript
// BEFORE: Everything inside MongoDB withTransaction
await withTransaction(async (session) => {
  const consumed = await AtlasTicketHoldModel.findOneAndUpdate(
    { hold_id: holdId, challenge_id: challengeId, agent_id: agentId, status: 'pending', expires_at: { $gt: new Date() } },
    { status: 'consumed' },
    { new: true, session },
  );
  const [payment] = await NewPaymentModel.create([{ ... }], { session });
  const tickets = await TicketModel.create([...], { session });
  await EventTicketTypeModel.updateOne({ ... }, { ... }, { session });
  const [receipt] = await AtlasReceiptModel.create([{ ... }], { session });
});

// AFTER: Hold + receipt in PostgreSQL, tickets/payment still MongoDB (for now)
// Step 1: Consume hold in PostgreSQL
const consumed = await db.oneOrNone(
  `UPDATE atlas.ticket_holds SET status = 'consumed', updated_at = NOW()
   WHERE hold_id = $1 AND challenge_id = $2 AND agent_id = $3
     AND status = 'pending' AND expires_at > NOW()
   RETURNING *`,
  [holdId, challengeId, agentId],
);
if (!consumed) throw new AtlasError('HOLD_NOT_FOUND', 'Hold expired or already consumed');

// Step 2: MongoDB transaction for tickets + payment (stays until Ticket/Payment RDS migration)
await withTransaction(async (session) => {
  const [payment] = await NewPaymentModel.create([{ ... }], { session });
  const tickets = await TicketModel.create([...], { session });
  await EventTicketTypeModel.updateOne({ ... }, { ... }, { session });
  // receipt is NO LONGER created here
});

// Step 3: Insert receipt into PostgreSQL
const receipt = await db.one(
  `INSERT INTO atlas.receipts (
    receipt_id, status, event_id, event_name, agent_id, payment_id,
    ticket_ids, total_charged, currency, payment_method,
    transaction_hash, stripe_payment_intent, idempotency_key, vc_tickets
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  RETURNING *`,
  [
    receiptId, 'confirmed', event._id.toHexString(), event.title,
    agentId, payment._id.toHexString(),
    ticketIds.map(id => id.toHexString()), totalCharged, currency, paymentMethod,
    transactionHash ?? null, stripePaymentIntent ?? null,
    idempotencyKey, JSON.stringify(vcTickets),
  ],
);
```

**Failure modes:**
- If hold consumption succeeds but MongoDB transaction fails: hold is orphaned (harmless -- 5-minute reservation). Idempotency key prevents double-consumption.
- If MongoDB transaction succeeds but receipt insert fails: tickets exist without receipt. The reconciliation job (`atlas-fee-reconciliation.ts`) detects orphaned payments and logs them. Receipt can be retried.
- After Tickets/Payments complete RDS migration: Steps 1-3 collapse into a single `db.tx()` with full atomicity.

### 5.8 atlas/ticket-hold.ts

Source: `lemonade-backend/src/app/services/atlas/ticket-hold.ts`

AtlasTicketHold moves to PostgreSQL. Simple INSERT/UPDATE/DELETE with string lookups.

```typescript
// BEFORE: Mongoose countDocuments + create + findOneAndUpdate
const agentHolds = await AtlasTicketHoldModel.countDocuments({
  agent_id: agentId, event_id: eventId, status: 'pending', expires_at: { $gt: new Date() },
});

const [hold] = await AtlasTicketHoldModel.create([{ ...holdData }]);

const consumed = await AtlasTicketHoldModel.findOneAndUpdate(
  { hold_id: holdId, challenge_id: challengeId, agent_id: agentId, status: 'pending', expires_at: { $gt: new Date() } },
  { status: 'consumed' },
  { new: true },
);

// AFTER
const { count } = await db.one<{ count: number }>(
  `SELECT COUNT(*)::INT AS count FROM atlas.ticket_holds
   WHERE agent_id = $1 AND event_id = $2 AND status = 'pending' AND expires_at > NOW()`,
  [agentId, eventId],
);

const hold = await db.one(
  `INSERT INTO atlas.ticket_holds (
    hold_id, challenge_id, event_id, ticket_type_id, quantity,
    agent_id, idempotency_key, total_price_usd, protocol_fee_cents,
    subtotal_cents, attendee_info, discount_codes, ip_address,
    payment_recipient_addresses, status, expires_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
  RETURNING *`,
  [holdId, challengeId, eventId, ticketTypeId, quantity, agentId, idempotencyKey,
   totalPriceUsd, protocolFeeCents.toString(), subtotalCents.toString(),
   JSON.stringify(attendeeInfo), discountCodes ?? null, ipAddress ?? null,
   paymentRecipientAddresses ? JSON.stringify(paymentRecipientAddresses) : null,
   'pending', expiresAt],
);

const consumed = await db.oneOrNone(
  `UPDATE atlas.ticket_holds SET status = 'consumed', updated_at = NOW()
   WHERE hold_id = $1 AND challenge_id = $2 AND agent_id = $3
     AND status = 'pending' AND expires_at > NOW()
   RETURNING *`,
  [holdId, challengeId, agentId],
);
```

### 5.9 atlas-process-fee.ts (job)

Source: `lemonade-backend/src/app/jobs/atlas-process-fee.ts`

No changes needed in the job file itself. It delegates to `AtlasFee.processAtlasFee()` which is rewritten above. The job handler only converts string IDs to ObjectIds before calling the service.

### 5.10 atlas-hold-expiry.ts (job)

Source: `lemonade-backend/src/app/jobs/atlas-hold-expiry.ts`

No changes needed in the job handler itself. Delegates to `transitionExpiredPaidHolds()` and `transitionExpiredFreeHolds()` which are rewritten above.

[FIX-5] This job handles three things:
1. **Expired ticket hold cleanup** -- AtlasTicketHold is now PostgreSQL. Add a DELETE step that replaces the MongoDB TTL index. Runs as part of this job, deletes in batches of 1000:
   ```typescript
   // Clean up consumed/expired holds older than 24 hours, in batches of 1000
   let deleted = 0;
   do {
     const result = await db.result(
       `DELETE FROM atlas.ticket_holds
        WHERE id IN (
          SELECT id FROM atlas.ticket_holds
          WHERE expires_at < NOW() - INTERVAL '24 hours'
            AND status IN ('expired', 'consumed')
          LIMIT 1000
        )`,
     );
     deleted = result.rowCount;
   } while (deleted === 1000);
   ```
2. **Fee distribution hold transitions** (pending_hold -> available) -- calls `transitionExpiredPaidHolds()` (rewritten in Section 5.6)
3. **Free ticket reward hold transitions** -- calls `transitionExpiredFreeHolds()` (rewritten in Section 5.6)

### 5.11 atlas-fee-reconciliation.ts (job)

Source: `lemonade-backend/src/app/jobs/atlas-fee-reconciliation.ts`

```typescript
// BEFORE: Mongoose find for existing distributions
const existing = await AtlasFeeDistributionModel.find({ payment_id: { $in: paymentIds } }).distinct('payment_id');

// AFTER
const existing = await db.any<{ payment_id: string }>(
  `SELECT DISTINCT payment_id FROM atlas.fee_distributions WHERE payment_id = ANY($1)`,
  [paymentIds.map(id => id.toHexString())],
);
const existingSet = new Set(existing.map(r => r.payment_id));
```

Note: `NewPaymentModel.find()` stays on MongoDB since NewPayment is not migrated.

### 5.12 atlas-weekly-payout.ts (job)

Source: `lemonade-backend/src/app/jobs/atlas-weekly-payout.ts`

No changes needed. Delegates to `atlas-payout.ts` functions.

### 5.13 atlas-reward.ts (GraphQL resolver)

Source: `lemonade-backend/src/graphql/resolvers/atlas-reward.ts`

See Section 6 below.

---

## 6. GraphQL Resolver Updates

Source: `lemonade-backend/src/graphql/resolvers/atlas-reward.ts`

### atlasRewardSummary (line 72-80)

```typescript
// BEFORE
const [orgBalance, attBalance] = await Promise.all([
  AtlasRewardBalanceModel.findOne({ user: userId, space: spaceId, type: 'organizer' }).lean(),
  AtlasRewardBalanceModel.findOne({ user: userId, space: spaceId, type: 'attendee' }).lean(),
]);
const gmvDoc = await AtlasOrganizerMonthlyGmvModel.findOne({ user: userId, year, month }).lean();

// AFTER
const [orgBalance, attBalance, gmvDoc] = await Promise.all([
  db.oneOrNone(
    `SELECT * FROM atlas.reward_balances WHERE user_id = $1 AND space_id = $2 AND type = 'organizer'`,
    [userId.toHexString(), spaceId.toHexString()],
  ),
  db.oneOrNone(
    `SELECT * FROM atlas.reward_balances WHERE user_id = $1 AND space_id = $2 AND type = 'attendee'`,
    [userId.toHexString(), spaceId.toHexString()],
  ),
  db.oneOrNone(
    `SELECT * FROM atlas.organizer_monthly_gmv WHERE user_id = $1 AND year = $2 AND month = $3`,
    [userId.toHexString(), year, month],
  ),
]);
```

### atlasRewardHistory (line 126-133)

```typescript
// BEFORE
const fees = await AtlasFeeDistributionModel.find({
  space_id: spaceId,
  $or: [{ organizer_id: userId }, { attendee_id: userId }],
}).sort({ created_at: -1 }).skip(offset).limit(limit).lean();

// AFTER
const fees = await db.any(
  `SELECT * FROM atlas.fee_distributions
   WHERE space_id = $1 AND (organizer_id = $2 OR attendee_id = $2)
   ORDER BY created_at DESC
   OFFSET $3 LIMIT $4`,
  [spaceId.toHexString(), userId.toHexString(), offset, limit],
);
```

### atlasPayoutHistory (line 172-190)

```typescript
// BEFORE: Complex aggregate with $unwind
const items = await AtlasPayoutBatchModel.aggregate([
  { $match: { 'items.user': userId } },
  { $sort: { created_at: -1 } },
  { $unwind: '$items' },
  { $match: { 'items.user': userId } },
  { $skip: offset },
  { $limit: limit },
  { $project: { amount_usdc: '$items.amount_usdc', payout_method: '$items.payout_method', status: '$items.status', processed_at: '$items.processed_at', batch_period_start: '$period_start', batch_period_end: '$period_end' } },
]);

// AFTER: JSONB array unpacking with lateral join
const items = await db.any(
  `SELECT
     elem->>'amount_usdc' AS amount_usdc,
     elem->>'payout_method' AS payout_method,
     elem->>'status' AS status,
     elem->>'processed_at' AS processed_at,
     b.period_start AS batch_period_start,
     b.period_end AS batch_period_end
   FROM atlas.payout_batches b,
   LATERAL jsonb_array_elements(b.items) AS elem
   WHERE elem->>'user' = $1
   ORDER BY b.created_at DESC
   OFFSET $2 LIMIT $3`,
  [userId.toHexString(), offset, limit],
);
```

### atlasUpdatePayoutSettings (line 236-249)

This operates on `AtlasPayoutSettingsModel` which stays on MongoDB. No change needed.

### atlasGetPayoutSettings (line 262)

Stays on MongoDB. No change needed.

---

## 7. Test Updates

Source test files:
- `src/app/services/__tests__/atlas-fee.test.ts` (15 test cases)
- `src/app/services/__tests__/atlas-payout.test.ts` (15 test cases)
- `src/app/services/__tests__/atlas-referral.test.ts` (14 test cases)
- `src/app/services/__tests__/atlas-refund.test.ts` (12 test cases)
- `src/app/services/__tests__/atlas-free-ticket-reward.test.ts` (7 test cases)
- `src/app/jobs/__tests__/atlas-hold-expiry.test.ts` (8 test cases)
- `src/app/middlewares/__tests__/atlas-mpp.test.ts` (15 test cases, no DB changes needed)

### Mocking Strategy

The codebase already has a pattern for mocking PostgreSQL via pg-promise. From `src/app/services/__test__/credit.test.ts`, the Prisma client wrapper is stubbed. For Atlas, mock the `db` import directly.

#### Create a shared test helper

**New file:** `src/app/services/__tests__/helpers/atlas-db-mock.ts`

```typescript
import sinon from 'sinon';

export interface MockDb {
  one: sinon.SinonStub;
  oneOrNone: sinon.SinonStub;
  any: sinon.SinonStub;
  manyOrNone: sinon.SinonStub;
  none: sinon.SinonStub;
  result: sinon.SinonStub;
  tx: sinon.SinonStub;
}

export function createMockDb(sandbox: sinon.SinonSandbox): MockDb {
  const mockTx: MockDb = {
    one: sandbox.stub(),
    oneOrNone: sandbox.stub(),
    any: sandbox.stub(),
    manyOrNone: sandbox.stub(),
    none: sandbox.stub(),
    result: sandbox.stub(),
    tx: sandbox.stub(),
  };

  const mockDb: MockDb = {
    one: sandbox.stub(),
    oneOrNone: sandbox.stub(),
    any: sandbox.stub(),
    manyOrNone: sandbox.stub(),
    none: sandbox.stub(),
    result: sandbox.stub(),
    // tx calls the callback with the mock transaction object
    tx: sandbox.stub().callsFake(async (fn: (t: MockDb) => Promise<unknown>) => fn(mockTx)),
  };

  return mockDb;
}
```

#### Before/After migration comparison

```typescript
// BEFORE (Mongoose mock)
sandbox.stub(AtlasFeeDistributionModel, 'findOne').returns({
  lean: () => Promise.resolve(mockFee),
} as any);

// AFTER (pg-promise mock)
const mockDb = createMockDb(sandbox);
sandbox.stub(pgHelper, 'db').value(mockDb);

mockDb.oneOrNone
  .withArgs(sinon.match(/FROM atlas\.fee_distributions/), sinon.match.array)
  .resolves(mockFee);
```

#### Transaction mock pattern

```typescript
// BEFORE (Mongoose withTransaction)
sandbox.stub(dbHelper, 'withTransaction').callsFake(async (fn) => fn({}));

// AFTER (pg-promise tx)
// Already handled by createMockDb -- tx calls callback with mock transaction object
// Assertions check t.none, t.one, etc. were called with expected SQL
```

#### Test data shape changes

Mongoose documents have `_id` (ObjectId). PostgreSQL rows have `id` (UUID string). Update test fixtures:

```typescript
// BEFORE
const mockFee = {
  _id: new Types.ObjectId(),
  payment_id: paymentId,
  organizer_id: organizerId,
  gross_amount_usdc: '100000000',
  save: sandbox.stub().resolves(),
};

// AFTER
const mockFee = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  payment_id: paymentId.toHexString(),
  organizer_id: organizerId.toHexString(),
  gross_amount_usdc: '100000000',
  // No .save() needed -- updates are explicit SQL
};
```

### Complete test file example [FIX-10]

Below is a complete example showing how to migrate `atlas-free-ticket-reward.test.ts` (the simplest test file) to pg-promise mocking. Use this as the template for all other test files.

```typescript
import sinon from 'sinon';
import assert from 'assert';
import { Types } from 'mongoose';
import * as pgHelper from '../../helpers/pg';
import { createMockDb, MockDb } from './helpers/atlas-db-mock';

describe('processAtlasFreeTicketReward', () => {
  let sandbox: sinon.SinonSandbox;
  let mockDb: MockDb;
  let processAtlasFreeTicketReward: typeof import('../atlas-free-ticket-reward').processAtlasFreeTicketReward;

  const userId = new Types.ObjectId();
  const eventId = new Types.ObjectId();
  const spaceId = new Types.ObjectId();

  before(async () => {
    sandbox = sinon.createSandbox();
    mockDb = createMockDb(sandbox);
    sandbox.stub(pgHelper, 'db').value(mockDb);

    const mod = await import('../atlas-free-ticket-reward');
    processAtlasFreeTicketReward = mod.processAtlasFreeTicketReward;
  });

  afterEach(() => {
    sandbox.resetHistory();
  });

  after(() => {
    sandbox.restore();
  });

  it('should create attendee and organizer rewards when under caps', async () => {
    // Mock db.one for COUNT queries (3 calls: event count, attendee monthly, organizer monthly)
    mockDb.one
      .withArgs(sinon.match(/FROM atlas\.free_ticket_rewards/), sinon.match.array)
      .onFirstCall().resolves({ count: 0 })   // event reward count
      .onSecondCall().resolves({ count: 0 })   // attendee monthly count
      .onThirdCall().resolves({ count: 0 });   // organizer monthly count

    // Mock db.none for INSERT calls
    mockDb.none
      .withArgs(sinon.match(/INSERT INTO atlas\.free_ticket_rewards/), sinon.match.array)
      .resolves();

    await processAtlasFreeTicketReward({
      userId, eventId, spaceId,
      organizerId: new Types.ObjectId(),
      isFreeEvent: true,
    });

    // Verify 2 inserts (attendee + organizer reward)
    assert.strictEqual(
      mockDb.none.getCalls().filter(c => c.args[0].includes('INSERT INTO atlas.free_ticket_rewards')).length,
      2,
    );
  });

  it('should skip when event cap reached', async () => {
    mockDb.one
      .withArgs(sinon.match(/FROM atlas\.free_ticket_rewards/), sinon.match.array)
      .resolves({ count: 100 }); // at cap

    await processAtlasFreeTicketReward({
      userId, eventId, spaceId,
      organizerId: new Types.ObjectId(),
      isFreeEvent: true,
    });

    // No inserts
    assert.strictEqual(
      mockDb.none.getCalls().filter(c => c.args[0].includes('INSERT')).length,
      0,
    );
  });
});
```

**Key mocking patterns:**

- `db.oneOrNone()` -- use for single-row lookups that may return null:
  ```typescript
  mockDb.oneOrNone
    .withArgs(sinon.match(/FROM atlas\.reward_balances/), sinon.match.array)
    .resolves({ id: 'uuid', user_id: userId.toHexString(), accrued_usdc: '100000' });
  ```

- `db.result()` -- use for UPDATE/DELETE where you need rowCount:
  ```typescript
  mockDb.result
    .withArgs(sinon.match(/UPDATE atlas\.fee_distributions/), sinon.match.array)
    .resolves({ rowCount: 1, rows: [] });
  ```

- SQL regex matching with `sinon.match(/pattern/)` is acceptable for test isolation. Match on the table name, not the full query. This decouples tests from exact SQL formatting.

### atlas-mpp.test.ts

No changes needed. Tests pure functions that build 402 challenge responses. No database operations.

---

## 8. Migration from Existing MongoDB Data

Atlas has not launched. All MongoDB data is from development/testing only.

**Recommendation: Drop, do not migrate.**

```bash
# On staging MongoDB, after PostgreSQL migration is deployed:
# All 10 Atlas collections moved to PostgreSQL. Drop all.
use lemonade_staging;
db.atlas_ticket_holds.drop();
db.atlas_receipts.drop();
db.atlas_fee_distributions.drop();
db.atlas_reward_balances.drop();
db.atlas_organizer_monthly_gmvs.drop();
db.atlas_dust_pools.drop();
db.atlas_payout_batches.drop();
db.atlas_referrals.drop();
db.atlas_refunds.drop();
db.atlas_free_ticket_rewards.drop();
```

If data preservation is needed for any reason (unlikely), a one-time migration script can read each MongoDB collection and insert into the corresponding PostgreSQL table with type conversions:

```typescript
// Example pattern (only if needed)
const holds = await AtlasTicketHoldModel.find().lean();
for (const hold of holds) {
  await db.none(
    `INSERT INTO atlas.ticket_holds (...) VALUES (...)`,
    [/* map MongoDB fields to PostgreSQL columns */],
  );
}
```

---

## 9. Transaction Handling

### Pattern Conversion

```typescript
// BEFORE: Mongoose withTransaction
import { withTransaction } from '../helpers/db';
await withTransaction(async (session: ClientSession) => {
  await Model.create([data], { session });
  await Model.updateOne(filter, update, { session });
});

// AFTER: pg-promise transaction
import { db } from '../helpers/pg';
await db.tx(async (t) => {
  await t.none('INSERT INTO atlas.table (...) VALUES (...)', [params]);
  await t.none('UPDATE atlas.table SET ... WHERE ...', [params]);
});
```

Key differences:
- `db.tx()` provides the transaction context object `t`. All queries inside use `t.none()`, `t.one()`, etc.
- If any query throws, the entire transaction rolls back automatically.
- No need to pass a session parameter to each operation.
- `t.result()` returns `{ rowCount, rows }` for checking affected row count.

Reference: `lemonade-backend/src/app/helpers/pg-migrate.ts:50-53` for existing transaction usage.

### Mixed MongoDB + PostgreSQL transactions

The purchase flow currently spans two databases:

1. **PostgreSQL** -- hold consumption + receipt creation (atlas.ticket_holds, atlas.receipts)
2. **MongoDB** -- ticket creation, payment, ticket type count updates (Ticket, NewPayment, EventTicketType -- all in `withTransaction`)

These cannot share a transaction today. The sequence is: consume hold (PG) -> create tickets/payment (MongoDB) -> insert receipt (PG). See Section 5.7 for failure modes and idempotency guarantees.

**After Tickets and Payments complete their RDS migration:** the entire purchase flow collapses into a single `db.tx()`. Hold consumption, ticket creation, payment recording, and receipt creation all become one atomic PostgreSQL transaction. This is the target end state.

The financial processing (fee distribution, balance credits, GMV tracking) happens asynchronously via the Agenda job `atlas-process-fee.ts`, which writes to PostgreSQL. If the fee job fails, `atlas-fee-reconciliation.ts` catches missing distributions within 48 hours and retries.

`atlas-hold-transition.ts` operates entirely within PostgreSQL (reads fee_distributions, writes reward_balances/GMV). This is fully within a single `db.tx()` transaction.

---

## 10. What Does NOT Change

| Component | Reason |
|---|---|
| Atlas REST router (`src/app/routers/atlas/`) | Calls services, not models. Services are rewritten but the router interface stays the same. |
| Atlas controllers | Same as routers. Call service functions that return the same shapes. |
| Atlas MCP tools in lemonade-ai | Call backend REST endpoints. Backend returns same JSON. |
| Atlas frontend in web-new | Calls GraphQL/REST. No database awareness. |
| ExternalEventMapping model | MongoDB. Phase 1 non-financial connector model. |
| Connection model atlas fields | MongoDB. Core model with atlas connector extensions. |
| AtlasAgentRegistration | Already in atlas-registry PostgreSQL. |
| AtlasPayoutSettings | MongoDB. Small config document, read-only in financial flows. |
| AtlasReferralCode | MongoDB. Small lookup document. |
| Atlas registry service | Already PostgreSQL (separate Fastify service with its own database). |
| Agenda job definitions | Job handlers delegate to services. Job scheduling/registration unchanged. |
| Redis caching (rate limits, Stripe validation cache) | Unchanged. Redis operations in ticket-hold.ts and payout.ts stay the same. |
| GraphQL type definitions (ObjectTypes, InputTypes) | The TypeGraphQL decorators can stay on the Mongoose model files or be moved to standalone type files. The field names exposed to GraphQL remain the same. |

---

## Execution Status

| Task | Status | Agent |
|---|---|---|
| IMPL document | Complete | -- |
| Migration SQL files (3 files) | Not started | -- |
| atlas-fee.ts rewrite | Not started | -- |
| atlas-payout.ts rewrite | Not started | -- |
| atlas-referral.ts rewrite | Not started | -- |
| atlas-refund.ts rewrite | Not started | -- |
| atlas-free-ticket-reward.ts rewrite | Not started | -- |
| atlas-hold-transition.ts rewrite | Not started | -- |
| atlas/purchase.ts rewrite (hold + receipt to PG) | Not started | -- |
| atlas/ticket-hold.ts rewrite | Not started | -- |
| atlas-hold-expiry.ts rewrite (add PG cleanup) | Not started | -- |
| atlas-fee-reconciliation.ts rewrite | Not started | -- |
| atlas-reward.ts resolver rewrite | Not started | -- |
| Test updates (6 files, excludes atlas-mpp) | Not started | -- |
| Delete Mongoose model files (10 files) | Not started | -- |
| MongoDB collection drops (10 collections, staging) | Not started | -- |
