# Hostile Audit Checklist

Standard checklist for every adversarial audit. Every item must be checked. No shortcuts. No "probably fine."

---

## When to use this

- Before any PR creation clearance
- Before any merge approval
- After any remap or rebase
- After any fix round
- On local master after merging all phases

---

## PART 1: Build and Type Safety

Run on EVERY branch being audited:

```bash
# TypeScript build
yarn build 2>&1 | grep "error TS" | head -20
# MUST be zero

# Lint (zero errors, warnings OK)
yarn lint 2>&1 | grep " error " | head -20
# MUST be zero errors
```

If auditing merged master, also run per-branch builds:
```bash
git stash
git checkout <branch>
yarn build 2>&1 | grep "error TS" | head -10
git checkout -
git stash pop
```

---

## PART 2: Security

### SQL Injection
```bash
# String interpolation in SQL queries (CRITICAL if found)
grep -rn '`.*\${.*}`' src/ --include="*.ts" | grep -i "sql\|query\|SELECT\|INSERT\|UPDATE\|DELETE\|WHERE\|FROM\|INTO\|SET " | grep -v "test\|__tests__\|\.test\." | head -20

# Template literals near database calls
grep -rn '`.*\${' src/ --include="*.ts" | grep -i "db\.\|\.query\|\.none\|\.one\|\.any\|\.tx" | grep -v "test\|__tests__" | head -20
```
ALL SQL must use positional parameters ($1, $2). Zero string interpolation.

### SSRF
```bash
# User input in URLs without validation
grep -rn "fetch\|axios\|http\.get\|undici" src/ --include="*.ts" | grep -v "test\|node_modules" | head -20
```
Any user-supplied URL must be validated (HTTPS only, no private IPs).

### Auth bypass
```bash
# Endpoints without auth middleware
grep -rn "router\.\(get\|post\|put\|delete\)" src/app/routers/ --include="*.ts" | grep -v "auth\|internal\|health\|well-known" | head -20
```
Every non-public endpoint must have auth middleware.

### Secrets in code
```bash
grep -rn "password\|secret\|api_key\|private_key\|token" src/ --include="*.ts" | grep -v "test\|node_modules\|\.d\.ts\|process\.env\|config\.\|param\|type\|interface\|import" | head -20
```
Zero hardcoded secrets.

---

## PART 3: Function Call Arity

Check that function calls match function signatures:

```bash
# Find all exported functions in changed files, check their call sites
# For each function: compare parameter count at definition vs call site
```

This caught the P5 syncAttendees bug (3 args passed, 2 expected). Manual check — read function signature, grep for call sites, verify arg count matches.

---

## PART 4: Cross-Phase Contracts

For every interface between phases, verify both sides match:

### Field names
```bash
# Phase 1→2: ExternalEventMapping field
grep -n "lemonadeEventId" src/app/models/external-event-mapping.ts src/app/services/atlas/purchase.ts

# Phase 2→4: Agenda job payload
grep -A20 "agenda.now.*atlas-process-fee" src/app/services/atlas/purchase.ts
grep -A20 "job.attrs.data" src/app/jobs/atlas-process-fee.ts

# Phase 2→6: 402 response
grep -n "atlas:challenge\|ticket_hold_id" src/app/middlewares/atlas-mpp.ts
# Compare with lemonade-ai:
grep -n "atlas:challenge\|ticket_hold_id" ../lemonade-ai/src/app/plugins/mcp-atlas-tools.ts

# Phase 2→6: Free ticket redirect
grep -n "free_ticket_redirect" src/app/controllers/atlas/purchase.ts
grep -n "free_ticket_redirect" ../lemonade-ai/src/app/plugins/mcp-atlas-tools.ts

# Phase 4→7: Reward resolvers
grep -n "atlasRewardSummary\|atlasRewardHistory" src/graphql/resolvers/atlas-reward.ts
grep -rn "atlasRewardSummary\|atlasRewardHistory" ../web-new/lib/
```

Every pair must use identical field names and types.

### Agenda job payloads
For every `agenda.now()` call, verify the payload fields match what the job handler destructures.

### REST/GraphQL response schemas
For every endpoint consumed by another service, verify the response fields match what the consumer reads.

---

## PART 5: Data Integrity

### MongoDB → PostgreSQL type mapping
For every migrated model:
- ObjectId → VARCHAR(24)
- String BigInt → DECIMAL(20,0) for USDC micro-units
- Number (dollars) → DECIMAL(12,2) for USD
- Date → TIMESTAMPTZ
- Boolean → BOOLEAN
- Embedded doc → JSONB
- String array → TEXT[]
- Enum string → VARCHAR with CHECK constraint

### No raw $inc on string fields
```bash
grep -rn "\$inc" src/ --include="*.ts" | grep -i "usdc\|amount\|balance\|fee\|reward" | head -10
```
Zero results for monetary string fields. All monetary updates use SQL arithmetic or aggregation pipeline with $toLong.

### Mongoose elimination (for migrated models)
```bash
grep -rn "@prop\|@modelOptions\|getModelForClass\|import.*typegoose\|import.*mongoose" src/app/models/atlas-*.ts 2>/dev/null
```
Zero results for models that should be on PostgreSQL.

### Deleted model imports
```bash
grep -rn "import.*OldModelName" src/app/services/ src/app/jobs/ src/graphql/ src/app/controllers/ --include="*.ts" | head -20
```
Zero imports of model class names that no longer exist.

---

## PART 6: Migration Integrity

```bash
# List all migration files
find src -name "*.sql" -path "*migration*" | sort

# Check for duplicate timestamps
find src -name "*.sql" -path "*migration*" | sed 's/.*\///' | cut -d'-' -f1 | sort | uniq -d
# MUST be empty

# Verify up and down pairs exist
# Every .sql should have a .down.sql
```

---

## PART 7: AI Artifacts

### Source code
```bash
# AUDIT FIX tags
grep -rn "AUDIT FIX\|AUDIT_FIX" src/ --include="*.ts" | head -10

# AI attribution
grep -rn "Co-Authored-By.*[Cc]laude\|Co-Authored-By.*[Aa]nthropic" src/ --include="*.ts" | head -10

# AI tool references
grep -rn "claude\|anthropic\|IMPL\|session\|prompt\|subagent" src/ --include="*.ts" | grep -v "node_modules\|anthropic.*model\|anthropic.*provider\|ai-models" | head -10
```
Zero results (except legitimate LLM provider references in AI model config).

### Commit messages
```bash
git log origin/master..HEAD --format="%H %s%n%b" | grep -i "co-authored-by.*claude\|co-authored-by.*anthropic" | head -10
```
Zero results for public repos. Acceptable for private repos per team decision.

### Em dashes
```bash
# In new/changed files only
git diff origin/master --name-only | xargs grep -n '—' 2>/dev/null | head -10
```
Zero em dashes in new files (pre-existing in unchanged files is acceptable).

---

## PART 8: Contamination

### Cross-phase file contamination
For each branch, verify ONLY that phase's files are present:
```bash
git diff origin/master --name-only | sort
```
Flag any files that belong to a different phase.

### Cross-repo contamination
```bash
# No backend files in AI repo, no AI files in web repo, etc.
git diff origin/master --name-only | grep -v "src/\|lib/\|package\|tsconfig\|yarn" | head -10
```

---

## PART 9: Working Tree Cleanliness

```bash
git status --short
# MUST be empty (zero uncommitted files)

git stash list
# Note any stashes (don't fail, just document)
```

---

## PART 10: Route and Endpoint Integrity

```bash
# Duplicate routes
grep -n "router\.\(get\|post\|put\|delete\)" src/app/routers/*.ts | sort -t: -k3 | head -20
# Manual check: no duplicate method+path combos

# Missing routes (referenced in code but not defined)
# Check controller imports in router match actual controller exports
```

---

## PART 11: Test Integrity

```bash
# Tests exist for new code
find src -name "*.test.ts" -newer <reference-file> | sort

# Tests pass
yarn test 2>&1 | tail -10

# No mocking of the wrong thing (e.g., mocking Mongoose when code uses pg-promise)
grep -rn "sinon\.\(stub\|mock\)" src/ --include="*.test.ts" | grep -i "Model\.\|findOne\|updateOne\|aggregate" | head -10
# If testing pg-promise code, should stub db.one/db.none, NOT Mongoose methods
```

---

## PART 12: Performance and Resource

### Connection pool
```bash
grep -rn "pool\|max.*connections\|poolSize" src/ --include="*.ts" | grep -v "node_modules" | head -10
```

### Unbounded queries
```bash
grep -rn "\.find(\|\.any(" src/ --include="*.ts" | grep -v "limit\|LIMIT\|test\|node_modules" | head -20
```
Flag any query without a LIMIT clause that could return unbounded results.

### N+1 queries
Manual check: look for loops that make database calls per iteration instead of batch queries.

---

## PART 13: JSONB and Complex Types

```bash
# NULL handling on JSONB operations
grep -rn "|| \$\|jsonb\|JSONB\|::jsonb" src/ --include="*.ts" | grep -v "test\|node_modules" | head -10
```
Every JSONB merge must use COALESCE for NULL safety:
```sql
field = COALESCE(field, '{}'::jsonb) || $1::jsonb  -- objects
field = COALESCE(field, '[]'::jsonb) || $1::jsonb   -- arrays
```

---

## PART 14: Feature Flags

```bash
# All feature flags referenced in code exist in config
grep -rn "PG_DUAL_WRITE\|PG_READ\|PG_PRIMARY\|ATLAS_ENABLED\|isAtlasEnabled" src/ --include="*.ts" | grep -v "test\|node_modules" | head -20

# Verify they're defined in config
grep -rn "PG_DUAL_WRITE\|PG_READ\|PG_PRIMARY\|ATLAS_ENABLED" src/config/ --include="*.ts" | head -10
```

---

## PART 15: Backfill and Data Migration

For any data migration scripts:
- Idempotent (ON CONFLICT or upsert)
- Cursor-based pagination (not loading all docs into memory)
- Batch size specified (1000 or less)
- ObjectId conversion documented (toHexString for VARCHAR(24), or ObjectId timestamp extraction for created_at)
- NULL/missing field handling (COALESCE or explicit default)
- Progress logging

---

## Scoring

After running all 15 parts:

| Result | Action |
|---|---|
| Zero issues across all parts | APPROVE — clear for merge/PR |
| Only LOW/MEDIUM issues | APPROVE with fix list — fixes can be done post-approval |
| Any HIGH issue | BLOCK — must fix before approval |
| Any CRITICAL issue | BLOCK — must fix, re-audit after fix |

---

## Usage

When writing an audit prompt, include:
"Follow the checklist at atlas-protocol/impl/HOSTILE-AUDIT-CHECKLIST.md. Run EVERY part. Skip nothing."
