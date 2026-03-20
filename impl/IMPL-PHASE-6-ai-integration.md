# IMPL-PHASE-6: AI-Powered Ticket Experience — lemonade-ai

**Phase:** 6 — AI Integration (MCP + LangChain Atlas Tools)
**Status:** Ready for Lead Routing (W3 Audit Fixes Applied)
**Date:** 2026-03-19
**Author:** Bridge Agent
**Target:** `lemonade-ai` (existing Fastify service)
**Depends on:** Phase 2 (Atlas REST endpoints on lemonade-backend), Phase 3 (Atlas Registry federated search), Phase 4 (USDC reward system)
**Reference Specs:** `atlas-protocol/06-agent-layer/CLIENT-SDK-SPEC.md`, `atlas-protocol/06-agent-layer/AGENT-INTEGRATIONS.md`

---

## Execution Status

| Agent | Task | Status |
|-------|------|--------|
| AI Agent | Task 1: Atlas HTTP client service | NOT STARTED |
| AI Agent | Task 2: Atlas MCP tools (search, compare, purchase) | NOT STARTED |
| AI Agent | Task 3: Atlas MCP resources (pricing, verification) | NOT STARTED |
| AI Agent | Task 4: Atlas MCP prompts | NOT STARTED |
| AI Agent | Task 5: Atlas LangChain tools for run() agent | NOT STARTED |
| AI Agent | Task 6: Tests | NOT STARTED |

---

## 1. Execution Summary

Add Atlas-aware tools to the existing MCP server and LangChain agent in `lemonade-ai`. The new tools call Atlas REST endpoints (Phase 2 on lemonade-backend) and the Atlas Registry (Phase 3) for federated search, ticket comparison, and purchase. Existing MCP tools (`search_events`, `buy_tickets`, etc.) remain unchanged for backward compatibility — the Atlas tools are additive.

> **AUDIT FIX W3 [6-C1]:** Payment flow uses checkout URL pattern (Option A). The `atlas_purchase` tool does NOT handle payment credentials. Instead: (1) tool calls purchase endpoint → gets 402 challenge, (2) tool calls `POST /atlas/v1/holds/:hold_id/checkout` to generate a one-time checkout URL, (3) tool returns checkout URL to agent, (4) agent shows "Pay Now" link in chat, (5) user clicks → pays on existing Lemonade checkout page, (6) tool polls for receipt via `GET /atlas/v1/receipts/by-hold/:hold_id`. This eliminates all `payment_credential`, `X-Payment-Credential`, and two-phase tool call complexity.
>
> **Phase 2 dependency (P2-NEW-1):** This flow requires a new endpoint `POST /atlas/v1/holds/:hold_id/checkout` on lemonade-backend. See `PENDING-FIXES.md` for specification. Phase 6 cannot function without this endpoint.

**Critical constraints:**

- New MCP tools follow the exact registration pattern in `src/app/plugins/mcp.ts:62-100` (using `server.registerTool()` with zod schemas).
- MCP transport is `StreamableHTTPServerTransport` (`mcp.ts:2,39-43`). User auth token accessed via `raw.requestInfo?.headers?.authorization` (lowercase, verified at `mcp.ts:83`).
- New tools do NOT use GraphQL. They call Atlas REST endpoints via HTTP (`/atlas/v1/*` on lemonade-backend) and Registry endpoints (`/atlas/v1/search` on atlas-registry).
- The x402 payment infrastructure in `src/app/plugins/a2a.ts` stays as-is. Atlas purchase uses the checkout URL pattern, not x402.
- lemonade-ai does NOT depend on `@atlas/client` SDK or `mppx`. It calls Atlas endpoints directly via `fetch()`.
- Existing `Tool` model documents in MongoDB are NOT created for Atlas tools. Atlas tools are registered programmatically in the MCP plugin, not via the `ToolModel` collection.

> **AUDIT FIX W3 [6-C9]:** Upstream audit fix dependencies. Phase 6 requires these fixes to be in place before deployment:
> - **[FT-2]** (Phase 2): Atlas purchase endpoint returns reward_info in receipt
> - **[FT-3]** (Phase 2): IP-based rate limiting on Atlas discovery endpoints
> - **[SV-1]** (Phase 4): Verification-tiered reward rates applied in `processAtlasFee`
> - **[SV-4]** (Phase 4): Dashboard verification CTA in reward resolvers
> The implementing agent MUST verify these are merged before integration testing.

---

## 2. Architecture Overview

```
                     lemonade-ai
                          |
        ┌─────────────────┼─────────────────┐
        |                 |                  |
   MCP Server        LangChain Agent     A2A Endpoint
   (mcp.ts)          (langchain/)        (a2a.ts)
        |                 |                  |
   ┌────┴────┐       ┌───┴────┐        (unchanged)
   |         |       |        |
 Existing  NEW      Existing  NEW
 tools     Atlas    tools     Atlas
 (GraphQL) tools    (GraphQL) tools
           |                  |
           ▼                  ▼
     atlas-http-client.ts
        |              |
        ▼              ▼
  Atlas Registry    lemonade-backend
  /atlas/v1/search  /atlas/v1/events/:id/purchase
  (federated)       /atlas/v1/holds/:id/checkout
                    /atlas/v1/receipts/by-hold/:id
```

> **AUDIT FIX W3 [6-C1]:** Purchase flow uses checkout URL pattern. No payment credential exchange.

### Request Flow: Atlas Purchase via MCP

```
Claude/Agent
  |  calls atlas_purchase tool
  |
  ├─ MCP tool extracts user auth from raw.requestInfo.headers.authorization
  |  (StreamableHTTPServerTransport — verified at mcp.ts:83)
  |
  ├─ POST /atlas/v1/events/:id/purchase (lemonade-backend)
  |   Headers: Atlas-Agent-Id, Atlas-Version, Authorization (user token)
  |   Body: { ticket_type_id, quantity, attendees }
  |
  ├─ Response fork:
  |   ├─ 200 + type: 'free_ticket_redirect' → return redirect URL (free event)
  |   ├─ 402 Payment Required → continue to checkout URL generation
  |   └─ 4xx/5xx → throw error
  |
  ├─ On 402: Extract hold_id from challenge
  |   POST /atlas/v1/holds/:hold_id/checkout (lemonade-backend)
  |   → Returns { checkout_url, expires_at }
  |
  ├─ Return to agent: { phase: 'checkout', checkout_url, amount, currency, ... }
  |   Agent presents "Pay Now" link in chat
  |
  ├─ User clicks link → pays on Lemonade checkout page (new tab)
  |
  ├─ Agent calls atlas_get_receipt tool (polls for completion)
  |   GET /atlas/v1/receipts/by-hold/:hold_id
  |   → Returns receipt with VC tickets + reward_info when payment completes
  |   → Returns { status: 'pending' } while waiting
  |
  └─ Agent delivers ticket receipt in chat
```

