# IMPL-PHASE-3: Atlas Registry Service

**Type:** Implementation Handover
**Status:** AUDIT FIXES APPLIED (R1+R2+R3+R4) — READY FOR LEAD ROUTING
**Date:** 2026-03-19
**Author:** Bridge Agent
**Target:** New greenfield Fastify service (`atlas-registry`)
**Depends on:** Phase 2 (Atlas router in lemonade-backend providing per-Space endpoints)

---

## Executive Summary

Build the Atlas Registry as a standalone Fastify service that provides federated search across all Atlas-compliant Spaces. The Registry indexes Lemonade Spaces at launch and is architected to index external Atlas-compliant endpoints from day one. It fans out search queries to indexed Space `/atlas/v1/search` endpoints, merges and ranks results, and exposes both REST and MCP interfaces for agent discovery.

**Key architectural decisions (non-negotiable):**
- Separate Fastify service -- NOT in lemonade-backend. Must scale independently.
- PostgreSQL for structured data (spaces index, query logs, health checks, referrals)
- Redis for search result caching (60s TTL)
- `source_type` field on all indexed spaces: `'lemonade_space' | 'external_platform'`
- All payments in USDC -- no custom tokens
- 2% protocol fee with 40/30/20/10 split (treasury/organizer/attendee/referral)

---

## 1. Project Structure

```
atlas-registry/
  src/
    app/
      index.ts                    # Fastify app creation + plugin registration
      plugins/
        mcp.ts                    # MCP server plugin (registry tools)
        health.ts                 # Liveness/readiness probes
        metrics.ts                # Prometheus metrics
      routes/
        search.ts                 # GET /atlas/v1/search (federated)
        organizers.ts             # GET /atlas/v1/organizers/:id, manifest
        register.ts              # POST /atlas/v1/register (admin)
        agents.ts                 # POST /atlas/v1/agents/register, key mgmt
        reports.ts                # POST /atlas/v1/report (E14: Space reporting)
        health.ts                 # GET /atlas/v1/health
      services/
        indexer.ts                # Space indexing (Lemonade + external)
        federated-search.ts       # Fan-out, merge, rank
        health-checker.ts         # Periodic manifest validation
        referral-tracker.ts       # atlas-ref attribution (+ E9 self-referral check)
        deduplication.ts          # E8 search result deduplication (token Jaccard + geo)
        report-service.ts         # E14 Space report handling + auto-delist
        agent-registry.ts         # Agent API key issuance + validation
        relevance.ts              # Scoring algorithm
        cache.ts                  # Redis caching layer
      models/
        types.ts                  # All TypeScript interfaces
      helpers/
        db.ts                     # PostgreSQL connection (pg + Knex)
        redis.ts                  # Redis connection (ioredis)
        logger.ts                 # Pino logger
        http-client.ts            # Axios/undici for fan-out requests
        rate-limiter.ts           # Per-agent rate limiting
    config/
      index.ts                    # env-var configuration
    bin/
      app.ts                      # Entry point
      migrate.ts                  # Knex migrations runner
  migrations/
    001_create_spaces_index.ts
    002_create_health_checks.ts
    003_create_query_logs.ts
    004_create_referral_transactions.ts
    005_create_organizer_profiles.ts
    006_create_agent_registrations.ts
    007_create_external_event_index.ts   # E1: duplicate external event detection
    008_create_space_reports.ts          # E14: Space report mechanism
    009_create_space_name_index.ts       # E14: naming collision detection
  knexfile.ts
  package.json
  tsconfig.json
  Dockerfile
  k8s/
    deployment.yaml
    service.yaml
    configmap.yaml
    hpa.yaml
```

---

## 2. Dependencies

```json
{
  "name": "atlas-registry",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": "22" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/bin/app.js",
    "start:dev": "ts-node-dev --transpile-only src/bin/app.ts",
    "migrate": "knex migrate:latest",
    "migrate:rollback": "knex migrate:rollback",
    "migrate:make": "knex migrate:make",
    "test": "mocha -r ts-node/register 'src/**/*.test.ts'"
  },
  "dependencies": {
    "fastify": "^4.24.3",
    "@fastify/cors": "^8.4.2",
    "@fastify/rate-limit": "^9.1.0",
    "@modelcontextprotocol/sdk": "^1.25.1",
    "knex": "^3.1.0",
    "pg": "^8.18.0",
    "ioredis": "^5.3.2",
    "pino": "^8.16.2",
    "undici": "^6.19.0",
    "zod": "^3.22.4",
    "uuid": "^9.0.0",
    "cron": "^3.1.0",
    "prom-client": "^15.0.0",
    "env-var": "^7.4.1"
  },
  "devDependencies": {
    "typescript": "^5.3.2",
    "@types/node": "^22.0.0",
    "@types/mocha": "^10.0.6",
    "mocha": "^10.2.0",
    "ts-node-dev": "^2.0.0"
  }
}
```

