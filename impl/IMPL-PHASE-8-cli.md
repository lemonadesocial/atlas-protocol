# IMPL-PHASE-8: Lemonade CLI

**Phase:** 8 -- Lemonade CLI
**Status:** Ready for Lead Routing
**Date:** 2026-03-19
**Author:** Bridge Agent
**Target:** New greenfield npm package (`lemonade-cli`)
**Depends on:** Phase 2 (Atlas REST endpoints), Phase 3 (Registry federated search), Phase 4 (USDC reward system), Phase 6 (MCP tools -- CLI mirrors these as shell commands)
**Breaking changes to existing repos:** None. The CLI is a pure consumer of existing APIs.

> **AUDIT FIX W4 [1]:** CLI purchase flow requires the P2-NEW-1 checkout endpoint (`POST /atlas/v1/holds/:hold_id/checkout`), which is on the Phase 2 branch (`feat/atlas-phase-2-protocol`, PR be#1992) and not yet merged. See `atlas-protocol/impl/PENDING-FIXES.md` Section "Phase 2 -- Checkout URL Endpoint". The CLI cannot ship until Phase 2 with the P2-NEW-1 endpoint is deployed. The `lemonade tickets buy` and `lemonade tickets receipt` commands are non-functional without it.

---

## Table of Contents

1. [Execution Summary](#1-execution-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Project Structure](#3-project-structure)
4. [Dependencies](#4-dependencies)
5. [Task 1: Authentication System](#5-task-1-authentication-system)
6. [Task 2: API Client Layer](#6-task-2-api-client-layer)
7. [Task 3: Output Formatting](#7-task-3-output-formatting)
8. [Task 4: Space Commands](#8-task-4-space-commands)
9. [Task 5: Event Commands](#9-task-5-event-commands)
10. [Task 6: Ticket Commands](#10-task-6-ticket-commands)
11. [Task 7: Rewards Commands](#11-task-7-rewards-commands)
12. [Task 8: Site Commands](#12-task-8-site-commands)
13. [Task 9: Connector Commands](#13-task-9-connector-commands)
14. [Task 10: Config Commands](#14-task-10-config-commands)
15. [Task 11: Auth Commands](#15-task-11-auth-commands)
16. [Testing Strategy](#16-testing-strategy)
17. [Publishing and Distribution](#17-publishing-and-distribution)
18. [AI Agent Usage Examples](#18-ai-agent-usage-examples)
19. [Auto-Sync with Backend APIs](#19-auto-sync-with-backend-apis)
20. [Execution Status](#20-execution-status)

---

## 1. Execution Summary

Build `lemonade-cli` as a standalone npm package that wraps every Lemonade API into shell commands. The CLI serves two audiences: human developers managing Spaces and events from the terminal, and AI agents (Claude Code, Codex, Cursor) that need structured JSON output and deterministic error codes.

The CLI calls three backend surfaces:

1. **lemonade-backend GraphQL** -- Space, event, ticket, connector, page mutations and queries via the existing `ai-tool` resolvers (`lemonade-backend/src/graphql/resolvers/ai-tool.ts`).
2. **Atlas REST endpoints** -- Federated search, ticket purchasing, receipt retrieval via `/atlas/v1/*` (`lemonade-backend/src/app/routers/atlas.ts`, Phase 2).
3. **Atlas Registry** -- Federated cross-Space search via `GET /atlas/v1/search` (`atlas-registry/src/app/routes/search.ts`, Phase 3).

**Design principles:**

- Every command works fully via flags. Interactive prompts are a fallback for humans, never required.
- `--json` flag on every command produces machine-parseable JSON output with consistent envelope.
- Exit codes are deterministic: 0 success, 1 user error, 2 auth error, 3 network error.
- All authentication via API key (env var or config file) or OAuth token. No session cookies.
- Pagination via `--limit` and `--cursor` on all list commands.
- Zero changes to any existing repository. Additive only.

> **AUDIT FIX W4-R2 [3]:** Complete command-to-transport mapping (44 commands).

### Command Transport Map

| Command | Transport | Target |
|---------|-----------|--------|
| **Auth (3)** | | |
| `auth login` | Local | OAuth browser flow, stores token locally |
| `auth token` | GraphQL | `aiGetMe` to validate key, stores locally |
| `auth whoami` | GraphQL | `aiGetMe` on lemonade-backend |
| **Space (8)** | | |
| `space create` | GraphQL | `aiCreateSpace` on lemonade-backend |
| `space list` | GraphQL | `aiListMySpaces` on lemonade-backend |
| `space update` | GraphQL | `aiUpdateSpace` on lemonade-backend |
| `space connect` | GraphQL | `connectPlatform` + `submitApiKey` on lemonade-backend |
| `space connectors` | GraphQL | `spaceConnections` on lemonade-backend |
| `space analytics` | GraphQL | `aiGetSpaceStats` on lemonade-backend |
| `space plan` | GraphQL + Local | `getSpace` + `aiGetSpaceStats` + `spaceConnections` on lemonade-backend; tier limits hardcoded locally |
| `space upgrade` | Local | Opens browser URL, no API call |
| **Event (13)** | | |
| `event create` | GraphQL | `aiCreateEvent` on lemonade-backend |
| `event list` | GraphQL | `aiGetHostingEvents` on lemonade-backend |
| `event search` | Atlas REST | `GET /atlas/v1/search` on atlas-registry |
| `event get` | GraphQL | `aiGetEvent` on lemonade-backend |
| `event update` | GraphQL | `aiUpdateEvent` on lemonade-backend |
| `event publish` | GraphQL | `aiPublishEvent` on lemonade-backend |
| `event cancel` | GraphQL | `aiCancelEvent` on lemonade-backend |
| `event analytics` | GraphQL | 3 parallel queries on lemonade-backend |
| `event guests` | GraphQL | `aiGetEventGuests` on lemonade-backend |
| `event invite` | GraphQL | `aiInviteEvent` on lemonade-backend |
| `event approvals` | GraphQL | `aiDecideEventJoinRequests` on lemonade-backend |
| `event feedback` | GraphQL | `aiGetEventFeedbackSummary` + `aiListEventFeedbacks` on lemonade-backend |
| `event checkins` | GraphQL | `aiGetEventCheckins` on lemonade-backend |
| **Tickets (6)** | | |
| `tickets types` | GraphQL | `aiListEventTicketTypes` on lemonade-backend |
| `tickets create-type` | GraphQL | `aiCreateEventTicketType` on lemonade-backend |
| `tickets update-type` | GraphQL | `aiUpdateEventTicketType` on lemonade-backend |
| `tickets buy` | Atlas REST | `POST /atlas/v1/events/:id/purchase` + `POST /atlas/v1/holds/:id/checkout` on lemonade-backend |
| `tickets price` | GraphQL | `aiCalculateTicketPrice` on lemonade-backend |
| `tickets receipt` | Atlas REST | `GET /atlas/v1/receipts/by-hold/:id` on lemonade-backend |
| **Rewards (5)** | | |
| `rewards balance` | GraphQL | `atlasRewardSummary` on lemonade-backend (Phase 4) |
| `rewards history` | GraphQL | `atlasRewardHistory` on lemonade-backend (Phase 4) |
| `rewards payouts` | GraphQL | `atlasPayoutHistory` on lemonade-backend (Phase 4) |
| `rewards referral` | GraphQL | `atlasReferralSummary` / `atlasGenerateReferralCode` / `atlasApplyReferralCode` (Phase 4) |
| `rewards settings` | GraphQL | `atlasGetPayoutSettings` / `atlasUpdatePayoutSettings` (Phase 4) |
| **Site (4)** | | |
| `site generate` | GraphQL | `aiGeneratePageFromDescription` on lemonade-backend |
| `site preview` | GraphQL + Local | `getPageConfig` to verify, then opens browser URL |
| `site deploy` | GraphQL | `publishPageConfig` on lemonade-backend |
| `site templates` | GraphQL | `aiSuggestSections` on lemonade-backend |
| **Connectors (2)** | | |
| `connectors list` | GraphQL | `availableConnectors` on lemonade-backend |
| `connectors sync` | GraphQL | `executeConnectorAction` on lemonade-backend |
| **Config (3)** | | |
| `config init` | Local | Creates `~/.lemonade/config.json` |
| `config set` | Local | Writes to `~/.lemonade/config.json` |
| `config get` | Local | Reads from `~/.lemonade/config.json` |

**Summary:** 35 GraphQL, 3 Atlas REST, 6 Local-only. Total: 44 commands.

---

## 2. Architecture Overview

```
lemonade-cli (npm package)
    |
    src/
    |-- commands/
    |   |-- manual/            # Hand-written commands (override generated)
    |   |   |-- auth.ts        # login, token, whoami
    |   |   |-- tickets-buy.ts # Custom checkout URL flow
    |   |   |-- site.ts        # generate, preview, deploy, templates
    |   |   |-- config.ts      # set, get, init
    |   |
    |   |-- generated/         # Auto-generated from MCP schema (committed to git)
    |   |   |-- search-events.ts
    |   |   |-- create-event.ts
    |   |   |-- ...            # One file per MCP tool
    |   |
    |   |-- index.ts           # Loader: manual first, then generated (manual wins)
    |
    |-- codegen/               # MCP schema codegen pipeline
    |   |-- generate.ts        # Reads mcp-schema.json, writes generated/ commands
    |   |-- templates.ts       # Command file templates
    |   |-- schema-check.ts    # Schema version compatibility checker
    |
    |-- api/                   # HTTP clients for each backend surface
    |   |-- graphql.ts         # GraphQL client (lemonade-backend)
    |   |-- atlas.ts           # Atlas REST client (lemonade-backend /atlas/v1)
    |   |-- registry.ts        # Atlas Registry client (atlas-registry /atlas/v1)
    |
    |-- auth/                  # Auth token management
    |   |-- store.ts           # Read/write ~/.lemonade/config.json
    |   |-- oauth.ts           # Browser-based OAuth flow
    |
    |-- output/                # Output formatting
    |   |-- json.ts            # JSON envelope formatter
    |   |-- table.ts           # Human-readable table formatter
    |   |-- error.ts           # Error formatting + exit codes
    |
    |-- config/                # Config file management
    |   |-- index.ts           # Config reader/writer
    |   |-- defaults.ts        # Default configuration values
    |
    |-- index.ts               # CLI entry point (Commander program)
```

### Codegen Pipeline

```
lemonade-ai build
    |
    yarn export-mcp-schema
    |
    dist/mcp-schema.json         # Single source of truth for operations
    |
    (npm publish / CI artifact)
    |
lemonade-cli
    |
    yarn generate                # Reads mcp-schema.json
    |
    src/commands/generated/      # One file per MCP tool (committed)
    |
    src/commands/manual/         # Hand-written overrides (never overwritten)
    |
    src/commands/index.ts        # Merges both (manual wins on conflict)
```

### Request Flow

```
User runs: lemonade event search "techno berlin"
    |
    v
Commander.js parses command + flags
    |
    v
auth/store.ts reads API key from:
  1. --api-key flag (highest priority)
  2. LEMONADE_API_KEY env var
  3. ~/.lemonade/config.json api_key field
    |
    v
api/registry.ts sends:
  GET https://registry.atlas-protocol.org/atlas/v1/search?q=techno+berlin
  Headers: Authorization: Bearer <api_key>, Atlas-Agent-Id: cli:lemonade-cli
    |
    v
output/table.ts or output/json.ts formats response
    |
    v
stdout (exit 0) or stderr (exit 1/2/3)
```

### API Surface Mapping

| CLI surface | Backend | Transport | Auth |
|-------------|---------|-----------|------|
| Space CRUD, members, analytics | lemonade-backend | GraphQL | API key via `x-ai-kratos-id` header |
| Event CRUD, publish, cancel | lemonade-backend | GraphQL | API key via `x-ai-kratos-id` header |
| Ticket types, pricing, discounts | lemonade-backend | GraphQL | API key via `x-ai-kratos-id` header |
| Connector management | lemonade-backend | GraphQL | API key via `x-ai-kratos-id` header |
| Page generation, deploy | lemonade-backend | GraphQL | API key via `x-ai-kratos-id` header |
| Federated event search | atlas-registry | REST | `Atlas-Agent-Id` header |
| Atlas event details, tickets | lemonade-backend | REST `/atlas/v1` | `Atlas-Agent-Id` + optional auth |
| Atlas ticket purchase | lemonade-backend | REST `/atlas/v1` | `Authorization` + `Atlas-Agent-Id` |
| Atlas receipt retrieval | lemonade-backend | REST `/atlas/v1` | `Authorization` + `Atlas-Agent-Id` |
| Reward balance, history, settings | lemonade-backend | GraphQL | API key via `x-ai-kratos-id` header |

---

## 3. Project Structure

```
lemonade-cli/
  src/
    index.ts                          # Entry point, Commander program setup
    commands/
      index.ts                        # Command loader: manual first, generated second
      manual/                         # Hand-written commands (never overwritten by codegen)
        auth.ts                       # login, token, whoami
        tickets-buy.ts                # Custom checkout URL flow
        tickets-receipt.ts            # Poll-based receipt check
        site.ts                       # generate, preview, deploy, templates
        config.ts                     # set, get, init
        space-connect.ts              # OAuth + API key flow
        space-upgrade.ts              # Browser URL, no API call
        space-plan.ts                 # Multi-query aggregation
        rewards-settings.ts           # Read-or-write based on flags
        rewards-referral.ts           # generate, apply, summary
      generated/                      # Auto-generated from MCP schema (committed to git)
        search-events.ts              # Generated from MCP tool
        create-event.ts               # Generated from MCP tool
        ...                           # One file per MCP tool (~30 files)
        _schema-version.json          # Tracks which schema version generated these
      extended/                       # Auto-generated from GraphQL introspection (committed)
        get-space.ts                  # Generated from GraphQL query
        create-event-ticket-discount.ts
        ...                           # One file per GraphQL operation (~70 files)
        _introspection-version.json   # Tracks which backend version generated these
    codegen/                          # MCP schema codegen pipeline
      generate.ts                     # Reads mcp-schema.json, writes generated/ commands
      templates.ts                    # Command file templates (flag generation, output)
      schema-check.ts                 # Schema version compatibility checker
    api/
      graphql.ts                      # GraphQL request client
      atlas.ts                        # Atlas REST client
      registry.ts                     # Atlas Registry REST client
      types.ts                        # Shared response types (inlined from MCP + GraphQL schemas)
    auth/
      store.ts                        # API key + token storage (~/.lemonade/config.json)
      oauth.ts                        # OAuth2 browser flow (PKCE)
    output/
      json.ts                         # --json envelope: { ok, data, error, cursor }
      table.ts                        # Human table output (column alignment, truncation)
      error.ts                        # Error classification + exit codes
    config/
      index.ts                        # Config file reader/writer
      defaults.ts                     # Default values
  tests/
    unit/
      commands/                       # Command parsing tests
      codegen/                        # Codegen pipeline tests
      api/                            # API client tests (mocked HTTP)
      output/                         # Formatter tests
      auth/                           # Auth store tests
    integration/
      auth.test.ts                    # OAuth flow integration
      space.test.ts                   # Space CRUD against staging
      event.test.ts                   # Event CRUD against staging
      search.test.ts                  # Atlas search against staging
  mcp-schema.json                     # Fetched from lemonade-ai build artifact
  package.json
  tsconfig.json
  .eslintrc.js
  README.md
  bin/
    lemonade                          # Shebang entry: #!/usr/bin/env node
```

---

## 4. Dependencies

```json
{
  "name": "lemonade-cli",
  "version": "0.1.0",
  "description": "Lemonade CLI -- manage Spaces, events, and tickets from the terminal",
  "bin": {
    "lemonade": "./dist/index.js"
  },
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "lint": "eslint src/",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "open": "^10.1.0",
    "chalk": "^5.3.0",
    "cli-table3": "^0.6.5",
    "ora": "^8.0.1",
    "conf": "^13.0.1"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0",
    "nock": "^14.0.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

**Why these choices:**

- `commander` -- industry standard CLI framework, minimal footprint, excellent TypeScript support
- `open` -- cross-platform browser opening for OAuth flow
- `chalk` -- terminal color output for human-readable mode
- `cli-table3` -- table formatting for list commands
- `ora` -- spinner for long-running operations (suppressed in `--json` mode)
- `conf` -- cross-platform config file management with atomic writes
- `nock` -- HTTP mocking for unit tests
- `vitest` -- fast test runner with native TypeScript support

Zero runtime dependency on `@anthropic-ai/sdk`, `graphql`, or any heavy framework. The CLI uses plain `fetch()` (Node 18+ built-in) for all HTTP calls.

---

## 5. Task 1: Authentication System

### 5.1 Config File

**File:** `src/auth/store.ts`

The CLI stores credentials in `~/.lemonade/config.json`. The config file is created on first `lemonade auth login` or `lemonade auth token`.

```typescript
// src/auth/store.ts

import Conf from 'conf';
import { homedir } from 'os';
import { join } from 'path';

export interface LemonadeConfig {
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: number;        // Unix timestamp ms
  default_space?: string;           // Space ID
  output_format?: 'json' | 'table'; // Default output format
  api_url?: string;                 // Override backend URL
  registry_url?: string;            // Override registry URL
}

const CONFIG_DIR = join(homedir(), '.lemonade');

const store = new Conf<LemonadeConfig>({
  projectName: 'lemonade',
  cwd: CONFIG_DIR,
  configName: 'config',
  fileExtension: 'json',
  defaults: {
    api_url: 'https://backend.lemonade.social',
    registry_url: 'https://registry.atlas-protocol.org',
    output_format: 'table',
  },
});

> **AUDIT FIX W4-R2 [11]:** Auth resolution order matches the stated priority:
> (1) `--api-key` flag, (2) `LEMONADE_API_KEY` env var, (3) config `access_token` (OAuth), (4) config `api_key`.

// The --api-key flag value is injected by the command handler before calling getAuthHeader().
// It is set via setFlagApiKey() so the resolution chain picks it up first.
let flagApiKey: string | undefined;

export function setFlagApiKey(key: string | undefined): void {
  flagApiKey = key;
}

export function getAuthHeader(): string | undefined {
  // Priority 1: --api-key flag (set by command handler)
  if (flagApiKey) return `Bearer ${flagApiKey}`;

  // Priority 2: LEMONADE_API_KEY env var
  const envKey = process.env.LEMONADE_API_KEY;
  if (envKey) return `Bearer ${envKey}`;

  // Priority 3: OAuth access_token from config (if not expired)
  const accessToken = store.get('access_token');
  const expiresAt = store.get('token_expires_at');
  if (accessToken && expiresAt && Date.now() < expiresAt) {
    return `Bearer ${accessToken}`;
  }

  // Priority 4: API key from config
  const configKey = store.get('api_key');
  if (configKey) return `Bearer ${configKey}`;

  return undefined;
}

export function getApiUrl(): string {
  return process.env.LEMONADE_API_URL || store.get('api_url') || 'https://backend.lemonade.social';
}

export function getRegistryUrl(): string {
  return process.env.LEMONADE_REGISTRY_URL || store.get('registry_url') || 'https://registry.atlas-protocol.org';
}

export function setApiKey(key: string): void {
  store.set('api_key', key);
}

export function setTokens(access: string, refresh: string, expiresIn: number): void {
  store.set('access_token', access);
  store.set('refresh_token', refresh);
  store.set('token_expires_at', Date.now() + expiresIn * 1000);
}

export function clearAuth(): void {
  store.delete('api_key');
  store.delete('access_token');
  store.delete('refresh_token');
  store.delete('token_expires_at');
}

export function getConfig(): LemonadeConfig {
  return store.store;
}

export function setConfig(key: keyof LemonadeConfig, value: string): void {
  store.set(key, value);
}

export function getConfigPath(): string {
  return store.path;
}
```

### 5.2 OAuth Browser Flow

**File:** `src/auth/oauth.ts`

Implements OAuth2 Authorization Code with PKCE (S256), matching the pattern in `lemonade-ai/src/app/plugins/mcp.ts:298-330`.

```typescript
// src/auth/oauth.ts

import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import open from 'open';
import { getApiUrl, setTokens } from './store';

const CLIENT_ID = 'lemonade-cli';
const BASE_REDIRECT_PORT = 9876;
const MAX_PORT_ATTEMPTS = 10;
const SCOPES = ['claudeai'];

// > **AUDIT FIX W4-R2 [13]:** Port fallback: try 9876, if bound try 9877-9886, fail after 10 attempts.
async function findAvailablePort(): Promise<number> {
  const net = await import('net');
  for (let port = BASE_REDIRECT_PORT; port < BASE_REDIRECT_PORT + MAX_PORT_ATTEMPTS; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => { tester.close(); resolve(true); })
        .listen(port);
    });
    if (available) return port;
  }
  throw new Error(`No available port in range ${BASE_REDIRECT_PORT}-${BASE_REDIRECT_PORT + MAX_PORT_ATTEMPTS - 1}`);
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function loginWithBrowser(): Promise<{ success: boolean; error?: string }> {
  const apiUrl = getApiUrl();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString('hex');
  const port = await findAvailablePort();
  const redirectUri = `http://localhost:${port}/callback`;

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${port}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Login failed</h2><p>You can close this tab.</p></body></html>');
        server.close();
        resolve({ success: false, error });
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Invalid callback</h2></body></html>');
        server.close();
        resolve({ success: false, error: 'Invalid state or missing code' });
        return;
      }

      // Exchange code for tokens
      try {
        const tokenResponse = await fetch(`${apiUrl}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: CLIENT_ID,
            code_verifier: codeVerifier,
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error(`Token exchange failed: ${tokenResponse.status}`);
        }

        const tokens = await tokenResponse.json() as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };

        setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Login successful!</h2><p>You can close this tab and return to the terminal.</p></body></html>');
        server.close();
        resolve({ success: true });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Token exchange failed</h2></body></html>');
        server.close();
        resolve({ success: false, error: (err as Error).message });
      }
    });

    server.listen(port, () => {
      const authUrl = new URL(`${apiUrl}/oauth2/auth`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', SCOPES.join(' '));
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      open(authUrl.toString());
    });

    // Timeout after 120 seconds
    setTimeout(() => {
      server.close();
      resolve({ success: false, error: 'Login timed out (120s)' });
    }, 120_000);
  });
}
```

### 5.3 Auth Resolution Order

For every authenticated request, the CLI resolves credentials in this order:

1. `--api-key <key>` flag on the command (highest priority)
2. `LEMONADE_API_KEY` environment variable
3. `access_token` from `~/.lemonade/config.json` (from OAuth login)
4. `api_key` from `~/.lemonade/config.json` (from `lemonade auth token`)

If none found, the command exits with code 2 and the message: `Not authenticated. Run "lemonade auth login" or set LEMONADE_API_KEY.`

---

## 6. Task 2: API Client Layer

### 6.1 GraphQL Client

**File:** `src/api/graphql.ts`

Calls lemonade-backend GraphQL. Mirrors the auth pattern from `lemonade-backend/src/graphql/resolvers/ai-tool.ts:1-20` where requests are authenticated via the `x-ai-kratos-id` header or `Authorization` bearer token.

```typescript
// src/api/graphql.ts

import { getApiUrl, getAuthHeader } from '../auth/store';

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

export class GraphQLError extends Error {
  constructor(
    message: string,
    public code: string | undefined,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'GraphQLError';
  }
}

export async function graphqlRequest<T>(
  operation: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const apiUrl = getApiUrl();
  const auth = getAuthHeader();

  if (!auth) {
    throw new GraphQLError('Not authenticated', 'UNAUTHENTICATED', 401);
  }

  const response = await fetch(`${apiUrl}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': auth,
    },
    body: JSON.stringify({ query: operation, variables }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new GraphQLError('Authentication failed', 'UNAUTHENTICATED', response.status);
    }
    throw new GraphQLError(
      `Backend returned ${response.status}`,
      'INTERNAL',
      response.status,
    );
  }

  const body = (await response.json()) as GraphQLResponse<T>;

  if (body.errors && body.errors.length > 0) {
    const first = body.errors[0];
    throw new GraphQLError(first.message, first.extensions?.code, 400);
  }

  if (!body.data) {
    throw new GraphQLError('Empty response from backend', 'INTERNAL', 500);
  }

  return body.data;
}
```

### 6.2 Atlas REST Client

**File:** `src/api/atlas.ts`

Calls Atlas REST endpoints on lemonade-backend (`/atlas/v1/*`). Follows the same header pattern as `lemonade-ai/src/app/services/atlas-http-client.ts`.

```typescript
// src/api/atlas.ts

import { getApiUrl, getAuthHeader } from '../auth/store';

const ATLAS_AGENT_ID = 'cli:lemonade-cli';
const ATLAS_VERSION = '1.0';

export class AtlasError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'AtlasError';
  }
}

export interface AtlasResponse<T> {
  status: number;
  data: T;
}

export async function atlasRequest<T>(options: {
  method?: 'GET' | 'POST';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  authenticated?: boolean;
  timeoutMs?: number;
}): Promise<AtlasResponse<T>> {
  const { method = 'GET', path, body, query, authenticated = false, timeoutMs = 10_000 } = options;
  const apiUrl = getApiUrl();

  const headers: Record<string, string> = {
    'Atlas-Agent-Id': ATLAS_AGENT_ID,
    'Atlas-Version': ATLAS_VERSION,
    'Content-Type': 'application/json',
  };

  if (authenticated) {
    const auth = getAuthHeader();
    if (!auth) {
      throw new AtlasError('Not authenticated', 401);
    }
    headers['Authorization'] = auth;
  }

  const qs = query
    ? '?' + Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';

  const url = `${apiUrl}${path}${qs}`;

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (body && method === 'POST') {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);
  const data = (await response.json()) as T;

  // 402 is not an error -- caller handles the payment challenge
  if (response.status === 402) {
    return { status: 402, data };
  }

  if (!response.ok) {
    throw new AtlasError(
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as Record<string, unknown>).message)
        : `Atlas API returned ${response.status}`,
      response.status,
    );
  }

  return { status: response.status, data };
}
```

### 6.3 Atlas Registry Client

**File:** `src/api/registry.ts`

Calls the Atlas Registry service for federated search. Endpoint: `GET /atlas/v1/search` on `atlas-registry` (Phase 3, `atlas-registry/src/app/routes/search.ts`).

```typescript
// src/api/registry.ts

import { getRegistryUrl } from '../auth/store';

const ATLAS_AGENT_ID = 'cli:lemonade-cli';
const ATLAS_VERSION = '1.0';

export interface RegistrySearchResult {
  items: Array<{
    id: string;
    title: string;
    description: string;
    start: string;
    end?: string;
    location: {
      name: string;
      address?: string;
      lat: number;
      lng: number;
      city?: string;
      country?: string;
    };
    categories: string[];
    organizer: { name: string; verified: boolean; atlas_id: string };
    price: { amount: number; currency: string; display: string } | null;
    source: { platform: string; url: string };
    availability: 'available' | 'limited' | 'sold_out' | 'not_on_sale';
    image_url?: string;
    payment_methods: string[];
  }>;
  cursor: string | null;
  total: number;
  sources: Array<{ platform: string; count: number }>;
}

export async function registrySearch(
  query: Record<string, string | number | boolean | undefined>,
): Promise<RegistrySearchResult> {
  const registryUrl = getRegistryUrl();

  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

  const url = `${registryUrl}/atlas/v1/search${qs ? '?' + qs : ''}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Atlas-Agent-Id': ATLAS_AGENT_ID,
      'Atlas-Version': ATLAS_VERSION,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Registry search failed: ${response.status}`);
  }

  return (await response.json()) as RegistrySearchResult;
}
```

---

## 7. Task 3: Output Formatting

### 7.1 JSON Envelope

**File:** `src/output/json.ts`

All `--json` output uses a consistent envelope:

```typescript
// src/output/json.ts

export interface JsonEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  cursor?: string | null;   // For paginated responses
  total?: number;            // For list responses
}

export function jsonSuccess<T>(data: T, pagination?: { cursor?: string | null; total?: number }): string {
  const envelope: JsonEnvelope<T> = { ok: true, data };
  if (pagination) {
    envelope.cursor = pagination.cursor;
    envelope.total = pagination.total;
  }
  return JSON.stringify(envelope, null, 2);
}

export function jsonError(code: string, message: string): string {
  const envelope: JsonEnvelope<never> = {
    ok: false,
    error: { code, message },
  };
  return JSON.stringify(envelope, null, 2);
}
```

### 7.2 Table Formatter

**File:** `src/output/table.ts`

```typescript
// src/output/table.ts

import Table from 'cli-table3';
import chalk from 'chalk';

export function renderTable(
  headers: string[],
  rows: string[][],
  options?: { title?: string; truncate?: number },
): string {
  const table = new Table({
    head: headers.map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
    wordWrap: true,
  });

  const maxWidth = options?.truncate || 50;

  for (const row of rows) {
    table.push(row.map((cell) => (cell.length > maxWidth ? cell.slice(0, maxWidth - 3) + '...' : cell)));
  }

  let output = '';
  if (options?.title) {
    output += chalk.bold(options.title) + '\n';
  }
  output += table.toString();
  return output;
}

export function renderKeyValue(pairs: Array<[string, string]>): string {
  const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${chalk.bold(k.padEnd(maxKeyLen))}  ${v}`).join('\n');
}
```

### 7.3 Error Handler and Exit Codes

**File:** `src/output/error.ts`

```typescript
// src/output/error.ts

import { GraphQLError } from '../api/graphql';
import { AtlasError } from '../api/atlas';
import { jsonError } from './json';

export enum ExitCode {
  SUCCESS = 0,
  USER_ERROR = 1,
  AUTH_ERROR = 2,
  NETWORK_ERROR = 3,
}

export function handleError(error: unknown, json: boolean): never {
  let code = 'UNKNOWN';
  let message = 'An unexpected error occurred';
  let exitCode = ExitCode.USER_ERROR;

  if (error instanceof GraphQLError) {
    code = error.code || 'GRAPHQL_ERROR';
    message = error.message;
    exitCode = error.statusCode === 401 || error.statusCode === 403
      ? ExitCode.AUTH_ERROR
      : ExitCode.USER_ERROR;
  } else if (error instanceof AtlasError) {
    code = `ATLAS_${error.statusCode}`;
    message = error.message;
    exitCode = error.statusCode === 401 ? ExitCode.AUTH_ERROR : ExitCode.USER_ERROR;
  } else if (error instanceof TypeError && (error as NodeJS.ErrnoException).code === 'UND_ERR_CONNECT_TIMEOUT') {
    code = 'NETWORK_TIMEOUT';
    message = 'Request timed out';
    exitCode = ExitCode.NETWORK_ERROR;
  } else if (error instanceof Error) {
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      code = 'NETWORK_ERROR';
      message = `Cannot reach server: ${error.message}`;
      exitCode = ExitCode.NETWORK_ERROR;
    } else {
      message = error.message;
    }
  }

  if (json) {
    process.stderr.write(jsonError(code, message) + '\n');
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }

  process.exit(exitCode);
}
```

---

## 8. Task 4: Space Commands

All space commands call lemonade-backend GraphQL mutations and queries from `lemonade-backend/src/graphql/resolvers/ai-tool.ts` and `lemonade-backend/src/graphql/resolvers/space.ts`.

### 8.1 `lemonade space create <title>`

| Property | Value |
|----------|-------|
| **Flags** | `--description <text>`, `--slug <slug>`, `--private`, `--json` |
| **API** | GraphQL mutation `aiCreateSpace` (`ai-tool.ts:1027-1055`) |
| **Input mapping** | `{ input: { title, description, slug, private } }` |
| **Success output (table)** | Space ID, title, slug |
| **Success output (json)** | `{ ok: true, data: { _id, title, slug, description } }` |
| **Error cases** | Slug taken (USER_ERROR), auth failure (AUTH_ERROR) |

```
GraphQL mutation:
  mutation($input: AISpaceInput!) {
    aiCreateSpace(input: $input) { _id title slug description }
  }
```

### 8.2 `lemonade space list`

| Property | Value |
|----------|-------|
| **Flags** | `--limit <n>` (default 20), `--cursor <str>`, `--json` |
| **API** | GraphQL query `aiListMySpaces` (`ai-tool.ts:356-406`) |
| **Input mapping** | `{ limit, skip }` |
| **Success output (table)** | Table: ID, Title, Slug, Members |
| **Success output (json)** | `{ ok: true, data: [{ _id, title, slug, description }], cursor, total }` |
| **Error cases** | Auth failure (AUTH_ERROR) |

```
GraphQL query:
  query($limit: Int, $skip: Int) {
    aiListMySpaces(limit: $limit, skip: $skip) {
      items { _id title slug description }
    }
  }
```

### 8.3 `lemonade space update <space-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--title <text>`, `--description <text>`, `--slug <slug>`, `--json` |
| **API** | GraphQL mutation `aiUpdateSpace` (`ai-tool.ts:1057-1090`) |
| **Input mapping** | `{ id: spaceId, input: { title, description, slug } }` |
| **Success output (table)** | Updated Space details |
| **Success output (json)** | `{ ok: true, data: { _id, title, slug } }` |
| **Error cases** | Space not found (USER_ERROR), not admin (AUTH_ERROR) |

```
GraphQL mutation:
  mutation($id: MongoID!, $input: AISpaceInput!) {
    aiUpdateSpace(id: $id, input: $input) { _id title slug }
  }
```

### 8.4 `lemonade space connect <space-id> <platform>`

| Property | Value |
|----------|-------|
| **Flags** | `--api-key-value <key>` (for API-key-based connectors), `--json` |
| **API** | GraphQL mutation `connectPlatform` (`connector.ts:179`), then `submitApiKey` (`connector.ts:325`) if API-key connector, or `configureConnection` (`connector.ts:364`) after OAuth callback |
| **Input mapping** | Step 1: `{ input: { space: spaceId, connectorType: platform } }`. Step 2 (if `requiresApiKey`): `{ input: { connectionId, apiKey: apiKeyValue } }`. Step 3 (optional): `{ input: { connectionId, config: {} } }` |
| **Success output (table)** | Connection ID, status, auth URL (if OAuth) |
| **Success output (json)** | `{ ok: true, data: { connectionId, requiresApiKey, authUrl } }` |
| **Error cases** | Connector not available (USER_ERROR), space not found (USER_ERROR), auth failure (AUTH_ERROR), API key required but `--api-key-value` not provided (USER_ERROR) |

> **AUDIT FIX W4 [8]:** No interactive prompts. If the connector requires an API key (`requiresApiKey: true` in response) and `--api-key-value` was not provided, exit with code 1 and message: "This connector requires an API key. Provide --api-key-value <key>." The CLI never falls back to interactive input. If the response contains `authUrl`, the CLI opens the browser for OAuth (non-interactive -- just opens URL). After OAuth, the CLI calls `submitApiKey` or `configureConnection` as needed.

> **AUDIT FIX W4-R2 [4]:** Full connector flow uses three mutations verified at `connector.ts:179,325,364`.

```
GraphQL mutations (executed in sequence):

  # Step 1: Initiate connection
  mutation($input: ConnectPlatformInput!) {
    connectPlatform(input: $input) { connectionId requiresApiKey authUrl }
  }

  # Step 2a: If requiresApiKey is true, submit the API key
  mutation($input: SubmitApiKeyInput!) {
    submitApiKey(input: $input) { id connectorType status enabled }
  }

  # Step 2b: If authUrl is present, open browser for OAuth, then configure
  mutation($input: ConfigureConnectionInput!) {
    configureConnection(input: $input) { id connectorType status config enabled }
  }
```

### 8.5 `lemonade space connectors <space-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL query `spaceConnections` (`connector.ts:88`) |
| **Input mapping** | `{ space: spaceId }` |
| **Success output (table)** | Table: Connector, Status, Last Sync, Enabled |
| **Success output (json)** | `{ ok: true, data: [{ id, connectorType, status, lastSyncAt, enabled }] }` |
| **Error cases** | Space not found (USER_ERROR), auth failure (AUTH_ERROR) |

```
GraphQL query:
  query($space: MongoID!) {
    spaceConnections(space: $space) {
      id connectorType status lastSyncAt lastSyncStatus enabled errorMessage
    }
  }
```

### 8.6 `lemonade space analytics <space-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL query `aiGetSpaceStats` (`ai-tool.ts:986`) |
| **Input mapping** | `{ space: spaceId }` |
| **Success output (table)** | Key-value: Total Members, Total Events, Total Attendees, Avg Rating |
| **Success output (json)** | `{ ok: true, data: { total_members, admin_count, total_events, total_attendees, average_rating } }` |

```
GraphQL query:
  query($space: MongoID!) {
    aiGetSpaceStats(space: $space) {
      total_members admin_count host_count
      total_events total_attendees average_rating
    }
  }
```

### 8.7 `lemonade space plan <space-id-or-slug>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | (a) GraphQL query `getSpace` (`space.ts`) to get space metadata + subscription tier. (b) Tier limits are hardcoded in the CLI from `DEFAULT_FEATURE_CONFIGS` (see below). (c) Usage counts from `aiGetSpaceStats` (`ai-tool.ts:986`) for member/event counts, `spaceConnections` (`connector.ts:88`) for connector count. |
| **Input mapping** | `{ _id: spaceId }` or `{ slug: spaceSlug }` |
| **Success output (table)** | Space name, current plan, then feature usage table: Feature / Limit / Used / Next Tier / Unlocks |
| **Success output (json)** | `{ ok: true, data: { space: { _id, title, slug }, plan: "pro", features: [{ feature, limit, used, next_tier, next_limit }] } }` |
| **Error cases** | Space not found (USER_ERROR), auth (AUTH_ERROR) |

> **AUDIT FIX W4-R3 [3]:** `getFeatureConfig` is a backend service function (not a GraphQL resolver) -- the CLI cannot call it directly. Instead, the CLI hardcodes the tier limits from `DEFAULT_FEATURE_CONFIGS` in `lemonade-backend/src/app/services/subscription-feature-config.ts:12-132`. These values are static per tier and rarely change. If they do change, the CLI publishes a patch release. No new GraphQL resolver is needed.

**Hardcoded tier limits (from `subscription-feature-config.ts:12-132`):**

```typescript
// src/config/tier-limits.ts (in lemonade-cli)
// Source of truth: lemonade-backend/src/app/services/subscription-feature-config.ts DEFAULT_FEATURE_CONFIGS

export const TIER_LIMITS: Record<string, Record<string, { enabled: boolean; limit?: number }>> = {
  custom_agents:              { free: { enabled: false, limit: 0 }, pro: { enabled: true, limit: 1 },  plus: { enabled: true, limit: 3 },  max: { enabled: true, limit: 10 }, enterprise: { enabled: true, limit: 0 } },
  advanced_ai_models:         { free: { enabled: true,  limit: 2 }, pro: { enabled: true, limit: 0 },  plus: { enabled: true, limit: 0 },  max: { enabled: true, limit: 0 },  enterprise: { enabled: true, limit: 0 } },
  premium_ai_models:          { free: { enabled: false },           pro: { enabled: false },            plus: { enabled: true },            max: { enabled: true },            enterprise: { enabled: true } },
  custom_event_slug:          { free: { enabled: false },           pro: { enabled: true },             plus: { enabled: true },            max: { enabled: true },            enterprise: { enabled: true } },
  custom_domain:              { free: { enabled: false },           pro: { enabled: false },            plus: { enabled: true },            max: { enabled: true },            enterprise: { enabled: true } },
  remove_branding:            { free: { enabled: false },           pro: { enabled: false },            plus: { enabled: true },            max: { enabled: true },            enterprise: { enabled: true } },
  premium_themes:             { free: { enabled: true,  limit: 3 }, pro: { enabled: true, limit: 10 }, plus: { enabled: true, limit: 0 },  max: { enabled: true, limit: 0 },  enterprise: { enabled: true, limit: 0 } },
  newsletter_sends_per_month: { free: { enabled: false, limit: 0 }, pro: { enabled: true, limit: 4 },  plus: { enabled: true, limit: 12 }, max: { enabled: true, limit: 30 }, enterprise: { enabled: true, limit: 0 } },
  newsletter_recipients:      { free: { enabled: false, limit: 0 }, pro: { enabled: true, limit: 1000 }, plus: { enabled: true, limit: 5000 }, max: { enabled: true, limit: 25000 }, enterprise: { enabled: true, limit: 0 } },
};
// limit: 0 means unlimited
```

Example table output:

```
Space: berlin-techno (Pro plan)

Feature          Limit  Used  Next tier  Unlocks
Connectors       2      2     Plus       4
AI credits       500    312   Plus       1500
API keys         3      1     Plus       10
Newsletter/mo    4      2     Plus       12
```

### 8.8 `lemonade space upgrade <space-id-or-slug>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | No API call. Constructs URL and opens browser. |
| **Behavior** | Constructs URL `https://lemonade.social/s/manage/{space-slug}/settings/subscription` and opens in default browser. In `--json` mode, outputs the URL instead of opening. If a Space ID is provided (not a slug), the CLI resolves the slug first via `getSpace`. |
| **Success output (table)** | "Opening subscription page for {space-slug}..." |
| **Success output (json)** | `{ ok: true, data: { upgrade_url: "https://lemonade.social/s/manage/{space-slug}/settings/subscription" } }` |
| **Error cases** | Space not found (USER_ERROR) |
| **Note** | No authentication needed beyond the current API key. The web page handles payment. |

### Tier-Limit Error Behavior

All CLI commands that hit subscription tier limits (connector limits, AI credit limits, API rate limits, feature-gated errors) MUST include:

1. The upgrade URL: `https://lemonade.social/s/manage/{space-slug}/settings/subscription`
2. A CLI shortcut: `Or run: lemonade space upgrade {space-slug}`

Example error output (table mode):
```
Error: Connector limit reached (2/2 on Pro plan).
Upgrade at: https://lemonade.social/s/manage/berlin-techno/settings/subscription
Or run: lemonade space upgrade berlin-techno
```

Example error output (json mode):
```json
{
  "ok": false,
  "error": {
    "code": "TIER_LIMIT",
    "message": "Connector limit reached (2/2 on Pro plan)",
    "upgrade_url": "https://lemonade.social/s/manage/berlin-techno/settings/subscription",
    "upgrade_command": "lemonade space upgrade berlin-techno"
  }
}
```

---

## 9. Task 5: Event Commands

### 9.1 `lemonade event create`

| Property | Value |
|----------|-------|
| **Flags** | `--title <text>` (required), `--start <iso-datetime>` (required), `--end <iso-datetime>`, `--description <text>`, `--space <id>`, `--address <text>`, `--virtual`, `--private`, `--json` |
| **API** | GraphQL mutation `aiCreateEvent` (`ai-tool.ts:876-1025`) |
| **Input mapping** | `{ input: { title, start, end, description, space, address: { title: address }, virtual, private, published: false } }` |
| **Success output (table)** | Event ID, title, start, status (draft) |
| **Success output (json)** | `{ ok: true, data: { _id, title, shortid, start, end, published } }` |
| **Error cases** | Missing required flags (USER_ERROR), space not found (USER_ERROR), auth (AUTH_ERROR) |
| **Note** | Events are created unpublished (draft). Use `lemonade event publish` to make them live. If `--space` is not provided and `default_space` is set in config, the default space is used. |

```
GraphQL mutation:
  mutation($input: AICreateEventInput!) {
    aiCreateEvent(input: $input) {
      _id title shortid start end published description
      address { title city country latitude longitude }
    }
  }
```

### 9.2 `lemonade event list`

| Property | Value |
|----------|-------|
| **Flags** | `--space <id>`, `--draft`, `--search <text>`, `--limit <n>` (default 20), `--cursor <str>`, `--json` |
| **API** | GraphQL query `aiGetHostingEvents` (`ai-tool.ts:268-354`) |
| **Input mapping** | `{ draft, search, limit, skip }` |
| **Success output (table)** | Table: ID, Title, Start, Status |
| **Success output (json)** | `{ ok: true, data: [{ _id, title, shortid, start, published }], cursor }` |

```
GraphQL query:
  query($draft: Boolean, $search: String, $limit: Int, $skip: Int) {
    aiGetHostingEvents(draft: $draft, search: $search, limit: $limit, skip: $skip) {
      items { _id title shortid start end published }
    }
  }
```

### 9.3 `lemonade event search <query>`

| Property | Value |
|----------|-------|
| **Flags** | `--lat <num>`, `--lng <num>`, `--radius <km>` (default 25), `--category <cat>`, `--date-from <iso>`, `--date-to <iso>`, `--price-min <num>`, `--price-max <num>`, `--sort <relevance|price_asc|price_desc|date_asc|date_desc|distance>`, `--limit <n>` (default 10, max 50), `--cursor <str>`, `--json` |
| **API** | Atlas Registry REST `GET /atlas/v1/search` (`atlas-registry/src/app/routes/search.ts`) |
| **Input mapping** | Query params: `q`, `lat`, `lng`, `radius_km`, `category`, `start_after`, `start_before`, `price_min`, `price_max`, `sort`, `limit`, `cursor` |
| **Success output (table)** | Table: Title, Date, Location, Price, Availability, Source |
| **Success output (json)** | `{ ok: true, data: { items: [...], cursor, total, sources: [...] } }` |
| **Error cases** | Registry unreachable (NETWORK_ERROR) |

This command uses the Atlas Registry for federated search across all Spaces, matching the `atlas_search` MCP tool (`lemonade-ai/src/app/plugins/mcp-atlas-tools.ts:404-489`).

### 9.4 `lemonade event get <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL query `aiGetEvent` (`ai-tool.ts:310-354`) for owned events, or Atlas REST `GET /atlas/v1/events/:id` for public Atlas events |
| **Input mapping** | `{ id: eventId }` |
| **Success output (table)** | Key-value: Title, Start, End, Location, Description, Published, Ticket Count |
| **Success output (json)** | `{ ok: true, data: { _id, title, shortid, start, end, address, description, published } }` |

```
GraphQL query:
  query($id: MongoID!) {
    aiGetEvent(id: $id) {
      _id title shortid start end published description
      address { title city country latitude longitude }
    }
  }
```

### 9.5 `lemonade event update <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--title <text>`, `--start <iso>`, `--end <iso>`, `--description <text>`, `--address <text>`, `--virtual`, `--json` |
| **API** | GraphQL mutation `aiUpdateEvent` (`ai-tool.ts:937-1025`) |
| **Input mapping** | `{ id: eventId, input: { title, start, end, description, address, virtual } }` |
| **Success output (table)** | Updated event summary |
| **Success output (json)** | `{ ok: true, data: { _id, title, start, end } }` |
| **Error cases** | Event not found (USER_ERROR), not host (AUTH_ERROR) |

```
GraphQL mutation:
  mutation($id: MongoID!, $input: AIUpdateEventInput!) {
    aiUpdateEvent(id: $id, input: $input) {
      _id title shortid start end published
    }
  }
```

### 9.6 `lemonade event publish <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL mutation `aiPublishEvent` (`ai-tool.ts:1124-1171`) |
| **Input mapping** | `{ id: eventId }` |
| **Success output (table)** | "Event published: <title>" |
| **Success output (json)** | `{ ok: true, data: { _id, title, published: true } }` |

```
GraphQL mutation:
  mutation($id: MongoID!) {
    aiPublishEvent(id: $id) { _id title published shortid }
  }
```

### 9.7 `lemonade event cancel <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL mutation `aiCancelEvent` (`ai-tool.ts:1281-1307`) |
| **Input mapping** | `{ id: eventId }` |
| **Success output (table)** | "Event cancelled: <event-id>" |
| **Success output (json)** | `{ ok: true, data: { cancelled: true } }` |

```
GraphQL mutation:
  mutation($id: MongoID!) {
    aiCancelEvent(id: $id)
  }
```

### 9.8 `lemonade event analytics <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | Three parallel GraphQL queries: `aiGetEventTicketSoldInsight` (`ai-tool.ts:410-445`), `aiGetEventViewInsight` (`ai-tool.ts:447-477`), `aiGetEventGuestStats` (`ai-tool.ts:518-543`) |
| **Input mapping** | `{ event: eventId }` for each query |
| **Success output (table)** | Multi-section: Sales (total sold, revenue), Views (page views, unique visitors), Guests (going, pending, checked in) |
| **Success output (json)** | `{ ok: true, data: { sales: {...}, views: {...}, guests: {...} } }` |

```
GraphQL queries (run in parallel):
  query($event: MongoID!) {
    aiGetEventTicketSoldInsight(event: $event) {
      total_tickets_sold total_revenue currency
      breakdown { ticket_type_name sold revenue }
    }
  }

  query($event: MongoID!) {
    aiGetEventViewInsight(event: $event) {
      total_views unique_visitors
      top_sources { source views }
      top_cities { city views }
    }
  }

  query($event: MongoID!) {
    aiGetEventGuestStats(event: $event) {
      going pending declined checked_in
    }
  }
```

### 9.9 `lemonade event guests <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--status <going|pending|declined|checked_in>`, `--limit <n>` (default 50), `--cursor <str>`, `--json` |
| **API** | GraphQL query `aiGetEventGuests` (`ai-tool.ts:479-516`) |
| **Input mapping** | `{ event: eventId, state: status, limit, skip }` |
| **Success output (table)** | Table: Name, Email, Status, Ticket Type, Checked In |
| **Success output (json)** | `{ ok: true, data: [{ name, email, status, ticket_type, checked_in_at }], cursor }` |

```
GraphQL query:
  query($event: MongoID!, $state: String, $limit: Int, $skip: Int) {
    aiGetEventGuests(event: $event, state: $state, limit: $limit, skip: $skip) {
      items { name email state ticket_type_name checked_in_at }
    }
  }
```

> **AUDIT FIX W4 [4]:** Added missing MCP tool parity commands: invite, approvals, feedback, checkins.

### 9.10 `lemonade event invite <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--email <email>` (required, repeatable for multiple invitees), `--json` |
| **API** | GraphQL mutation `aiInviteEvent` (`ai-tool.ts:112`) |
| **Input mapping** | `{ input: { event: eventId, emails: [email1, email2, ...] } }` |
| **Success output (table)** | "Invitations sent to N recipients" |
| **Success output (json)** | `{ ok: true, data: { sent: true } }` |
| **Error cases** | Event not found (USER_ERROR), not host (AUTH_ERROR) |

```
GraphQL mutation:
  mutation($input: InviteEventInput!) {
    aiInviteEvent(input: $input)
  }
```

### 9.11 `lemonade event approvals <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--approve` (approve pending requests), `--decline` (decline pending requests), `--request-id <id>` (optional, repeatable -- specific requests; if omitted, acts on all pending), `--json` |
| **API** | GraphQL mutation `aiDecideEventJoinRequests` (`ai-tool.ts:667`) |
| **Input mapping** | `{ event: eventId, decision: approve ? 'approved' : 'declined', request_ids: requestIds }` |
| **Success output (table)** | "Processed N requests (approved/declined)" |
| **Success output (json)** | `{ ok: true, data: { processed_count, decision } }` |
| **Error cases** | Event not found (USER_ERROR), not host (AUTH_ERROR), invalid decision (USER_ERROR) |
| **Note** | Exactly one of `--approve` or `--decline` must be provided. If neither is provided and `--json` is not set, the command lists pending requests instead (read-only mode). |

```
GraphQL mutation:
  mutation($event: MongoID!, $decision: String!, $request_ids: [MongoID!]) {
    aiDecideEventJoinRequests(event: $event, decision: $decision, request_ids: $request_ids) {
      processed_count decision
    }
  }
```

### 9.12 `lemonade event feedback <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--rating <1-5>` (filter by rating), `--limit <n>` (default 20), `--offset <n>` (default 0), `--summary` (show summary only, no individual feedbacks), `--json` |
| **API** | GraphQL query `aiGetEventFeedbackSummary` (`ai-tool.ts:808`) for summary, GraphQL query `aiListEventFeedbacks` (`ai-tool.ts:834`) for individual entries |
| **Input mapping** | Summary: `{ event: eventId }`. List: `{ event: eventId, rate_value: rating, limit, skip: offset }` |
| **Success output (table)** | Summary header (avg rating, total reviews, distribution), then individual feedback rows |
| **Success output (json)** | `{ ok: true, data: { summary: { average_rating, total_reviews, rating_distribution }, feedbacks: [...] } }` |
| **Error cases** | Event not found (USER_ERROR), not host (AUTH_ERROR) |

```
GraphQL queries (summary always fetched; individual feedbacks unless --summary):
  query($event: MongoID!) {
    aiGetEventFeedbackSummary(event: $event) {
      average_rating total_reviews
      rating_distribution { rating count }
    }
  }

  query($event: MongoID!, $rate_value: Int, $limit: Int, $skip: Int) {
    aiListEventFeedbacks(event: $event, rate_value: $rate_value, limit: $limit, skip: $skip) {
      items { user_name rate_value comment created_at }
    }
  }
```

### 9.13 `lemonade event checkins <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--limit <n>` (default 20, max 100), `--offset <n>` (default 0), `--json` |
| **API** | GraphQL query `aiGetEventCheckins` (`ai-tool.ts:747`) |
| **Input mapping** | `{ event: eventId, limit, skip: offset }` |
| **Success output (table)** | Table: Name, Email, Ticket Type, Checked In At |
| **Success output (json)** | `{ ok: true, data: [{ user_name, user_email, ticket_type_name, checked_in_at }] }` |
| **Error cases** | Event not found (USER_ERROR), not host (AUTH_ERROR) |

```
GraphQL query:
  query($event: MongoID!, $limit: Int, $skip: Int) {
    aiGetEventCheckins(event: $event, limit: $limit, skip: $skip) {
      items { user_name user_email ticket_type_name checked_in_at }
    }
  }
```

---

## 10. Task 6: Ticket Commands

### 10.1 `lemonade tickets types <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL query `aiListEventTicketTypes` (`ai-tool.ts:395-408`) |
| **Input mapping** | `{ event: eventId }` |
| **Success output (table)** | Table: ID, Name, Price, Available, On Sale |
| **Success output (json)** | `{ ok: true, data: [{ _id, title, price, limit, active }] }` |

```
GraphQL query:
  query($event: MongoID!) {
    aiListEventTicketTypes(event: $event) {
      _id title default_price default_currency limit active
      prices { cost currency network }
    }
  }
```

### 10.2 `lemonade tickets create-type <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--name <text>` (required), `--price <amount>` (required), `--currency <code>` (default USD), `--limit <n>`, `--description <text>`, `--json` |
| **API** | GraphQL mutation `aiCreateEventTicketType` (`ai-tool.ts:1173-1206`) |
| **Input mapping** | `{ input: { event: eventId, title: name, default_price: price * 100, default_currency: currency, limit, description } }` |
| **Success output (table)** | Ticket type ID, name, price |
| **Success output (json)** | `{ ok: true, data: { _id, title, default_price, default_currency, limit } }` |
| **Note** | Price is provided in dollars (e.g., `--price 25.00`) and converted to cents for the API (`2500`). |

```
GraphQL mutation:
  mutation($input: EventTicketTypeInput!) {
    aiCreateEventTicketType(input: $input) {
      _id title default_price default_currency limit active
    }
  }
```

### 10.3 `lemonade tickets update-type <ticket-type-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--name <text>`, `--price <amount>`, `--currency <code>`, `--limit <n>`, `--active <bool>`, `--json` |
| **API** | GraphQL mutation `aiUpdateEventTicketType` (`ai-tool.ts:1208-1240`) |
| **Input mapping** | `{ _id: ticketTypeId, input: { title, default_price, default_currency, limit, active } }` |
| **Success output (table)** | Updated ticket type summary |
| **Success output (json)** | `{ ok: true, data: { _id, title, default_price, limit, active } }` |

```
GraphQL mutation:
  mutation($_id: MongoID!, $input: EventTicketTypeInput!) {
    aiUpdateEventTicketType(_id: $_id, input: $input) {
      _id title default_price default_currency limit active
    }
  }
```

### 10.4 `lemonade tickets buy <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--ticket-type <id>` (required), `--quantity <n>` (default 1), `--attendee-name <name>` (required), `--attendee-email <email>` (required), `--discount <code>`, `--json` |
| **API** | Atlas REST `POST /atlas/v1/events/:id/purchase` (`lemonade-backend/src/app/controllers/atlas/purchase.ts`, Phase 2) |
| **Input mapping** | Body: `{ ticket_type_id, quantity, attendees: [{ name, email }] }` |
| **Success output (table)** | Purchase status, checkout URL or redirect URL |
| **Success output (json)** | Full purchase response: `{ ok: true, data: { phase, checkout_url, hold_id, amount, currency } }` |
| **Error cases** | Tickets sold out (USER_ERROR), invalid ticket type (USER_ERROR), auth (AUTH_ERROR), 422: attendee count must match quantity -- the number of `--attendee-name`/`--attendee-email` pairs must equal `--quantity` (USER_ERROR) |
| **Note** | For paid events, returns a checkout URL. For free events, returns a redirect URL. Mirrors `atlas_purchase` MCP tool (`lemonade-ai/src/app/plugins/mcp-atlas-tools.ts:577-695`). Multiple attendees use Commander.js variadic options (see declaration below). |

> **AUDIT FIX W4-R2 [10]:** Commander.js variadic flag declaration for multi-attendee support:
>
> ```typescript
> .option('--attendee-name <names...>', 'Attendee full names (one per ticket, in order)')
> .option('--attendee-email <emails...>', 'Attendee emails (one per ticket, matches --attendee-name order)')
> ```
>
> Commander.js collects variadic options into arrays: `opts.attendeeName = ['Alice', 'Bob']`, `opts.attendeeEmail = ['alice@x.com', 'bob@x.com']`. The CLI zips these into the `attendees` array: `attendees = names.map((n, i) => ({ name: n, email: emails[i] }))`.

> **AUDIT FIX W4 [6]:** The CLI MUST validate locally before sending the request: if the number of attendee name/email pairs does not equal `--quantity`, exit with code 1 and message "Attendee count (N) must match quantity (M). Provide one --attendee-name and --attendee-email per ticket." This prevents a round-trip to the backend for a guaranteed 422.

Purchase flow:

1. CLI sends `POST /atlas/v1/events/:id/purchase` with attendee details
2. If 200 with `type: 'free_ticket_redirect'` -- print redirect URL
3. If 402 -- extract `hold_id`, call `POST /atlas/v1/holds/:hold_id/checkout` (P2-NEW-1) to get checkout URL
4. Print checkout URL for user to open
5. If `--json`, include `hold_id` so the caller can poll with `lemonade tickets receipt`

> **AUDIT FIX W4 [1]:** Step 3 depends on P2-NEW-1 checkout endpoint. See PENDING-FIXES.md. CLI cannot execute paid purchases until Phase 2 with this endpoint is deployed.

### 10.5 `lemonade tickets price <event-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--ticket-type <id>` (required), `--quantity <n>` (default 1), `--discount <code>`, `--json` |
| **API** | GraphQL query `aiCalculateTicketPrice` (`ai-tool.ts:622-660`) |
| **Input mapping** | `{ event: eventId, ticket_type: ticketTypeId, count: quantity, discount_code: discount }` |
| **Success output (table)** | Subtotal, discount amount, total, currency |
| **Success output (json)** | `{ ok: true, data: { subtotal, discount_amount, total, currency } }` |

```
GraphQL query:
  query($event: MongoID!, $ticket_type: MongoID!, $count: Int!, $discount_code: String) {
    aiCalculateTicketPrice(event: $event, ticket_type: $ticket_type, count: $count, discount_code: $discount_code) {
      subtotal discount_amount total currency
    }
  }
```

### 10.6 `lemonade tickets receipt <hold-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--poll` (wait up to 60s for completion), `--json` |
| **API** | Atlas REST `GET /atlas/v1/receipts/by-hold/:hold_id` (`lemonade-backend/src/app/controllers/atlas/receipts.ts`, Phase 2) |
| **Input mapping** | Path param: `hold_id` |
| **Success output (table)** | Receipt status, ticket credentials, payment details, reward info |
| **Success output (json)** | `{ ok: true, data: { status, receipt, reward_info } }` |
| **Note** | With `--poll`, the CLI checks every 3 seconds for up to 60 seconds until status changes from `pending` to `completed` or `expired`. Mirrors `atlas_get_receipt` MCP tool (`lemonade-ai/src/app/plugins/mcp-atlas-tools.ts:699-788`). |

---

## 11. Task 7: Rewards Commands

> **AUDIT FIX W4 [2]:** Reward resolver signatures verified against `lemonade-backend-phase4/src/graphql/resolvers/atlas-reward.ts` (feat/atlas-phase-4-rewards branch). The actual resolver names, field names, and argument types are documented below. The implementing agent MUST cross-reference the actual merged code if Phase 4 lands with changes.

Rewards commands call the `AtlasRewardResolver` class defined in `lemonade-backend-phase4/src/graphql/resolvers/atlas-reward.ts`. This file contains 4 queries and 3 mutations:

**Queries:** `atlasRewardSummary` (line 64), `atlasRewardHistory` (line 118), `atlasReferralSummary` (line 151), `atlasPayoutHistory` (line 162), `atlasGetPayoutSettings` (line 256)
**Mutations:** `atlasGenerateReferralCode` (line 197), `atlasApplyReferralCode` (line 209), `atlasUpdatePayoutSettings` (line 224)

### 11.1 `lemonade rewards balance`

| Property | Value |
|----------|-------|
| **Flags** | `--space <id>` (required), `--json` |
| **API** | GraphQL query `atlasRewardSummary` (`atlas-reward.ts:64`) |
| **Input mapping** | `{ space: spaceId }` |
| **Success output (table)** | Key-value: Organizer Accrued, Organizer Pending, Organizer Paid Out, Attendee Accrued, Attendee Pending, Attendee Paid Out, Volume Tier, Monthly GMV, Verified, Next Payout |
| **Success output (json)** | `{ ok: true, data: { organizer_accrued_usdc, organizer_pending_usdc, organizer_paid_out_usdc, attendee_accrued_usdc, attendee_pending_usdc, attendee_paid_out_usdc, volume_tier, monthly_gmv_usdc, next_tier_threshold_usdc, next_payout_date, is_self_verified, verification_cta_extra_usdc } }` |

```
GraphQL query:
  query($space: String!) {
    atlasRewardSummary(space: $space) {
      organizer_accrued_usdc organizer_pending_usdc organizer_paid_out_usdc
      attendee_accrued_usdc attendee_pending_usdc attendee_paid_out_usdc
      volume_tier monthly_gmv_usdc next_tier_threshold_usdc
      next_payout_date is_self_verified verification_cta_extra_usdc
    }
  }
```

### 11.2 `lemonade rewards history`

| Property | Value |
|----------|-------|
| **Flags** | `--space <id>` (required), `--limit <n>` (default 20, max 100), `--offset <n>` (default 0), `--json` |
| **API** | GraphQL query `atlasRewardHistory` (`atlas-reward.ts:118`) |
| **Input mapping** | `{ space: spaceId, limit, offset }` (uses `AtlasRewardHistoryArgs`) |
| **Success output (table)** | Table: Date, Gross Amount, Organizer Cashback, Attendee Cashback, Volume Bonus, Payment Method, Status |
| **Success output (json)** | `{ ok: true, data: [{ _id, event_id, gross_amount_usdc, organizer_cashback_usdc, attendee_cashback_usdc, organizer_volume_bonus_usdc, attendee_discovery_bonus_usdc, payment_method, status, created_at }] }` |

```
GraphQL query:
  query($space: String!, $limit: Int, $offset: Int) {
    atlasRewardHistory(space: $space, limit: $limit, offset: $offset) {
      _id event_id gross_amount_usdc
      organizer_cashback_usdc attendee_cashback_usdc
      organizer_volume_bonus_usdc attendee_discovery_bonus_usdc
      payment_method status created_at
    }
  }
```

### 11.3 `lemonade rewards payouts`

| Property | Value |
|----------|-------|
| **Flags** | `--limit <n>` (default 20, max 100), `--offset <n>` (default 0), `--json` |
| **API** | GraphQL query `atlasPayoutHistory` (`atlas-reward.ts:162`) |
| **Input mapping** | `{ limit, offset }` (uses `AtlasPayoutHistoryArgs`) |
| **Success output (table)** | Table: Amount, Method, TX Hash, Stripe Transfer, Status, Date |
| **Success output (json)** | `{ ok: true, data: [{ amount_usdc, payout_method, tx_hash, stripe_transfer_id, status, processed_at }] }` |

```
GraphQL query:
  query($limit: Int, $offset: Int) {
    atlasPayoutHistory(limit: $limit, offset: $offset) {
      amount_usdc payout_method tx_hash stripe_transfer_id status processed_at
    }
  }
```

### 11.4 `lemonade rewards referral`

| Property | Value |
|----------|-------|
| **Flags** | `--generate` (generate referral code), `--apply <code>` (apply referral code), `--json` |
| **API** | Query `atlasReferralSummary` (`atlas-reward.ts:151`) for read, mutation `atlasGenerateReferralCode` (`atlas-reward.ts:197`) for `--generate`, mutation `atlasApplyReferralCode` (`atlas-reward.ts:209`) for `--apply` |
| **Success output (table)** | Referral summary or generated code |
| **Success output (json)** | `{ ok: true, data: { code } }` (generate) or `{ ok: true, data: { applied: true } }` (apply) or referral summary (read) |

```
GraphQL mutation (generate):
  mutation { atlasGenerateReferralCode { code } }

GraphQL mutation (apply):
  mutation($code: String!) { atlasApplyReferralCode(code: $code) }

GraphQL query (summary):
  query { atlasReferralSummary { ... } }
```

### 11.5 `lemonade rewards settings`

| Property | Value |
|----------|-------|
| **Flags** | `--wallet <address>` (set payout wallet), `--chain <chain-id>` (set payout chain), `--preferred <stripe|crypto>` (set preferred payout method), `--json` |
| **API** | GraphQL query `atlasGetPayoutSettings` (`atlas-reward.ts:256`) for read, mutation `atlasUpdatePayoutSettings` (`atlas-reward.ts:224`) for write |
| **Input mapping** | Read: none. Write: `{ input: { wallet_address, wallet_chain, stripe_connect_account_id, preferred_method } }` (uses `AtlasPayoutSettingsInput`) |
| **Success output (table)** | Key-value: Wallet, Chain, Preferred Method, Stripe Connected |
| **Success output (json)** | `{ ok: true, data: { wallet_address, wallet_chain, stripe_connect_account_id, preferred_method } }` |
| **Note** | When called with no write flags, displays current settings. When called with `--wallet`, `--chain`, or `--preferred`, updates settings. Wallet address is validated as `0x` + 40 hex chars. Stripe Connect setup requires the web dashboard -- the CLI prints: "Connect Stripe at https://lemonade.social/s/manage/{space-slug}/settings/payout" |
| **Error cases** | Invalid wallet format: "Invalid wallet address format" (USER_ERROR). No Stripe Connect: shows CTA link (not an error). |

---

## 12. Task 8: Site Commands

> **AUDIT FIX W4 [5]:** Page config mutation line numbers verified against codebase.

Site commands wrap the page generation system from `lemonade-backend/src/graphql/resolvers/ai-tool.ts` (mutations: `aiCreatePageConfig` at line 1477, `aiUpdatePageConfigSection` at line 1495, `aiGeneratePageFromDescription` at line 1534, `aiSuggestSections` at line 1558) and `lemonade-backend/src/graphql/resolvers/page-config.ts` (mutation: `publishPageConfig` at line 101).

### 12.1 `lemonade site generate <owner-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--type <event|space>` (required), `--description <text>` (required), `--style <text>`, `--json` |
| **API** | GraphQL mutation `aiGeneratePageFromDescription` (`ai-tool.ts:1534`) |
| **Input mapping** | `{ input: { owner_id: ownerId, owner_type: type, description, style } }` |
| **Success output (table)** | Page ID, section count, status |
| **Success output (json)** | `{ ok: true, data: { _id, name, status, version, sections: [...] } }` |
| **Note** | This uses the AI page generation system from `web-new/lib/graphql/gql/ai/index.gql`. The description is a natural language prompt like "A modern dark tech conference page with speaker bios and schedule." |

```
GraphQL mutation:
  mutation($input: AiGeneratePageInput!) {
    aiGeneratePageFromDescription(input: $input) {
      _id name status version
      sections { id type order hidden }
      theme { type mode colors { text_primary accent background } }
    }
  }
```

### 12.2 `lemonade site preview <page-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL query `getPageConfig` (`page-config.ts:175`) to verify page exists, then opens preview URL in browser |
| **Behavior** | First calls `getPageConfig(id)` to verify the page exists and the user has access. If the page exists, constructs URL `https://<api_url>/preview/<page-id>` and opens in default browser. In `--json` mode, outputs the URL instead of opening. |
| **Success output (table)** | "Opening preview in browser..." |
| **Success output (json)** | `{ ok: true, data: { preview_url: "...", status: "draft|published" } }` |
| **Error cases** | Page not found: 404 (USER_ERROR, "Page not found"). Not authorized: 403 (AUTH_ERROR, "You do not have permission to preview this page. Only the creator or space admin can preview draft pages."). |

> **AUDIT FIX W4 [9]:** The CLI validates page existence and authorization before constructing the preview URL. Draft pages require creator or space admin access (enforced by `getPageConfig` at `page-config.ts:182-199`). Published pages are publicly accessible.

### 12.3 `lemonade site deploy <page-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL mutation `publishPageConfig` |
| **Input mapping** | `{ id: pageId }` |
| **Success output (table)** | "Page deployed (version N)" |
| **Success output (json)** | `{ ok: true, data: { _id, status, published_version } }` |

```
GraphQL mutation:
  mutation($id: MongoID!) {
    publishPageConfig(id: $id) {
      _id status published_version
    }
  }
```

### 12.4 `lemonade site templates`

| Property | Value |
|----------|-------|
| **Flags** | `--type <event|space>`, `--json` |
| **API** | GraphQL query `aiSuggestSections` (`ai-tool.ts:1558`) |
| **Input mapping** | `{ ownerType: type }` |
| **Success output (table)** | Table: Name, Description, Section Count |
| **Success output (json)** | `{ ok: true, data: [{ id, name, description, sections }] }` |

```
GraphQL query:
  query($ownerType: String!) {
    aiSuggestSections(ownerType: $ownerType) {
      id name description preview_url
    }
  }
```

---

## 13. Task 9: Connector Commands

### 13.1 `lemonade connectors list`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL query `availableConnectors` (`connector.ts:67`) |
| **Input mapping** | None |
| **Success output (table)** | Table: ID, Name, Category, Auth Type |
| **Success output (json)** | `{ ok: true, data: [{ id, name, category, authType, capabilities }] }` |

```
GraphQL query:
  query {
    availableConnectors {
      id name category authType capabilities
    }
  }
```

### 13.2 `lemonade connectors sync <connection-id>`

| Property | Value |
|----------|-------|
| **Flags** | `--action <action-id>` (default: `sync-events`), `--json` |
| **API** | GraphQL mutation `executeConnectorAction` (`connector.ts:443`) |
| **Input mapping** | `{ input: { connectionId, actionId: action } }` |
| **Success output (table)** | Sync result: success/failure, records processed, records failed |
| **Success output (json)** | `{ ok: true, data: { success, recordsProcessed, recordsFailed, message } }` |

```
GraphQL mutation:
  mutation($input: ExecuteConnectorActionInput!) {
    executeConnectorAction(input: $input) {
      success data message error recordsProcessed recordsFailed
    }
  }
```

---

## 14. Task 10: Config Commands

### 14.1 `lemonade config init`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **Behavior** | Creates `~/.lemonade/config.json` with default values if it does not exist. If it exists, prints current config path. |
| **Success output (table)** | "Config initialized at ~/.lemonade/config.json" |
| **Success output (json)** | `{ ok: true, data: { path: "...", created: true } }` |

### 14.2 `lemonade config set <key> <value>`

| Property | Value |
|----------|-------|
| **Valid keys** | `default_space`, `output_format`, `api_url`, `registry_url` |
| **Flags** | `--json` |
| **Behavior** | Writes key-value to `~/.lemonade/config.json`. Validates key is in the allowed set. |
| **Success output (table)** | "Set <key> = <value>" |
| **Success output (json)** | `{ ok: true, data: { key, value } }` |

### 14.3 `lemonade config get <key>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **Behavior** | Reads a single key from config. If key not set, exits with code 1. If no key provided, prints all config. |
| **Success output (table)** | Value string |
| **Success output (json)** | `{ ok: true, data: { key, value } }` |

---

## 15. Task 11: Auth Commands

### 15.1 `lemonade auth login`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **Behavior** | Opens browser for OAuth2 Authorization Code + PKCE flow. Starts a local HTTP server on port 9876 to receive the callback. Exchanges code for tokens and stores in `~/.lemonade/config.json`. |
| **Success output (table)** | "Logged in as <email>" |
| **Success output (json)** | `{ ok: true, data: { email, expires_at } }` |
| **Error cases** | Timeout (120s), user denied, server unreachable |

### 15.2 `lemonade auth token <api-key>`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **Behavior** | Stores the API key in `~/.lemonade/config.json`. Validates the key by calling `aiGetMe`. |
| **Success output (table)** | "API key saved. Authenticated as <name>" |
| **Success output (json)** | `{ ok: true, data: { name, email } }` |
| **Error cases** | Invalid key (AUTH_ERROR) |

### 15.3 `lemonade auth whoami`

| Property | Value |
|----------|-------|
| **Flags** | `--json` |
| **API** | GraphQL query `aiGetMe` (`ai-tool.ts:240-266`) |
| **Success output (table)** | Key-value: Name, Email, User ID |
| **Success output (json)** | `{ ok: true, data: { _id, name, email, first_name, last_name } }` |
| **Error cases** | Not authenticated (AUTH_ERROR) |

```
GraphQL query:
  query { aiGetMe { _id name email first_name last_name } }
```

---

## 16. Testing Strategy

### 16.1 Unit Tests

| Test suite | File | What to verify |
|------------|------|----------------|
| Auth store | `tests/unit/auth/store.test.ts` | Config file read/write, auth resolution order (flag > env > config), token expiry check |
| GraphQL client | `tests/unit/api/graphql.test.ts` | Request construction, auth header injection, error parsing, timeout handling |
| Atlas client | `tests/unit/api/atlas.test.ts` | URL construction, Atlas-Agent-Id/Atlas-Version headers, 402 pass-through, query string encoding |
| Registry client | `tests/unit/api/registry.test.ts` | Search query construction, timeout, response parsing |
| JSON output | `tests/unit/output/json.test.ts` | Envelope structure for success/error/paginated responses |
| Table output | `tests/unit/output/table.test.ts` | Column alignment, truncation, key-value rendering |
| Error handler | `tests/unit/output/error.test.ts` | Exit code mapping: GraphQLError -> AUTH_ERROR, AtlasError -> USER_ERROR, network -> NETWORK_ERROR |
| Command parsing | `tests/unit/commands/*.test.ts` | Flag parsing, required flag validation, default values, flag-to-API mapping |

All unit tests use `nock` to mock HTTP responses. No real network calls.

### 16.2 Integration Tests

| Test | Target | What to verify |
|------|--------|----------------|
| Auth flow | Staging backend | `lemonade auth token <key>` validates key, `lemonade auth whoami` returns profile |
| Space CRUD | Staging backend | Create space, list spaces, update space, verify mutations reach backend |
| Event lifecycle | Staging backend | Create event, add ticket type, publish, list events, cancel |
| Atlas search | Staging registry | `lemonade event search "test"` returns federated results |
| Atlas purchase | Staging backend | `lemonade tickets buy` returns 402 challenge with checkout URL |
| Rewards | Staging backend | `lemonade rewards balance` returns reward balances |
| Config | Local filesystem | `lemonade config init`, `set`, `get` cycle |
| JSON mode | All commands | Every command with `--json` produces valid JSON matching the envelope schema |
| Error codes | Various | Auth failure -> exit 2, network timeout -> exit 3, user error -> exit 1 |

Integration tests run against staging and require `LEMONADE_API_KEY` and `LEMONADE_STAGING_URL` environment variables.

### 16.3 Test Fixtures

```typescript
// tests/fixtures/atlas-search-result.json
{
  "items": [{
    "id": "atlas_evt_abc123",
    "title": "Berlin Techno Night",
    "description": "Underground techno at Tresor",
    "start": "2026-03-22T22:00:00Z",
    "location": { "name": "Tresor", "city": "Berlin", "country": "DE", "lat": 52.51, "lng": 13.42 },
    "categories": ["music", "nightlife"],
    "organizer": { "name": "Berlin Techno Collective", "verified": true, "atlas_id": "org_xyz" },
    "price": { "amount": 18.00, "currency": "EUR", "display": "18.00 EUR" },
    "source": { "platform": "lemonade", "url": "https://lemonade.social/e/tresor-night" },
    "availability": "available",
    "payment_methods": ["tempo_usdc", "stripe_card"]
  }],
  "cursor": "eyJwIjoxfQ==",
  "total": 47,
  "sources": [{ "platform": "lemonade", "count": 32 }, { "platform": "eventbrite", "count": 15 }]
}

// tests/fixtures/graphql-event.json
{
  "data": {
    "aiCreateEvent": {
      "_id": "664f1a2b3c4d5e6f7a8b9c0d",
      "title": "Tech Meetup Berlin",
      "shortid": "tech-meetup-berlin",
      "start": "2026-04-01T18:00:00Z",
      "end": "2026-04-01T21:00:00Z",
      "published": false,
      "description": "Monthly tech meetup"
    }
  }
}

// tests/fixtures/atlas-402-challenge.json
{
  "hold_id": "hold_test123",
  "amount": 25.00,
  "currency": "USD",
  "amount_usdc": 25.00,
  "payment_methods": ["tempo_usdc", "stripe_card"],
  "expires_at": "2026-03-19T12:05:00Z"
}

// tests/fixtures/atlas-checkout.json
{
  "checkout_url": "https://lemonade.social/checkout/hold_test123?session=cs_test",
  "expires_at": "2026-03-19T12:10:00Z"
}
```

---

## 17. Publishing and Distribution

### 17.1 npm Package

```json
{
  "name": "lemonade-cli",
  "version": "0.1.0",
  "bin": { "lemonade": "./dist/index.js" },
  "files": ["dist/", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" }
}
```

**Install methods:**

```bash
# Global install
npm install -g lemonade-cli

# npx (no install)
npx lemonade-cli event search "techno berlin"

# Project-local
npm install --save-dev lemonade-cli
npx lemonade event list
```

### 17.2 Versioning

- Semantic versioning: `MAJOR.MINOR.PATCH`
- `0.x.y` during pre-release (breaking changes allowed)
- `1.0.0` once all Phase 2-4 APIs are stable
- CLI version displayed via `lemonade --version`

### 17.3 CI/CD

- **Build:** `npm run build` (TypeScript compilation)
- **Test:** `npm test` (unit), `npm run test:integration` (staging)
- **Lint:** `npm run lint`
- **Publish:** Manual via `npm publish` from release branch, or automated via GitHub Actions on tag push

### 17.4 Entry Point

**File:** `src/index.ts`

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth';
import { registerSpaceCommands } from './commands/space';
import { registerEventCommands } from './commands/event';
import { registerTicketCommands } from './commands/tickets';
import { registerRewardCommands } from './commands/rewards';
import { registerSiteCommands } from './commands/site';
import { registerConnectorCommands } from './commands/connectors';
import { registerConfigCommands } from './commands/config';
import { version } from '../package.json';

const program = new Command();

program
  .name('lemonade')
  .description('Lemonade CLI -- manage Spaces, events, and tickets')
  .version(version);

registerAuthCommands(program);
registerSpaceCommands(program);
registerEventCommands(program);
registerTicketCommands(program);
registerRewardCommands(program);
registerSiteCommands(program);
registerConnectorCommands(program);
registerConfigCommands(program);

program.parse();
```

### 17.5 Command Registration Pattern

Every command file exports a single `register*Commands(program)` function:

```typescript
// src/commands/event.ts (pattern example -- abbreviated)

import { Command } from 'commander';
import { graphqlRequest } from '../api/graphql';
import { registrySearch } from '../api/registry';
import { atlasRequest } from '../api/atlas';
import { jsonSuccess } from '../output/json';
import { renderTable, renderKeyValue } from '../output/table';
import { handleError } from '../output/error';

export function registerEventCommands(program: Command): void {
  const event = program
    .command('event')
    .description('Manage events');

  event
    .command('create')
    .description('Create a new event')
    .requiredOption('--title <title>', 'Event title')
    .requiredOption('--start <datetime>', 'Start date (ISO 8601)')
    .option('--end <datetime>', 'End date (ISO 8601)')
    .option('--description <text>', 'Event description')
    .option('--space <id>', 'Space ID')
    .option('--address <text>', 'Venue address')
    .option('--virtual', 'Virtual event')
    .option('--private', 'Private event')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        const result = await graphqlRequest<{ aiCreateEvent: Record<string, unknown> }>(
          `mutation($input: AICreateEventInput!) {
            aiCreateEvent(input: $input) {
              _id title shortid start end published description
            }
          }`,
          {
            input: {
              title: opts.title,
              start: new Date(opts.start).toISOString(),
              end: opts.end ? new Date(opts.end).toISOString() : undefined,
              description: opts.description,
              space: opts.space,
              address: opts.address ? { title: opts.address } : undefined,
              virtual: opts.virtual || false,
              private: opts.private || false,
            },
          },
        );

        const event = result.aiCreateEvent;

        if (opts.json) {
          console.log(jsonSuccess(event));
        } else {
          console.log(renderKeyValue([
            ['ID', String(event._id)],
            ['Title', String(event.title)],
            ['Start', String(event.start)],
            ['Status', 'Draft (unpublished)'],
          ]));
        }
      } catch (error) {
        handleError(error, opts.json);
      }
    });

  // ... remaining event subcommands follow the same pattern
}
```

---

## 18. AI Agent Usage Examples

### 18.1 Claude Code: Create a Full Community Setup

```bash
# Authenticate
export LEMONADE_API_KEY="lmnd_key_abc123"

# Create a space
SPACE=$(lemonade space create "Berlin Techno Collective" \
  --description "Underground electronic music community" \
  --slug "berlin-techno" \
  --json | jq -r '.data._id')

# Connect Eventbrite
lemonade space connect "$SPACE" eventbrite --json

# Create an event
EVENT=$(lemonade event create \
  --title "Tresor: Pulse" \
  --start "2026-04-05T22:00:00+02:00" \
  --end "2026-04-06T06:00:00+02:00" \
  --description "A night of pulsing techno at Tresor" \
  --space "$SPACE" \
  --address "Kopenicker Str. 70, 10179 Berlin" \
  --json | jq -r '.data._id')

# Add ticket types
lemonade tickets create-type "$EVENT" \
  --name "Early Bird" --price 15.00 --currency EUR --limit 100 --json

lemonade tickets create-type "$EVENT" \
  --name "General Admission" --price 25.00 --currency EUR --limit 300 --json

lemonade tickets create-type "$EVENT" \
  --name "VIP" --price 50.00 --currency EUR --limit 50 --json

# Generate a page
PAGE=$(lemonade site generate "$EVENT" \
  --type event \
  --description "Dark minimal design with large hero image, lineup section, and ticket purchase" \
  --style "dark minimal techno" \
  --json | jq -r '.data._id')

# Deploy the page
lemonade site deploy "$PAGE" --json

# Publish the event
lemonade event publish "$EVENT" --json

# Verify everything
lemonade event get "$EVENT" --json
lemonade event analytics "$EVENT" --json
```

### 18.2 Codex: Search and Purchase Flow

```bash
# Search for events
RESULTS=$(lemonade event search "jazz new york" \
  --date-from "2026-04-01" \
  --date-to "2026-04-30" \
  --price-max 100 \
  --limit 5 \
  --json)

# Extract the first event ID
EVENT_ID=$(echo "$RESULTS" | jq -r '.data.items[0].id')

# Get ticket types for the event
lemonade tickets types "$EVENT_ID" --json

# Initiate purchase
PURCHASE=$(lemonade tickets buy "$EVENT_ID" \
  --ticket-type "tkt_general" \
  --quantity 2 \
  --attendee-name "Alice Smith" --attendee-email "alice@example.com" \
  --attendee-name "Bob Jones" --attendee-email "bob@example.com" \
  --json)

# Extract hold_id and checkout_url
HOLD_ID=$(echo "$PURCHASE" | jq -r '.data.hold_id')
CHECKOUT=$(echo "$PURCHASE" | jq -r '.data.checkout_url')

echo "Pay at: $CHECKOUT"

# Poll for receipt (after user pays)
lemonade tickets receipt "$HOLD_ID" --poll --json
```

### 18.3 Cursor: Reward Monitoring

```bash
# Check reward balance
lemonade rewards balance --json

# View payout history
lemonade rewards history --limit 10 --json

# Configure payout wallet
lemonade rewards settings \
  --wallet "0x1234...abcd" \
  --chain "8453" \
  --preferred crypto \
  --json
```

### 18.4 Environment Variables for AI Agents

AI agents should set these environment variables instead of using `~/.lemonade/config.json`:

| Variable | Purpose |
|----------|---------|
| `LEMONADE_API_KEY` | Authentication (takes priority over config file) |
| `LEMONADE_API_URL` | Backend URL override (default: `https://backend.lemonade.social`) |
| `LEMONADE_REGISTRY_URL` | Registry URL override (default: `https://registry.atlas-protocol.org`) |

When `LEMONADE_API_KEY` is set, the CLI never prompts for authentication. Combined with `--json`, this makes the CLI fully non-interactive for agent use.

---

## 19. Post-Launch: Auto-Sync Pipeline

> **AUDIT FIX W4-R2 [2]:** This section describes post-launch automation. For Wave 4 launch, all 44 commands are manually implemented per Sections 5-15. Those sections are authoritative for launch scope. The codegen pipeline described below replaces manual command maintenance AFTER launch, once the MCP schema export and GraphQL introspection tooling are built and validated.

The CLI must stay in sync with lemonade-ai MCP tools and lemonade-backend APIs automatically. No manual command maintenance. New MCP tools become CLI commands on the next publish cycle, and breaking API changes are caught in CI before they reach users.

### 19.1 MCP Tool Schema Export

lemonade-ai already defines every operation as MCP tools with Zod schemas (input types, output types, descriptions) in `src/app/plugins/mcp.ts:54-111`. A new build step exports these definitions as a JSON schema file that serves as the single source of truth for what operations exist.

**New script in lemonade-ai:** `yarn export-mcp-schema`

**File:** `lemonade-ai/src/bin/export-mcp-schema.ts`

```typescript
// lemonade-ai/src/bin/export-mcp-schema.ts

import { buildServer } from '../app/plugins/mcp';
import { writeFileSync } from 'fs';

async function main() {
  const server = await buildServer();
  const tools = server.getRegisteredTools();

  const schema = {
    version: process.env.npm_package_version || '0.0.0',
    exported_at: new Date().toISOString(),
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: tool.inputSchema,    // Zod schema serialized to JSON Schema
      outputSchema: tool.outputSchema,  // Zod schema serialized to JSON Schema
    })),
  };

  writeFileSync('dist/mcp-schema.json', JSON.stringify(schema, null, 2));
  console.log(`Exported ${schema.tools.length} tools to dist/mcp-schema.json`);
}

main();
```

**Integration with lemonade-ai build:**

Add to `lemonade-ai/package.json`:

```json
{
  "scripts": {
    "export-mcp-schema": "ts-node src/bin/export-mcp-schema.ts",
    "build": "tsc && yarn export-mcp-schema"
  }
}
```

The schema runs automatically on every lemonade-ai build. The output file `dist/mcp-schema.json` is published as a build artifact and optionally included in the npm package.

**Schema structure:**

```json
{
  "version": "1.5.0",
  "exported_at": "2026-03-19T10:00:00Z",
  "tools": [
    {
      "name": "search_events",
      "description": "Search for events by keyword, location, date...",
      "annotations": { "readOnlyHint": true, "destructiveHint": false },
      "inputSchema": {
        "type": "object",
        "properties": {
          "q": { "type": "string", "description": "Keyword search" },
          "lat": { "type": "number" },
          "lng": { "type": "number" }
        }
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": { "type": "array", "items": { "type": "object" } }
        }
      }
    }
  ]
}
```

### 19.1b GraphQL Introspection (lemonade-backend)

The MCP server exposes roughly 30 tools, but lemonade-backend has 100+ GraphQL resolvers. The CLI must cover the full platform, not just MCP operations. A second codegen source uses standard GraphQL introspection to generate commands for every query and mutation.

**Script:** `yarn generate:graphql` in lemonade-cli

**How it works:**

1. Runs a standard GraphQL introspection query against the backend (staging URL from `LEMONADE_API_URL` or a local schema dump file at `graphql-schema.json`).
2. Parses all queries and mutations from the introspection result.
3. For each operation, generates a command scaffold in `src/commands/extended/`.
4. Flags are derived from GraphQL input types (required args become `requiredOption`, optional args become `option`).
5. Output formatting uses the GraphQL return type fields.

**Zero changes to lemonade-backend.** Introspection is a built-in GraphQL feature. No new code, endpoints, or exports needed.

**Generated output directory:** `src/commands/extended/` (separate from MCP-generated `src/commands/generated/`).

```typescript
// lemonade-cli/src/codegen/generate-graphql.ts (simplified)

import { getIntrospectionQuery, buildClientSchema, printSchema } from 'graphql';

async function introspect(url: string): Promise<IntrospectionResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  });
  const { data } = await response.json();
  return data;
}

function operationToCommand(op: GraphQLOperation): { group: string; subcommand: string } {
  // ai-prefixed operations: aiGetEvent -> event get, aiCreateSpace -> space create
  // atlas-prefixed operations: atlasRewardSummary -> rewards balance
  // Non-prefixed: getSpace -> space get, searchSpaces -> space search
  // ... mapping logic
}

// For each query/mutation:
//   1. Derive command group + subcommand from operation name
//   2. Extract input args as CLI flags
//   3. Extract return type fields for output formatting
//   4. Write command file to src/commands/extended/
```

**Priority resolution when both MCP and GraphQL define the same operation:**

| Source | Directory | Priority | When to use |
|--------|-----------|----------|-------------|
| Manual overrides | `src/commands/manual/` | Highest | Custom behavior (checkout flow, OAuth, polling) |
| MCP schema | `src/commands/generated/` | High | Rich metadata, AI-optimized help text and output |
| GraphQL introspection | `src/commands/extended/` | Low | Full platform coverage for operations not in MCP |

When the same operation exists in multiple sources (e.g., `search_events` is both an MCP tool and a GraphQL query), the higher-priority version wins. The command loader resolves conflicts:

```
Manual > MCP-generated > GraphQL-extended
```

**Updated architecture:**

```
MCP schema (~30 tools)          --> src/commands/generated/   (rich help, custom output)
GraphQL introspection (100+)    --> src/commands/extended/    (auto-generated, full coverage)
Manual overrides (~12 commands) --> src/commands/manual/      (custom behavior)

                Command Loader (src/commands/index.ts)
                    |
                    v
                Manual wins > Generated wins > Extended
```

**Add to `lemonade-cli/package.json`:**

```json
{
  "scripts": {
    "generate": "yarn generate:mcp && yarn generate:graphql",
    "generate:mcp": "ts-node src/codegen/generate.ts mcp-schema.json",
    "generate:graphql": "ts-node src/codegen/generate-graphql.ts",
    "build": "yarn generate && tsc"
  }
}
```

### 19.2 CLI Code Generation

lemonade-cli has a codegen script that reads the MCP schema and generates command scaffolds.

**Script:** `yarn generate:mcp` in lemonade-cli (called by `yarn generate`)

**File:** `lemonade-cli/src/codegen/generate.ts`

```typescript
// lemonade-cli/src/codegen/generate.ts

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface McpToolSchema {
  name: string;
  description: string;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean };
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

interface McpSchema {
  version: string;
  tools: McpToolSchema[];
}

// Maps MCP tool names to CLI command group + subcommand
function toolToCommand(toolName: string): { group: string; subcommand: string } {
  const mappings: Record<string, { group: string; subcommand: string }> = {
    search_events: { group: 'event', subcommand: 'search' },
    get_event: { group: 'event', subcommand: 'get' },
    create_event: { group: 'event', subcommand: 'create' },
    update_event: { group: 'event', subcommand: 'update' },
    publish_event: { group: 'event', subcommand: 'publish' },
    cancel_event: { group: 'event', subcommand: 'cancel' },
    get_hosting_events: { group: 'event', subcommand: 'list' },
    invite_event: { group: 'event', subcommand: 'invite' },
    decide_event_join_requests: { group: 'event', subcommand: 'approvals' },
    list_event_ticket_types: { group: 'tickets', subcommand: 'types' },
    create_event_ticket_type: { group: 'tickets', subcommand: 'create-type' },
    update_event_ticket_type: { group: 'tickets', subcommand: 'update-type' },
    buy_tickets: { group: 'tickets', subcommand: 'buy' },
    calculate_ticket_price: { group: 'tickets', subcommand: 'price' },
    get_me: { group: 'auth', subcommand: 'whoami' },
    list_my_spaces: { group: 'space', subcommand: 'list' },
    create_space: { group: 'space', subcommand: 'create' },
    update_space: { group: 'space', subcommand: 'update' },
    // ... all other mappings
  };

  if (mappings[toolName]) return mappings[toolName];

  // Fallback: derive from tool name
  const parts = toolName.split('_');
  return { group: parts[0], subcommand: parts.slice(1).join('-') };
}

// Convert JSON Schema property to Commander.js flag
function schemaPropertyToFlag(name: string, prop: Record<string, unknown>): string {
  const type = prop.type as string;
  const desc = (prop.description as string) || name;
  const required = prop.required ? '.requiredOption' : '.option';

  if (type === 'boolean') return `${required}('--${name}', '${desc}')`;
  return `${required}('--${name} <${type}>', '${desc}')`;
}

function generateCommandFile(tool: McpToolSchema): string {
  const { group, subcommand } = toolToCommand(tool.name);
  const inputProps = (tool.inputSchema as { properties?: Record<string, Record<string, unknown>> }).properties || {};

  const flags = Object.entries(inputProps)
    .map(([name, prop]) => schemaPropertyToFlag(name, prop))
    .join('\n    ');

  return `// AUTO-GENERATED from mcp-schema.json -- do not edit manually
// MCP tool: ${tool.name}
// Override this command by creating src/commands/manual/${tool.name}.ts

import { Command } from 'commander';
import { graphqlRequest } from '../../api/graphql';
import { jsonSuccess } from '../../output/json';
import { renderTable } from '../../output/table';
import { handleError } from '../../output/error';

export const group = '${group}';
export const subcommand = '${subcommand}';
export const description = '${tool.description.replace(/'/g, "\\'")}';

export function register(parent: Command): void {
  parent
    .command('${subcommand}')
    .description('${tool.description.replace(/'/g, "\\'")}')
    ${flags}
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        // Generated API call -- uses the RESOLVER name (not MCP tool name)
        // See TOOL_TO_RESOLVER mapping below
        const result = await graphqlRequest(
          TOOL_TO_RESOLVER['${tool.name}'],
          opts,
        );

        if (opts.json) {
          console.log(jsonSuccess(result));
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (error) {
        handleError(error, opts.json);
      }
    });
}
`;
}

function main() {
  const schemaPath = process.argv[2] || 'mcp-schema.json';
  const schema: McpSchema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

  const outDir = join(__dirname, '..', 'commands', 'generated');
  mkdirSync(outDir, { recursive: true });

  let count = 0;
  for (const tool of schema.tools) {
    const fileName = `${tool.name.replace(/_/g, '-')}.ts`;
    writeFileSync(join(outDir, fileName), generateCommandFile(tool));
    count++;
  }

  // Write schema version marker
  writeFileSync(
    join(outDir, '_schema-version.json'),
    JSON.stringify({ version: schema.version, generated_at: new Date().toISOString(), tool_count: count }),
  );

  console.log(\`Generated \${count} command files from schema v\${schema.version}\`);
}

main();
```

> **AUDIT FIX W4-R2 [5]:** MCP tool names do NOT match GraphQL resolver names. The codegen MUST use this mapping. MCP tool `search_events` maps to GraphQL resolver `aiSearchEvents`, not `search_events`.

**MCP Tool Name to GraphQL Resolver Mapping (TOOL_TO_RESOLVER):**

```typescript
// src/codegen/tool-resolver-map.ts
export const TOOL_TO_RESOLVER: Record<string, string> = {
  search_events: 'aiSearchEvents',
  get_event: 'aiGetEvent',
  create_event: 'aiCreateEvent',
  update_event: 'aiUpdateEvent',
  publish_event: 'aiPublishEvent',
  cancel_event: 'aiCancelEvent',
  get_hosting_events: 'aiGetHostingEvents',
  invite_event: 'aiInviteEvent',
  decide_event_join_requests: 'aiDecideEventJoinRequests',
  get_event_feedback_summary: 'aiGetEventFeedbackSummary',
  list_event_feedbacks: 'aiListEventFeedbacks',
  get_event_checkins: 'aiGetEventCheckins',
  get_event_checkin_insight: 'aiGetEventCheckins',
  list_event_ticket_types: 'aiListEventTicketTypes',
  create_event_ticket_type: 'aiCreateEventTicketType',
  update_event_ticket_type: 'aiUpdateEventTicketType',
  buy_tickets: 'aiBuyTickets',
  calculate_ticket_price: 'aiCalculateTicketPrice',
  get_me: 'aiGetMe',
  list_my_spaces: 'aiListMySpaces',
  create_space: 'aiCreateSpace',
  update_space: 'aiUpdateSpace',
  get_space_stats: 'aiGetSpaceStats',
  get_space_members: 'aiGetSpaceMembers',
  get_event_guests: 'aiGetEventGuests',
  get_event_guest_stats: 'aiGetEventGuestStats',
  get_event_ticket_sold_insight: 'aiGetEventTicketSoldInsight',
  get_event_view_insight: 'aiGetEventViewInsight',
  get_event_payment_stats: 'aiGetEventPaymentStats',
  get_event_application_answers: 'aiGetEventApplicationAnswers',
  get_notifications: 'aiGetNotifications',
  read_notifications: 'aiReadNotifications',
  generate_page_from_description: 'aiGeneratePageFromDescription',
  create_page_config: 'aiCreatePageConfig',
  update_page_config_section: 'aiUpdatePageConfigSection',
  suggest_sections: 'aiSuggestSections',
  get_backend_version: 'aiGetBackendVersion',
  list_chains: 'aiListChains',
  accept_event: 'aiAcceptEvent',
  decline_event: 'aiDeclineEvent',
};
```

> **AUDIT FIX W4-R2 [12]:** Complete example of a generated command file.

**Example: `src/commands/generated/search-events.ts` (full contents):**

```typescript
// AUTO-GENERATED from mcp-schema.json -- do not edit manually
// MCP tool: search_events -> GraphQL resolver: aiSearchEvents
// Override this command by creating src/commands/manual/search-events.ts

import { Command } from 'commander';
import { graphqlRequest } from '../../api/graphql';
import { jsonSuccess } from '../../output/json';
import { renderTable } from '../../output/table';
import { handleError } from '../../output/error';

export const group = 'event';
export const subcommand = 'search';
export const description = 'Search for events by keyword, location, date, and category';

const QUERY = `query($q: String, $lat: Float, $lng: Float, $limit: Int) {
  aiSearchEvents(q: $q, lat: $lat, lng: $lng, limit: $limit) {
    _id title start end published description
    address { title city country latitude longitude }
  }
}`;

export function register(parent: Command): void {
  parent
    .command('search [query]')
    .description(description)
    .option('--lat <number>', 'Latitude for location search', parseFloat)
    .option('--lng <number>', 'Longitude for location search', parseFloat)
    .option('--limit <number>', 'Max results (default 10)', parseInt)
    .option('--json', 'Output as JSON')
    .action(async (query, opts) => {
      try {
        const result = await graphqlRequest<{
          aiSearchEvents: Array<{
            _id: string;
            title: string;
            start: string;
            end?: string;
            address?: { title: string; city?: string };
          }>;
        }>(QUERY, {
          q: query,
          lat: opts.lat,
          lng: opts.lng,
          limit: opts.limit || 10,
        });

        const events = result.aiSearchEvents;

        if (opts.json) {
          console.log(jsonSuccess(events));
        } else {
          console.log(renderTable(
            ['Title', 'Date', 'Location'],
            events.map((e) => [
              e.title,
              new Date(e.start).toLocaleDateString(),
              e.address?.city || 'Online',
            ]),
          ));
        }
      } catch (error) {
        handleError(error, opts.json);
      }
    });
}
```

**Add to `lemonade-cli/package.json`:**

```json
{
  "scripts": {
    "generate": "ts-node src/codegen/generate.ts mcp-schema.json",
    "build": "yarn generate && tsc"
  }
}
```

**Key design decisions:**

- Generated files are committed to git (not `.gitignored`). This means the CLI works without running codegen -- `npm install -g lemonade-cli` uses the last-generated commands.
- The `_schema-version.json` marker tracks which schema version the generated files were built against.
- Each generated file exports `group`, `subcommand`, and a `register()` function, making them discoverable by the command loader.

### 19.3 Manual Override Pattern

Commands that need custom behavior beyond what codegen provides live in `src/commands/manual/` and take precedence over generated commands.

```
src/commands/
  manual/        # hand-written overrides (never overwritten by codegen) -- highest priority
  generated/     # auto-generated from MCP schema (committed, overwritten on yarn generate:mcp)
  extended/      # auto-generated from GraphQL introspection (committed, overwritten on yarn generate:graphql)
  index.ts       # loader: manual first, then generated, then extended (highest priority wins)
```

**Loader logic (`src/commands/index.ts`):**

```typescript
// src/commands/index.ts

import { Command } from 'commander';
import { readdirSync } from 'fs';
import { join } from 'path';

interface CommandModule {
  group: string;
  subcommand: string;
  register: (parent: Command) => void;
}

export function loadAllCommands(program: Command): void {
  const registered = new Set<string>();

  // Phase 1: Load manual commands (these take precedence)
  const manualDir = join(__dirname, 'manual');
  for (const file of safeReaddir(manualDir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    const mod = require(join(manualDir, file)) as CommandModule;
    const key = `${mod.group}:${mod.subcommand}`;
    const parent = getOrCreateGroup(program, mod.group);
    mod.register(parent);
    registered.add(key);
  }

  // Phase 2: Load MCP-generated commands (skip if manual override exists)
  const generatedDir = join(__dirname, 'generated');
  for (const file of safeReaddir(generatedDir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    if (file.startsWith('_')) continue; // skip _schema-version.json
    const mod = require(join(generatedDir, file)) as CommandModule;
    const key = `${mod.group}:${mod.subcommand}`;
    if (registered.has(key)) continue; // manual override exists
    const parent = getOrCreateGroup(program, mod.group);
    mod.register(parent);
    registered.add(key);
  }

  // Phase 3: Load GraphQL-extended commands (skip if manual or MCP override exists)
  const extendedDir = join(__dirname, 'extended');
  for (const file of safeReaddir(extendedDir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    if (file.startsWith('_')) continue;
    const mod = require(join(extendedDir, file)) as CommandModule;
    const key = `${mod.group}:${mod.subcommand}`;
    if (registered.has(key)) continue; // manual or MCP-generated override exists
    const parent = getOrCreateGroup(program, mod.group);
    mod.register(parent);
    registered.add(key);
  }
}

function getOrCreateGroup(program: Command, name: string): Command {
  const existing = program.commands.find((c) => c.name() === name);
  if (existing) return existing;
  return program.command(name).description(`Manage ${name}s`);
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir); }
  catch { return []; }
}
```

**Commands that require manual overrides (not suitable for codegen):**

| Command | Why manual |
|---------|-----------|
| `tickets buy` | Custom 402 challenge -> checkout URL -> receipt polling flow |
| `tickets receipt` | Polling loop with `--poll` flag and 3s interval |
| `site generate` | Streaming output for AI generation progress |
| `site preview` | Browser opening + page existence validation |
| `auth login` | OAuth browser flow with local HTTP server |
| `auth token` | API key validation before storing |
| `config *` | Local filesystem operations, no API calls |
| `space connect` | OAuth browser flow + API key submission |
| `space upgrade` | Browser URL construction, no API call |
| `space plan` | Multi-query aggregation with formatted table |
| `rewards settings` | Read-or-write behavior based on flags |
| `rewards referral` | Three operations behind one command (generate, apply, summary) |

All other commands (simple CRUD operations, list queries, analytics) are generated from the MCP schema and work without manual intervention.

> **AUDIT FIX W4-R2 [8][15]:** Shared types package (`@lemonade/api-types`) deferred to post-launch. Removed from all dependency lists, imports, and CI steps. CLI inlines its own TypeScript types in `src/api/types.ts`, derived from MCP schema output types and GraphQL introspection return types. Zero lemonade-backend changes required.

### 19.4 CI Pipeline

On lemonade-ai or lemonade-backend deploy, a CI job verifies CLI compatibility and auto-publishes if all checks pass.

```
Backend or AI service deploys
    |
    v
GitHub Actions: cli-compatibility-check.yml
    |
    +--> Step 1: Fetch latest mcp-schema.json from lemonade-ai build artifact
    |
    +--> Step 2: Run yarn generate:mcp (regenerate MCP commands)
    |
    +--> Step 3: Run yarn generate:graphql (regenerate GraphQL extended commands from staging)
    |
    +--> Step 4: Run yarn build (TypeScript type check against new schemas)
    |
    +--> Step 5: Run yarn test (unit tests with mocked HTTP)
    |
    +--> Step 6: Run yarn test:integration (integration tests against staging)
    |
    +--> Step 7: If all pass -> auto-publish new CLI version to npm
    |            If any fail -> alert team via Slack, block CLI publish
    |            (Backend/AI deploy is NOT blocked -- the CLI is downstream)
```

**GitHub Actions workflow:**

```yaml
# .github/workflows/cli-compatibility-check.yml
name: CLI Compatibility Check

on:
  workflow_dispatch:
  repository_dispatch:
    types: [backend-deployed, ai-deployed]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: lemonade/lemonade-cli

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - run: npm ci

      # Fetch latest MCP schema from lemonade-ai
      - name: Fetch MCP schema
        run: |
          curl -f -o mcp-schema.json \
            "${{ secrets.AI_BUILD_ARTIFACT_URL }}/mcp-schema.json"

      # Regenerate MCP commands from schema
      - run: yarn generate:mcp

      # Regenerate GraphQL extended commands from staging introspection
      - run: yarn generate:graphql
        env:
          LEMONADE_API_URL: ${{ secrets.STAGING_API_URL }}

      # Type check
      - run: yarn build

      # Unit tests
      - run: yarn test

      # Integration tests against staging
      - run: yarn test:integration
        env:
          LEMONADE_API_KEY: ${{ secrets.STAGING_API_KEY }}
          LEMONADE_API_URL: ${{ secrets.STAGING_API_URL }}
          LEMONADE_REGISTRY_URL: ${{ secrets.STAGING_REGISTRY_URL }}

      # Auto-publish if all passed
      - name: Publish to npm
        if: success()
        run: |
          npm version patch --no-git-tag-version
          npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # Alert on failure
      - name: Alert on failure
        if: failure()
        run: |
          curl -X POST "${{ secrets.SLACK_WEBHOOK }}" \
            -d '{"text":"CLI compatibility check failed after backend/AI deploy. Schema or type changes broke the CLI build."}'
```

**The CLI is never more than one CI cycle behind the APIs.** New MCP tools automatically become CLI commands on next publish. The backend/AI deploy is never blocked by CLI failures -- the CLI is a downstream consumer.

### 19.5 Schema Versioning

The MCP schema includes a version field that tracks compatibility.

**Version field in `mcp-schema.json`:**

```json
{
  "version": "1.5.0",
  "tools": [...]
}
```

**CLI startup check:**

```typescript
// src/commands/index.ts (added to loadAllCommands)

import { readFileSync } from 'fs';
import { join } from 'path';

function checkSchemaVersion(): void {
  try {
    const marker = JSON.parse(
      readFileSync(join(__dirname, 'generated', '_schema-version.json'), 'utf-8'),
    );
    const builtAgainst = marker.version; // e.g., "1.5.0"

    // On first command execution, the CLI can optionally check the live API version
    // > **AUDIT FIX W4-R2 [14]:** Check once per CLI invocation (not per command). Cache result for the session.
    // via aiGetBackendVersion (ai-tool.ts:107, returns package.json version string).
    // Called once in loadAllCommands(). Result cached in a module-level variable.
    // Subsequent commands in the same process reuse the cached version.
    // This is best-effort -- network failure should not block CLI usage.
  } catch {
    // No schema version marker -- CLI was installed without codegen (fine, use committed files)
  }
}
```

**Version compatibility rules:**

> **AUDIT FIX W4-R2 [16]:** Runtime behavior for version mismatches is explicit: patch/minor = warning, major = hard error.

| Schema change | Version bump | CI behavior | Runtime behavior |
|---------------|-------------|-------------|------------------|
| New tool added | Minor (1.5 -> 1.6) | CI passes: new generated command auto-added | Warning on stderr |
| Tool description or annotation changed | Patch (1.5.0 -> 1.5.1) | CI passes: generated file updated | No warning |
| Tool input field added (optional) | Patch | CI passes: new flag auto-added to generated command | No warning |
| Tool input field removed | Major (1.x -> 2.0) | CI fails: generated command references removed field | **Hard error: exit code 1** |
| Tool renamed | Major | CI fails: generated command uses old name | **Hard error: exit code 1** |
| Tool removed | Major | CI fails: generated file references non-existent tool | **Hard error: exit code 1** |

**Runtime mismatch behavior:**

> **AUDIT FIX W4-R2 [6]:** `aiGetBackendVersion` is a real resolver at `ai-tool.ts:107`. It returns the lemonade-backend `package.json` version as a string. The CLI calls this once per invocation to compare against its built schema version.

- **Patch or minor mismatch** (e.g., CLI built against 1.5, server is 1.7): Warning on stderr, command execution continues normally.

```
Warning: CLI was built against API v1.5 but server is v1.7.
Some commands may be missing or outdated. Run: npm update -g lemonade-cli
```

- **Major mismatch** (e.g., CLI built against 1.x, server is 2.x): Hard error, exit code 1.

```
Error: CLI is incompatible with API v2.0 (CLI was built for v1.x).
Breaking changes detected. Run: npm update -g lemonade-cli
```

Both messages are printed to stderr (do not pollute `--json` stdout). The major-version hard error prevents silent failures from removed or renamed operations.

---

## 20. Execution Status

> **AUDIT FIX W4-R2 [7]:** Tasks 6 and 7 are explicitly BLOCKED until upstream phases deploy.

### Blockers

| Blocker | Blocks | Status |
|---------|--------|--------|
| Phase 2 P2-NEW-1: `POST /atlas/v1/holds/:hold_id/checkout` (PR be#1992) | Task 6 (`tickets buy`, `tickets receipt`) | NOT MERGED |
| Phase 4: `atlas-reward.ts` reward resolvers (feat/atlas-phase-4-rewards) | Task 7 (all `rewards` commands) | NOT MERGED |

### Task Status

| Agent | Task | Status |
|-------|------|--------|
| CLI Agent | Task 1: Authentication system (auth store + OAuth) | NOT STARTED |
| CLI Agent | Task 2: API client layer (GraphQL + Atlas + Registry) | NOT STARTED |
| CLI Agent | Task 3: Output formatting (JSON + table + errors) | NOT STARTED |
| CLI Agent | Task 4: Space commands (create, list, update, connect, connectors, analytics, plan, upgrade) | NOT STARTED |
| CLI Agent | Task 5: Event commands (create, list, search, get, update, publish, cancel, analytics, guests, invite, approvals, feedback, checkins) | NOT STARTED |
| CLI Agent | Task 6: Ticket commands (types, create-type, update-type, buy, price, receipt) | **BLOCKED UNTIL** Phase 2 P2-NEW-1 is deployed |
| CLI Agent | Task 7: Rewards commands (balance, history, payouts, referral, settings) | **BLOCKED UNTIL** Phase 4 reward resolvers are deployed |
| CLI Agent | Task 8: Site commands (generate, preview, deploy, templates) | NOT STARTED |
| CLI Agent | Task 9: Connector commands (list, sync) | NOT STARTED |
| CLI Agent | Task 10: Config commands (init, set, get) | NOT STARTED |
| CLI Agent | Task 11: Auth commands (login, token, whoami) | NOT STARTED |
| CLI Agent | Task 12: Tests (unit + integration) | NOT STARTED |
| CLI Agent | Task 13: Package setup + publishing config | NOT STARTED |
| AI Agent | Task 14: MCP schema export script in lemonade-ai (post-launch) | NOT STARTED |
| CLI Agent | Task 15: MCP codegen pipeline (post-launch) | NOT STARTED |
| CLI Agent | Task 15b: GraphQL introspection codegen (post-launch) | NOT STARTED |
| CLI Agent | Task 16: CI workflow (post-launch) | NOT STARTED |
| CLI Agent | Task 17: Schema version checker (post-launch) | NOT STARTED |

---

## Appendix A: Complete Command Reference

```
lemonade auth login                                    # OAuth browser login
lemonade auth token <api-key>                          # API key auth
lemonade auth whoami                                   # Show current user

lemonade space create <title>                          # Create a space
lemonade space list                                    # List my spaces
lemonade space update <space-id>                       # Update space
lemonade space connect <space-id> <platform>           # Connect Eventbrite/Lu.ma/Meetup
lemonade space connectors <space-id>                   # List connected platforms
lemonade space analytics <space-id>                    # Space analytics
lemonade space plan <space-id-or-slug>                 # Show plan + usage limits
lemonade space upgrade <space-id-or-slug>              # Open subscription page

lemonade event create                                  # Create event (via flags)
lemonade event list                                    # List my events
lemonade event search <query>                          # Atlas federated search
lemonade event get <event-id>                          # Event details
lemonade event update <event-id>                       # Update event
lemonade event publish <event-id>                      # Publish event
lemonade event cancel <event-id>                       # Cancel event
lemonade event analytics <event-id>                    # Event analytics
lemonade event guests <event-id>                       # Guest list
lemonade event invite <event-id>                       # Send invitations
lemonade event approvals <event-id>                    # Manage join requests
lemonade event feedback <event-id>                     # View feedback + ratings
lemonade event checkins <event-id>                     # View check-in list

lemonade tickets types <event-id>                      # List ticket types
lemonade tickets create-type <event-id>                # Create ticket type
lemonade tickets update-type <ticket-type-id>          # Update ticket type
lemonade tickets buy <event-id>                        # Purchase tickets (Atlas 402 flow)
lemonade tickets price <event-id>                      # Calculate price with discounts
lemonade tickets receipt <hold-id>                     # Get purchase receipt

lemonade rewards balance                               # Show reward balance
lemonade rewards history                               # Reward distribution history
lemonade rewards payouts                               # Payout history
lemonade rewards referral                              # Referral program
lemonade rewards settings                              # Configure payout wallet

lemonade site generate <owner-id>                      # AI-generate page from description
lemonade site preview <page-id>                        # Preview in browser
lemonade site deploy <page-id>                         # Publish page
lemonade site templates                                # List available templates

lemonade connectors list                               # List available connectors
lemonade connectors sync <connection-id>               # Trigger manual sync

lemonade config init                                   # Initialize config file
lemonade config set <key> <value>                      # Set config value
lemonade config get [key]                              # Get config value(s)
```

**Global flags (available on all commands):**

| Flag | Description |
|------|-------------|
| `--json` | Output as structured JSON (machine-parseable) |
| `--api-key <key>` | Override API key for this command |
| `--api-url <url>` | Override backend URL for this command |
| `--help` | Show command help |
| `--version` | Show CLI version |

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | User error (bad input, resource not found, validation failure) |
| 2 | Authentication error (not logged in, invalid key, expired token) |
| 3 | Network error (timeout, connection refused, server error) |

---

## Appendix B: API Endpoint Cross-Reference

> **AUDIT FIX W4-R3 [1]:** Every line number re-verified via `grep -n` against current HEAD of lemonade-backend (master, post-Phase-5 merge). connector.ts shifted +18 lines from Phase 5 merge. ai-tool.ts and page-config.ts unchanged.

| CLI Command | Backend Endpoint | Source File |
|-------------|------------------|-------------|
| `auth whoami` | GraphQL `aiGetMe` | `ai-tool.ts:141` |
| `space create` | GraphQL `aiCreateSpace` | `ai-tool.ts:394` |
| `space list` | GraphQL `aiListMySpaces` | `ai-tool.ts:301` |
| `space update` | GraphQL `aiUpdateSpace` | `ai-tool.ts:406` |
| `space connect` | GraphQL `connectPlatform` | `connector.ts:179` |
| `space connect` | GraphQL `submitApiKey` | `connector.ts:325` |
| `space connect` | GraphQL `configureConnection` | `connector.ts:364` |
| `space connectors` | GraphQL `spaceConnections` | `connector.ts:88` |
| `space analytics` | GraphQL `aiGetSpaceStats` | `ai-tool.ts:986` |
| `space plan` | GraphQL `getSpace` + hardcoded tier limits | `space.ts` (see Section 8.7) |
| `space upgrade` | No API call (opens browser URL) | N/A |
| `event create` | GraphQL `aiCreateEvent` | `ai-tool.ts:194` |
| `event list` | GraphQL `aiGetHostingEvents` | `ai-tool.ts:157` |
| `event search` | REST `GET /atlas/v1/search` | `atlas-registry/src/app/routes/search.ts` |
| `event get` | GraphQL `aiGetEvent` | `ai-tool.ts:211` |
| `event update` | GraphQL `aiUpdateEvent` | `ai-tool.ts:226` |
| `event publish` | GraphQL `aiPublishEvent` | `ai-tool.ts:253` |
| `event cancel` | GraphQL `aiCancelEvent` | `ai-tool.ts:1032` |
| `event analytics` | GraphQL `aiGetEventTicketSoldInsight` | `ai-tool.ts:456` |
| `event analytics` | GraphQL `aiGetEventViewInsight` | `ai-tool.ts:503` |
| `event analytics` | GraphQL `aiGetEventGuestStats` | `ai-tool.ts:640` |
| `event guests` | GraphQL `aiGetEventGuests` | `ai-tool.ts:568` |
| `event invite` | GraphQL `aiInviteEvent` | `ai-tool.ts:112` |
| `event approvals` | GraphQL `aiDecideEventJoinRequests` | `ai-tool.ts:667` |
| `event feedback` | GraphQL `aiGetEventFeedbackSummary` | `ai-tool.ts:808` |
| `event feedback` | GraphQL `aiListEventFeedbacks` | `ai-tool.ts:834` |
| `event checkins` | GraphQL `aiGetEventCheckins` | `ai-tool.ts:747` |
| `tickets types` | GraphQL `aiListEventTicketTypes` | `ai-tool.ts:380` |
| `tickets create-type` | GraphQL `aiCreateEventTicketType` | `ai-tool.ts:421` |
| `tickets update-type` | GraphQL `aiUpdateEventTicketType` | `ai-tool.ts:437` |
| `tickets buy` | REST `POST /atlas/v1/events/:id/purchase` | `controllers/atlas/purchase.ts` (Phase 2) |
| `tickets buy` | REST `POST /atlas/v1/holds/:id/checkout` | `controllers/atlas/checkout.ts` (Phase 2, P2-NEW-1) |
| `tickets price` | GraphQL `aiCalculateTicketPrice` | `ai-tool.ts:1265` |
| `tickets receipt` | REST `GET /atlas/v1/receipts/by-hold/:id` | `controllers/atlas/receipts.ts` (Phase 2) |
| `rewards balance` | GraphQL `atlasRewardSummary` | `atlas-reward.ts:64` (Phase 4) |
| `rewards history` | GraphQL `atlasRewardHistory` | `atlas-reward.ts:118` (Phase 4) |
| `rewards payouts` | GraphQL `atlasPayoutHistory` | `atlas-reward.ts:162` (Phase 4) |
| `rewards referral` | GraphQL `atlasReferralSummary` / `atlasGenerateReferralCode` / `atlasApplyReferralCode` | `atlas-reward.ts:151,197,209` (Phase 4) |
| `rewards settings` | GraphQL `atlasGetPayoutSettings` / `atlasUpdatePayoutSettings` | `atlas-reward.ts:256,224` (Phase 4) |
| `site generate` | GraphQL `aiGeneratePageFromDescription` | `ai-tool.ts:1534` |
| `site preview` | GraphQL `getPageConfig` | `page-config.ts:175` |
| `site deploy` | GraphQL `publishPageConfig` | `page-config.ts:101` |
| `site templates` | GraphQL `aiSuggestSections` | `ai-tool.ts:1558` |
| `connectors list` | GraphQL `availableConnectors` | `connector.ts:67` |
| `connectors sync` | GraphQL `executeConnectorAction` | `connector.ts:443` |

All `ai-tool.ts` paths are relative to `lemonade-backend/src/graphql/resolvers/`. All `connector.ts`, `page-config.ts`, `atlas-reward.ts` paths are in the same directory. Atlas REST controller paths are relative to `lemonade-backend/src/app/`.

---

## Appendix C: MCP Tool Parity

> **Note:** After Task 15 (codegen pipeline) is implemented, MCP tool parity is enforced automatically via the codegen pipeline described in Section 19. The tables below will be maintained by `yarn generate` reading `mcp-schema.json`, not by manual edits. The manual override list in Section 19.3 documents which commands require hand-written implementations. All other MCP tools map 1:1 to generated CLI commands.

The CLI mirrors every Atlas MCP tool from Phase 6 (`lemonade-ai/src/app/plugins/mcp-atlas-tools.ts`):

| MCP Tool | CLI Command | Notes |
|----------|-------------|-------|
| `atlas_search` | `lemonade event search` | Same query params, same response shape |
| `atlas_compare_tickets` | `lemonade tickets types` (per event) | CLI fetches one event at a time; scripts can compare by calling multiple times |
| `atlas_purchase` | `lemonade tickets buy` | Same 402 flow: purchase -> checkout URL -> receipt |
| `atlas_get_receipt` | `lemonade tickets receipt` | Same hold_id polling pattern |

> **AUDIT FIX W4 [4]:** Added missing MCP tool parity: `invite_event`, `decide_event_join_requests`, `get_event_feedback_summary`, `list_event_feedbacks`, `get_event_checkins`.

The CLI also wraps every existing Lemonade MCP tool registered in `lemonade-ai/src/app/plugins/mcp.ts:54-111`:

| MCP Tool (existing) | CLI Command |
|---------------------|-------------|
| `search_events` | `lemonade event search` (also uses Atlas Registry) |
| `get_event` | `lemonade event get` |
| `create_event` | `lemonade event create` |
| `update_event` | `lemonade event update` |
| `publish_event` | `lemonade event publish` |
| `cancel_event` | `lemonade event cancel` |
| `get_hosting_events` | `lemonade event list` |
| `invite_event` | `lemonade event invite` |
| `decide_event_join_requests` | `lemonade event approvals` |
| `get_event_feedback_summary` | `lemonade event feedback --summary` |
| `list_event_feedbacks` | `lemonade event feedback` |
| `get_event_checkins` | `lemonade event checkins` |
| `get_event_checkin_insight` | `lemonade event checkins` (check-in count included in `event analytics`) |
| `list_event_ticket_types` | `lemonade tickets types` |
| `create_event_ticket_type` | `lemonade tickets create-type` |
| `update_event_ticket_type` | `lemonade tickets update-type` |
| `buy_tickets` | `lemonade tickets buy` |
| `calculate_ticket_price` | `lemonade tickets price` |
| `get_me` | `lemonade auth whoami` |
| `list_my_spaces` | `lemonade space list` |
| `create_space` | `lemonade space create` |
| `update_space` | `lemonade space update` |
| `get_space_stats` | `lemonade space analytics` |
| `get_space_members` | `lemonade space analytics` (member counts; full member list via `get_space_members`) |
| `get_event_guests` | `lemonade event guests` |
| `get_event_guest_stats` | `lemonade event analytics` |
| `get_event_ticket_sold_insight` | `lemonade event analytics` |
| `get_event_view_insight` | `lemonade event analytics` |
| `get_event_payment_stats` | `lemonade event analytics` |
| `generate_page_from_description` | `lemonade site generate` |
| `create_page_config` | `lemonade site generate` (simplified) |
| `update_page_config_section` | (not exposed as separate CLI command -- use `site generate` for full regeneration) |
| `suggest_sections` | `lemonade site templates` |