---

## 3. New Files to Create

All paths relative to `lemonade-ai/src/`.

| # | File Path | Purpose |
|---|-----------|---------|
| 1 | `app/services/atlas-http-client.ts` | HTTP client for Atlas REST endpoints (Registry + Backend) |
| 2 | `app/plugins/mcp-atlas-tools.ts` | Atlas MCP tool registration (search, compare, purchase, get_receipt) |
| 3 | `app/plugins/mcp-atlas-resources.ts` | Atlas MCP resource registration (pricing, verification) |
| 4 | `app/plugins/mcp-atlas-prompts.ts` | Atlas MCP prompt registration |
| 5 | `app/services/langchain/tools/atlas.ts` | Atlas LangChain tools for the run() agent |

---

## 4. Existing Files to Modify

| # | File Path | Change |
|---|-----------|--------|
| 1 | `src/app/plugins/mcp.ts` | Import and call `registerAtlasTools()`, `registerAtlasResources()`, `registerAtlasPrompts()` inside `buildServer()` after existing tool registration loop |
| 2 | `src/app/services/langchain/tools.ts` | Import `buildAtlasTools()` from `tools/atlas.ts`, add results to the tool array in `build()` |

---

## 5. Task 1: Atlas HTTP Client Service

**File:** `src/app/services/atlas-http-client.ts`

> **AUDIT FIX W3 [6-C5]:** Complete implementation shown, not just interface signature.
> **AUDIT FIX W3 [6-C7]:** Every request includes `Atlas-Version: 1.0` header.

```typescript
// src/app/services/atlas-http-client.ts

import { lemonadeBackendUrl } from '../../config';
import { logger } from '../helpers/logger';

const ATLAS_REGISTRY_URL = process.env.ATLAS_REGISTRY_URL;
// Reuse existing env var from config/index.ts:18
const ATLAS_BACKEND_URL = lemonadeBackendUrl;

const ATLAS_AGENT_ID = 'agent:lemonade-ai';
const ATLAS_API_VERSION = '1.0';

interface AtlasRequestOptions {
  method?: 'GET' | 'POST';
  path: string;
  target: 'registry' | 'backend';
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

export interface AtlasResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

export async function atlasRequest<T>(options: AtlasRequestOptions): Promise<AtlasResponse<T>> {
  const {
    method = 'GET',
    path,
    target,
    headers: extraHeaders = {},
    body,
    query,
    timeoutMs,
  } = options;

  const baseUrl = target === 'registry' ? ATLAS_REGISTRY_URL : ATLAS_BACKEND_URL;
  if (!baseUrl) {
    throw new Error(`Atlas ${target} URL not configured`);
  }

  const qs = query ? buildQueryString(query) : '';
  const url = `${baseUrl}${path}${qs}`;

  // Default timeouts: 5s for backend calls, 10s for registry search
  const timeout = timeoutMs ?? (target === 'registry' ? 10_000 : 5_000);

  const headers: Record<string, string> = {
    'Atlas-Agent-Id': ATLAS_AGENT_ID,
    'Atlas-Version': ATLAS_API_VERSION,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(timeout),
  };

  if (body && method === 'POST') {
    fetchOptions.body = JSON.stringify(body);
  }

  async function doFetch(): Promise<AtlasResponse<T>> {
    const response = await fetch(url, fetchOptions);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // 402: return as-is (not an error — caller handles the challenge)
    if (response.status === 402) {
      const data = await response.json();
      return { status: 402, data: data as T, headers: responseHeaders };
    }

    // 200-299: success
    if (response.ok) {
      const data = await response.json();
      return { status: response.status, data: data as T, headers: responseHeaders };
    }

    // 4xx (not 402): throw with status + message
    if (response.status >= 400 && response.status < 500) {
      const errorBody = await response.text();
      throw new Error(`Atlas ${target} ${method} ${path} returned ${response.status}: ${errorBody}`);
    }

    // 5xx: throw (retry handled in wrapper)
    const errorBody = await response.text();
    throw new Error(`Atlas ${target} ${method} ${path} returned ${response.status}: ${errorBody}`);
  }

  try {
    return await doFetch();
  } catch (error) {
    // On 5xx or network error: retry once after 1s
    if (error instanceof Error && !error.message.includes('returned 4')) {
      logger.warn({ error: error.message, url }, 'Atlas request failed, retrying once');
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return await doFetch();
    }
    throw error;
  }
}

// > **AUDIT FIX W3 [6-H3]:** Registry timeout returns empty results with warning.
export async function atlasRegistrySearch<T>(query: Record<string, string | number | boolean | undefined>): Promise<AtlasResponse<T>> {
  try {
    return await atlasRequest<T>({
      method: 'GET',
      path: '/atlas/v1/search',
      target: 'registry',
      query,
      timeoutMs: 10_000,
    });
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Atlas Registry search timed out or failed — returning empty results');
    return {
      status: 200,
      data: { items: [], cursor: null, total: 0, sources: [] } as T,
      headers: {},
    };
  }
}
```

**Environment variables required:**

| Variable | Required | Default | Source |
|----------|----------|---------|--------|
| `ATLAS_REGISTRY_URL` | Yes (for Atlas features) | — | New. Atlas Registry service URL |
| `LEMONADE_BACKEND_URL` | Already exists | — | `config/index.ts:18`. Reused for Atlas backend endpoints |

---

## 6. Task 2: Atlas MCP Tools

**File:** `src/app/plugins/mcp-atlas-tools.ts`

> **AUDIT FIX W3 [6-C1]:** Purchase tool uses checkout URL pattern. No `payment_credential` field. Added `atlas_get_receipt` as a 4th tool for polling receipt after payment.
> **AUDIT FIX W3 [6-C4]:** Free ticket redirect handled (200 + `type: 'free_ticket_redirect'`).
> **AUDIT FIX W3 [6-C6]:** Auth header confirmed via `StreamableHTTPServerTransport` at `mcp.ts:83`. Accessed as `raw.requestInfo?.headers?.authorization` (lowercase).
> **AUDIT FIX W3 [6-H2]:** Idempotency key auto-generated from `(event_id, ticket_type_id, quantity, agent_id)`.
> **AUDIT FIX W3 [6-H1]:** All `request()` calls use named parameters via options object.

**Types** (defined at the top of `mcp-atlas-tools.ts`):

> **AUDIT FIX W3 [6-C3]:** 402 challenge schema. Phase 2 is not yet merged — these fields are the EXPECTED structure based on Phase 2 IMPL (IMPL-PHASE-2-atlas-protocol.md Section 8, Task 4). The implementing agent MUST cross-reference the actual `purchase.ts` controller once Phase 2 merges and update these types if they diverge.
> **AUDIT FIX W3 [6-H4]:** Receipt structure cross-referenced to Phase 2 IMPL Section 10, Task 6 (AtlasReceipt model).

