# Atlas Protocol — Deployment Checklist

Complete these steps to deploy Atlas to staging. All code is merged — this is infrastructure and configuration only.

## Pre-requisites

- [ ] All 7 PRs merged to master across all repos
- [ ] Post-merge task applied: add 'meetup' to connector sync scheduler filter (PENDING-FIXES.md P5-POST-1)

---

## 1. Atlas Registry — New Service

The atlas-registry is a new Fastify service that needs its own deployment.

### Infrastructure (lemonade-cdk)

- [ ] Create new ECS task definition for atlas-registry
  - Docker image built from `atlas-registry/` repo
  - Node.js 22
  - Port: 3100
  - Health check: `GET /health`
  - Min replicas: 2, Max: 10
  - CPU: 512, Memory: 1024 (adjust based on load)

- [ ] Create PostgreSQL database for the registry
  - New RDS instance OR new database on existing RDS
  - Run migrations on first deploy: `yarn migrate`

- [ ] Redis access
  - Can share existing ElastiCache, use a different DB number (e.g., DB 5)
  - OR create dedicated Redis if preferred

- [ ] Set environment variables for atlas-registry:
  ```
  PORT=3100
  DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/atlas_registry
  REDIS_URL=redis://<host>:6379/5
  LEMONADE_BACKEND_URL=http://<backend-internal-url>:4000
  ATLAS_INTERNAL_SECRET=<generate-random-64-char-string>
  ADMIN_API_KEY=<generate-random-64-char-string>
  HEALTH_CHECK_INTERVAL_MINUTES=15
  SEARCH_CACHE_TTL_SECONDS=60
  MAX_FANOUT_CONCURRENCY=20
  NODE_ENV=production
  ```

---

## 2. lemonade-backend — Enable Atlas

No new infrastructure. Just env vars on the existing service.

- [ ] Add environment variables:
  ```
  ATLAS_ENABLED=true
  ATLAS_INTERNAL_SECRET=<same-value-as-registry>
  ATLAS_VC_SIGNING_KEY=<generate-ES256-private-key>
  ATLAS_VC_SIGNING_KEY_ID=atlas-key-1
  ATLAS_VC_ISSUER_DID=did:web:lemonade.social
  ```

- [ ] Generate the ES256 signing key for Verifiable Credentials:
  ```bash
  openssl ecparam -genkey -name prime256v1 -noout -out atlas-vc-key.pem
  openssl ec -in atlas-vc-key.pem -text -noout
  # Set the private key as ATLAS_VC_SIGNING_KEY (base64 encoded PEM)
  ```

- [ ] Deploy updated lemonade-backend code
- [ ] Run new migrations (they run automatically on deploy if migrate-on-start is configured)
- [ ] Verify Atlas endpoints respond:
  ```bash
  curl https://staging-api.lemonade.social/.well-known/atlas.json
  # Should return manifest JSON
  curl https://staging-api.lemonade.social/atlas/v1/search?q=test
  # Should return search results (or empty array)
  ```

---

## 3. lemonade-ai — Enable Atlas MCP Tools

No new infrastructure. Just env vars on the existing service.

- [ ] Add environment variables:
  ```
  ATLAS_REGISTRY_URL=http://<registry-internal-url>:3100
  LEMONADE_BACKEND_URL=http://<backend-internal-url>:4000
  ```
  Note: LEMONADE_BACKEND_URL may already be set. Verify it points to the correct backend.

- [ ] Deploy updated lemonade-ai code
- [ ] Verify MCP tools are registered:
  - Connect via MCP client
  - `atlas_search`, `atlas_compare_tickets`, `atlas_purchase`, `atlas_get_receipt` should appear as available tools

---

## 4. web-new — Enable Atlas Frontend

No new infrastructure. Just one env var.

- [ ] Add environment variable:
  ```
  NEXT_PUBLIC_ATLAS_REGISTRY_URL=https://<registry-public-url>
  ```

- [ ] Deploy updated web-new code
- [ ] Verify Atlas UI:
  - `/explore/atlas` page loads with search bar
  - AI chat can find events
  - Reward dashboard shows in Space management (or "coming soon" fallback)

---

## 5. Post-Deploy Verification

Run these checks after all 4 services are deployed:

- [ ] Atlas manifest: `GET /.well-known/atlas.json` returns valid JSON
- [ ] Atlas search: `GET /atlas/v1/search?q=music` returns results
- [ ] Atlas ticket listing: `GET /atlas/v1/events/<id>/tickets` returns ticket types
- [ ] Atlas purchase flow: `POST /atlas/v1/events/<id>/purchase` returns 402 challenge
- [ ] Registry health: `GET <registry-url>/health` returns OK
- [ ] Registry federated search: `GET <registry-url>/v1/search?q=music` returns federated results
- [ ] MCP tools work: AI agent can search events via atlas_search tool
- [ ] Frontend: /explore/atlas shows events
- [ ] Connectors: Space settings shows Eventbrite and Lu.ma connector options

---

## 6. Rollback Plan

If anything breaks:

### Quick disable (no rollback needed)
Set `ATLAS_ENABLED=false` on lemonade-backend and redeploy. Atlas endpoints disappear. Everything else works normally.

### Full rollback
Revert each merge commit on master:
```bash
git revert -m 1 <merge-commit-hash>
```
One revert per phase. Existing functionality is unaffected because all Atlas code is additive.

---

## Environment Variable Summary

| Service | Variable | Value | Required |
|---|---|---|---|
| lemonade-backend | ATLAS_ENABLED | true | Yes |
| lemonade-backend | ATLAS_INTERNAL_SECRET | random 64-char | Yes |
| lemonade-backend | ATLAS_VC_SIGNING_KEY | ES256 PEM (base64) | Yes |
| lemonade-backend | ATLAS_VC_SIGNING_KEY_ID | atlas-key-1 | Yes |
| lemonade-backend | ATLAS_VC_ISSUER_DID | did:web:lemonade.social | Yes |
| atlas-registry | DATABASE_URL | postgresql://... | Yes |
| atlas-registry | REDIS_URL | redis://... | Yes |
| atlas-registry | LEMONADE_BACKEND_URL | http://backend:4000 | Yes |
| atlas-registry | ATLAS_INTERNAL_SECRET | same as backend | Yes |
| atlas-registry | ADMIN_API_KEY | random 64-char | Yes |
| atlas-registry | PORT | 3100 | Yes |
| lemonade-ai | ATLAS_REGISTRY_URL | http://registry:3100 | Yes |
| lemonade-ai | LEMONADE_BACKEND_URL | http://backend:4000 | Likely exists |
| web-new | NEXT_PUBLIC_ATLAS_REGISTRY_URL | https://registry-url | Yes |