**Why these choices:**
- `knex` for PostgreSQL migrations + query builder (no ORM overhead for this service's simple relational data)
- `undici` for high-performance HTTP fan-out (Node.js native HTTP client, faster than axios for parallel requests)
- `cron` for scheduled indexing/health checks
- `zod` v3 (not v4) -- simpler, no MCP SDK compatibility issues
- `@fastify/rate-limit` -- built-in per-agent rate limiting

---

## 3. Configuration

```typescript
// src/config/index.ts
import env from 'env-var';

export const port = env.get('PORT').default(3100).asPortNumber();
export const host = env.get('HOST').default('0.0.0.0').asString();

// PostgreSQL
export const databaseUrl = env.get('DATABASE_URL').required().asString();

// Redis
export const redisUrl = env.get('REDIS_URL').required().asString();

// Service URLs
export const lemonadeBackendUrl = env.get('LEMONADE_BACKEND_URL').required().asString();
export const lemonadeBackendInternalUrl = env.get('LEMONADE_BACKEND_INTERNAL_URL')
  .default('').asString(); // K8s internal service URL for indexer

// Registry
export const registryBaseUrl = env.get('REGISTRY_BASE_URL')
  .default('https://registry.atlas-protocol.org').asString();
export const indexIntervalMinutes = env.get('INDEX_INTERVAL_MINUTES').default(15).asIntPositive();
export const healthCheckIntervalMinutes = env.get('HEALTH_CHECK_INTERVAL_MINUTES')
  .default(15).asIntPositive();

// Federated search
export const searchTimeoutMs = env.get('SEARCH_TIMEOUT_MS').default(3000).asIntPositive();
export const searchCacheTtlSeconds = env.get('SEARCH_CACHE_TTL_SECONDS').default(60).asIntPositive();
export const maxFanoutConcurrency = env.get('MAX_FANOUT_CONCURRENCY').default(20).asIntPositive();

// Rate limiting
export const searchRateLimit = env.get('SEARCH_RATE_LIMIT_PER_MIN').default(100).asIntPositive();
export const purchaseRateLimit = env.get('PURCHASE_RATE_LIMIT_PER_MIN').default(10).asIntPositive();

// Admin
export const adminApiKey = env.get('ADMIN_API_KEY').required().asString();

// MCP / OAuth
export const applicationUrl = env.get('APPLICATION_URL').required().asString();
```

**Environment variables summary:**

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PORT` | No | 3100 | HTTP port |
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `REDIS_URL` | Yes | -- | Redis connection string |
| `LEMONADE_BACKEND_URL` | Yes | -- | Backend API for indexing Lemonade Spaces |
| `LEMONADE_BACKEND_INTERNAL_URL` | No | -- | K8s internal URL (faster indexing) |
| `REGISTRY_BASE_URL` | No | `https://registry.atlas-protocol.org` | Public URL of this service |
| `INDEX_INTERVAL_MINUTES` | No | 15 | Re-index frequency |
| `HEALTH_CHECK_INTERVAL_MINUTES` | No | 15 | Health check frequency |
| `SEARCH_TIMEOUT_MS` | No | 3000 | Per-Space search timeout |
| `SEARCH_CACHE_TTL_SECONDS` | No | 60 | Redis cache TTL for search results |
| `MAX_FANOUT_CONCURRENCY` | No | 20 | Max parallel search fan-out |
| `SEARCH_RATE_LIMIT_PER_MIN` | No | 100 | Rate limit per Atlas-Agent-Id |
| `PURCHASE_RATE_LIMIT_PER_MIN` | No | 10 | Rate limit per Atlas-Agent-Id |
| `ADMIN_API_KEY` | Yes | -- | Admin API authentication |
| `APPLICATION_URL` | Yes | -- | Public URL for MCP OAuth metadata |

---

## 4. PostgreSQL Schema

### 4.1 spaces_index

```sql
CREATE TABLE spaces_index (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source discrimination
  source_type     VARCHAR(32) NOT NULL CHECK (source_type IN ('lemonade_space', 'external_platform')),

  -- Lemonade-specific (NULL for external)
  lemonade_space_id   VARCHAR(64),           -- MongoDB ObjectId string from lemonade-backend
  lemonade_space_slug VARCHAR(128),

  -- Common fields
  name            VARCHAR(256) NOT NULL,
  description     TEXT,
  base_url        VARCHAR(512) NOT NULL,     -- e.g., https://myspace.lemonade.social
  atlas_endpoint  VARCHAR(512) NOT NULL,     -- e.g., https://myspace.lemonade.social/atlas/v1/search
  manifest_url    VARCHAR(512) NOT NULL,     -- e.g., https://myspace.lemonade.social/.well-known/atlas.json

  -- Manifest snapshot
  atlas_version   VARCHAR(16),
  capabilities    JSONB NOT NULL DEFAULT '{}',
  payment_methods TEXT[] NOT NULL DEFAULT '{}',
  signing_keys    JSONB NOT NULL DEFAULT '[]',

  -- Health
  status          VARCHAR(32) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'unhealthy', 'inactive', 'pending_validation', 'removed')),
  last_health_check   TIMESTAMPTZ,
  last_health_status  VARCHAR(32),
  consecutive_failures INT NOT NULL DEFAULT 0,

  -- Metadata
  logo_url        VARCHAR(512),
  contact_email   VARCHAR(256),
  event_count     INT NOT NULL DEFAULT 0,    -- cached count from last index

  -- Geographic center (for coarse pre-filtering before fan-out)
  primary_lat     DECIMAL(9, 6),             -- latitude of Space's primary location
  primary_lng     DECIMAL(9, 6),             -- longitude of Space's primary location

  -- Owner (for self-referral detection — E9)
  owner_user_id   VARCHAR(64),                -- Lemonade user ID of Space owner (populated during indexing)
  -- > **AUDIT FIX R4 [FT-4]:** Self verification identity for cross-identity checks (SV-2)
  owner_self_verified_identity_id VARCHAR(128), -- Self.xyz verified identity ID of Space owner (NULL if unverified)

  -- > **AUDIT FIX R4 [FT-4]:** Paid event ratio tracking for relevance scoring penalty
  paid_event_count INT NOT NULL DEFAULT 0,     -- count of paid events (ticket price > 0) at last index
  total_event_count INT NOT NULL DEFAULT 0,    -- total event count at last index

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_indexed_at TIMESTAMPTZ,

  -- Constraints
  UNIQUE (base_url),
  UNIQUE (lemonade_space_id)
);

CREATE INDEX idx_spaces_source_type ON spaces_index(source_type);
CREATE INDEX idx_spaces_status ON spaces_index(status);
CREATE INDEX idx_spaces_lemonade_space_id ON spaces_index(lemonade_space_id) WHERE lemonade_space_id IS NOT NULL;
```

### 4.2 health_checks

```sql
CREATE TABLE health_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        UUID NOT NULL REFERENCES spaces_index(id) ON DELETE CASCADE,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          VARCHAR(32) NOT NULL CHECK (status IN ('healthy', 'unhealthy', 'timeout', 'invalid_manifest', 'http_error')),
  http_status     INT,
  response_time_ms INT,
  error_message   TEXT,
  manifest_valid  BOOLEAN,

  -- Partition by month for cleanup
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_health_checks_space_id ON health_checks(space_id, checked_at DESC);
CREATE INDEX idx_health_checks_created_at ON health_checks(created_at);
```

### 4.3 query_logs

```sql
CREATE TABLE query_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        VARCHAR(128),              -- Atlas-Agent-Id header
  query_text      VARCHAR(256),
  query_params    JSONB NOT NULL DEFAULT '{}',
  total_results   INT NOT NULL DEFAULT 0,
  spaces_queried  INT NOT NULL DEFAULT 0,
  spaces_responded INT NOT NULL DEFAULT 0,
  response_time_ms INT NOT NULL,
  cache_hit       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_query_logs_created_at ON query_logs(created_at);
CREATE INDEX idx_query_logs_agent_id ON query_logs(agent_id) WHERE agent_id IS NOT NULL;
```

### 4.4 referral_transactions

```sql
CREATE TABLE referral_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Attribution
  atlas_ref           VARCHAR(128) NOT NULL,       -- atlas-ref parameter value
  source_space_id     UUID REFERENCES spaces_index(id),  -- where the event was discovered
  target_space_id     UUID REFERENCES spaces_index(id),  -- where the purchase happened
  agent_id            VARCHAR(128),

  -- Transaction
  event_id            VARCHAR(128) NOT NULL,       -- Atlas event ID
  receipt_id          VARCHAR(128),                -- Atlas receipt ID
  transaction_amount  DECIMAL(12, 6) NOT NULL,     -- total purchase amount (USDC)
  referral_fee        DECIMAL(12, 6) NOT NULL,     -- 2% protocol fee from cross-Space discovery
  fee_split           JSONB NOT NULL DEFAULT '{}', -- breakdown: treasury, organizer_cashback, attendee_cashback, referral

  -- Status
  status              VARCHAR(32) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'confirmed', 'settled', 'disputed', 'refunded', 'self_referral_blocked')),
  review_flags        JSONB NOT NULL DEFAULT '[]',  -- F-2: heuristic flags for manual review (e.g. 'same_registration_ip', 'accounts_registered_within_1h')
  settled_at          TIMESTAMPTZ,

  -- Timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referral_atlas_ref ON referral_transactions(atlas_ref);
CREATE INDEX idx_referral_source_space ON referral_transactions(source_space_id);
CREATE INDEX idx_referral_status ON referral_transactions(status);
```

### 4.5 organizer_profiles

```sql
CREATE TABLE organizer_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atlas_organizer_id  VARCHAR(128) NOT NULL UNIQUE,  -- UUID v7

  -- Identity
  name                VARCHAR(128) NOT NULL,
  email               VARCHAR(256),
  avatar_url          VARCHAR(512),
  bio                 TEXT,
  website             VARCHAR(512),

  -- Verification
  verification_level  VARCHAR(32) NOT NULL DEFAULT 'unverified'
                      CHECK (verification_level IN ('unverified', 'connected', 'verified', 'trusted')),

  -- Connected accounts (from OAuth -- stored as JSONB array)
  connected_accounts  JSONB NOT NULL DEFAULT '[]',
  -- Each element: { platform, platform_user_id, platform_username, connected_at, oauth_valid, last_sync, event_count }

  -- Aggregated stats
  total_events        INT NOT NULL DEFAULT 0,
  active_events       INT NOT NULL DEFAULT 0,
  total_tickets_sold  INT NOT NULL DEFAULT 0,
  total_revenue_usdc  DECIMAL(14, 6) NOT NULL DEFAULT 0,
  total_rewards_earned_usdc DECIMAL(14, 6) NOT NULL DEFAULT 0,
  disputes            INT NOT NULL DEFAULT 0,

  -- Payout
  payout_address      VARCHAR(128),
  stripe_connected_account_id VARCHAR(128),

  -- Timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizer_atlas_id ON organizer_profiles(atlas_organizer_id);
CREATE INDEX idx_organizer_verification ON organizer_profiles(verification_level);
```

### 4.6 agent_registrations

```sql
CREATE TABLE agent_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atlas_agent_id  VARCHAR(128) NOT NULL UNIQUE,  -- agt_ prefixed UUID v7
  name            VARCHAR(256) NOT NULL,
  description     TEXT,
  api_key_hash    VARCHAR(256) NOT NULL,        -- bcrypt hash of API key
  api_key_prefix  VARCHAR(16) NOT NULL,         -- first 8 chars for identification

  -- Permissions
  scopes          TEXT[] NOT NULL DEFAULT '{search}',  -- search, purchase, admin

  -- Rate limiting
  search_rate_limit   INT NOT NULL DEFAULT 100,   -- per minute
  purchase_rate_limit INT NOT NULL DEFAULT 10,    -- per minute

  -- Status
  status          VARCHAR(32) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended', 'revoked')),
  last_used_at    TIMESTAMPTZ,
  request_count   BIGINT NOT NULL DEFAULT 0,

  -- Owner (for self-referral detection — E9)
  owner_user_id   VARCHAR(64),                -- Lemonade user ID of agent's registered owner
  -- > **AUDIT FIX R4 [SV-2]:** Self.xyz identity for cross-identity referral comparison
  owner_self_verified_identity_id VARCHAR(128), -- Self.xyz verified identity ID of agent owner (NULL if unverified)

  -- Key rotation
  key_created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  key_expires_at  TIMESTAMPTZ,                 -- NULL = no expiry (but protocol recommends 90-day rotation)

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_atlas_id ON agent_registrations(atlas_agent_id);
CREATE INDEX idx_agent_api_key_prefix ON agent_registrations(api_key_prefix);
CREATE INDEX idx_agent_status ON agent_registrations(status);
```

> **AUDIT FIX R2 [E14]:** Added `space_reports` table for the report mechanism, and
> `space_name_index` table for naming collision detection. Organizers who connect real
> platform accounts via OAuth get `verified: true` (tracked via `verification_level`
> in `organizer_profiles` — already present). The report mechanism allows agents/users
> to flag suspicious Spaces; after N reports, the Space is temporarily de-listed
> pending manual review.

### 4.7 space_reports (E14: Shadow Space impersonation prevention)

```sql
-- Migration: 008_create_space_reports.ts
CREATE TABLE space_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        UUID NOT NULL REFERENCES spaces_index(id) ON DELETE CASCADE,
  reporter_type   VARCHAR(32) NOT NULL CHECK (reporter_type IN ('agent', 'user')),
  reporter_id     VARCHAR(128) NOT NULL,       -- atlas_agent_id or lemonade user_id
  reason          VARCHAR(64) NOT NULL CHECK (reason IN ('impersonation', 'fake_events', 'scam', 'spam', 'other')),
  description     TEXT,
  status          VARCHAR(32) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'investigating', 'confirmed', 'dismissed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     VARCHAR(128)                 -- admin who resolved
);

CREATE INDEX idx_space_reports_space_id ON space_reports(space_id, status);
CREATE INDEX idx_space_reports_status ON space_reports(status);
-- Prevent duplicate reports from same reporter on same space
CREATE UNIQUE INDEX idx_space_reports_unique_reporter ON space_reports(space_id, reporter_id) WHERE status = 'pending';
```

### 4.8 space_name_index (E14: Naming collision detection)

```sql
-- Migration: 009_create_space_name_index.ts
-- Stores normalized Space names for fast Levenshtein comparison during indexing
CREATE TABLE space_name_index (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        UUID NOT NULL REFERENCES spaces_index(id) ON DELETE CASCADE,
  normalized_name VARCHAR(256) NOT NULL,       -- lowercase, stripped punctuation
  primary_lat     DECIMAL(9, 6),               -- for geographic region matching
  primary_lng     DECIMAL(9, 6),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_space_name_normalized ON space_name_index(normalized_name);
CREATE INDEX idx_space_name_space_id ON space_name_index(space_id);
```

---

## 5. TypeScript Interfaces

```typescript
// src/app/models/types.ts

// ─── Source Type Discriminator ───────────────────────────────────────────────

export type SourceType = 'lemonade_space' | 'external_platform';

export type SpaceStatus = 'active' | 'unhealthy' | 'inactive' | 'pending_validation' | 'removed';

export type HealthCheckStatus = 'healthy' | 'unhealthy' | 'timeout' | 'invalid_manifest' | 'http_error';

export type ReferralStatus = 'pending' | 'confirmed' | 'settled' | 'disputed' | 'refunded' | 'self_referral_blocked';

export type VerificationLevel = 'unverified' | 'connected' | 'verified' | 'trusted';

export type AgentStatus = 'active' | 'suspended' | 'revoked';

// ─── Spaces Index ────────────────────────────────────────────────────────────

export interface IndexedSpace {
  id: string;
  source_type: SourceType;
  lemonade_space_id: string | null;
  lemonade_space_slug: string | null;
  name: string;
  description: string | null;
  base_url: string;
  atlas_endpoint: string;
  manifest_url: string;
  atlas_version: string | null;
  capabilities: AtlasCapabilities;
  payment_methods: string[];
  signing_keys: object[];
  status: SpaceStatus;
  last_health_check: Date | null;
  last_health_status: HealthCheckStatus | null;
  consecutive_failures: number;
  logo_url: string | null;
  contact_email: string | null;
  event_count: number;
  owner_user_id: string | null;    // E9: Space owner for self-referral detection
  owner_self_verified_identity_id: string | null; // R4 SV-2: Self.xyz identity for cross-identity referral check
  paid_event_count: number;        // R4 FT-4: count of paid events for relevance scoring
  total_event_count: number;       // R4 FT-4: total events for paid_event_ratio calculation
  created_at: Date;
  updated_at: Date;
  last_indexed_at: Date | null;
}

export interface AtlasCapabilities {
  discovery: boolean;
  purchase: boolean;
  refund: boolean;
  holds: boolean;
  oauth_connect: boolean;
  webhooks?: boolean;
}

// ─── Health Check ────────────────────────────────────────────────────────────

export interface HealthCheckRecord {
  id: string;
  space_id: string;
  checked_at: Date;
  status: HealthCheckStatus;
  http_status: number | null;
  response_time_ms: number | null;
  error_message: string | null;
  manifest_valid: boolean | null;
}

// ─── Query Log ───────────────────────────────────────────────────────────────

export interface QueryLog {
  id: string;
  agent_id: string | null;
  query_text: string | null;
  query_params: Record<string, unknown>;
  total_results: number;
  spaces_queried: number;
  spaces_responded: number;
  response_time_ms: number;
  cache_hit: boolean;
  created_at: Date;
}

// ─── Referral Transaction ────────────────────────────────────────────────────

export interface FeeSplit {
  treasury: number;           // 40% of 2% = 0.80%
  organizer_cashback: number; // 30% of 2% = 0.60%
  attendee_cashback: number;  // 20% of 2% = 0.40%
  referral: number;           // 10% of 2% = 0.20%
}

export interface ReferralTransaction {
  id: string;
  atlas_ref: string;
  source_space_id: string | null;
  target_space_id: string | null;
  agent_id: string | null;
  event_id: string;
  receipt_id: string | null;
  transaction_amount: number;
  referral_fee: number;
  fee_split: FeeSplit;
  status: ReferralStatus;
  settled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Organizer Profile ───────────────────────────────────────────────────────

export interface ConnectedAccount {
  platform: string;
  platform_user_id: string;
  platform_username: string | null;
  connected_at: string;      // ISO 8601
  oauth_valid: boolean;
  last_sync: string;         // ISO 8601
  event_count: number;
}

export interface OrganizerProfile {
  id: string;
  atlas_organizer_id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  bio: string | null;
  website: string | null;
  verification_level: VerificationLevel;
  connected_accounts: ConnectedAccount[];
  total_events: number;
  active_events: number;
  total_tickets_sold: number;
  total_revenue_usdc: number;
  total_rewards_earned_usdc: number;
  disputes: number;
  payout_address: string | null;
  stripe_connected_account_id: string | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Agent Registration ──────────────────────────────────────────────────────

export type AgentScope = 'search' | 'purchase' | 'admin';

export interface AgentRegistration {
  id: string;
  atlas_agent_id: string;
  name: string;
  description: string | null;
  api_key_hash: string;
  api_key_prefix: string;
  scopes: AgentScope[];
  search_rate_limit: number;
  purchase_rate_limit: number;
  status: AgentStatus;
  last_used_at: Date | null;
  request_count: number;
  owner_user_id: string | null;    // E9: agent owner for self-referral detection
  owner_self_verified_identity_id: string | null; // R4 SV-2: Self.xyz identity for cross-identity referral check
  key_created_at: Date;
  key_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Federated Search ────────────────────────────────────────────────────────

export interface FederatedSearchParams {
  q?: string;
  location?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  date_from?: string;
  date_to?: string;
  categories?: string[];
  tags?: string[];
  price_min?: number;
  price_max?: number;
  free_only?: boolean;
  availability?: string[];
  source_platform?: string;
  organizer_id?: string;
  organizer_verified?: boolean;
  attendance_mode?: string;
  sort?: 'relevance' | 'date_asc' | 'date_desc' | 'price_asc' | 'price_desc' | 'distance' | 'popularity';
  page?: number;
  per_page?: number;
  include_sold_out?: boolean;
  payment_methods?: string[];
}

export interface SpaceSearchResponse {
  space_id: string;
  space_name: string;
  source_type: SourceType;
  response_time_ms: number;
  results: AtlasSearchResultItem[];
  total_results: number;
  error?: string;
}

export interface AtlasSearchResultItem {
  event: Record<string, unknown>;  // Full AtlasEvent JSON-LD
  relevance_score?: number;
  distance_km?: number;
  source: string;
}

export interface MergedSearchResult {
  event: Record<string, unknown>;
  relevance_score: number;
  distance_km: number | null;
  source: 'registry';
  source_space_id: string;
  source_space_name: string;
  source_type: SourceType;
}

export interface FederatedSearchResponse {
  'atlas:search_result': {
    query: Record<string, unknown>;
    total_results: number;
    page: number;
    per_page: number;
    total_pages: number;
    has_next: boolean;
    results: MergedSearchResult[];
    facets?: {
      categories: { value: string; count: number }[];
      source_platforms: { value: string; count: number }[];
      price_ranges: { value: string; count: number }[];
    };
    response_time_ms: number;
  };
}

// ─── Space Registration Request ──────────────────────────────────────────────

export interface RegisterSpaceRequest {
  source_type: SourceType;
  name: string;
  description?: string;
  base_url: string;
  logo_url?: string;
  contact_email?: string;
  // For lemonade_space: set automatically by indexer
  lemonade_space_id?: string;
  lemonade_space_slug?: string;
}
```

---

## 6. Fastify App Setup

```typescript
// src/app/index.ts
import fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import { logger } from './helpers/logger';
import { connectDb, disconnectDb } from './helpers/db';
import { connectRedis, disconnectRedis, getRedis } from './helpers/redis';
import { searchRoutes } from './routes/search';
import { organizerRoutes } from './routes/organizers';
import { registerRoutes } from './routes/register';
import { agentRoutes } from './routes/agents';
import { healthRoutes } from './routes/health';
import { mcpPlugin } from './plugins/mcp';
import { metricsPlugin } from './plugins/metrics';
import { healthPlugin } from './plugins/health';
import { startIndexer } from './services/indexer';
import { startHealthChecker } from './services/health-checker';
import { verifyApiKey } from './services/agent-registry';
import { getDb } from './helpers/db';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Augment Fastify request with agent context
declare module 'fastify' {
  interface FastifyRequest {
    agentId: string | null;
    agentScopes?: string[];
  }
}

export async function createApp() {
  const app = fastify({
    logger,
    trustProxy: true,
  });

  // Connect infrastructure
  await connectDb();
  const redis = await connectRedis();

  // CORS
  await app.register(fastifyCors, {
    credentials: true,
    origin: true,
  });

  // Rate limiting (keyed by Atlas-Agent-Id header)
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      return (req.headers['atlas-agent-id'] as string) || req.ip;
    },
    redis,
  });

  // Plugins
  await app.register(healthPlugin);
  await app.register(metricsPlugin);
  await app.register(mcpPlugin);

> **AUDIT FIX [P3-H1]:** Added agent authentication middleware. Agents must send
> `Authorization: Bearer <api_key>` which is verified against the hashed key in
> `agent_registrations`. Unauthenticated requests fall through to IP-based rate limiting
> at a lower (public) tier. The middleware is registered on search/organizer routes.

  // Agent authentication middleware — validates Bearer token against agent_registrations
  // Agents without a valid API key are treated as public tier (lower rate limits via IP)
  app.decorate('authenticateAgent', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      // No auth — public tier, rely on IP-based rate limiting
      request.agentId = null;
      return;
    }
    const token = authHeader.slice(7);
    const prefix = token.substring(0, 12);
    const db = getDb();
    const agent = await db('agent_registrations')
      .where('api_key_prefix', prefix)
      .where('status', 'active')
      .first();
    if (!agent || !verifyApiKey(token, agent.api_key_hash)) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', http_status: 401, message: 'Invalid API key', atlas_version: '1.0' },
      });
    }
    // Check key expiry
    if (agent.key_expires_at && new Date(agent.key_expires_at) < new Date()) {
      return reply.code(401).send({
        error: { code: 'KEY_EXPIRED', http_status: 401, message: 'API key expired — rotate via admin', atlas_version: '1.0' },
      });
    }
    request.agentId = agent.atlas_agent_id;
    request.agentScopes = agent.scopes;
    // Update last_used_at (fire-and-forget)
    db('agent_registrations')
      .where('id', agent.id)
      .update({ last_used_at: new Date(), request_count: db.raw('request_count + 1') })
      .catch(() => {});
  });

  // Routes (all under /atlas/v1 prefix)
  await app.register(searchRoutes, { prefix: '/atlas/v1' });
  await app.register(organizerRoutes, { prefix: '/atlas/v1' });
  await app.register(registerRoutes, { prefix: '/atlas/v1' });
  await app.register(agentRoutes, { prefix: '/atlas/v1' });
  await app.register(healthRoutes, { prefix: '/atlas/v1' });

  // Start background services after server is ready
  app.addHook('onReady', async () => {
    startIndexer();
    startHealthChecker();
  });

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await disconnectDb();
    await disconnectRedis();
  });

  return app;
}
```

---

## 7. Space Indexer Service

The indexer populates `spaces_index` from two sources:
1. **Lemonade Spaces** -- queried from lemonade-backend, then validated via `/.well-known/atlas.json`
2. **External platforms** -- registered manually via admin API, validated on registration

```typescript
// src/app/services/indexer.ts

import { CronJob } from 'cron';
import { getDb } from '../helpers/db';
import { httpClient } from '../helpers/http-client';
import { logger } from '../helpers/logger';
import { lemonadeBackendInternalUrl, lemonadeBackendUrl, indexIntervalMinutes } from '../../config';
import type { IndexedSpace, SourceType, AtlasCapabilities } from '../models/types';

const ATLAS_MANIFEST_PATH = '/.well-known/atlas.json';

interface AtlasManifest {
  '@context': string;
  atlas_version: string;
  platform: {
    name: string;
    url: string;
    logo?: string;
    description?: string;
    contact_email?: string;
  };
  capabilities: AtlasCapabilities;
  endpoints: {
    search?: string;
    events: string;
    purchase?: string;
  };
  payment_methods: string[];
  signing_keys: object[];
}

/**
 * Starts the periodic indexer.
 * - Fetches all active Lemonade Spaces that have Atlas enabled (via Phase 2 router)
 * - For each Space, fetches /.well-known/atlas.json and validates
 * - Upserts into spaces_index
 */
export function startIndexer(): void {
  // Run immediately on startup, then on schedule
  indexLemonadeSpaces().catch((err) => logger.error({ err }, 'Initial indexing failed'));

  const job = new CronJob(`*/${indexIntervalMinutes} * * * *`, async () => {
    try {
      await indexLemonadeSpaces();
    } catch (err) {
      logger.error({ err }, 'Scheduled indexing failed');
    }
  });
  job.start();
  logger.info(`Indexer started: every ${indexIntervalMinutes} minutes`);
}

/**
 * Queries lemonade-backend for all Spaces, then validates each Space's Atlas manifest.
 *
 * Implementation note: Phase 2 adds the Atlas router to lemonade-backend for each Space
 * that has a custom domain or subdomain. The indexer discovers these by:
 *   1. Calling an internal backend endpoint that lists Atlas-enabled Spaces
 *   2. Fetching each Space's /.well-known/atlas.json
 *   3. Upserting into spaces_index with source_type = 'lemonade_space'
 *
 * The backend endpoint to call:
 *   GET /internal/atlas/spaces  (or GraphQL query -- coordinate with Phase 2 implementer)
 *
 * Expected response per Space:
 *   { _id, slug, title, description, base_url (custom domain or subdomain), image_avatar }
 */
async function indexLemonadeSpaces(): Promise<void> {
  const backendUrl = lemonadeBackendInternalUrl || lemonadeBackendUrl;
  const startTime = Date.now();

  // Fetch list of Atlas-enabled Lemonade Spaces from backend
  // IMPLEMENTATION NOTE: The Phase 2 implementer must expose an internal endpoint
  // that returns all Spaces with Atlas enabled. Coordinate the exact endpoint path.
  // Fallback: use the GraphQL aiListMySpaces pattern but with a service-to-service token.
  const spacesResponse = await httpClient.get(`${backendUrl}/internal/atlas/spaces`);
  const spaces = spacesResponse.data as Array<{
    _id: string;
    slug: string;
    title: string;
    description?: string;
    base_url: string;
    image_avatar?: string;
    owner_user_id?: string;  // E9: Space owner for self-referral detection
    owner_self_verified_identity_id?: string; // R4 SV-2: Self.xyz verified identity ID (null if unverified)
    paid_event_count?: number;   // R4 FT-4: count of paid events
    total_event_count?: number;  // R4 FT-4: total event count
  }>;

  logger.info({ count: spaces.length }, 'Fetched Lemonade Spaces for indexing');

  const db = getDb();
  let indexed = 0;
  let failed = 0;

  for (const space of spaces) {
    try {
      const manifestUrl = `${space.base_url}${ATLAS_MANIFEST_PATH}`;
      const manifest = await fetchAndValidateManifest(manifestUrl);

      if (!manifest) {
        failed++;
        continue;
      }

      const atlasEndpoint = manifest.endpoints.search || `${space.base_url}/atlas/v1/search`;

      await db('spaces_index')
        .insert({
          source_type: 'lemonade_space' as SourceType,
          lemonade_space_id: space._id,
          lemonade_space_slug: space.slug,
          name: manifest.platform.name || space.title,
          description: manifest.platform.description || space.description || null,
          base_url: space.base_url,
          atlas_endpoint: atlasEndpoint,
          manifest_url: manifestUrl,
          atlas_version: manifest.atlas_version,
          capabilities: manifest.capabilities,
          payment_methods: manifest.payment_methods,
          signing_keys: JSON.stringify(manifest.signing_keys),
          status: 'active',
          logo_url: manifest.platform.logo || space.image_avatar || null,
          contact_email: manifest.platform.contact_email || null,
          owner_user_id: space.owner_user_id || null, // E9: Space owner for self-referral detection
          owner_self_verified_identity_id: space.owner_self_verified_identity_id || null, // R4 SV-2
          paid_event_count: space.paid_event_count ?? 0, // R4 FT-4
          total_event_count: space.total_event_count ?? 0, // R4 FT-4
          last_indexed_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict('lemonade_space_id')
        .merge([
          'name', 'description', 'base_url', 'atlas_endpoint', 'manifest_url',
          'atlas_version', 'capabilities', 'payment_methods', 'signing_keys',
          'status', 'logo_url', 'contact_email', 'owner_user_id',
          'owner_self_verified_identity_id', 'paid_event_count', 'total_event_count', // R4 FT-4, SV-2
          'last_indexed_at', 'updated_at',
        ]);

      indexed++;
    } catch (err) {
      logger.warn({ err, spaceId: space._id }, 'Failed to index Space');
      failed++;
    }
  }

> **AUDIT FIX [P3-M3]:** Deleted Spaces are now cleaned up. After indexing, any
> Lemonade Space in the index that was NOT returned by the backend is marked `removed`.

> **AUDIT FIX R4 [FT-4]:** Paid event ratio tracking during Space indexing. The
> internal backend endpoint (`GET /internal/atlas/spaces`) must return `paid_event_count`
> and `total_event_count` per Space (count of events where at least one ticket type has
> `price > 0`, and total event count respectively). The indexer populates these into
> `spaces_index` on every index cycle. The `owner_self_verified_identity_id` field is also
> populated from the backend response (the Space owner's Self.xyz identity ID, or null if
> unverified). These fields are used by relevance scoring (FT-4) and referral self-identity
> comparison (SV-2).

> **AUDIT FIX R2 [E14]:** Naming collision detection during Space indexing. When indexing
> a new Space, check if another Space already exists with a very similar name
> (Levenshtein distance < 2 on normalized name) in the same geographic region
> (~100km radius). If a collision is detected, flag the new Space for manual review
> before making it searchable (set status to `pending_validation` instead of `active`).

  // E14: Naming collision detection on Space upsert
  // After upserting the Space, check for naming collisions:
  //   1. Normalize the new Space name: lowercase, strip punctuation, collapse whitespace
  //   2. Query space_name_index for entries in the same geographic region (~100km)
  //   3. For each candidate, compute Levenshtein distance against the new name
  //   4. If distance < 2 and the candidate is a DIFFERENT Space:
  //      - Set new Space status to 'pending_validation'
  //      - Log: { level: 'warn', msg: 'E14: Naming collision detected', new_space, existing_space }
  //      - Create an entry in space_reports with reason 'impersonation' (auto-flagged)
  //   5. Upsert the normalized name into space_name_index for future comparisons
  //
  // function checkNamingCollision(spaceId: string, name: string, lat?: number, lng?: number): Promise<boolean>

> **AUDIT FIX R2 [E1]:** Duplicate external event detection during indexing. After
> indexing all Spaces, scan for events that share the same `(externalPlatform, externalEventId)`
> across multiple Spaces. Only the FIRST indexed copy is kept; subsequent duplicates are
> flagged and excluded from search results. This is a secondary defense — the primary
> defense is the unique `(connectorType, externalAccountId)` constraint in Phase 1.

  // E1 secondary defense: deduplicate external events across Spaces
  // After indexing, query for events with duplicate (externalPlatform, externalEventId) hashes.
  // The indexer maintains a global lookup table `external_event_index` that maps
  // hash(externalPlatform, externalEventId) → first_seen_space_id.
  // Implementation:
  //   1. During event indexing from each Space, compute hash = SHA-256(externalPlatform + ':' + externalEventId)
  //   2. Check `external_event_index` table for existing entry with same hash
  //   3. If exists and belongs to a DIFFERENT Space:
  //      - Skip indexing this event (do not include in Space's event_count)
  //      - Log: { level: 'warn', msg: 'Duplicate external event detected', hash, original_space_id, duplicate_space_id }
  //   4. If not exists: insert into `external_event_index` with current space_id
  //
  // Schema addition (add migration 007_create_external_event_index.ts):
  //   CREATE TABLE external_event_index (
  //     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  //     event_hash      VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 of "platform:externalEventId"
  //     external_platform VARCHAR(64) NOT NULL,
  //     external_event_id VARCHAR(256) NOT NULL,
  //     first_seen_space_id UUID NOT NULL REFERENCES spaces_index(id),
  //     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  //   );
  //   CREATE INDEX idx_external_event_hash ON external_event_index(event_hash);

  // Cleanup: mark Lemonade Spaces not returned by backend as 'removed'
  const returnedIds = spaces.map((s) => s._id);
  if (returnedIds.length > 0) {
    const removed = await db('spaces_index')
      .where('source_type', 'lemonade_space')
      .whereNotIn('lemonade_space_id', returnedIds)
      .whereNot('status', 'removed')
      .update({ status: 'removed', updated_at: new Date() });
    if (removed > 0) {
      logger.info({ removed }, 'Marked stale Lemonade Spaces as removed');
    }
  }

  logger.info({
    indexed,
    failed,
    total: spaces.length,
    duration_ms: Date.now() - startTime,
  }, 'Indexing complete');
}

/**
 * Fetches and validates a /.well-known/atlas.json manifest.
 * Returns the parsed manifest or null if invalid.
 */
async function fetchAndValidateManifest(url: string): Promise<AtlasManifest | null> {
  try {
    const response = await httpClient.get(url, { timeout: 5000 });

    if (response.status !== 200) {
      logger.warn({ url, status: response.status }, 'Manifest fetch failed');
      return null;
    }

    const manifest = response.data as AtlasManifest;

    // Validate required fields per SCHEMAS.md Section 1
    if (!manifest['@context'] || manifest['@context'] !== 'https://atlas-protocol.org/v1') {
      logger.warn({ url }, 'Invalid manifest: wrong @context');
      return null;
    }
    if (!manifest.atlas_version) {
      logger.warn({ url }, 'Invalid manifest: missing atlas_version');
      return null;
    }
    if (!manifest.platform?.name || !manifest.platform?.url) {
      logger.warn({ url }, 'Invalid manifest: missing platform name/url');
      return null;
    }
    if (!manifest.endpoints?.events) {
      logger.warn({ url }, 'Invalid manifest: missing endpoints.events');
      return null;
    }
    if (!manifest.payment_methods || manifest.payment_methods.length === 0) {
      logger.warn({ url }, 'Invalid manifest: missing payment_methods');
      return null;
    }
    if (!manifest.signing_keys || manifest.signing_keys.length === 0) {
      logger.warn({ url }, 'Invalid manifest: missing signing_keys');
      return null;
    }

    return manifest;
  } catch (err) {
    logger.warn({ err, url }, 'Manifest fetch error');
    return null;
  }
}

> **AUDIT FIX [P3-M2]:** SSRF protection for `base_url`. Validates URL scheme (HTTPS only),
> resolves DNS (both A and AAAA records) and checks against private IP ranges (10.x,
> 172.16-31.x, 192.168.x, 169.254.x, 127.x, ::1, fc00::/7, fe80::/10) before fetching
> manifest. Prevents internal network scanning via both IPv4 and IPv6.

> **AUDIT FIX R3 [CC-5]:** Added `dns.resolve6()` for IPv6 private range checking.
> The original code only called `dns.resolve()` which returns IPv4 (A records).
> A hostname resolving to an IPv6 private address (fc00::/7, fe80::/10, ::1) would
> bypass the SSRF check entirely. Now resolves both A and AAAA records.

import { resolve, resolve6 } from 'dns/promises';

async function validateUrlNotPrivate(urlStr: string): Promise<void> {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }
  const hostname = parsed.hostname;
  // Resolve DNS and check for private IPs — both IPv4 (A) and IPv6 (AAAA) records
  try {
    // CC-5: Resolve IPv4 addresses
    const ipv4Addresses = await resolve(hostname).catch(() => [] as string[]);
    // CC-5: Resolve IPv6 addresses
    const ipv6Addresses = await resolve6(hostname).catch(() => [] as string[]);

    const allAddresses = [...ipv4Addresses, ...ipv6Addresses];
    if (allAddresses.length === 0) {
      throw new Error(`DNS resolution returned no addresses for ${hostname}`);
    }

    for (const addr of allAddresses) {
      if (isPrivateIp(addr)) {
        throw new Error(`URL resolves to private IP range: ${addr}`);
      }
    }
  } catch (err) {
    if ((err as Error).message?.includes('private IP') ||
        (err as Error).message?.includes('no addresses')) throw err;
    throw new Error(`DNS resolution failed for ${hostname}`);
  }
}

function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  // IPv6 loopback and private
  if (ip === '::1') return true;
  if (/^fc00:/i.test(ip) || /^fd/i.test(ip)) return true;
  if (/^fe80:/i.test(ip)) return true;
  return false;
}

/**
 * Register an external platform manually (admin API).
 * Fetches manifest, validates, inserts with source_type = 'external_platform'.
 */
export async function registerExternalPlatform(params: {
  name: string;
  base_url: string;
  description?: string;
  logo_url?: string;
  contact_email?: string;
}): Promise<IndexedSpace> {
  // SSRF protection: validate URL before fetching
  await validateUrlNotPrivate(params.base_url);

  const manifestUrl = `${params.base_url}${ATLAS_MANIFEST_PATH}`;
  const manifest = await fetchAndValidateManifest(manifestUrl);

  if (!manifest) {
    throw new Error(`Invalid or unreachable Atlas manifest at ${manifestUrl}`);
  }

  const atlasEndpoint = manifest.endpoints.search || `${params.base_url}/atlas/v1/search`;
  const db = getDb();

> **AUDIT FIX [P3-M6]:** External platform upsert now uses `base_url` as conflict
> target instead of `lemonade_space_id`. PostgreSQL's `NULL != NULL` means the
> `lemonade_space_id` unique constraint never triggers for external platforms,
> causing duplicate insertions instead of upserts.

  const [inserted] = await db('spaces_index')
    .insert({
      source_type: 'external_platform' as SourceType,
      lemonade_space_id: null,
      lemonade_space_slug: null,
      name: params.name || manifest.platform.name,
      description: params.description || manifest.platform.description || null,
      base_url: params.base_url,
      atlas_endpoint: atlasEndpoint,
      manifest_url: manifestUrl,
      atlas_version: manifest.atlas_version,
      capabilities: manifest.capabilities,
      payment_methods: manifest.payment_methods,
      signing_keys: JSON.stringify(manifest.signing_keys),
      status: 'active',
      logo_url: params.logo_url || manifest.platform.logo || null,
      contact_email: params.contact_email || manifest.platform.contact_email || null,
      last_indexed_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict('base_url')
    .merge([
      'name', 'description', 'atlas_endpoint', 'manifest_url',
      'atlas_version', 'capabilities', 'payment_methods', 'signing_keys',
      'status', 'logo_url', 'contact_email', 'last_indexed_at', 'updated_at',
    ])
    .returning('*');

  return inserted;
}
```

---

## 8. Federated Search Service

This is the core of the Registry. It fans out search queries to all healthy indexed Spaces, merges results, ranks them, and returns a unified response.

```typescript
// src/app/services/federated-search.ts

import { getDb } from '../helpers/db';
import { getRedis } from '../helpers/redis';
import { httpClient } from '../helpers/http-client';
import { logger } from '../helpers/logger';
import { searchTimeoutMs, searchCacheTtlSeconds, maxFanoutConcurrency } from '../../config';
import { computeRelevanceScore } from './relevance';
import type {
  FederatedSearchParams,
  FederatedSearchResponse,
  MergedSearchResult,
  SpaceSearchResponse,
  IndexedSpace,
} from '../models/types';

/**
 * Execute a federated search across all healthy indexed Spaces.
 *
 * Algorithm:
 * 1. Check Redis cache for identical query
 * 2. Fetch all active Spaces from spaces_index
 * 3. Fan out search to each Space's atlas_endpoint in parallel (with timeout)
 * 4. Collect responses, merge results
 * 5. Re-rank merged results using relevance scoring
 * 6. Apply pagination
 * 7. Compute facets from all results
 * 8. Cache the merged result set
 * 9. Log the query
 */
export async function federatedSearch(
  params: FederatedSearchParams,
  agentId: string | null,
): Promise<FederatedSearchResponse> {
  const startTime = Date.now();

  // 1. Cache check
  const cacheKey = buildCacheKey(params);
  const redis = getRedis();
  const cached = await redis.get(cacheKey);

  if (cached) {
    const parsed = JSON.parse(cached) as FederatedSearchResponse;
    // Log cache hit (async, don't await)
    logQuery(params, agentId, parsed['atlas:search_result'].total_results, 0, 0, Date.now() - startTime, true);
    return parsed;
  }

  // 2. Get all healthy spaces
  const db = getDb();
  const spaces: IndexedSpace[] = await db('spaces_index')
    .where('status', 'active')
    .whereNotNull('atlas_endpoint')
    .select('*');

  if (spaces.length === 0) {
    return buildEmptyResponse(params, Date.now() - startTime);
  }

> **AUDIT FIX [P3-H7]:** Fan-out now paginates through downstream Spaces instead of
> only fetching page 1 (max 100 results). After the initial fan-out, if any Space
> reports `total_results > per_page`, subsequent pages are fetched up to a cap of
> 200 results per Space to prevent unbounded fetching.

> **AUDIT FIX R3 [F-1]:** Reduced per-Space result cap from 500 to 200. With 50 Spaces x 200 =
> 10,000 results max before dedup. Token-based Jaccard dedup on 10K results is fast (hash-based).

  // 3. Fan out search queries in parallel with concurrency limit
  const queryString = buildQueryString(params);
  const spaceResults = await fanOutSearch(spaces, queryString);

  // 3b. Fetch additional pages from Spaces that have more results (up to 200 per Space)
  const MAX_RESULTS_PER_SPACE = 200;
  const PER_PAGE = 100;
  for (const sr of spaceResults) {
    if (sr.error || sr.total_results <= PER_PAGE) continue;
    const pagesToFetch = Math.min(
      Math.ceil(sr.total_results / PER_PAGE) - 1, // pages remaining
      Math.ceil(MAX_RESULTS_PER_SPACE / PER_PAGE) - 1, // cap
    );
    const space = spaces.find((s) => s.id === sr.space_id);
    if (!space) continue;
    const pagePromises = [];
    for (let p = 2; p <= pagesToFetch + 1; p++) {
      const pageQuery = queryString.replace('page=1', `page=${p}`);
      pagePromises.push(
        searchSpace(space, pageQuery, 1500).catch(() => null)
      );
    }
    const pageResults = await Promise.allSettled(pagePromises);
    for (const pr of pageResults) {
      if (pr.status === 'fulfilled' && pr.value && !pr.value.error) {
        sr.results.push(...pr.value.results);
      }
    }
  }

> **AUDIT FIX [P3-H2]:** Federated search now validates and sanitizes all downstream data.
> Malicious Spaces can no longer inject fake verified status, phishing purchase URLs,
> XSS payloads, or inflated relevance scores. Validation includes: schema field checks,
> HTML tag stripping on name/description, relevance_score capped to [0, 1], and
> purchase_endpoint validated as HTTPS URL.

  // 4. Merge all results — with validation and sanitization of downstream data
  const allResults: MergedSearchResult[] = [];
  let totalFromSpaces = 0;
  let spacesResponded = 0;

  for (const sr of spaceResults) {
    if (sr.error) continue;
    spacesResponded++;
    totalFromSpaces += sr.total_results;

    for (const item of sr.results) {
      // Schema validation: skip items missing required fields
      if (!item.event || typeof item.event !== 'object' || !item.event['name']) {
        logger.warn({ space_id: sr.space_id }, 'Skipping result with missing required fields');
        continue;
      }

      // Sanitize text fields — strip HTML tags to prevent XSS
      if (typeof item.event['name'] === 'string') {
        item.event['name'] = stripHtmlTags(item.event['name']);
      }
      if (typeof item.event['description'] === 'string') {
        item.event['description'] = stripHtmlTags(item.event['description']);
      }

      // Cap downstream relevance_score to [0, 1] — prevent score inflation
      const rawScore = typeof item.relevance_score === 'number' ? item.relevance_score : 0;
      const cappedScore = Math.min(1.0, Math.max(0.0, rawScore));

      // Validate purchase_endpoint is HTTPS URL (or strip it)
      const purchaseUrl = item.event['atlas:purchase_endpoint'] as string | undefined;
      if (purchaseUrl && !isValidHttpsUrl(purchaseUrl)) {
        logger.warn({ space_id: sr.space_id, url: purchaseUrl }, 'Stripping invalid purchase_endpoint');
        delete item.event['atlas:purchase_endpoint'];
      }

      // Do NOT trust downstream organizer_verified — Registry verifies independently
      // Strip the field; it will be re-computed from organizer_profiles if needed
      delete item.event['atlas:organizer_verified'];

      allResults.push({
        event: item.event,
        relevance_score: cappedScore,
        distance_km: item.distance_km ?? null,
        source: 'registry',
        source_space_id: sr.space_id,
        source_space_name: sr.space_name,
        source_type: sr.source_type,
      });
    }
  }

  /** Strip HTML tags from a string (simple regex — sufficient for text fields) */
  function stripHtmlTags(str: string): string {
    return str.replace(/<[^>]*>/g, '').trim();
  }

  /** Validate a URL is HTTPS */
  function isValidHttpsUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

> **AUDIT FIX R2 [E8]:** Search result deduplication to prevent Space flooding attacks.
> After merging results from all Spaces, deduplicate by: token-based Jaccard similarity
> on normalized title + same date + same venue (within 200m).
> When duplicates are found, keep the result from the Space with the highest reliability
> score. Others are excluded from results and logged for investigation.
> Additionally, Space creation is rate-limited to max 3 Spaces per user (enforced at
> the Lemonade backend level — documented expectation, not enforced here).
> Accounts creating many Spaces with similar events are flagged for manual review.

> **AUDIT FIX R3 [F-1]:** Replaced Levenshtein distance dedup with token-based Jaccard
> similarity. Levenshtein misses word reordering ("Berlin Techno Night" vs "Techno Night
> Berlin"). Jaccard on sorted token sets catches reordering automatically.
> Normalize: lowercase, remove punctuation, split into word tokens, sort alphabetically.
> Jaccard coefficient = |intersection| / |union| > 0.7 AND same date AND same location
> (within 200m). Performance: hash-based set operations, O(n) per comparison vs O(n*m)
> for Levenshtein. Venue distance threshold widened from 100m to 200m to catch
> slightly different geocoding of same venue across platforms.

  // E8: Deduplicate merged results before ranking
  // Algorithm (token-based Jaccard similarity):
  //   1. Normalize each event title: lowercase, strip punctuation, collapse whitespace,
  //      split into word tokens, sort alphabetically → Set<string>
  //   2. For each pair of results, check:
  //      a. Jaccard similarity of token sets > 0.7
  //         Jaccard = |intersection(A,B)| / |union(A,B)|
  //      b. Same date (startDate matches to the day)
  //      c. Same venue: if both have lat/lng in location, distance < 200m (Haversine)
  //         OR if both have venue name, exact match after normalization
  //   3. If all three match → mark as duplicates
  //   4. From each duplicate group, keep the result with the highest relevance_score
  //      (proxy for Space reliability). Log discarded duplicates for investigation.
  //
  // Helper: tokenize title for Jaccard comparison
  // function tokenize(title: string): Set<string> {
  //   return new Set(
  //     title.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean).sort()
  //   );
  // }
  //
  // function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  //   if (a.size === 0 && b.size === 0) return 1.0;
  //   let intersection = 0;
  //   for (const token of a) {
  //     if (b.has(token)) intersection++;
  //   }
  //   const union = a.size + b.size - intersection;
  //   return union === 0 ? 0 : intersection / union;
  // }
  //
  // const JACCARD_THRESHOLD = 0.7;
  //
  // function deduplicateResults(results: MergedSearchResult[]): MergedSearchResult[] {
  //   const normalized = results.map((r) => ({
  //     result: r,
  //     titleTokens: tokenize(r.event['name'] as string || ''),
  //     dateKey: (r.event['startDate'] as string || '').substring(0, 10), // YYYY-MM-DD
  //     venueLat: extractLat(r.event['location']),
  //     venueLng: extractLng(r.event['location']),
  //     venueName: extractVenueName(r.event['location']),
  //   }));
  //
  //   const kept: MergedSearchResult[] = [];
  //   const discarded = new Set<number>();
  //
  //   for (let i = 0; i < normalized.length; i++) {
  //     if (discarded.has(i)) continue;
  //     let bestIdx = i;
  //     for (let j = i + 1; j < normalized.length; j++) {
  //       if (discarded.has(j)) continue;
  //       const a = normalized[i], b = normalized[j];
  //       if (
  //         jaccardSimilarity(a.titleTokens, b.titleTokens) > JACCARD_THRESHOLD &&
  //         a.dateKey === b.dateKey && a.dateKey !== '' &&
  //         venueMatch(a, b) // venueMatch updated: distance < 200m (was 100m)
  //       ) {
  //         // Duplicate found — keep the one with higher relevance_score
  //         if (normalized[j].result.relevance_score > normalized[bestIdx].result.relevance_score) {
  //           discarded.add(bestIdx);
  //           bestIdx = j;
  //         } else {
  //           discarded.add(j);
  //         }
  //         logger.warn({
  //           kept_space: normalized[bestIdx].result.source_space_id,
  //           discarded_space: normalized[j === bestIdx ? i : j].result.source_space_id,
  //           title_a: r.event['name'],
  //           jaccard: jaccardSimilarity(a.titleTokens, b.titleTokens).toFixed(2),
  //         }, 'E8: Duplicate search result removed (Space flooding protection)');
  //       }
  //     }
  //     if (!discarded.has(bestIdx)) kept.push(normalized[bestIdx].result);
  //   }
  //   return kept;
  // }
  //
  // Backend expectation (not enforced in Registry):
  //   - Max 3 Spaces per user — enforced via Lemonade backend Space creation mutation
  //   - Accounts creating >2 Spaces with >50% event title overlap should be flagged
  //     for manual review (query: compare event titles across Spaces owned by same user)
  const deduplicatedResults = deduplicateResults(allResults);

  // 5. Re-rank using registry-level relevance scoring
  // R4 FT-4: Build a lookup map for Space paid_event_count/total_event_count
  const spaceMap = new Map(spaces.map((s) => [s.id, s]));
  const ranked = deduplicatedResults
    .map((r) => ({
      ...r,
      relevance_score: computeRelevanceScore(r, params, spaceMap.get(r.source_space_id)), // R4 FT-4: pass Space for paid_event_ratio
    }))
    .sort((a, b) => sortResults(a, b, params.sort || 'relevance'));

  // 6. Paginate
  const page = params.page || 1;
  const perPage = Math.min(params.per_page || 20, 100);
  const totalResults = ranked.length;
  const totalPages = Math.ceil(totalResults / perPage);
  const offset = (page - 1) * perPage;
  const pageResults = ranked.slice(offset, offset + perPage);

  // 7. Compute facets from ALL deduplicated results (not just current page)
  const facets = computeFacets(deduplicatedResults);

  // 8. Build response
  const responseTimeMs = Date.now() - startTime;
  const response: FederatedSearchResponse = {
    'atlas:search_result': {
      query: params as unknown as Record<string, unknown>,
      total_results: totalResults,
      page,
      per_page: perPage,
      total_pages: totalPages,
      has_next: page < totalPages,
      results: pageResults,
      facets,
      response_time_ms: responseTimeMs,
    },
  };

  // 9. Cache (don't await)
  redis.set(cacheKey, JSON.stringify(response), 'EX', searchCacheTtlSeconds).catch(() => {});

  // 10. Log query (don't await)
  logQuery(params, agentId, totalResults, spaces.length, spacesResponded, responseTimeMs, false);

  return response;
}

> **AUDIT FIX [P3-C1]:** Fixed `batch[j]` ReferenceError — `batch` variable did not exist
> after refactor from sequential batching to parallel fan-out. Now uses `spaces[j]` to
> reference the correct space. Removed orphaned closing brace from old batching loop.

> **AUDIT FIX [P3-C2]:** `searchSpace` was called with 3 args but defined with 2. The
> `PER_SPACE_TIMEOUT` parameter was silently ignored, so the function always used the
> global `searchTimeoutMs` (3000ms) instead of the intended 1500ms per-space timeout.
> Updated function signature to accept `timeoutMs` and pass it through.

/**
 * Fan out search to ALL spaces in parallel with per-Space timeout.
 * Uses Promise.allSettled so one slow/failing Space doesn't block others.
 *
 * PERFORMANCE NOTE: Sequential batching (old approach) could hit 9-10s with 50+ Spaces
 * at 3s timeout per batch. Parallel fan-out with 1.5s per-Space timeout ensures we meet
 * the <2s SLA from PROTOCOL-SPEC.md Section 3.4.
 *
 * Concurrency is bounded by maxFanoutConcurrency (default: 50) to limit open connections.
 * AbortController per request ensures cleanup on timeout.
 */
async function fanOutSearch(
  spaces: IndexedSpace[],
  queryString: string,
): Promise<SpaceSearchResponse[]> {
  // Fan out ALL spaces in parallel (bounded by maxFanoutConcurrency via connection pool)
  const PER_SPACE_TIMEOUT = 1500; // 1.5s per Space — strict, ensures <2s total
  const results: SpaceSearchResponse[] = [];

  // All spaces in parallel, not sequential batches
  const spacesToSearch = spaces.slice(0, maxFanoutConcurrency);
  const promises = spacesToSearch.map((space) =>
    searchSpace(space, queryString, PER_SPACE_TIMEOUT)
  );
  const settled = await Promise.allSettled(promises);

  for (let j = 0; j < settled.length; j++) {
    const result = settled[j];
    const space = spacesToSearch[j];

    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      results.push({
        space_id: space.id,
        space_name: space.name,
        source_type: space.source_type,
        response_time_ms: PER_SPACE_TIMEOUT,
        results: [],
        total_results: 0,
        error: result.reason?.message || 'Unknown error',
      });
    }
  }

  return results;
}

/**
 * Search a single Space's Atlas endpoint.
 */
async function searchSpace(
  space: IndexedSpace,
  queryString: string,
  timeoutMs: number,
): Promise<SpaceSearchResponse> {
  const start = Date.now();
  const url = `${space.atlas_endpoint}?${queryString}`;

  try {
    const response = await httpClient.get(url, {
      timeout: timeoutMs,
      headers: {
        'Atlas-Version': '1.0',
        'Accept': 'application/json',
      },
    });

    const data = response.data as {
      'atlas:search_result'?: {
        results: Array<{ event: Record<string, unknown>; relevance_score?: number; distance_km?: number; source: string }>;
        total_results: number;
      };
    };

    const searchResult = data['atlas:search_result'];

    return {
      space_id: space.id,
      space_name: space.name,
      source_type: space.source_type,
      response_time_ms: Date.now() - start,
      results: searchResult?.results || [],
      total_results: searchResult?.total_results || 0,
    };
  } catch (err) {
    return {
      space_id: space.id,
      space_name: space.name,
      source_type: space.source_type,
      response_time_ms: Date.now() - start,
      results: [],
      total_results: 0,
      error: (err as Error).message,
    };
  }
}

function buildCacheKey(params: FederatedSearchParams): string {
  // Deterministic key from sorted params (exclude page for broader cache hits)
  const keyObj = { ...params };
  delete keyObj.page; // Cache all pages under same key prefix
  const sorted = JSON.stringify(keyObj, Object.keys(keyObj).sort());
  return `atlas:search:${Buffer.from(sorted).toString('base64url')}:p${params.page || 1}`;
}

function buildQueryString(params: FederatedSearchParams): string {
  const parts: string[] = [];
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.location) parts.push(`location=${encodeURIComponent(params.location)}`);
  if (params.lat !== undefined) parts.push(`lat=${params.lat}`);
  if (params.lng !== undefined) parts.push(`lng=${params.lng}`);
  if (params.radius_km !== undefined) parts.push(`radius_km=${params.radius_km}`);
  if (params.date_from) parts.push(`date_from=${encodeURIComponent(params.date_from)}`);
  if (params.date_to) parts.push(`date_to=${encodeURIComponent(params.date_to)}`);
  if (params.categories?.length) parts.push(`categories=${params.categories.join(',')}`);
  if (params.tags?.length) parts.push(`tags=${params.tags.join(',')}`);
  if (params.price_min !== undefined) parts.push(`price_min=${params.price_min}`);
  if (params.price_max !== undefined) parts.push(`price_max=${params.price_max}`);
  if (params.free_only) parts.push(`free_only=true`);
  if (params.availability?.length) parts.push(`availability=${params.availability.join(',')}`);
  if (params.source_platform) parts.push(`source_platform=${encodeURIComponent(params.source_platform)}`);
  if (params.organizer_id) parts.push(`organizer_id=${params.organizer_id}`);
  if (params.organizer_verified !== undefined) parts.push(`organizer_verified=${params.organizer_verified}`);
  if (params.attendance_mode) parts.push(`attendance_mode=${params.attendance_mode}`);
  if (params.sort) parts.push(`sort=${params.sort}`);
  if (params.include_sold_out) parts.push(`include_sold_out=true`);
  if (params.payment_methods?.length) parts.push(`payment_methods=${params.payment_methods.join(',')}`);
  // Always request max per_page from downstream (we paginate in the registry)
  parts.push('per_page=100');
  parts.push('page=1');
  return parts.join('&');
}

function sortResults(a: MergedSearchResult, b: MergedSearchResult, sort: string): number {
  switch (sort) {
    case 'date_asc':
      return compareField(a, b, 'startDate', 1);
    case 'date_desc':
      return compareField(a, b, 'startDate', -1);
    case 'price_asc':
      return comparePriceRange(a, b, 1);
    case 'price_desc':
      return comparePriceRange(a, b, -1);
    case 'distance':
      return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
    case 'popularity':
      // Fallback to relevance if no popularity signal
      return b.relevance_score - a.relevance_score;
    case 'relevance':
    default:
      return b.relevance_score - a.relevance_score;
  }
}

function compareField(a: MergedSearchResult, b: MergedSearchResult, field: string, direction: number): number {
  const aVal = a.event[field] as string || '';
  const bVal = b.event[field] as string || '';
  return aVal.localeCompare(bVal) * direction;
}

function comparePriceRange(a: MergedSearchResult, b: MergedSearchResult, direction: number): number {
  const aPrice = (a.event['atlas:price_range'] as { min_price?: number })?.min_price ?? 0;
  const bPrice = (b.event['atlas:price_range'] as { min_price?: number })?.min_price ?? 0;
  return (aPrice - bPrice) * direction;
}

function computeFacets(results: MergedSearchResult[]) {
  const categories = new Map<string, number>();
  const platforms = new Map<string, number>();
  const priceRanges = new Map<string, number>();

  for (const r of results) {
    // Categories
    const cats = r.event['atlas:categories'] as string[] | undefined;
    if (cats) {
      for (const c of cats) {
        categories.set(c, (categories.get(c) || 0) + 1);
      }
    }

    // Source platforms
    const platform = r.event['atlas:source_platform'] as string | undefined;
    if (platform) {
      platforms.set(platform, (platforms.get(platform) || 0) + 1);
    }

    // Price ranges
    const priceRange = r.event['atlas:price_range'] as { min_price?: number } | undefined;
    const minPrice = priceRange?.min_price ?? 0;
    let bucket: string;
    if (minPrice === 0) bucket = 'free';
    else if (minPrice <= 25) bucket = '1-25';
    else if (minPrice <= 50) bucket = '26-50';
    else if (minPrice <= 100) bucket = '51-100';
    else bucket = '100+';
    priceRanges.set(bucket, (priceRanges.get(bucket) || 0) + 1);
  }

  return {
    categories: [...categories.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    source_platforms: [...platforms.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    price_ranges: [...priceRanges.entries()].map(([value, count]) => ({ value, count })),
  };
}

function buildEmptyResponse(params: FederatedSearchParams, responseTimeMs: number): FederatedSearchResponse {
  return {
    'atlas:search_result': {
      query: params as unknown as Record<string, unknown>,
      total_results: 0,
      page: params.page || 1,
      per_page: params.per_page || 20,
      total_pages: 0,
      has_next: false,
      results: [],
      facets: { categories: [], source_platforms: [], price_ranges: [] },
      response_time_ms: responseTimeMs,
    },
  };
}

> **AUDIT FIX [P3-M9]:** Query logging now uses an in-memory buffer with batch
> insertion. Logs are flushed to PostgreSQL every 5 seconds or every 100 records
> (whichever comes first), reducing per-query DB write overhead.

// Query log buffer for batched insertion
const queryLogBuffer: Array<Record<string, unknown>> = [];
const QUERY_LOG_FLUSH_INTERVAL_MS = 5000;
const QUERY_LOG_FLUSH_SIZE = 100;

// Start the periodic flush interval
setInterval(() => flushQueryLogs(), QUERY_LOG_FLUSH_INTERVAL_MS);

async function flushQueryLogs(): Promise<void> {
  if (queryLogBuffer.length === 0) return;
  const batch = queryLogBuffer.splice(0, queryLogBuffer.length);
  try {
    const db = getDb();
    await db('query_logs').insert(batch);
  } catch (err) {
    logger.warn({ err, count: batch.length }, 'Failed to flush query log batch');
  }
}

async function logQuery(
  params: FederatedSearchParams,
  agentId: string | null,
  totalResults: number,
  spacesQueried: number,
  spacesResponded: number,
  responseTimeMs: number,
  cacheHit: boolean,
): Promise<void> {
  queryLogBuffer.push({
    agent_id: agentId,
    query_text: params.q || null,
    query_params: params,
    total_results: totalResults,
    spaces_queried: spacesQueried,
    spaces_responded: spacesResponded,
    response_time_ms: responseTimeMs,
    cache_hit: cacheHit,
  });

  // Flush if buffer is full
  if (queryLogBuffer.length >= QUERY_LOG_FLUSH_SIZE) {
    flushQueryLogs().catch(() => {});
  }
}
```

---

## 9. Relevance Scoring

```typescript
// src/app/services/relevance.ts

import type { MergedSearchResult, FederatedSearchParams, IndexedSpace } from '../models/types';

/**
 * Compute a 0.0-1.0 relevance score for a merged search result.
 *
 * Factors:
 * 1. Space-level relevance (passed through from downstream) -- 40% weight
 * 2. Freshness (events starting sooner score higher) -- 20% weight
 * 3. Organizer verification -- 15% weight
 * 4. Availability (available > few_remaining > sold_out) -- 10% weight
 * 5. Geographic proximity (if lat/lng provided) -- 15% weight
 * 6. Paid event ratio multiplier (FT-4) -- post-multiplier on final score
 */
export function computeRelevanceScore(
  result: MergedSearchResult,
  params: FederatedSearchParams,
  space?: Pick<IndexedSpace, 'paid_event_count' | 'total_event_count'>, // R4 FT-4
): number {
  let score = 0;

  // 1. Downstream relevance (40%)
  const downstreamScore = result.relevance_score || 0.5;
  score += downstreamScore * 0.4;

  // 2. Freshness (20%) -- events starting within 7 days score highest
  const startDate = result.event['startDate'] as string | undefined;
  if (startDate) {
    const daysUntil = (new Date(startDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntil >= 0 && daysUntil <= 7) score += 0.2;
    else if (daysUntil > 7 && daysUntil <= 30) score += 0.15;
    else if (daysUntil > 30 && daysUntil <= 90) score += 0.1;
    else score += 0.05;
  }

> **AUDIT FIX R2 [E14]:** Verified organizer badge. Organizers who connect real platform
> accounts (Eventbrite OAuth proves ownership) get `verification_level: 'verified'` in
> `organizer_profiles`. The relevance scoring weights verified organizers higher (0.15 vs
> 0.03), making impersonating shadow Spaces rank below legitimate verified organizers.
> Verification is set during OAuth connection in Phase 1 connectors — when
> `connected_accounts` has at least one entry with `oauth_valid: true`, the organizer's
> `verification_level` is upgraded to at least `'connected'`.

  // 3. Organizer verification (15%) — E14: verified badge gives ranking advantage
  // Registry independently computes verification from organizer_profiles, NOT from
  // downstream data (which is stripped in AUDIT FIX P3-H2).
  const verified = result.event['atlas:organizer_verified'] as boolean | undefined;
  score += verified ? 0.15 : 0.03;

  // 4. Availability (10%)
  const availability = result.event['atlas:availability'] as string | undefined;
  switch (availability) {
    case 'available': score += 0.1; break;
    case 'few_remaining': score += 0.08; break;
    case 'not_on_sale': score += 0.02; break;
    case 'sold_out': score += 0.0; break;
    default: score += 0.05;
  }

  // 5. Geographic proximity (15%)
  if (params.lat !== undefined && params.lng !== undefined && result.distance_km !== null) {
    const radiusKm = params.radius_km || 50;
    const proximityRatio = Math.max(0, 1 - (result.distance_km / radiusKm));
    score += proximityRatio * 0.15;
  } else {
    score += 0.075; // Neutral if no geo context
  }

> **AUDIT FIX R4 [FT-4]:** Paid event ratio penalty. Spaces with predominantly free
> events get a relevance multiplier penalty to prevent gaming via mass free event creation.
> Rationale: free events are cheap to create and inflate attendance, so Spaces that rely
> heavily on free events should not outrank Spaces with proven paid event track records.
> - > 50% paid events: no penalty (1.0x multiplier)
> - > 80% free events (< 20% paid): 0.5x multiplier
> - 100% free events (0% paid): 0.3x multiplier
> - Spaces with 0 total events: no penalty (new Spaces get benefit of the doubt)

  // 6. Paid event ratio multiplier (FT-4) — penalize free-heavy Spaces
  if (space && space.total_event_count > 0) {
    const paidRatio = space.paid_event_count / space.total_event_count;
    let paidEventMultiplier = 1.0;
    if (paidRatio === 0) {
      // 100% free events → 0.3x
      paidEventMultiplier = 0.3;
    } else if (paidRatio < 0.2) {
      // > 80% free events → 0.5x
      paidEventMultiplier = 0.5;
    }
    // paidRatio >= 0.5 (> 50% paid) → no penalty (1.0x)
    score *= paidEventMultiplier;
  }

  return Math.min(1.0, Math.max(0.0, score));
}
```

---

## 10. Health Checker Service

```typescript
// src/app/services/health-checker.ts

import { CronJob } from 'cron';
import { getDb } from '../helpers/db';
import { httpClient } from '../helpers/http-client';
import { logger } from '../helpers/logger';
import { healthCheckIntervalMinutes } from '../../config';
import type { HealthCheckStatus, IndexedSpace } from '../models/types';

const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Periodically validates /.well-known/atlas.json for all indexed spaces.
 *
 * Rules:
 * - Healthy: manifest fetched, valid JSON, required fields present, HTTP 200
 * - Unhealthy: 3+ consecutive failures -> status set to 'unhealthy', excluded from search
 * - Recovery: if unhealthy space passes check, reset to 'active'
 */
export function startHealthChecker(): void {
  const job = new CronJob(`*/${healthCheckIntervalMinutes} * * * *`, async () => {
    try {
      await checkAllSpaces();
    } catch (err) {
      logger.error({ err }, 'Health check cycle failed');
    }
  });
  job.start();
  logger.info(`Health checker started: every ${healthCheckIntervalMinutes} minutes`);
}

async function checkAllSpaces(): Promise<void> {
  const db = getDb();
  const spaces: IndexedSpace[] = await db('spaces_index')
    .whereIn('status', ['active', 'unhealthy', 'pending_validation'])
    .select('*');

> **AUDIT FIX [P3-M5]:** Health checks now run in parallel with concurrency limit of 10
> instead of sequentially. With 200 spaces x 10s timeout, sequential = ~33 min.
> Parallel (10 concurrent) = ~3.3 min.

  logger.info({ count: spaces.length }, 'Starting health check cycle');

  // Run checks in parallel with concurrency limit
  const HEALTH_CHECK_CONCURRENCY = 10;
  for (let i = 0; i < spaces.length; i += HEALTH_CHECK_CONCURRENCY) {
    const batch = spaces.slice(i, i + HEALTH_CHECK_CONCURRENCY);
    await Promise.allSettled(batch.map((space) => checkSpace(space)));
  }
}

async function checkSpace(space: IndexedSpace): Promise<void> {
  const db = getDb();
  const startTime = Date.now();
  let status: HealthCheckStatus = 'healthy';
  let httpStatus: number | null = null;
  let errorMessage: string | null = null;
  let manifestValid = false;

  try {
    const response = await httpClient.get(space.manifest_url, { timeout: 10000 });
    httpStatus = response.status;

    if (response.status !== 200) {
      status = 'http_error';
      errorMessage = `HTTP ${response.status}`;
    } else {
      const manifest = response.data;
      // Validate required fields
      if (
        manifest?.['@context'] === 'https://atlas-protocol.org/v1' &&
        manifest?.atlas_version &&
        manifest?.platform?.name &&
        manifest?.endpoints?.events &&
        Array.isArray(manifest?.payment_methods) &&
        manifest.payment_methods.length > 0 &&
        Array.isArray(manifest?.signing_keys) &&
        manifest.signing_keys.length > 0
      ) {
        manifestValid = true;
        status = 'healthy';
> **AUDIT FIX [P3-M4]:** External platforms are now re-indexed during health checks.
> When a healthy manifest is fetched, capabilities, payment_methods, and signing_keys
> are updated in the index, ensuring the Registry stays current with platform changes.

      } else {
        status = 'invalid_manifest';
        errorMessage = 'Manifest missing required fields';
      }

      // Re-index manifest data on healthy check (keeps capabilities/keys fresh)
      if (manifestValid) {
        await db('spaces_index')
          .where('id', space.id)
          .update({
            capabilities: manifest.capabilities,
            payment_methods: manifest.payment_methods,
            signing_keys: JSON.stringify(manifest.signing_keys),
            atlas_version: manifest.atlas_version,
            last_indexed_at: new Date(),
          });
      }
    }
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      status = 'timeout';
      errorMessage = `Timeout after 10s`;
    } else {
      status = 'http_error';
      errorMessage = error.message;
    }
  }

  const responseTimeMs = Date.now() - startTime;

  // Insert health check record
  await db('health_checks').insert({
    space_id: space.id,
    status,
    http_status: httpStatus,
    response_time_ms: responseTimeMs,
    error_message: errorMessage,
    manifest_valid: manifestValid,
  });

  // Update space status
  if (status === 'healthy') {
    // Recovery: if was unhealthy, restore to active
    await db('spaces_index')
      .where('id', space.id)
      .update({
        status: 'active',
        last_health_check: new Date(),
        last_health_status: status,
        consecutive_failures: 0,
        updated_at: new Date(),
      });
  } else {
    const newFailures = space.consecutive_failures + 1;
    const newStatus = newFailures >= MAX_CONSECUTIVE_FAILURES ? 'unhealthy' : space.status;

    await db('spaces_index')
      .where('id', space.id)
      .update({
        status: newStatus,
        last_health_check: new Date(),
        last_health_status: status,
        consecutive_failures: newFailures,
        updated_at: new Date(),
      });

    if (newStatus === 'unhealthy' && space.status !== 'unhealthy') {
      logger.warn({
        spaceId: space.id,
        spaceName: space.name,
        consecutiveFailures: newFailures,
      }, 'Space marked unhealthy -- excluded from search');
    }
  }
}
```

---

## 11. MCP Tools for Agent Discovery

Reference pattern: `lemonade-ai/src/app/plugins/mcp.ts` (lines 42-259).

```typescript
// src/app/plugins/mcp.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import * as z from 'zod';
import { federatedSearch } from '../services/federated-search';
import { httpClient } from '../helpers/http-client';
import { getDb } from '../helpers/db';
import { applicationUrl } from '../../config';
import { logger } from '../helpers/logger';

let transport: StreamableHTTPServerTransport;

async function buildServer(): Promise<{ transport: StreamableHTTPServerTransport; server: McpServer }> {
  const transport = new StreamableHTTPServerTransport();

  const server = new McpServer(
    { name: 'atlas-registry-mcp', version: '1.0.0' },
    { capabilities: { logging: {}, prompts: {}, resources: {} } },
  );

  // ── Tool: atlas_search ──────────────────────────────────────────────────

  server.registerTool(
    'atlas_search',
    {
      description: 'Search for events across all Atlas-compliant platforms. Returns events from multiple sources ranked by relevance.',
      inputSchema: z.object({
        q: z.string().optional().describe('Free-text search query'),
        location: z.string().optional().describe('City, region, or country'),
        lat: z.number().min(-90).max(90).optional().describe('Latitude for geo search'),
        lng: z.number().min(-180).max(180).optional().describe('Longitude for geo search'),
        radius_km: z.number().min(1).max(500).optional().describe('Search radius in km (default: 50)'),
        date_from: z.string().optional().describe('Earliest event date (ISO 8601)'),
        date_to: z.string().optional().describe('Latest event date (ISO 8601)'),
        categories: z.array(z.string()).optional().describe('Event categories to filter by'),
        price_max: z.number().optional().describe('Maximum ticket price (USD)'),
        free_only: z.boolean().optional().describe('Only show free events'),
        sort: z.enum(['relevance', 'date_asc', 'date_desc', 'price_asc', 'price_desc', 'distance', 'popularity']).optional(),
        per_page: z.number().min(1).max(50).optional().describe('Results per page (max 50)'),
        page: z.number().min(1).optional(),
      }),
      outputSchema: z.object({
        total_results: z.number(),
        results: z.array(z.object({
          event_name: z.string(),
          event_id: z.string(),
          start_date: z.string(),
          end_date: z.string(),
          location: z.string(),
          price_range: z.string(),
          currency: z.string(),
          availability: z.string(),
          payment_methods: z.array(z.string()),
          source_platform: z.string(),
          organizer: z.string(),
          organizer_verified: z.boolean(),
          purchase_endpoint: z.string(),
        })),
        has_next: z.boolean(),
      }),
    },
    async (input) => {
      const result = await federatedSearch(
        {
          q: input.q,
          location: input.location,
          lat: input.lat,
          lng: input.lng,
          radius_km: input.radius_km,
          date_from: input.date_from,
          date_to: input.date_to,
          categories: input.categories,
          price_max: input.price_max,
          free_only: input.free_only,
          sort: input.sort,
          per_page: input.per_page,
          page: input.page,
        },
        'mcp-tool', // agent ID for MCP tool calls
      );

      const sr = result['atlas:search_result'];

      // Simplify for agent consumption
> **AUDIT FIX [P3-M8]:** MCP output now includes protocol-required fields that were
> previously stripped: `availability`, `payment_methods`, `end_date`, and `currency`.

      const simplified = {
        total_results: sr.total_results,
        results: sr.results.map((r) => ({
          event_name: (r.event['name'] as string) || 'Unknown',
          event_id: (r.event['atlas:id'] as string) || '',
          start_date: (r.event['startDate'] as string) || '',
          end_date: (r.event['endDate'] as string) || '',
          location: formatLocation(r.event['location']),
          price_range: formatPriceRange(r.event['atlas:price_range']),
          currency: ((r.event['atlas:price_range'] as { currency?: string })?.currency) || 'USD',
          availability: (r.event['atlas:availability'] as string) || 'unknown',
          payment_methods: (r.event['atlas:payment_methods'] as string[]) || [],
          source_platform: (r.event['atlas:source_platform'] as string) || '',
          organizer: ((r.event['organizer'] as { name?: string })?.name) || '',
          organizer_verified: (r.event['atlas:organizer_verified'] as boolean) || false,
          purchase_endpoint: (r.event['atlas:purchase_endpoint'] as string) || '',
        })),
        has_next: sr.has_next,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(simplified, null, 2) }],
        structuredContent: simplified,
      };
    },
  );

  // ── Tool: atlas_get_event ───────────────────────────────────────────────

  server.registerTool(
    'atlas_get_event',
    {
      description: 'Get full details for a specific event from any Atlas-compliant Space.',
      inputSchema: z.object({
        event_id: z.string().describe('Atlas event ID (UUID v7)'),
        space_base_url: z.string().optional().describe('Base URL of the Space hosting the event. If omitted, searches all Spaces.'),
      }),
    },
> **AUDIT FIX [P3-H4]:** `atlas_get_event` no longer searches all spaces sequentially
> (50 spaces x 3s = 150s worst case). Now uses parallel fan-out with early termination
> via AbortController when the first match is found. Also strongly recommends
> `space_base_url` parameter which avoids fan-out entirely.

    async (input) => {
      let event: Record<string, unknown> | null = null;

      if (input.space_base_url) {
        // Direct fetch — preferred path, no fan-out needed
        const url = `${input.space_base_url}/atlas/v1/events/${input.event_id}`;
        const response = await httpClient.get(url, { timeout: 5000 });
        event = response.data;
      } else {
        // Parallel fan-out with early termination on first match
        const db = getDb();
        const spaces = await db('spaces_index').where('status', 'active').select('base_url');
        const abortController = new AbortController();

        const promises = spaces.map(async (space) => {
          try {
            if (abortController.signal.aborted) return null;
            const url = `${space.base_url}/atlas/v1/events/${input.event_id}`;
            const response = await httpClient.get(url, {
              timeout: 3000,
              signal: abortController.signal,
            });
            if (response.status === 200 && response.data) {
              abortController.abort(); // Cancel remaining requests
              return response.data;
            }
          } catch {
            // Space didn't have this event — continue
          }
          return null;
        });

        const results = await Promise.allSettled(promises);
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            event = r.value;
            break;
          }
        }
      }

      if (!event) {
        return { content: [{ type: 'text', text: 'Event not found.' }] };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(event, null, 2) }],
        structuredContent: event,
      };
    },
  );

  // ── Tool: atlas_list_ticket_types ───────────────────────────────────────

  server.registerTool(
    'atlas_list_ticket_types',
    {
      description: 'List available ticket types for an event, including prices and availability.',
      inputSchema: z.object({
        event_id: z.string().describe('Atlas event ID'),
        space_base_url: z.string().describe('Base URL of the Space hosting the event'),
      }),
    },
> **AUDIT FIX [P3-H5]:** Endpoint path corrected from `/tickets` to `/ticket-types`
> to match the protocol spec (`PROTOCOL-SPEC.md` Section 4.3).

    async (input) => {
      const url = `${input.space_base_url}/atlas/v1/events/${input.event_id}/ticket-types`;
      const response = await httpClient.get(url, { timeout: 5000 });

      return {
        content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        structuredContent: response.data,
      };
    },
  );

  // ── Tool: atlas_get_organizer ───────────────────────────────────────────

  server.registerTool(
    'atlas_get_organizer',
    {
      description: 'Get an organizer profile including connected accounts, verification level, and stats.',
      inputSchema: z.object({
        organizer_id: z.string().describe('Atlas organizer ID (UUID v7)'),
      }),
    },
    async (input) => {
      const db = getDb();
      const profile = await db('organizer_profiles')
        .where('atlas_organizer_id', input.organizer_id)
        .first();

      if (!profile) {
        return { content: [{ type: 'text', text: 'Organizer not found.' }] };
      }

      // Format per AtlasOrganizerProfile schema (SCHEMAS.md Section 7)
      const formatted = {
        'atlas:organizer_id': profile.atlas_organizer_id,
        name: profile.name,
        email: profile.email,
        avatar: profile.avatar_url,
        bio: profile.bio,
        website: profile.website,
        verification_level: profile.verification_level,
        connected_accounts: profile.connected_accounts,
        stats: {
          total_events: profile.total_events,
          active_events: profile.active_events,
          total_tickets_sold: profile.total_tickets_sold,
          total_revenue_usdc: profile.total_revenue_usdc,
          total_rewards_earned_usdc: profile.total_rewards_earned_usdc,
          member_since: profile.created_at,
          disputes: profile.disputes,
        },
        payout_address: profile.payout_address,
        stripe_connected_account_id: profile.stripe_connected_account_id,
        'atlas:created_at': profile.created_at,
        'atlas:updated_at': profile.updated_at,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
        structuredContent: formatted,
      };
    },
  );

  // ── MCP Resources ──────────────────────────────────────────────────────

  server.registerResource('registry-stats', 'atlas://registry/stats', {
    description: 'Atlas Registry statistics: indexed spaces, query volume, health',
  }, async () => {
    const db = getDb();
    const [spaceCount] = await db('spaces_index').count('* as count');
    const [activeCount] = await db('spaces_index').where('status', 'active').count('* as count');
    const [queryCount] = await db('query_logs').count('* as count');

    const stats = {
      total_indexed_spaces: Number(spaceCount.count),
      active_spaces: Number(activeCount.count),
      total_queries: Number(queryCount.count),
    };

    return {
      contents: [{
        uri: 'atlas://registry/stats',
        mimeType: 'application/json',
        text: JSON.stringify(stats),
      }],
    };
  });

  await server.connect(transport);
  return { transport, server };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatLocation(location: unknown): string {
  if (!location || typeof location !== 'object') return 'Unknown';
  const loc = location as Record<string, unknown>;
  if (loc['@type'] === 'VirtualLocation') return 'Online';
  const addr = loc['address'] as Record<string, string> | undefined;
  if (addr) {
    return [addr['addressLocality'], addr['addressRegion'], addr['addressCountry']]
      .filter(Boolean).join(', ');
  }
  return (loc['name'] as string) || 'Unknown';
}

function formatPriceRange(priceRange: unknown): string {
  if (!priceRange || typeof priceRange !== 'object') return 'Unknown';
  const pr = priceRange as { min_price?: number; max_price?: number; currency?: string };
  if (pr.min_price === 0 && pr.max_price === 0) return 'Free';
  if (pr.min_price === pr.max_price) return `$${pr.min_price}`;
  return `$${pr.min_price} - $${pr.max_price}`;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export const mcpPlugin: FastifyPluginAsync = async (fastify) => {
  const oauthMetadata = {
    issuer: applicationUrl,
    authorization_endpoint: `${applicationUrl}/oauth2/auth`,
    token_endpoint: `${applicationUrl}/oauth2/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
  };

  fastify.get('/.well-known/oauth-authorization-server', async (_, reply) => {
    reply.status(200).send(oauthMetadata);
  });

  fastify.get('/.well-known/oauth-protected-resource', async (_, reply) => {
    reply.status(200).send({
      resource: `${applicationUrl}/mcp`,
      authorization_servers: [applicationUrl],
      scopes_supported: ['atlas-search'],
      resource_name: 'Atlas Registry',
    });
  });

  fastify.post('/mcp', async (req: FastifyRequest, rep: FastifyReply) => {
    if (!transport) {
      const result = await buildServer();
      transport = result.transport;
    }
    await transport.handleRequest(req.raw, rep.raw, req.body);
  });
};
```

---

## 12. REST API Routes

### 12.1 Federated Search

```typescript
// src/app/routes/search.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { federatedSearch } from '../services/federated-search';