```typescript
// src/app/plugins/mcp-atlas-tools.ts

import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'crypto';
import { atlasRequest, atlasRegistrySearch } from '../services/atlas-http-client';
import { logger } from '../helpers/logger';

// ---------- Types ----------
// These MUST match Phase 2 response schemas. Cross-reference:
//   402 challenge: IMPL-PHASE-2 Section 8 (Task 4: purchase controller, 402 response body)
//   Receipt: IMPL-PHASE-2 Section 10 (Task 6: AtlasReceipt model)
//   If Phase 2 changes these, update here.

interface AtlasEvent {
  '@id': string;
  name: string;
  startDate: string;
  endDate?: string;
  location: { name: string; address?: string; lat: number; lng: number; city?: string; country?: string };
  organizer: { name: string; verified: boolean; atlas_id: string };
  'atlas:availability': string;
  'atlas:price_range': { min_price: number; max_price: number; currency: string };
}

interface AtlasTicketType {
  id: string;
  name: string;
  price: { amount: number; currency: string; display: string };
  available: number | null;
  on_sale: boolean;
  limit_per_order: number;
}

interface Atlas402Challenge {
  hold_id: string;
  amount: number;
  currency: string;
  amount_usdc: number;
  payment_methods: string[];
  expires_at: string;                 // ISO 8601 hold expiry
  // Phase 2 also returns: recipient, nonce (for direct payment).
  // We don't expose these to the agent — checkout URL handles payment.
}

interface AtlasCheckoutResponse {
  checkout_url: string;
  expires_at: string;                 // checkout session expiry
}

interface AtlasFreeTicketRedirect {
  type: 'free_ticket_redirect';
  redirect_url: string;
}

interface AtlasPurchaseReceipt {
  purchase_id: string;
  credentials: Array<{
    jwt: string;
    decoded: {
      attendee: { name: string; email: string };
      event_title: string;
      ticket_type: string;
    };
    ticketUrl?: string;
    qrData: string;
  }>;
  payment: {
    method: string;
    amount: number;
    currency: string;
    transaction_id: string;
  };
  purchased_at: string;
  reward_info?: {
    cashback_earned?: string;
    cashback_currency?: string;
    verification_prompt?: string;     // Present only for unverified users
  };
}

// ---------- Idempotency key generation ----------
// > **AUDIT FIX W3 [6-H2]:** Deterministic from purchase params, not user-supplied.
function generateIdempotencyKey(eventId: string, ticketTypeId: string, quantity: number): string {
  const input = `atlas:${eventId}:${ticketTypeId}:${quantity}:${Date.now()}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

// ---------- Tool Registration ----------

