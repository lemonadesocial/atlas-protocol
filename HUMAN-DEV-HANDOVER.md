# Human Dev Handover — Complete Deployment Guide

All code is written by agents. You only need to configure infrastructure and deploy.

## Overview of what's being deployed

1. **Atlas Protocol** — agent-driven event discovery, ticketing, and settlement (7 PRs across 4 repos)
2. **RDS Migration** — guest lists, check-ins, tickets, payments, ticket types, subscribers migrated from MongoDB to PostgreSQL (2 PRs on lemonade-backend)
3. **Lemonade CLI** — command-line tool for developers and AI agents (separate repo)
4. **Atlas Registry** — new Fastify service for federated event search (separate repo)

## What human devs need to do (6 tasks)

### Task 1: Verify RDS is ready

You already have an RDS PostgreSQL 16 instance. The Atlas and RDS migration schemas are created automatically by migration files on deploy. Verify:

- RDS instance is accessible from lemonade-backend's VPC
- Existing `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD` env vars are set (they already are in CDK)
- The PostgreSQL connection has capacity for the new schemas (events.*, spaces.*, atlas.*)

No new database needs to be created. The migrations create schemas within the existing `lemonade` database.

### Task 2: Add Atlas environment variables to CDK

#### lemonade-backend (add these to the existing service):
```
ATLAS_ENABLED=true
ATLAS_INTERNAL_SECRET=<generate-random-64-char-string>
ATLAS_VC_SIGNING_KEY=<ES256-private-key-base64>
ATLAS_VC_SIGNING_KEY_ID=atlas-key-1
ATLAS_VC_ISSUER_DID=did:web:lemonade.social
```

To generate the ES256 signing key:
```bash
openssl ecparam -genkey -name prime256v1 -noout | openssl ec -outform PEM | base64 -w0
```

#### lemonade-ai (add to existing service):
```
ATLAS_REGISTRY_URL=http://<registry-internal-url>:3100
```
Note: `LEMONADE_BACKEND_URL` likely already exists. Verify it points to the backend.

#### web-new (add to existing service):
```
NEXT_PUBLIC_ATLAS_REGISTRY_URL=https://<registry-public-url>
```

### Task 3: Create Atlas Registry service in CDK

The atlas-registry is a NEW service that needs its own deployment:

- Docker image: built from the `atlas-registry` repo
- Node.js 22
- Port: 3100
- Health check: `GET /health`
- Min replicas: 2, Max: 10
- CPU: 512, Memory: 1024

Environment variables:
```
PORT=3100
DATABASE_URL=postgresql://<user>:<password>@<rds-host>:5432/atlas_registry
REDIS_URL=redis://<redis-host>:6379/5
LEMONADE_BACKEND_URL=http://<backend-internal-url>:4000
ATLAS_INTERNAL_SECRET=<same-value-as-lemonade-backend>
ADMIN_API_KEY=<generate-random-64-char-string>
NODE_ENV=production
```

The registry needs its own database. Either:
- Create a new database on the existing RDS: `CREATE DATABASE atlas_registry;`
- Or use a separate RDS instance

For staging, same RDS instance with a new database is fine.

### Task 4: Register OAuth client for CLI

Register a public OAuth client in Ory Hydra on identity.lemonade.social:

- Client name: `lemonade-cli`
- Grant types: `authorization_code`, `refresh_token`
- Response types: `code`
- Token endpoint auth method: `none` (public client, PKCE only)
- Redirect URIs:
  ```
  http://localhost:9876/callback
  http://localhost:9877/callback
  http://localhost:9878/callback
  http://localhost:9879/callback
  http://localhost:9880/callback
  http://localhost:9881/callback
  http://localhost:9882/callback
  http://localhost:9883/callback
  http://localhost:9884/callback
  http://localhost:9885/callback
  http://localhost:9886/callback
  ```
- Scopes: `openid`, `offline_access`, plus whatever scopes lemonade APIs require

After registration, provide the `client_id` to KC for the CLI config.

### Task 5: Deploy all services

Deploy in this order:

1. **lemonade-backend** (with new env vars) — migrations run automatically on startup:
   - Creates `atlas` schema with 13 Atlas tables
   - Creates `events` schema with 5 tables + 1 materialized view
   - Creates `spaces` schema with 1 table + 1 materialized view
   - Seeds recurring Agenda jobs

2. **atlas-registry** (new service) — migrations run on first deploy

3. **lemonade-ai** (with new env var) — no migrations

4. **web-new** (with new env var) — no migrations

### Task 6: Confirm deploy is successful

After all services are deployed, confirm the migrations ran and tables exist. An agent session will handle the backfill script and verification — you just need to confirm the infrastructure is up.

```bash
# Quick check — PostgreSQL schemas exist
psql $DATABASE_URL -c "\dn"
# Should show: atlas, events, spaces (in addition to existing ai, api, public)
```

## What you do NOT need to do

- Write any SQL (migrations handle everything)
- Create schemas or tables (migrations handle everything)
- Write any code (agents wrote everything)
- Set up connection pooling (existing pg-promise config handles it)
- Migrate data manually (backfill script handles it)

## Verification after deploy

```bash
# Atlas endpoints
curl https://staging-api.lemonade.social/.well-known/atlas.json
# Should return JSON manifest

curl https://staging-api.lemonade.social/atlas/v1/search?q=test
# Should return search results or empty array

# PostgreSQL schemas created
psql $DATABASE_URL -c "\dt atlas.*"   # 13 Atlas tables
psql $DATABASE_URL -c "\dt events.*"  # 5 events tables
psql $DATABASE_URL -c "\dt spaces.*"  # 1 spaces table

# Registry health
curl http://<registry-url>:3100/health
# Should return OK

# Reconciliation job running
# Check logs for "pg-reconciliation" entries every 15 minutes
```

## Rollback

### Quick disable Atlas (no rollback needed):
Set `ATLAS_ENABLED=false` on lemonade-backend and redeploy. Atlas endpoints disappear. Everything else works normally.

### Full rollback:
Revert each merge commit on master: `git revert -m 1 <merge-commit-hash>`

### RDS migration rollback:
The backfill is one-way (MongoDB → PostgreSQL). MongoDB data is NEVER deleted. If PostgreSQL has issues, the code can be reverted to read from MongoDB again. No data loss in either direction.

## Timeline

Your work: ~3 hours total
- Task 1 (verify RDS): 15 min
- Task 2 (env vars): 30 min
- Task 3 (registry service): 1-2 hours
- Task 4 (OAuth client): 30 min
- Task 5 (deploy): 30 min
- Task 6 (confirm deploy): 5 min

Backfill, verification, and reconciliation are handled by agents after you confirm deploy is up.

## Questions?

Reach out to KC. Technical details are in:
- `atlas-protocol/DEPLOYMENT-CHECKLIST.md` — full deployment steps with env var table
- `atlas-protocol/impl/IMPL-POSTGRESQL-MIGRATION.md` — Atlas PostgreSQL schema details
- `atlas-protocol/PRD-POSTGRESQL-MIGRATION.md` — broader RDS migration plan
- `atlas-protocol/impl/IMPL-RDS-MIGRATION.md` — events/spaces migration details