const searchQuerySchema = z.object({
  q: z.string().max(256).optional(),
  location: z.string().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().min(1).max(500).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  categories: z.string().optional(),          // comma-separated
  tags: z.string().optional(),                // comma-separated
  price_min: z.coerce.number().min(0).optional(),
  price_max: z.coerce.number().optional(),
  free_only: z.coerce.boolean().optional(),
  availability: z.string().optional(),        // comma-separated
  source_platform: z.string().optional(),
  organizer_id: z.string().optional(),
  organizer_verified: z.coerce.boolean().optional(),
  attendance_mode: z.string().optional(),
  sort: z.enum(['relevance', 'date_asc', 'date_desc', 'price_asc', 'price_desc', 'distance', 'popularity']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  include_sold_out: z.coerce.boolean().optional(),
  payment_methods: z.string().optional(),     // comma-separated
});

export const searchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/search', async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.status(422).send({
        error: {
          code: 'INVALID_REQUEST',
          http_status: 422,
          message: 'Invalid search parameters',
          details: parsed.error.issues,
          atlas_version: '1.0',
        },
      });
      return;
    }

    const q = parsed.data;
    const params = {
      ...q,
      categories: q.categories?.split(',').map((s) => s.trim()),
      tags: q.tags?.split(',').map((s) => s.trim()),
      availability: q.availability?.split(',').map((s) => s.trim()),
      payment_methods: q.payment_methods?.split(',').map((s) => s.trim()),
    };

    const agentId = (request.headers['atlas-agent-id'] as string) || null;

    const result = await federatedSearch(params, agentId);

    reply
      .header('Atlas-Version', '1.0')
      .header('Cache-Control', 'public, max-age=60')
      .send(result);
  });
};
```

### 12.2 Organizer Routes

```typescript
// src/app/routes/organizers.ts