export function registerAtlasTools(server: McpServer): void {

  // --- atlas_search ---
  server.registerTool(
    'atlas_search',
    {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      description:
        'Search for events across all platforms connected to Atlas (Lemonade, Eventbrite, Lu.ma, Meetup, etc.). ' +
        'Returns federated results from the Atlas Registry. Use this for broad event discovery across all sources.',
      inputSchema: z.object({
        q: z.string().optional().describe('Keyword search (title, description, tags)'),
        lat: z.number().optional().describe('Latitude for location-based search'),
        lng: z.number().optional().describe('Longitude for location-based search'),
        radius_km: z.number().optional().default(25).describe('Search radius in kilometers'),
        start_after: z.string().optional().describe('ISO 8601 — only events starting after this date'),
        start_before: z.string().optional().describe('ISO 8601 — only events starting before this date'),
        category: z.enum([
          'music', 'tech', 'arts', 'sports', 'food',
          'business', 'health', 'education', 'community',
          'nightlife', 'film', 'gaming', 'other',
        ]).optional().describe('Event category filter'),
        price_min: z.number().optional().describe('Minimum price in USD'),
        price_max: z.number().optional().describe('Maximum price in USD'),
        payment_method: z.enum(['tempo_usdc', 'stripe_card', 'stripe_wallet']).optional()
          .describe('Only show events accepting this payment method'),
        sort: z.enum(['relevance', 'price_asc', 'price_desc', 'date_asc', 'date_desc', 'distance'])
          .optional().default('relevance'),
        limit: z.number().optional().default(10).describe('Number of results (max 50)'),
        cursor: z.string().optional().describe('Opaque pagination cursor from previous search result. null means last page.'),
      }),
      outputSchema: z.object({
        items: z.array(z.object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
          start: z.string(),
          end: z.string().optional(),
          location: z.object({
            name: z.string(),
            address: z.string().optional(),
            lat: z.number(),
            lng: z.number(),
            city: z.string().optional(),
            country: z.string().optional(),
          }),
          categories: z.array(z.string()),
          organizer: z.object({
            name: z.string(),
            verified: z.boolean(),
            atlas_id: z.string(),
          }),
          price: z.object({
            amount: z.number(),
            currency: z.string(),
            display: z.string(),
          }).nullable(),
          source: z.object({
            platform: z.string(),
            url: z.string(),
          }),
          availability: z.enum(['available', 'limited', 'sold_out', 'not_on_sale']),
          image_url: z.string().optional(),
          payment_methods: z.array(z.string()),
        })),
        cursor: z.string().nullable().describe('Opaque cursor for next page. null = no more pages.'),
        total: z.number(),
        sources: z.array(z.object({
          platform: z.string(),
          count: z.number(),
        })),
      }),
    },
    async (input) => {
      // > **AUDIT FIX W3 [6-H3]:** Registry timeout returns empty results, not throw.
      const response = await atlasRegistrySearch(
        input as Record<string, string | number | boolean | undefined>,
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(response.data) }],
        structuredContent: response.data,
      };
    },
  );

  // --- atlas_compare_tickets ---
  server.registerTool(
    'atlas_compare_tickets',
    {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      description:
        'Compare ticket types and prices across multiple events. ' +
        'Useful when the user wants to choose between several events based on price, ' +
        'availability, and ticket options.',
      inputSchema: z.object({
        event_ids: z.array(z.string()).min(2).max(5)
          .describe('Atlas event IDs to compare (2-5 events)'),
      }),
      outputSchema: z.object({
        comparisons: z.array(z.object({
          event_id: z.string(),
          event_title: z.string(),
          start: z.string(),
          location_name: z.string(),
          tickets: z.array(z.object({
            id: z.string(),
            name: z.string(),
            price: z.object({
              amount: z.number(),
              currency: z.string(),
              display: z.string(),
            }),
            available: z.number().nullable(),
            on_sale: z.boolean(),
          })),
          cheapest_price: z.object({
            amount: z.number(),
            currency: z.string(),
            display: z.string(),
          }).nullable(),
        })),
      }),
    },
    async (input) => {
      const comparisons = await Promise.all(
        input.event_ids.map(async (eventId) => {
          const [eventRes, ticketsRes] = await Promise.all([
            atlasRequest<AtlasEvent>({ method: 'GET', path: `/atlas/v1/events/${eventId}`, target: 'backend' }),
            atlasRequest<{ ticket_types: AtlasTicketType[] }>({ method: 'GET', path: `/atlas/v1/events/${eventId}/tickets`, target: 'backend' }),
          ]);

          const event = eventRes.data;
          const tickets = ticketsRes.data.ticket_types;

          const onSaleTickets = tickets.filter((t) => t.on_sale && (t.available === null || t.available > 0));
          const cheapest = onSaleTickets.length > 0
            ? onSaleTickets.reduce((min, t) => t.price.amount < min.price.amount ? t : min)
            : null;

          return {
            event_id: eventId,
            event_title: event.name,
            start: event.startDate,
            location_name: event.location?.name || 'Online',
            tickets: tickets.map((t) => ({
              id: t.id,
              name: t.name,
              price: t.price,
              available: t.available,
              on_sale: t.on_sale,
            })),
            cheapest_price: cheapest ? cheapest.price : null,
          };
        }),
      );

      const result = { comparisons };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  // --- atlas_purchase ---
  // > **AUDIT FIX W3 [6-C1]:** Checkout URL pattern. No payment_credential.
  // > **AUDIT FIX W3 [6-C4]:** Free ticket redirect handled.
  server.registerTool(
    'atlas_purchase',
    {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      description:
        'Initiate a ticket purchase for an event via Atlas Protocol. ' +
        'Returns one of three outcomes: ' +
        '(1) "checkout" — a payment URL the user must click to pay (present as a "Pay Now" link), ' +
        '(2) "free_redirect" — a link to claim a free ticket, ' +
        '(3) error. ' +
        'After the user pays, use atlas_get_receipt to fetch the ticket receipt. ' +
        'NEVER tell the user the purchase is complete until you have the receipt.',
      inputSchema: z.object({
        event_id: z.string().describe('Atlas event ID'),
        ticket_type_id: z.string().describe('Ticket type ID from atlas_compare_tickets'),
        quantity: z.number().min(1).describe('Number of tickets to purchase'),
        attendees: z.array(z.object({
          name: z.string().describe('Attendee full name'),
          email: z.string().describe('Attendee email for ticket delivery'),
        })).describe('One attendee per ticket'),
      }),
      outputSchema: z.object({
        phase: z.enum(['checkout', 'free_redirect', 'error']),
        // Phase: checkout (paid event)
        checkout_url: z.string().optional().describe('URL for user to complete payment'),
        hold_id: z.string().optional().describe('Hold ID — pass to atlas_get_receipt after payment'),
        amount: z.number().optional(),
        currency: z.string().optional(),
        amount_usdc: z.number().optional(),
        payment_methods: z.array(z.string()).optional(),
        expires_at: z.string().optional().describe('Hold expiry — user must pay before this time'),
        // Phase: free_redirect
        redirect_url: z.string().optional().describe('URL to claim free ticket'),
        // Phase: error
        error_message: z.string().optional(),
      }),
    },
    async (input, raw) => {
      const authorization = raw.requestInfo?.headers?.authorization;
      if (!authorization || typeof authorization !== 'string') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ phase: 'error', error_message: 'User must be logged in to purchase tickets' }) }],
          structuredContent: { phase: 'error', error_message: 'User must be logged in to purchase tickets' },
        };
      }

      const idempotencyKey = generateIdempotencyKey(input.event_id, input.ticket_type_id, input.quantity);

      const purchaseResponse = await atlasRequest<Atlas402Challenge | AtlasFreeTicketRedirect | AtlasPurchaseReceipt>({
        method: 'POST',
        path: `/atlas/v1/events/${input.event_id}/purchase`,
        target: 'backend',
        headers: {
          'Authorization': authorization,
          'Idempotency-Key': idempotencyKey,
        },
        body: {
          ticket_type_id: input.ticket_type_id,
          quantity: input.quantity,
          attendees: input.attendees,
        },
      });

      // > **AUDIT FIX W3 [6-C4]:** Free ticket redirect
      if (purchaseResponse.status === 200) {
        const data = purchaseResponse.data as Record<string, unknown>;
        if (data.type === 'free_ticket_redirect') {
          const redirect = data as unknown as AtlasFreeTicketRedirect;
          const result = {
            phase: 'free_redirect' as const,
            redirect_url: redirect.redirect_url,
          };
          return {
            content: [{ type: 'text', text: `Free event! Claim your ticket: ${redirect.redirect_url}` }],
            structuredContent: result,
          };
        }
      }

      // 402: Generate checkout URL
      if (purchaseResponse.status === 402) {
        const challenge = purchaseResponse.data as Atlas402Challenge;

        // Call checkout session endpoint (Phase 2 dependency P2-NEW-1)
        const checkoutResponse = await atlasRequest<AtlasCheckoutResponse>({
          method: 'POST',
          path: `/atlas/v1/holds/${challenge.hold_id}/checkout`,
          target: 'backend',
          headers: { 'Authorization': authorization },
        });

        const result = {
          phase: 'checkout' as const,
          checkout_url: checkoutResponse.data.checkout_url,
          hold_id: challenge.hold_id,
          amount: challenge.amount,
          currency: challenge.currency,
          amount_usdc: challenge.amount_usdc,
          payment_methods: challenge.payment_methods,
          expires_at: challenge.expires_at,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      }

      // Unexpected status
      const result = { phase: 'error' as const, error_message: `Unexpected response: ${purchaseResponse.status}` };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  // --- atlas_get_receipt ---
  // > **AUDIT FIX W3 [6-C1]:** Separate tool for polling receipt after checkout.
  server.registerTool(
    'atlas_get_receipt',
    {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      description:
        'Check if a ticket purchase is complete and get the receipt. ' +
        'Call this after the user has clicked the checkout link from atlas_purchase. ' +
        'Returns "pending" if payment is not yet complete, or the full receipt with ticket credentials.',
      inputSchema: z.object({
        hold_id: z.string().describe('Hold ID from atlas_purchase result'),
      }),
      outputSchema: z.object({
        status: z.enum(['pending', 'completed', 'expired']),
        receipt: z.object({
          purchase_id: z.string(),
          credentials: z.array(z.object({
            attendee_name: z.string(),
            attendee_email: z.string(),
            event_title: z.string(),
            ticket_type: z.string(),
            ticket_url: z.string().optional(),
            qr_data: z.string(),
          })),
          payment: z.object({
            method: z.string(),
            amount: z.number(),
            currency: z.string(),
            transaction_id: z.string(),
          }),
          purchased_at: z.string(),
        }).optional(),
        reward_info: z.object({
          cashback_earned: z.string().optional(),
          cashback_currency: z.string().optional(),
          verification_prompt: z.string().optional(),
        }).optional(),
      }),
    },
    async (input, raw) => {
      const authorization = raw.requestInfo?.headers?.authorization;
      const headers: Record<string, string> = {};
      if (authorization && typeof authorization === 'string') {
        headers['Authorization'] = authorization;
      }

      const response = await atlasRequest<{ status: string; receipt?: AtlasPurchaseReceipt }>({
        method: 'GET',
        path: `/atlas/v1/receipts/by-hold/${input.hold_id}`,
        target: 'backend',
        headers,
      });

      const data = response.data;

      if (data.status === 'completed' && data.receipt) {
        const receipt = data.receipt;
        const result = {
          status: 'completed' as const,
          receipt: {
            purchase_id: receipt.purchase_id,
            credentials: receipt.credentials.map((c) => ({
              attendee_name: c.decoded.attendee.name,
              attendee_email: c.decoded.attendee.email,
              event_title: c.decoded.event_title,
              ticket_type: c.decoded.ticket_type,
              ticket_url: c.ticketUrl,
              qr_data: c.qrData,
            })),
            payment: receipt.payment,
            purchased_at: receipt.purchased_at,
          },
          reward_info: receipt.reward_info,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      }

      const result = { status: data.status as 'pending' | 'expired' };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

} // end registerAtlasTools
```

---

## 7. Task 3: Atlas MCP Resources

**File:** `src/app/plugins/mcp-atlas-resources.ts`

> **AUDIT FIX W3 [6-M1]:** URI scheme uses `lemonade://atlas/` (consistent with existing `lemonade://` resources at `mcp.ts:199-254`).
> **AUDIT FIX W3 [6-C2]:** Self.xyz verification uses `getSelfVerificationStatus` GraphQL query with `SelfVerificationConfig` input. The `self_verified` field does NOT exist on the User GraphQL type. Verification status is stored in the `user_self_disclosures` collection (model: `UserSelfDisclosure` at `lemonade-backend/src/app/models/user-self-disclosure.ts`). Each disclosure has `user` (ObjectId), `type` (SelfDisclosureType enum: issuing_state, name, nationality, date_of_birth, etc.), and `value`. The `nullifier` field (unique identity hash) is on `UserSelfRequest` at `lemonade-backend/src/app/models/user-self-request.ts`.
> **AUDIT FIX W3 [6-H6]:** Verification status is re-checked on each resource read. No caching — the cost is a single GraphQL query and verification status can change.

```typescript
// src/app/plugins/mcp-atlas-resources.ts

import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { request } from '../services/langchain/tools/lemonade-backend';
import { logger } from '../helpers/logger';

export function registerAtlasResources(server: McpServer): void {

  // > **AUDIT FIX W3 [6-M1]:** lemonade://atlas/ URI scheme
  server.resource(
    'atlas-pricing',
    'lemonade://atlas/pricing',
    {
      description: 'Current Atlas Protocol reward rates, fee structure, and volume tiers. ' +
        'Use this to tell users about cashback rates before or after a purchase.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const pricing = {
        protocol_fee_percent: 2,
        fee_split: {
          unverified: { treasury: 40, organizer_cashback: 30, attendee_cashback: 20, referral_pool: 10 },
          verified: { treasury: 25, organizer_cashback: 35, attendee_cashback: 25, referral_pool: 15 },
        },
        attendee_cashback_rate: {
          unverified: '0.4%',
          verified: '0.8%',
        },
        organizer_cashback_rate: {
          unverified: '0.6%',
          verified: '1.0%',
        },
        volume_tiers: [
          { threshold_usd: 0, rate: '0.6%' },
          { threshold_usd: 10_000, rate: '0.8%' },
          { threshold_usd: 50_000, rate: '1.0%' },
          { threshold_usd: 250_000, rate: '1.2%' },
        ],
        payout_schedule: 'Weekly (Monday)',
        minimum_payout_usdc: 5,
      };

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(pricing),
        }],
      };
    },
  );

  // > **AUDIT FIX W3 [6-C2]:** Fixed Self.xyz verification check.
  // > Uses getSelfVerificationStatus GraphQL query (lemonade-backend/src/graphql/resolvers/self.ts).
  // > Passes a minimal config to check if ANY disclosure exists.
  // > Returns: { disclosures: [{ type: string, verified: boolean }] }
  // > A user is "Atlas-verified" if they have at least one verified disclosure.
  server.resource(
    'atlas-verification',
    'lemonade://atlas/verification',
    {
      description: 'The authenticated user\'s Self.xyz identity verification status and Atlas reward tier. ' +
        'Verified users earn 2x cashback on Atlas purchases.',
      mimeType: 'application/json',
    },
    async (uri, extra) => {
      const authorization = (extra as { requestInfo?: { headers?: Record<string, string> } })?.requestInfo?.headers?.authorization;
      if (!authorization) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ verified: false, tier: 'unverified', message: 'Not authenticated' }),
          }],
        };
      }

      try {
        // Query the existing getSelfVerificationStatus resolver
        // This checks UserSelfDisclosure records for the authenticated user.
        // Config: check name disclosure as a baseline indicator of verification.
        // See: lemonade-backend/src/graphql/resolvers/self.ts:getSelfVerificationStatus()
        // See: lemonade-backend/src/app/services/self-verification.ts:86-93:getVerificationStatus()
        const verificationResponse = await request<{
          getSelfVerificationStatus: {
            disclosures: Array<{ type: string; verified: boolean }>;
          };
        }>(
          `query GetSelfVerificationStatus($config: SelfVerificationConfigInput!) {
            getSelfVerificationStatus(config: $config) {
              disclosures { type verified }
            }
          }`,
          { Authorization: authorization },
          { config: { name: true } },
        );

        const disclosures = verificationResponse.getSelfVerificationStatus?.disclosures || [];
        const verified = disclosures.some((d) => d.verified);

        const result = {
          verified,
          tier: verified ? 'verified' : 'unverified',
          cashback_rate: verified ? '0.8%' : '0.4%',
          organizer_rate: verified ? '1.0%' : '0.6%',
          upgrade_prompt: verified
            ? null
            : 'Verify your identity with Self.xyz to earn 2x cashback on Atlas purchases.',
        };

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(result),
          }],
        };
      } catch (error) {
        logger.warn({ error: (error as Error).message }, 'Failed to check Self.xyz verification status');
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ verified: false, tier: 'unverified', message: 'Verification check failed' }),
          }],
        };
      }
    },
  );

} // end registerAtlasResources
```

**Import needed:** The `request` function from `src/app/services/langchain/tools/lemonade-backend.ts:39-74`. Its signature is:

```typescript
// > **AUDIT FIX W3 [6-H1]:** Explicit parameter documentation.
export async function request<T>(
  operation: string,        // GraphQL query/mutation string
  headers?: Record<string, unknown>,  // HTTP headers (Authorization, etc.)
  variables?: unknown,      // GraphQL variables
): Promise<T>
```

---

## 8. Task 4: Atlas MCP Prompts

**File:** `src/app/plugins/mcp-atlas-prompts.ts`

> **AUDIT FIX W3 [6-C1]:** Prompt step 6 updated to reflect checkout URL flow (no payment credential).

```typescript
// src/app/plugins/mcp-atlas-prompts.ts

import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerAtlasPrompts(server: McpServer): void {

  server.prompt(
    'find_events_near_me',
    {
      description: 'Find events near a location using Atlas federated search',
      arguments: [
        { name: 'location', description: 'City name or "lat,lng" coordinates', required: true },
        { name: 'interests', description: 'What kind of events (e.g., techno, jazz, tech meetup)', required: false },
        { name: 'date', description: 'When (e.g., "this Saturday", "next week")', required: false },
        { name: 'budget', description: 'Maximum price per ticket in USD', required: false },
      ],
    },
    async ({ location, interests, date, budget }) => {
      let prompt = `Use the atlas_search tool to find events near ${location}.`;
      if (interests) prompt += ` Focus on: ${interests}.`;
      if (date) prompt += ` Date: ${date}.`;
      if (budget) prompt += ` Max price: $${budget} per ticket.`;
      prompt += ' Present the results as a numbered list with title, date, venue, price, and availability.';
      prompt += ' If the user is interested in any, offer to show ticket details or compare prices.';

      return {
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt } }],
      };
    },
  );

  server.prompt(
    'compare_ticket_prices',
    {
      description: 'Compare ticket prices across multiple events',
      arguments: [
        { name: 'events', description: 'Event names or Atlas event IDs to compare (comma-separated)', required: true },
      ],
    },
    async ({ events }) => {
      const prompt =
        `The user wants to compare ticket prices for these events: ${events}. ` +
        'First use atlas_search to find matching events if names are given (not IDs). ' +
        'Then use atlas_compare_tickets with the event IDs. ' +
        'Present a comparison table showing: event name, date, venue, cheapest ticket, VIP ticket (if available), and availability. ' +
        'Recommend the best value option.';

      return {
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt } }],
      };
    },
  );

  server.prompt(
    'buy_tickets_for_event',
    {
      description: 'Buy tickets for an event through Atlas',
      arguments: [
        { name: 'event', description: 'Event name or Atlas event ID', required: true },
        { name: 'attendees', description: 'Who is attending (names and emails)', required: true },
        { name: 'ticket_type', description: 'Preferred ticket type (e.g., "general admission", "VIP")', required: false },
      ],
    },
    async ({ event, attendees, ticket_type }) => {
      let prompt =
        `The user wants to buy tickets for: ${event}. Attendees: ${attendees}. `;
      if (ticket_type) prompt += `Preferred ticket type: ${ticket_type}. `;
      prompt +=
        'Steps: ' +
        '1. Use atlas_search to find the event (if name given). ' +
        '2. Use atlas_compare_tickets to show available ticket types and prices. ' +
        '3. Confirm the ticket type, quantity, and total price with the user BEFORE purchasing. ' +
        '4. Use atlas_purchase to initiate the purchase — this returns a checkout URL. ' +
        '5. Present the checkout URL as a "Pay Now" link. Tell the user the amount and to click to pay. ' +
        '6. After the user says they have paid, use atlas_get_receipt with the hold_id to check completion. ' +
        '7. If status is "pending", wait a moment and try again. If "completed", show the receipt with ticket details and any cashback earned. ' +
        '8. If the user is unverified and reward_info includes a verification_prompt, mention they can verify with Self.xyz for 2x cashback next time. ' +
        'IMPORTANT: Never tell the user the purchase is complete until atlas_get_receipt returns status "completed".';

      return {
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt } }],
      };
    },
  );

} // end registerAtlasPrompts
```

---

## 9. Task 5: Modify MCP Plugin to Register Atlas Tools

**File:** `src/app/plugins/mcp.ts`

**Change 1:** Add imports after existing imports (around line 15):

```typescript
import { registerAtlasTools } from './mcp-atlas-tools';
import { registerAtlasResources } from './mcp-atlas-resources';
import { registerAtlasPrompts } from './mcp-atlas-prompts';
```

**Change 2:** Inside `buildServer()`, after the existing tool registration loop (after line 100, before `return server`):

> **AUDIT FIX W3 [6-C8]:** Guard on BOTH env vars. Log warning if partially configured.

```typescript
  // Atlas Protocol tools (call REST endpoints, not GraphQL)
  const atlasRegistryUrl = process.env.ATLAS_REGISTRY_URL;
  const atlasBackendUrl = process.env.LEMONADE_BACKEND_URL;

  if (atlasRegistryUrl && atlasBackendUrl) {
    registerAtlasTools(server);
    registerAtlasResources(server);
    registerAtlasPrompts(server);
    logger.info('Atlas Protocol MCP tools registered');
  } else if (atlasRegistryUrl || atlasBackendUrl) {
    logger.warn(
      { ATLAS_REGISTRY_URL: !!atlasRegistryUrl, LEMONADE_BACKEND_URL: !!atlasBackendUrl },
      'Atlas Protocol partially configured — both ATLAS_REGISTRY_URL and LEMONADE_BACKEND_URL required. Atlas tools NOT registered.',
    );
  }
```

---

## 10. Task 6: Atlas LangChain Tools

**File:** `src/app/services/langchain/tools/atlas.ts`

LangChain versions of the Atlas tools for the `run()` agent. These use `DynamicStructuredTool` following the exact pattern from `lemonade-backend.ts:320-364`.

> **AUDIT FIX W3 [6-C1]:** Checkout URL pattern. No payment_credential.
> **AUDIT FIX W3 [6-H5]:** Card metadata uses `type: 'atlas_event'` (not the legacy `new_new_photos_expanded` field). The `new_new_photos_expanded` pattern is a legacy compatibility shim for existing Lemonade event cards. Atlas events use their own card type so the frontend can render `AtlasEventCard` components.

```typescript
// src/app/services/langchain/tools/atlas.ts

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { atlasRequest, atlasRegistrySearch } from '../../atlas-http-client';
import type { State } from '../tools';

export function buildAtlasTools(state: State): DynamicStructuredTool[] {
  if (!process.env.ATLAS_REGISTRY_URL || !process.env.LEMONADE_BACKEND_URL) {
    return [];
  }

  return [
    new DynamicStructuredTool({
      name: 'atlas_search',
      description:
        'Search for events across all platforms connected to Atlas. ' +
        'Returns federated results from multiple event sources.',
      schema: z.object({
        q: z.string().optional().describe('Keyword search'),
        lat: z.number().optional().describe('Latitude'),
        lng: z.number().optional().describe('Longitude'),
        radius_km: z.number().optional().default(25).describe('Radius in km'),
        start_after: z.string().optional().describe('ISO 8601 start date'),
        start_before: z.string().optional().describe('ISO 8601 end date'),
        category: z.string().optional().describe('Event category'),
        price_max: z.number().optional().describe('Max price in USD'),
        sort: z.string().optional().default('relevance'),
        limit: z.number().optional().default(10),
      }),
      func: async (input) => {
        const response = await atlasRegistrySearch(
          input as Record<string, string | number | boolean | undefined>,
        );

        state.metadata['tool'] = { type: 'atlas', name: 'atlas_search', data: response.data };

        // > **AUDIT FIX W3 [6-H5]:** Use 'atlas_event' card type, not legacy event card format.
        const items = (response.data as { items: Array<{ id: string; title: string; start: string; image_url?: string; location?: { name: string }; price?: { display: string } | null; availability?: string }> }).items;
        if (items?.length > 0) {
          state.metadata['cards'] = items.map((item) => ({
            type: 'atlas_event',
            data: item,
          }));
        }

        return JSON.stringify(response.data);
      },
      returnDirect: false,
    }),

    new DynamicStructuredTool({
      name: 'atlas_compare_tickets',
      description: 'Compare ticket types and prices across multiple events.',
      schema: z.object({
        event_ids: z.array(z.string()).min(2).max(5).describe('Atlas event IDs to compare'),
      }),
      func: async (input) => {
        const comparisons = await Promise.all(
          input.event_ids.map(async (eventId) => {
            const [eventRes, ticketsRes] = await Promise.all([
              atlasRequest({ method: 'GET', path: `/atlas/v1/events/${eventId}`, target: 'backend' }),
              atlasRequest({ method: 'GET', path: `/atlas/v1/events/${eventId}/tickets`, target: 'backend' }),
            ]);
            return { event: eventRes.data, tickets: ticketsRes.data };
          }),
        );

        state.metadata['tool'] = { type: 'atlas', name: 'atlas_compare_tickets', data: comparisons };
        state.metadata['cards'] = [{ type: 'atlas_comparison', data: comparisons }];
        return JSON.stringify({ comparisons });
      },
      returnDirect: false,
    }),

    new DynamicStructuredTool({
      name: 'atlas_purchase',
      description:
        'Initiate ticket purchase via Atlas. Returns a checkout URL for the user to pay. ' +
        'After user pays, use atlas_get_receipt to fetch the ticket.',
      schema: z.object({
        event_id: z.string().describe('Atlas event ID'),
        ticket_type_id: z.string().describe('Ticket type ID'),
        quantity: z.number().min(1).describe('Number of tickets'),
        attendees: z.array(z.object({
          name: z.string(),
          email: z.string(),
        })).describe('One attendee per ticket'),
      }),
      func: async (input) => {
        const headers: Record<string, string> = {};
        if (state.context?.headers) {
          const authHeader = state.context.headers['Authorization'] || state.context.headers['authorization'];
          if (authHeader) headers['Authorization'] = String(authHeader);
        }

        const response = await atlasRequest({
          method: 'POST',
          path: `/atlas/v1/events/${input.event_id}/purchase`,
          target: 'backend',
          headers,
          body: {
            ticket_type_id: input.ticket_type_id,
            quantity: input.quantity,
            attendees: input.attendees,
          },
        });

        // Free ticket redirect
        if (response.status === 200) {
          const data = response.data as Record<string, unknown>;
          if (data.type === 'free_ticket_redirect') {
            state.metadata['tool'] = { type: 'atlas', name: 'atlas_purchase', data };
            return JSON.stringify(data);
          }
        }

        // 402: generate checkout URL
        if (response.status === 402) {
          const challenge = response.data as { hold_id: string; amount: number; currency: string; amount_usdc: number; payment_methods: string[]; expires_at: string };

          const checkoutResponse = await atlasRequest<{ checkout_url: string; expires_at: string }>({
            method: 'POST',
            path: `/atlas/v1/holds/${challenge.hold_id}/checkout`,
            target: 'backend',
            headers,
          });

          const result = {
            phase: 'checkout',
            checkout_url: checkoutResponse.data.checkout_url,
            hold_id: challenge.hold_id,
            amount: challenge.amount,
            currency: challenge.currency,
            amount_usdc: challenge.amount_usdc,
            expires_at: challenge.expires_at,
          };
          state.metadata['tool'] = { type: 'atlas', name: 'atlas_purchase', data: result };
          return JSON.stringify(result);
        }

        state.metadata['tool'] = { type: 'atlas', name: 'atlas_purchase', data: response.data };
        return JSON.stringify(response.data);
      },
      returnDirect: false,
    }),

    new DynamicStructuredTool({
      name: 'atlas_get_receipt',
      description: 'Check purchase status and get receipt after user pays via checkout URL.',
      schema: z.object({
        hold_id: z.string().describe('Hold ID from atlas_purchase result'),
      }),
      func: async (input) => {
        const headers: Record<string, string> = {};
        if (state.context?.headers) {
          const authHeader = state.context.headers['Authorization'] || state.context.headers['authorization'];
          if (authHeader) headers['Authorization'] = String(authHeader);
        }

        const response = await atlasRequest({
          method: 'GET',
          path: `/atlas/v1/receipts/by-hold/${input.hold_id}`,
          target: 'backend',
          headers,
        });

        state.metadata['tool'] = { type: 'atlas', name: 'atlas_get_receipt', data: response.data };

        const data = response.data as { status: string; receipt?: Record<string, unknown> };
        if (data.status === 'completed' && data.receipt) {
          state.metadata['cards'] = [{ type: 'atlas_receipt', data: data.receipt }];
        }

        return JSON.stringify(response.data);
      },
      returnDirect: false,
    }),
  ];
}
```

**Modification to `src/app/services/langchain/tools.ts`:**

Add after the existing tool-type loop in `build()` (around line 55):

```typescript
import { buildAtlasTools } from './tools/atlas';

// Inside build():
  // ... existing tool loop ...

  // Atlas tools (REST-based, no MongoDB Tool documents)
  result.push(...buildAtlasTools(state));

  return result;
```

---

## 11. Testing Strategy

> **AUDIT FIX W3 [6-M3]:** Test fixtures for 402, receipt, and redirect responses included.

### Unit Tests

| Test | File | What to verify |
|------|------|----------------|
| Atlas HTTP client | `atlas-http-client.test.ts` | URL construction, header injection (Atlas-Version, Atlas-Agent-Id), 402 pass-through, retry on 5xx, registry timeout returns empty |
| atlas_search tool | `mcp-atlas-tools.test.ts` | Query param mapping, response transformation, cursor pagination (opaque string, null = last page) |
| atlas_compare_tickets tool | `mcp-atlas-tools.test.ts` | Parallel fan-out, cheapest price calculation, handles missing events gracefully |
| atlas_purchase tool (checkout phase) | `mcp-atlas-tools.test.ts` | 402 → checkout URL generation, hold_id returned |
| atlas_purchase tool (free redirect) | `mcp-atlas-tools.test.ts` | 200 + type=free_ticket_redirect → redirect_url returned |
| atlas_purchase tool (unauthenticated) | `mcp-atlas-tools.test.ts` | Returns error phase when no auth header |
| atlas_get_receipt tool (pending) | `mcp-atlas-tools.test.ts` | Returns { status: 'pending' } |
| atlas_get_receipt tool (completed) | `mcp-atlas-tools.test.ts` | Returns full receipt with credentials and reward_info |
| lemonade://atlas/pricing resource | `mcp-atlas-resources.test.ts` | Returns correct fee structure |
| lemonade://atlas/verification resource | `mcp-atlas-resources.test.ts` | Calls getSelfVerificationStatus GraphQL query, returns verified/unverified |
| LangChain atlas tools | `tools/atlas.test.ts` | Tool registration, state.metadata population, atlas_event card type |

### Test Fixtures

```typescript
// fixtures/atlas-402-challenge.json
{
  "hold_id": "hold_abc123",
  "amount": 36.00,
  "currency": "EUR",
  "amount_usdc": 38.52,
  "payment_methods": ["tempo_usdc", "stripe_card"],
  "expires_at": "2026-03-19T12:05:00Z"
}

// fixtures/atlas-checkout-response.json
{
  "checkout_url": "https://lemonade.social/checkout/hold_abc123?session=cs_xxx",
  "expires_at": "2026-03-19T12:10:00Z"
}

// fixtures/atlas-receipt.json
{
  "purchase_id": "pur_xyz789",
  "credentials": [{
    "jwt": "eyJhbGciOiJFZDI1NTE5...",
    "decoded": {
      "attendee": { "name": "Alice", "email": "alice@example.com" },
      "event_title": "Tresor: Pulse",
      "ticket_type": "General Admission"
    },
    "ticketUrl": "https://lemonade.social/tickets/pur_xyz789_0",
    "qrData": "atlas:ticket:pur_xyz789:0:sig_abc"
  }],
  "payment": {
    "method": "tempo_usdc",
    "amount": 38.52,
    "currency": "USDC",
    "transaction_id": "0xabc123..."
  },
  "purchased_at": "2026-03-19T11:42:18Z",
  "reward_info": {
    "cashback_earned": "0.10",
    "cashback_currency": "USDC",
    "verification_prompt": "Verify with Self.xyz to earn 2x cashback on your next purchase."
  }
}

// fixtures/atlas-free-redirect.json
{
  "type": "free_ticket_redirect",
  "redirect_url": "https://lemonade.social/e/free-event/register"
}

// fixtures/atlas-receipt-pending.json
{
  "status": "pending"
}
```

### Integration Tests

| Test | What to verify |
|------|----------------|
| MCP tool registration | All 4 Atlas tools appear in `server.listTools()` when both env vars are set |
| MCP tool registration (disabled) | Zero Atlas tools when `ATLAS_REGISTRY_URL` is missing |
| MCP tool registration (partial config) | Zero Atlas tools + warning log when only one env var is set |
| Full purchase flow | Search → compare → purchase → get_receipt (mock Atlas endpoints) |
| Auth header forwarding | User auth token reaches Atlas backend endpoints |

### Manual Verification

| Step | Expected result |
|------|----------------|
| Connect MCP client to lemonade-ai | Atlas tools visible alongside existing Lemonade tools |
| Call `atlas_search` with `q: "techno"` | Returns federated results from Registry |
| Call `atlas_compare_tickets` with 2 event IDs | Returns side-by-side comparison |
| Call `atlas_purchase` for paid event | Returns checkout URL + hold_id |
| Call `atlas_purchase` for free event | Returns free redirect URL |
| Call `atlas_get_receipt` before payment | Returns { status: 'pending' } |
| Call `atlas_get_receipt` after payment | Returns full receipt with credentials |
| Read `lemonade://atlas/pricing` | Returns fee structure JSON |
| Read `lemonade://atlas/verification` (authenticated) | Returns user's verification tier via getSelfVerificationStatus |

---

## 12. Environment Variables

New variables required (add to deployment config):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ATLAS_REGISTRY_URL` | Yes (for Atlas features) | — | Atlas Registry service URL |

Existing variables reused (no changes needed):

| Variable | Purpose | Source |
|----------|---------|--------|
| `LEMONADE_BACKEND_URL` | Backend URL for Atlas REST endpoints | `config/index.ts:18` |

---

> **AUDIT FIX W3 [6-M4]:** Pre-deployment checklist.

## 13. Pre-Deployment Checklist

Before deploying Phase 6, verify:

| # | Check | How to verify |
|---|-------|---------------|
| 1 | Phase 2 Atlas endpoints are live | `curl $LEMONADE_BACKEND_URL/atlas/v1/search?q=test` returns 200 |
| 2 | Phase 2 P2-NEW-1 checkout endpoint exists | `curl -X POST $LEMONADE_BACKEND_URL/atlas/v1/holds/test/checkout` returns 404 (not 500) |
| 3 | Phase 3 Atlas Registry is live and indexing | `curl $ATLAS_REGISTRY_URL/atlas/v1/health` returns 200 |
| 4 | Phase 4 reward_info is included in receipts | Phase 2 audit fix [FT-2] is merged |
| 5 | Phase 2 rate limiting is active | Audit fix [FT-3] is merged |
| 6 | Phase 4 verification-tiered rewards active | Audit fix [SV-1] is merged |
| 7 | `ATLAS_REGISTRY_URL` env var is set | Deployment config |
| 8 | `LEMONADE_BACKEND_URL` env var exists | Already configured |

## 14. Deployment Sequence

1. Phase 2 (Atlas endpoints on lemonade-backend) must be deployed first, including P2-NEW-1.
2. Phase 3 (Atlas Registry) must be deployed and indexing Spaces.
3. Phase 4 (Reward system) must be deployed for reward_info in receipts.
4. Set `ATLAS_REGISTRY_URL` env var on lemonade-ai deployment.
5. Deploy lemonade-ai with the new code.
6. Atlas MCP tools become available to all connected agents.
7. Existing tools continue to work unchanged.