import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../helpers/db';
import { registryBaseUrl } from '../../config';

export const organizerRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /atlas/v1/organizers/:id
  fastify.get('/organizers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const profile = await db('organizer_profiles')
      .where('atlas_organizer_id', id)
      .first();

    if (!profile) {
      reply.status(404).send({
        error: { code: 'NOT_FOUND', http_status: 404, message: 'Organizer not found', atlas_version: '1.0' },
      });
      return;
    }

    // Format per AtlasOrganizerProfile schema (SCHEMAS.md Section 7)
    const formatted = {
      'atlas:organizer_id': profile.atlas_organizer_id,
      name: profile.name,
      email: profile.email,
      avatar: profile.avatar_url,
      bio: profile.bio,
      website: profile.website,
      verification_level: profile.verification_level,
      connected_accounts: profile.connected_accounts,
      stats: {
        total_events: profile.total_events,
        active_events: profile.active_events,
        total_tickets_sold: profile.total_tickets_sold,
        total_revenue_usdc: Number(profile.total_revenue_usdc),
        total_rewards_earned_usdc: Number(profile.total_rewards_earned_usdc),
        member_since: profile.created_at,
        disputes: profile.disputes,
      },
      payout_address: profile.payout_address,
      stripe_connected_account_id: profile.stripe_connected_account_id,
      'atlas:created_at': profile.created_at,
      'atlas:updated_at': profile.updated_at,
    };

    reply.header('Atlas-Version', '1.0').send(formatted);
  });

  // GET /atlas/v1/organizers/:id/manifest.json (auto-generated)
  fastify.get('/organizers/:id/manifest.json', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const profile = await db('organizer_profiles')
      .where('atlas_organizer_id', id)
      .first();

    if (!profile) {
      reply.status(404).send({
        error: { code: 'NOT_FOUND', http_status: 404, message: 'Organizer not found', atlas_version: '1.0' },
      });
      return;
    }

    // Auto-generated organizer manifest per PROTOCOL-SPEC.md Section 3.2
    const manifest = {
      '@context': 'https://atlas-protocol.org/v1',
      atlas_version: '1.0',
      organizer: {
        id: profile.atlas_organizer_id,
        name: profile.name,
        verification_level: profile.verification_level,
        connected_accounts: (profile.connected_accounts || []).map((acc: Record<string, unknown>) => ({
          platform: acc.platform,
          platform_username: acc.platform_username,
          connected: acc.oauth_valid,
          event_count: acc.event_count,
        })),
      },
      stats: {
        total_events: profile.total_events,
        active_events: profile.active_events,
        total_tickets_sold: profile.total_tickets_sold,
      },
      search_url: `${registryBaseUrl}/atlas/v1/search?organizer_id=${id}`,
    };

    reply
      .header('Content-Type', 'application/json')
      .header('Access-Control-Allow-Origin', '*')
      .header('Atlas-Version', '1.0')
      .send(manifest);
  });
};
```

### 12.3 Space Registration (Admin Only)

```typescript
// src/app/routes/register.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';
import { registerExternalPlatform } from '../services/indexer';
import { adminApiKey } from '../../config';

/** Timing-safe string comparison — returns false on length mismatch without leaking info */
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const registerSchema = z.object({
  source_type: z.literal('external_platform'),
  name: z.string().min(1).max(256),
  base_url: z.string().url(),
  description: z.string().max(512).optional(),
  logo_url: z.string().url().optional(),
  contact_email: z.string().email().optional(),
});

> **AUDIT FIX [P3-H3]:** Auth hook now uses `return reply.code(401).send(...)` to
> short-circuit in Fastify. Without the `return`, the handler continues executing
> after sending 401, causing `ERR_HTTP_HEADERS_SENT` double-response errors.

> **AUDIT FIX [P3-M1]:** Admin API key comparison now uses `crypto.timingSafeEqual`
> to prevent timing side-channel attacks on the admin key.

export const registerRoutes: FastifyPluginAsync = async (fastify) => {
  // Admin auth hook for registration
  fastify.addHook('onRequest', async (request, reply) => {
    const authHeader = request.headers['authorization'];
    const expected = `Bearer ${adminApiKey}`;
    if (!authHeader || !timingSafeCompare(authHeader, expected)) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', http_status: 401, message: 'Admin API key required', atlas_version: '1.0' },
      });
    }
  });

  // POST /atlas/v1/register
  fastify.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(422).send({
        error: {
          code: 'INVALID_REQUEST',
          http_status: 422,
          message: 'Invalid registration data',
          details: parsed.error.issues,
          atlas_version: '1.0',
        },
      });
      return;
    }

    try {
      const space = await registerExternalPlatform(parsed.data);
      reply.status(201).send({
        id: space.id,
        name: space.name,
        base_url: space.base_url,
        atlas_endpoint: space.atlas_endpoint,
        status: space.status,
        source_type: space.source_type,
      });
    } catch (err) {
      reply.status(400).send({
        error: {
          code: 'REGISTRATION_FAILED',
          http_status: 400,
          message: (err as Error).message,
          atlas_version: '1.0',
        },
      });
    }
  });
};
```

### 12.4 Agent Registration

```typescript
// src/app/routes/agents.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';
import { registerAgent, rotateAgentKey, getAgentByAtlasId } from '../services/agent-registry';
import { adminApiKey } from '../../config';

/** Timing-safe string comparison */
function timingSafeCompareAgent(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const registerAgentSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(1000).optional(),
  scopes: z.array(z.enum(['search', 'purchase', 'admin'])).optional(),
});

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /atlas/v1/agents/register (admin only)
  fastify.post('/agents/register', async (request, reply) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !timingSafeCompareAgent(authHeader, `Bearer ${adminApiKey}`)) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', http_status: 401, message: 'Admin API key required', atlas_version: '1.0' },
      });
    }

    const parsed = registerAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(422).send({
        error: { code: 'INVALID_REQUEST', http_status: 422, message: 'Invalid agent data', details: parsed.error.issues, atlas_version: '1.0' },
      });
      return;
    }

    const result = await registerAgent(parsed.data);

    // Return the API key ONCE -- it is not stored in plaintext
    reply.status(201).send({
      atlas_agent_id: result.atlas_agent_id,
      api_key: result.api_key,         // plaintext, shown only at creation
      api_key_prefix: result.api_key_prefix,
      scopes: result.scopes,
      search_rate_limit: result.search_rate_limit,
      purchase_rate_limit: result.purchase_rate_limit,
      message: 'Store this API key securely. It will not be shown again.',
    });
  });

  // POST /atlas/v1/agents/:id/rotate-key (admin only)
  fastify.post('/agents/:id/rotate-key', async (request, reply) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !timingSafeCompareAgent(authHeader, `Bearer ${adminApiKey}`)) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', http_status: 401, message: 'Admin API key required', atlas_version: '1.0' },
      });
    }

    const { id } = request.params as { id: string };
    const result = await rotateAgentKey(id);

    reply.send({
      atlas_agent_id: result.atlas_agent_id,
      api_key: result.api_key,
      api_key_prefix: result.api_key_prefix,
      message: 'Previous key is now invalid. Store this new key securely.',
    });
  });
};
```

### 12.5 Health

```typescript
// src/app/routes/health.ts

import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../helpers/db';
import { getRedis } from '../helpers/redis';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /atlas/v1/health
  fastify.get('/health', async (request, reply) => {
    const db = getDb();
    const redis = getRedis();

    const checks: Record<string, string> = {};

    // PostgreSQL
    try {
      await db.raw('SELECT 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'error';
    }

    // Redis
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }

    // Indexed spaces
    const [count] = await db('spaces_index').where('status', 'active').count('* as count');
    const activeSpaces = Number(count.count);

    const allOk = Object.values(checks).every((v) => v === 'ok');

    reply.status(allOk ? 200 : 503).send({
      status: allOk ? 'healthy' : 'degraded',
      checks,
      active_spaces: activeSpaces,
      atlas_version: '1.0',
      timestamp: new Date().toISOString(),
    });
  });
};
```

---

## 13. Agent Registry Service

```typescript
// src/app/services/agent-registry.ts

import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { getDb } from '../helpers/db';
import type { AgentScope } from '../models/types';

// Use bcrypt-compatible hashing (or crypto.scrypt for zero-dep)
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

function hashApiKey(key: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(key, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyApiKey(key: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const verify = scryptSync(key, salt, 64).toString('hex');
  // Timing-safe comparison to prevent timing side-channel attacks
  const hashBuf = Buffer.from(hash, 'hex');
  const verifyBuf = Buffer.from(verify, 'hex');
  if (hashBuf.length !== verifyBuf.length) return false;
  return timingSafeEqual(hashBuf, verifyBuf);
}

function generateApiKey(): string {
  return `atlas_${randomBytes(32).toString('hex')}`;
}

export async function registerAgent(params: {
  name: string;
  description?: string;
  scopes?: AgentScope[];
  owner_user_id?: string;          // E9: Lemonade user ID of registering owner
  owner_self_verified_identity_id?: string; // R4 SV-2: Self.xyz verified identity ID (null if unverified)
}): Promise<{ atlas_agent_id: string; api_key: string; api_key_prefix: string; scopes: AgentScope[]; search_rate_limit: number; purchase_rate_limit: number }> {
  const db = getDb();
  const atlasAgentId = `agt_${randomUUID()}`;
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  const apiKeyPrefix = apiKey.substring(0, 12);
  const scopes = params.scopes || ['search'];

  await db('agent_registrations').insert({
    atlas_agent_id: atlasAgentId,
    name: params.name,
    description: params.description || null,
    api_key_hash: apiKeyHash,
    api_key_prefix: apiKeyPrefix,
    scopes,
    owner_user_id: params.owner_user_id || null, // E9
    owner_self_verified_identity_id: params.owner_self_verified_identity_id || null, // R4 SV-2
    status: 'active',
    key_created_at: new Date(),
  });

  return {
    atlas_agent_id: atlasAgentId,
    api_key: apiKey,
    api_key_prefix: apiKeyPrefix,
    scopes,
    search_rate_limit: 100,
    purchase_rate_limit: 10,
  };
}

export async function rotateAgentKey(atlasAgentId: string): Promise<{ atlas_agent_id: string; api_key: string; api_key_prefix: string }> {
  const db = getDb();
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  const apiKeyPrefix = apiKey.substring(0, 12);

  const updated = await db('agent_registrations')
    .where('atlas_agent_id', atlasAgentId)
    .update({
      api_key_hash: apiKeyHash,
      api_key_prefix: apiKeyPrefix,
      key_created_at: new Date(),
      updated_at: new Date(),
    })
    .returning('atlas_agent_id');

  if (updated.length === 0) {
    throw new Error(`Agent ${atlasAgentId} not found`);
  }

  return { atlas_agent_id: atlasAgentId, api_key: apiKey, api_key_prefix: apiKeyPrefix };
}

export async function getAgentByAtlasId(atlasAgentId: string) {
  const db = getDb();
  return db('agent_registrations').where('atlas_agent_id', atlasAgentId).first();
}

export { verifyApiKey };
```

---

## 14. Referral Attribution Service

```typescript
// src/app/services/referral-tracker.ts

import { getDb } from '../helpers/db';
import { logger } from '../helpers/logger';
import type { FeeSplit, ReferralStatus } from '../models/types';

const PROTOCOL_FEE_PERCENT = 2.0;
const FEE_SPLIT: { treasury: number; organizer_cashback: number; attendee_cashback: number; referral: number } = {
  treasury: 0.40,
  organizer_cashback: 0.30,
  attendee_cashback: 0.20,
  referral: 0.10,
};

/**
 * Record a cross-Space referral transaction.
 * Called when a purchase completes and the atlas-ref parameter traces back
 * to a Registry search that led to the discovery.
 *
 * Fee math (from FEE-STRUCTURE.md) — all in integer micro-units (XP-2):
 *   amountMicro  = transaction_amount * 1_000_000 (or transaction_amount_micro directly)
 *   protocolFee  = floor(amountMicro * 200 / 10000)   // 2%
 *   treasury     = floor(protocolFee * 4000 / 10000)   // 40%
 *   organizer    = floor(protocolFee * 3000 / 10000)   // 30%
 *   attendee     = floor(protocolFee * 2000 / 10000)   // 20%
 *   referral     = floor(protocolFee * 1000 / 10000)   // 10%
 */
> **AUDIT FIX R2 [E9]:** Self-referral prevention. Before recording a referral,
> check if the purchasing agent's registered owner matches the Space owner. If
> `agent_registration.owner_user_id === space.owner_user_id`, set referral fee to $0
> and log as "self-referral blocked." This prevents agents from earning referral fees
> on purchases routed through their own Space.

> **AUDIT FIX R3 [F-2]:** Known limitation: the E9 self-referral check is bypassed by
> creating a second Lemonade account. `agent_owner_user_id !== space_owner_user_id`
> passes because they are different user IDs owned by the same person.
> **Mitigation (heuristic flags — do NOT block automatically, too many false positives):**
> 1. If agent registration IP matches Space owner's registration IP, flag for manual review.
> 2. If agent and Space owner accounts were registered within 1 hour of each other, flag.
> 3. Monthly automated report: top 20 referral-earning agents by volume. Manual review.
> These flags are stored on `referral_transactions.review_flags JSONB DEFAULT '[]'`.
> A scheduled monthly job (`atlas-referral-review-report`) aggregates flagged referrals
> and sends to admin dashboard for human review.

> **AUDIT FIX R4 [SV-2]:** Self.xyz verified identity comparison resolves F-2 (self-referral
> bypass via second account). When BOTH the agent owner AND the Space owner are Self-verified,
> compare their `selfVerifiedIdentityId`. If the same identity → block referral (same person
> operating two accounts). If different identities → allow (genuinely different people).
> For unverified users, keep the existing F-2 heuristic flags (IP/email/timing).
> This is a hard block (not a flag) because Self verification proves unique personhood —
> same identity ID = definitively the same person. No false positive risk.

export async function recordReferral(params: {
  atlas_ref: string;
  source_space_id?: string;
  target_space_id?: string;
  agent_id?: string;
  event_id: string;
  receipt_id?: string;
  transaction_amount: number;
  transaction_amount_micro?: number; // XP-2: preferred — integer micro-units from calling Space
}): Promise<void> {
  const db = getDb();

  // E9: Self-referral detection — block referral fee when agent owner === space owner
  let selfReferralBlocked = false;
  // F-2: Heuristic flags for multi-account self-referral bypass (manual review, not auto-block)
  const reviewFlags: string[] = [];

  if (params.agent_id && params.target_space_id) {
    // Look up the agent's owner_user_id from agent_registrations
    // R4 SV-2: Also fetch owner_self_verified_identity_id for Self.xyz identity comparison
    const agent = await db('agent_registrations')
      .where('atlas_agent_id', params.agent_id)
      .select('owner_user_id', 'owner_self_verified_identity_id', 'registration_ip', 'created_at')
      .first();

    // Look up the target Space's owner from spaces_index → lemonade-backend
    // The spaces_index stores lemonade_space_id; we need the Space owner.
    // Option: Add owner_user_id to spaces_index (populated during indexing from backend response).
    // For now, query the space's owner_user_id from spaces_index (see schema addition below).
    // R4 SV-2: Also fetch owner_self_verified_identity_id for Self.xyz identity comparison
    const space = await db('spaces_index')
      .where('id', params.target_space_id)
      .select('owner_user_id', 'owner_self_verified_identity_id', 'owner_registration_ip', 'owner_created_at')
      .first();

    if (agent?.owner_user_id && space?.owner_user_id &&
        agent.owner_user_id === space.owner_user_id) {
      selfReferralBlocked = true;
      logger.warn({
        agent_id: params.agent_id,
        space_id: params.target_space_id,
        owner_user_id: agent.owner_user_id,
      }, 'E9: Self-referral blocked — agent owner matches Space owner');
    }

    // SV-2: Self.xyz verified identity comparison — resolves F-2 bypass via second account
    // When BOTH parties are Self-verified, compare their selfVerifiedIdentityId.
    // Same identity = same person operating two accounts → hard block.
    // Different identity = genuinely different people → allow.
    if (!selfReferralBlocked &&
        agent?.owner_self_verified_identity_id && space?.owner_self_verified_identity_id) {
      if (agent.owner_self_verified_identity_id === space.owner_self_verified_identity_id) {
        selfReferralBlocked = true;
        logger.warn({
          agent_id: params.agent_id,
          space_id: params.target_space_id,
          self_identity_id: agent.owner_self_verified_identity_id,
        }, 'SV-2: Self-referral blocked — same Self.xyz verified identity (multi-account bypass detected)');
      } else {
        // Different verified identities — explicitly allow, skip F-2 heuristics
        logger.info({
          agent_id: params.agent_id,
          space_id: params.target_space_id,
        }, 'SV-2: Different Self.xyz identities confirmed — referral allowed');
      }
    }

    // F-2: Heuristic flags for multi-account self-referral (different user IDs, same person)
    // SV-2: Skip F-2 heuristics if both parties are Self-verified with DIFFERENT identities —
    // verified different people don't need heuristic suspicion checks
    const bothVerifiedDifferent = agent?.owner_self_verified_identity_id &&
      space?.owner_self_verified_identity_id &&
      agent.owner_self_verified_identity_id !== space.owner_self_verified_identity_id;
    if (!selfReferralBlocked && !bothVerifiedDifferent && agent && space) {
      // Flag 1: Same IP at registration time
      if (agent.registration_ip && space.owner_registration_ip &&
          agent.registration_ip === space.owner_registration_ip) {
        reviewFlags.push('same_registration_ip');
        logger.info({
          agent_id: params.agent_id,
          space_id: params.target_space_id,
          ip: agent.registration_ip,
        }, 'F-2: Referral flagged — agent and Space owner share registration IP');
      }

      // Flag 2: Accounts registered within 1 hour of each other
      if (agent.created_at && space.owner_created_at) {
        const diffMs = Math.abs(
          new Date(agent.created_at).getTime() - new Date(space.owner_created_at).getTime()
        );
        if (diffMs < 3600_000) { // 1 hour
          reviewFlags.push('accounts_registered_within_1h');
          logger.info({
            agent_id: params.agent_id,
            space_id: params.target_space_id,
            diff_minutes: Math.round(diffMs / 60_000),
          }, 'F-2: Referral flagged — agent and Space owner registered within 1 hour');
        }
      }
    }
  }

> **AUDIT FIX R3 [XP-2]:** Replaced float multiplication with integer micro-unit math.
> Phase 4 uses BigInt micro-units; Phase 3 was using JavaScript floats, producing
> different results for non-round amounts (e.g., $25.37 * 0.02 = 0.5074 vs 507400 micro).
> Now: accept `transaction_amount_micro` as integer from calling Space (preferred),
> or convert `transaction_amount` to micro-units via `Math.round(amount * 1_000_000)`.
> All fee splits use integer arithmetic with `Math.floor` — no floating point.

  // XP-2: Convert to integer micro-units (1 USDC = 1_000_000 micro-units)
  // Prefer transaction_amount_micro if provided by caller (avoids float conversion entirely).
  // Fallback: convert float transaction_amount to micro-units (lossy for non-round amounts).
  const amountMicro = params.transaction_amount_micro ?? Math.round(params.transaction_amount * 1_000_000);

  // All fee math in integer micro-units — no floating point
  const protocolFeeMicro = Math.floor(amountMicro * 200 / 10000); // 2%

  // If self-referral detected, zero out the referral portion; redistribute to treasury
  const referralBps = selfReferralBlocked ? 0 : 1000; // FEE_SPLIT.referral = 0.10 = 1000 bps
  const treasuryBps = selfReferralBlocked
    ? 4000 + 1000  // treasury (40%) + referral share (10%) goes to treasury
    : 4000;        // FEE_SPLIT.treasury = 0.40

  const feeSplitMicro = {
    treasury: Math.floor(protocolFeeMicro * treasuryBps / 10000),
    organizer_cashback: Math.floor(protocolFeeMicro * 3000 / 10000), // 30%
    attendee_cashback: Math.floor(protocolFeeMicro * 2000 / 10000),  // 20%
    referral: Math.floor(protocolFeeMicro * referralBps / 10000),     // 10% or 0%
  };

  // Convert back to USDC decimal for storage (DECIMAL(12,6) column)
  const microToUsdc = (micro: number) => micro / 1_000_000;
  const protocolFee = microToUsdc(protocolFeeMicro);
  const feeSplit: FeeSplit = {
    treasury: microToUsdc(feeSplitMicro.treasury),
    organizer_cashback: microToUsdc(feeSplitMicro.organizer_cashback),
    attendee_cashback: microToUsdc(feeSplitMicro.attendee_cashback),
    referral: microToUsdc(feeSplitMicro.referral),
  };

  await db('referral_transactions').insert({
    atlas_ref: params.atlas_ref,
    source_space_id: params.source_space_id || null,
    target_space_id: params.target_space_id || null,
    agent_id: params.agent_id || null,
    event_id: params.event_id,
    receipt_id: params.receipt_id || null,
    transaction_amount: params.transaction_amount,
    referral_fee: protocolFee,
    fee_split: feeSplit,
    status: selfReferralBlocked ? 'self_referral_blocked' as ReferralStatus : 'pending' as ReferralStatus,
    review_flags: JSON.stringify(reviewFlags), // F-2: heuristic flags for manual review
  });

  logger.info({
    atlas_ref: params.atlas_ref,
    event_id: params.event_id,
    amount: params.transaction_amount,
    fee: protocolFee,
    self_referral_blocked: selfReferralBlocked,
    review_flags: reviewFlags, // F-2
  }, selfReferralBlocked ? 'Self-referral recorded with $0 referral fee' : 'Referral transaction recorded');
}
```

> **AUDIT FIX [P3-H6]:** `recordReferral()` was defined but never called. Added a
> callback endpoint `POST /atlas/v1/referrals` that Spaces call when a purchase
> completes with an `atlas_ref` query parameter. This is the mechanism that triggers
> referral attribution.

```typescript
// src/app/routes/referrals.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { recordReferral } from '../services/referral-tracker';

const referralCallbackSchema = z.object({
  atlas_ref: z.string().min(1).max(128),
  event_id: z.string().min(1),
  receipt_id: z.string().optional(),
  transaction_amount: z.number().positive(),        // USDC decimal (legacy — used as fallback)
  transaction_amount_micro: z.number().int().positive().optional(), // XP-2: preferred — integer micro-units (1 USDC = 1_000_000)
  source_space_id: z.string().uuid().optional(),
  target_space_id: z.string().uuid().optional(),
  agent_id: z.string().optional(),
});

export const referralRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /atlas/v1/referrals — callback from Spaces when a purchase completes
  // with an atlas_ref parameter (indicating Registry-mediated discovery)
  fastify.post('/referrals', async (request, reply) => {
    const parsed = referralCallbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({
        error: {
          code: 'INVALID_REQUEST',
          http_status: 422,
          message: 'Invalid referral callback data',
          details: parsed.error.issues,
          atlas_version: '1.0',
        },
      });
    }

    await recordReferral(parsed.data);

    reply.code(201).send({
      status: 'recorded',
      atlas_ref: parsed.data.atlas_ref,
    });
  });
};
```

**Route registration:** Add to `src/app/index.ts`:
```typescript
import { referralRoutes } from './routes/referrals';
import { reportRoutes } from './routes/reports';
// ... in createApp():
await app.register(referralRoutes, { prefix: '/atlas/v1' });
await app.register(reportRoutes, { prefix: '/atlas/v1' });
```

> **AUDIT FIX R2 [E14]:** Report mechanism for suspicious Spaces. `POST /v1/report`
> allows agents and users to flag Spaces for impersonation, fake events, scams, or spam.
> After a configurable threshold (default: 3 pending reports), the Space is automatically
> de-listed (`status: 'pending_validation'`) pending manual review.

```typescript
// src/app/routes/reports.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDb } from '../helpers/db';
import { logger } from '../helpers/logger';

const REPORT_DELIST_THRESHOLD = 3; // After N pending reports, auto-delist

const reportSchema = z.object({
  space_id: z.string().uuid(),
  reporter_type: z.enum(['agent', 'user']),
  reporter_id: z.string().min(1).max(128),
  reason: z.enum(['impersonation', 'fake_events', 'scam', 'spam', 'other']),
  description: z.string().max(1000).optional(),
});

export const reportRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /atlas/v1/report — report a suspicious Space
  fastify.post('/report', async (request, reply) => {
    const parsed = reportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({
        error: {
          code: 'INVALID_REQUEST',
          http_status: 422,
          message: 'Invalid report data',
          details: parsed.error.issues,
          atlas_version: '1.0',
        },
      });
    }

    const db = getDb();
    const { space_id, reporter_type, reporter_id, reason, description } = parsed.data;

    // Verify Space exists
    const space = await db('spaces_index').where('id', space_id).first();
    if (!space) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', http_status: 404, message: 'Space not found', atlas_version: '1.0' },
      });
    }

    // Insert report (unique constraint prevents duplicate pending reports from same reporter)
    try {
      await db('space_reports').insert({
        space_id,
        reporter_type,
        reporter_id,
        reason,
        description: description || null,
        status: 'pending',
      });
    } catch (err) {
      // Duplicate report — unique constraint violation
      if ((err as Error).message?.includes('unique') || (err as Error).message?.includes('duplicate')) {
        return reply.code(409).send({
          error: { code: 'DUPLICATE_REPORT', http_status: 409, message: 'You have already reported this Space', atlas_version: '1.0' },
        });
      }
      throw err;
    }

    // Check if threshold reached — auto-delist
    const [{ count }] = await db('space_reports')
      .where('space_id', space_id)
      .where('status', 'pending')
      .count('* as count');

    if (Number(count) >= REPORT_DELIST_THRESHOLD && space.status === 'active') {
      await db('spaces_index')
        .where('id', space_id)
        .update({ status: 'pending_validation', updated_at: new Date() });

      logger.warn({
        space_id,
        space_name: space.name,
        report_count: Number(count),
      }, 'E14: Space auto-delisted after reaching report threshold');
    }

    reply.code(201).send({
      status: 'reported',
      space_id,
      message: 'Report submitted for review. Thank you.',
    });
  });
};
```

---

## 15. Rate Limiting Middleware

```typescript
// src/app/helpers/rate-limiter.ts

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getRedis } from './redis';
import { searchRateLimit, purchaseRateLimit } from '../../config';

/**
 * Per-agent rate limiting keyed by Atlas-Agent-Id.
 * Uses Redis sliding window counter.
 *
 * Protocol spec (PROTOCOL-SPEC.md Section 11.3):
 * - Search: 100 requests/minute
 * - Purchase: 10 requests/minute
 * - Rate limit responses MUST include Retry-After header
 */
export async function checkRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  type: 'search' | 'purchase',
): Promise<boolean> {
  const agentId = request.headers['atlas-agent-id'] as string;
  if (!agentId) return true; // Unauthenticated requests use IP-based @fastify/rate-limit

  const redis = getRedis();
  const limit = type === 'search' ? searchRateLimit : purchaseRateLimit;
  const key = `atlas:ratelimit:${type}:${agentId}`;
  const now = Date.now();
  const windowMs = 60_000;

  // Sliding window
  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, now - windowMs);
  multi.zadd(key, now.toString(), `${now}:${Math.random()}`);
  multi.zcard(key);
  multi.expire(key, 120);

  const results = await multi.exec();
  const count = results?.[2]?.[1] as number || 0;

  if (count > limit) {
    reply
      .status(429)
      .header('Retry-After', '60')
      .header('X-RateLimit-Limit', limit.toString())
      .header('X-RateLimit-Remaining', '0')
      .send({
        error: {
          code: 'RATE_LIMITED',
          http_status: 429,
          message: `Rate limit exceeded. Maximum ${limit} ${type} requests per minute.`,
          retry_after: 60,
          atlas_version: '1.0',
        },
      });
    return false;
  }

  reply.header('X-RateLimit-Limit', limit.toString());
  reply.header('X-RateLimit-Remaining', (limit - count).toString());
  return true;
}
```

---

## 16. Deployment

### 16.1 Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false
COPY . .
RUN yarn build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/knexfile.js ./

EXPOSE 3100
CMD ["node", "dist/bin/app.js"]
```

### 16.2 Kubernetes Resources

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: atlas-registry
  labels:
    app: atlas-registry
spec:
  replicas: 2
  selector:
    matchLabels:
      app: atlas-registry
  template:
    metadata:
      labels:
        app: atlas-registry
    spec:
      containers:
      - name: atlas-registry
        image: ${ECR_REPO}/atlas-registry:latest
        ports:
        - containerPort: 3100
        envFrom:
        - configMapRef:
            name: atlas-registry-config
        - secretRef:
            name: atlas-registry-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /livez
            port: 3100
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /atlas/v1/health
            port: 3100
          initialDelaySeconds: 5
          periodSeconds: 10

---
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: atlas-registry-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: atlas-registry
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## 17. Coordination Points

### 17.1 Phase 2 Dependency

The indexer needs an internal endpoint from lemonade-backend to discover Atlas-enabled Spaces. The Phase 2 implementer must expose:

```
GET /internal/atlas/spaces
Authorization: Bearer <INTERNAL_SERVICE_TOKEN>

Response: [{
  _id: string,           // MongoDB ObjectId
  slug: string,          // Space.slug (space.ts:109)
  title: string,         // from Whitelabel.title
  description: string,   // from Whitelabel.description
  base_url: string,      // custom domain or subdomain
  image_avatar: string,  // Space.image_avatar (space.ts:141)
  owner_user_id: string,  // E9: Space owner's Lemonade user ID (for self-referral detection)
  owner_self_verified_identity_id: string | null, // R4 SV-2: Space owner's Self.xyz identity ID (null if unverified)
  paid_event_count: number,   // R4 FT-4: count of events with at least one paid ticket type
  total_event_count: number   // R4 FT-4: total event count for this Space
}]
```

**Verified field references in lemonade-backend:**
- `Space.slug` -- `/Users/kc/Documents/Lemonade Repos/lemonade-backend/src/app/models/space.ts:109`
- `Space.image_avatar` -- `/Users/kc/Documents/Lemonade Repos/lemonade-backend/src/app/models/space.ts:141`
- `Space.payment_accounts` -- `/Users/kc/Documents/Lemonade Repos/lemonade-backend/src/app/models/space.ts:179`
- `Space.subscription_tier` -- `/Users/kc/Documents/Lemonade Repos/lemonade-backend/src/app/models/space.ts:231`

### 17.2 Event Flow: Space Changes

When a Space is created/updated/deleted in lemonade-backend, the indexer needs to know. Two options:

**Option A (recommended at launch):** Polling. The indexer runs every 15 minutes and re-fetches the full Space list. Simple, no cross-service coupling.

**Option B (future optimization):** Webhook/event bus. lemonade-backend publishes Space change events to Redis PubSub or an SNS topic. The indexer subscribes and indexes immediately. Implement when the 15-minute lag becomes a problem.

### 17.3 MPP PRD Cross-References

- **PRD #5 (Micropayment Insights):** The `query_logs` table provides the analytics data that the Registry can sell as insights. Agent query patterns, popular events, search trends -- all captured here.
- **PRD #8 (Agent Sessions):** Agent session deposits for multi-query agents. The `agent_registrations` table and rate limiter support this. Session deposits would add a `session_balance` column and debit per query.

---

## 18. Testing Strategy

### Unit Tests
- Manifest validation logic (valid, missing fields, wrong context)
- Relevance scoring (verified organizers, proximity, freshness)
- Cache key generation (deterministic, pagination-aware)
- Fee split calculation (2% with 40/30/20/10)
- Rate limit logic

### Integration Tests
- Full federated search with mocked downstream Spaces
- Indexer with mocked backend API
- Health checker with mocked manifest endpoints
- Agent registration and key rotation

### Load Tests
- Fan-out to 50+ Spaces with 3s timeout
- P95 response time < 2 seconds (per PROTOCOL-SPEC.md Section 3.4)
- Rate limiting under sustained load

---

## 19. Execution Status

| Task | Status | Assignee |
|------|--------|----------|
| Project scaffolding | NOT STARTED | -- |
| PostgreSQL schema + migrations | NOT STARTED | -- |
| Fastify app setup | NOT STARTED | -- |
| Space indexer service | NOT STARTED | -- |
| Federated search service | NOT STARTED | -- |
| Relevance scoring | NOT STARTED | -- |
| Health checker service | NOT STARTED | -- |
| MCP tools | NOT STARTED | -- |
| REST API routes | NOT STARTED | -- |
| Agent registration | NOT STARTED | -- |
| Referral tracking | NOT STARTED | -- |
| Rate limiting | NOT STARTED | -- |
| Docker + K8s config | NOT STARTED | -- |
| Unit tests | NOT STARTED | -- |
| Integration tests | NOT STARTED | -- |

---

## 20. Open Questions (for Lead Agent)

1. **Internal backend endpoint:** Should this be a REST endpoint on the admin port (8080) or a new route on the main Koa app? The admin port is preferred for service-to-service calls.
2. **Redis DB allocation:** lemonade-ai uses DB3 (per CLAUDE.md). What DB number should atlas-registry use? Suggest DB5 to leave room.
3. **PostgreSQL hosting:** Separate RDS instance or shared with any existing PostgreSQL? lemonade-ai already uses Prisma with pg -- is there a shared PG instance?
4. **Domain:** Is `registry.atlas-protocol.org` the target domain, or will it be `registry.lemonade.social` initially?

---

## 21. Known Limitations (from Audit)

> **AUDIT FIX [P3-M7]:** Geo-spatial pre-filtering columns (`primary_lat`, `primary_lng`)
> have been added to the `spaces_index` schema, but the full geo-spatial pre-filtering
> logic (skip Spaces >500km from query center before fan-out) is deferred. Requires:
> (1) populating lat/lng from Space manifests or backend data,
> (2) Haversine distance calculation in the federated search query builder,
> (3) determining whether virtual-only Spaces should be exempt from geo-filtering.
> The schema is ready; the service code should be implemented when the Space count
> exceeds ~50 and fan-out latency becomes a measurable bottleneck.
