# IMPL-PHASE-7: AI-Powered Ticket Experience — web-new Frontend

**Phase:** 7 — Frontend AI Chat + Atlas Discovery + Reward Dashboard
**Status:** Ready for Lead Routing (W3 Audit Fixes Applied)
**Date:** 2026-03-19
**Author:** Bridge Agent
**Target:** `web-new` (Next.js frontend)
**Depends on:** Phase 2 (Atlas REST endpoints), Phase 4 (USDC reward system + GraphQL resolvers), Phase 6 (Atlas MCP tools on lemonade-ai)
**Package manager:** Yarn v1 — `yarn add --ignore-engines` only, never `npm install`

---

## Execution Status

| Agent | Task | Status |
|-------|------|--------|
| FE Agent | Task 1: Atlas types + HTTP client + hooks | NOT STARTED |
| FE Agent | Task 2: AI chat panes (EventSearchPane, TicketComparePane, PaymentLinkCard) | NOT STARTED |
| FE Agent | Task 3: AI chat card types in CardList.tsx | NOT STARTED |
| FE Agent | Task 4: Atlas event discovery page (`/explore/atlas`) | NOT STARTED |
| FE Agent | Task 5: Reward dashboard in Space management | NOT STARTED |
| FE Agent | Task 6: Self.xyz verification prompt components | NOT STARTED |
| FE Agent | Task 7: Tests | NOT STARTED |

---

## 1. Execution Summary

Add three capabilities to the web-new frontend:

1. **AI Chat Enhancement** — New panes in the existing AI chat for conversational event search, ticket comparison, and a payment link. The AI agent (lemonade-ai) drives the flow via MCP tools; the frontend renders structured results as interactive panes.

2. **Atlas Discovery Page** — A new `/explore/atlas` page showing federated search results from the Atlas Registry. Reuses existing event card components.

3. **Reward Dashboard** — A new section in Space management showing earned USDC cashback, pending holds, payout history, and Self.xyz verification status.

> **AUDIT FIX W3 [7-C5]:** PurchaseConfirmPane replaced with PaymentLinkCard. Per the checkout URL decision (Option A), users pay on the existing Lemonade checkout page — no Stripe Elements or crypto wallet UI in the chat. The flow: EventSearchPane → TicketComparePane → PaymentLinkCard (with "Pay Now" link) → (user pays in new tab) → AtlasReceiptCard.

**Critical constraints:**

> **AUDIT FIX W3 [7-C3]:** `'use client'` directive only on hooks and interactive components, NOT on pure service/fetch modules.

- Interactive components and hooks use `'use client'` directive.
- Service modules (`lib/services/atlas-client.ts`) do NOT use `'use client'` — they are plain fetch functions importable from both server and client contexts.
- Dark-mode-first Tailwind tokens (`text-primary`, `bg-overlay-primary`, `border-card-border`, etc.). All tokens verified in `web-new/app/styles/themes/dark.css`.
- No new GraphQL schema on lemonade-backend for Atlas search — frontend calls Atlas REST endpoints directly via `fetch()`.
- Reward data uses new GraphQL queries added by Phase 4 (reward resolvers on lemonade-backend).
- Reuse existing components: event cards, Pane compound components, Jotai state pattern.
- No new dependencies unless unavoidable. All existing libs (framer-motion, react-hook-form, zod, ts-pattern, jotai) are available.

> **AUDIT FIX W3 [7-M4]:** Feature flag for partial deployment. All Atlas UI components gate on `NEXT_PUBLIC_ATLAS_REGISTRY_URL` being set. If not set, Atlas sections/pages render nothing. This allows deploying Phase 7 code before Phase 2/3/4 are live.

---

## 2. Architecture Overview

```
                         web-new
                           |
        ┌──────────────────┼──────────────────┐
        |                  |                   |
   AI Chat             /explore/atlas      Space Management
   (existing +         (new page)          (existing + new tab)
    new panes)              |                   |
        |                   |                   |
   ┌────┴─────┐        AtlasSearch         RewardDashboard
   |          |         Component           Component
 Existing  NEW              |                   |
 panes    Atlas          Atlas REST          GraphQL
          panes          (fetch)            (useQuery)
   |          |              |                   |
   ▼          ▼              ▼                   ▼
 CreateEvent  EventSearch  Atlas Registry   lemonade-backend
 Pane         Pane         /atlas/v1/search  atlas reward
              TicketCompare                  resolvers
              Pane
              PaymentLink
              Card
```

### AI Chat Pane Flow

> **AUDIT FIX W3 [7-C5]:** Checkout URL flow — no in-chat payment UI.

```
User: "Find techno events in Berlin this Saturday"
  |
  ├─ AI agent calls atlas_search MCP tool
  ├─ MCP tool returns results with card metadata (type: 'atlas_event')
  ├─ AI chat renders assistant message with AtlasEventCard components
  |
User: "Compare tickets for the first two"
  |
  ├─ AI agent calls atlas_compare_tickets
  ├─ Returns comparison data (type: 'atlas_comparison')
  ├─ AI chat renders TicketComparePane
  |
User: "Buy 2 tickets to the first one"
  |
  ├─ AI agent calls atlas_purchase → gets checkout URL
  ├─ Agent says: "Here's your payment link for 2x General Admission at EUR 36.00"
  ├─ AI chat renders PaymentLinkCard with "Pay Now" button
  |
User: clicks "Pay Now" → opens checkout in new tab → pays
  |
  ├─ AI agent calls atlas_get_receipt → polls for completion
  ├─ Returns receipt with tickets + reward info (type: 'atlas_receipt')
  ├─ AI chat renders AtlasReceiptCard:
  |   - Ticket details
  |   - Cashback earned
  |   - "Verify with Self for 2x" prompt (if unverified)
```

---

## 3. New Files to Create

All paths relative to `web-new/`.

| # | File Path | Purpose |
|---|-----------|---------|
| 1 | `lib/types/atlas.ts` | Shared Atlas TypeScript types |
| 2 | `lib/services/atlas-client.ts` | Atlas REST client — NO `'use client'` |
| 3 | `lib/hooks/useAtlasSearch.ts` | Client hook for Atlas federated search |
| 4 | `lib/hooks/useAtlasTickets.ts` | Client hook for Atlas ticket listing |
| 5 | `lib/components/features/ai/panes/EventSearchPane.tsx` | AI chat pane: Atlas search results |
| 6 | `lib/components/features/ai/panes/TicketComparePane.tsx` | AI chat pane: cross-event ticket comparison |
| 7 | `lib/components/features/ai/cards/AtlasEventCard.tsx` | Event card for Atlas search results |
| 8 | `lib/components/features/ai/cards/PaymentLinkCard.tsx` | Checkout URL card with "Pay Now" button |
| 9 | `lib/components/features/ai/cards/AtlasReceiptCard.tsx` | Purchase receipt card with reward info |
| 10 | `lib/components/features/explore/AtlasExplore.tsx` | Atlas discovery page content |
| 11 | `lib/components/features/explore/AtlasSearchBar.tsx` | Search input with category/location filters |
| 12 | `lib/components/features/explore/AtlasEventGrid.tsx` | Event result grid |
| 13 | `app/[domain]/(default)/explore/atlas/page.tsx` | Next.js route for `/explore/atlas` |
| 14 | `lib/components/features/space-manage/RewardDashboard.tsx` | Reward overview: balance, history, tier |
| 15 | `lib/components/features/space-manage/RewardHistory.tsx` | Payout + accrual transaction list |
| 16 | `lib/components/features/space-manage/RewardVerificationBanner.tsx` | Self.xyz verification CTA banner |
| 17 | `app/[domain]/(blank)/s/manage/[uid]/rewards/page.tsx` | Rewards tab page in Space management |

---

## 4. Existing Files to Modify

> **AUDIT FIX W3 [7-C4]:** Card rendering goes in CardList.tsx (not Messages.tsx). Messages.tsx delegates to CardList for all card types.

| # | File Path | Change |
|---|-----------|--------|
| 1 | `lib/components/features/ai/cards/utils.ts` | Extend `CardItem` type union with Atlas card types |
| 2 | `lib/components/features/ai/cards/CardList.tsx` | Add `.with()` cases for `atlas_event`, `atlas_comparison`, `atlas_receipt`, `atlas_payment_link` at lines 25-38 (replace `.exhaustive()` with new cases + `.otherwise()`) |
| 3 | `lib/components/features/explore/Explore.tsx` | Add "Atlas Events" section/link |
| 4 | `app/[domain]/(blank)/s/manage/[uid]/layout.tsx` | Add "Rewards" tab to the `menu` array at line 16-25 |

> **AUDIT FIX W3 [7-C1]:** Provider state NOT modified. AI chat state uses the existing generic `data?: unknown` field on messages. Atlas data is carried in message metadata as card entries (type-discriminated). No new top-level state fields, no new reducer actions, no changes to `provider.tsx`.

---

## 5. Task 1: Atlas Types and HTTP Client

### 5.1 Atlas Types

**File:** `lib/types/atlas.ts`

> **AUDIT FIX W3 [7-H1]:** Reward types include Phase 4 model field names. Phase 4 GraphQL resolvers are NOT yet merged — these types are based on IMPL-PHASE-4-rewards.md Section 2 (model definitions). The implementing agent MUST verify field names against actual Phase 4 resolvers once merged. If Phase 4 resolvers are unavailable, the reward dashboard shows "Rewards coming soon" (see 7-H3).

```typescript
// lib/types/atlas.ts

// --- Search + Event types ---

export interface AtlasEvent {
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
  organizer: {
    name: string;
    verified: boolean;
    atlas_id: string;
  };
  price: {
    amount: number;
    currency: string;
    display: string;
  } | null;
  source: {
    platform: string;
    url: string;
  };
  availability: 'available' | 'limited' | 'sold_out' | 'not_on_sale';
  image_url?: string;
  payment_methods: string[];
}

export interface AtlasTicketType {
  id: string;
  name: string;
  description?: string;
  price: {
    amount: number;
    currency: string;
    display: string;
  };
  available: number | null;
  limit_per_order: number;
  on_sale: boolean;
}

export interface AtlasSearchResult {
  items: AtlasEvent[];
  cursor: string | null;
  total: number;
  sources: Array<{ platform: string; count: number }>;
}

export interface AtlasSearchParams {
  q?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  start_after?: string;
  start_before?: string;
  category?: string;
  price_min?: number;
  price_max?: number;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'date_asc' | 'date_desc' | 'distance';
  limit?: number;
  cursor?: string;
}

export interface AtlasTicketComparison {
  event_id: string;
  event_title: string;
  start: string;
  location_name: string;
  tickets: AtlasTicketType[];
  cheapest_price: {
    amount: number;
    currency: string;
    display: string;
  } | null;
}

// --- Purchase types ---

export interface AtlasCheckoutInfo {
  checkout_url: string;
  hold_id: string;
  amount: number;
  currency: string;
  amount_usdc: number;
  payment_methods: string[];
  expires_at: string;
}

export interface AtlasPurchaseReceipt {
  purchase_id: string;
  credentials: Array<{
    attendee_name: string;
    attendee_email: string;
    event_title: string;
    ticket_type: string;
    ticket_url?: string;
    qr_data: string;
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
    verification_prompt?: string;
  };
}

// --- Reward dashboard types ---
// Field names from Phase 4 IMPL: AtlasRewardBalance (Section 2.1), AtlasFeeDistribution (Section 2.2)
// All USDC amounts are BigInt strings with 6 decimal places ("1000000" = $1.00)

export interface AtlasRewardBalance {
  _id: string;
  type: 'organizer' | 'attendee';
  accrued_usdc: string;       // total ever earned
  paid_out_usdc: string;      // total paid out
  pending_usdc: string;       // available but not yet paid
  clawed_back_usdc: string;   // total clawed back from refunds
  last_payout_at?: string;
}

export interface AtlasRewardTransaction {
  _id: string;
  payment_id: string;
  event_id: string;
  gross_amount_usdc: string;
  organizer_cashback_usdc: string;
  attendee_cashback_usdc: string;
  organizer_volume_bonus_usdc: string;
  status: 'pending_hold' | 'available' | 'paid_out' | 'clawed_back' | 'partially_clawed_back' | 'cancelled';
  hold_expires_at: string;
  organizer_verified: boolean;
  attendee_verified: boolean;
  created_at: string;
}
```

### 5.2 Atlas HTTP Client

**File:** `lib/services/atlas-client.ts`

> **AUDIT FIX W3 [7-C3]:** No `'use client'` directive. Pure fetch functions, usable from server components and hooks.
> **AUDIT FIX W3 [7-C2]:** Uses `NEXT_PUBLIC_LMD_BE` (existing env var from `.env.example:22`) for backend. Only `NEXT_PUBLIC_ATLAS_REGISTRY_URL` is new.

```typescript
// lib/services/atlas-client.ts
// NO 'use client' — this is a pure service module

import type { AtlasSearchParams, AtlasSearchResult, AtlasTicketType, AtlasEvent } from '@/lib/types/atlas';

const ATLAS_REGISTRY_URL = process.env.NEXT_PUBLIC_ATLAS_REGISTRY_URL;
const ATLAS_BACKEND_URL = process.env.NEXT_PUBLIC_LMD_BE;

function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

export function isAtlasEnabled(): boolean {
  return !!(ATLAS_REGISTRY_URL && ATLAS_BACKEND_URL);
}

export async function atlasSearch(params: AtlasSearchParams): Promise<AtlasSearchResult> {
  if (!ATLAS_REGISTRY_URL) throw new Error('NEXT_PUBLIC_ATLAS_REGISTRY_URL not configured');

  const qs = buildQueryString(params as Record<string, string | number | undefined>);
  const response = await fetch(`${ATLAS_REGISTRY_URL}/atlas/v1/search${qs}`, {
    headers: { 'Atlas-Version': '1.0' },
  });

  if (!response.ok) {
    throw new Error(`Atlas search failed: ${response.status}`);
  }

  return response.json();
}

export async function atlasGetEvent(eventId: string): Promise<AtlasEvent> {
  if (!ATLAS_BACKEND_URL) throw new Error('NEXT_PUBLIC_LMD_BE not configured');

  const response = await fetch(`${ATLAS_BACKEND_URL}/atlas/v1/events/${eventId}`, {
    headers: { 'Atlas-Version': '1.0' },
  });

  if (!response.ok) {
    throw new Error(`Atlas get event failed: ${response.status}`);
  }

  return response.json();
}

export async function atlasListTickets(eventId: string): Promise<AtlasTicketType[]> {
  if (!ATLAS_BACKEND_URL) throw new Error('NEXT_PUBLIC_LMD_BE not configured');

  const response = await fetch(`${ATLAS_BACKEND_URL}/atlas/v1/events/${eventId}/tickets`, {
    headers: { 'Atlas-Version': '1.0' },
  });

  if (!response.ok) {
    throw new Error(`Atlas list tickets failed: ${response.status}`);
  }

  const data = await response.json();
  return data.ticket_types;
}
```

### 5.3 Atlas Search Hook

**File:** `lib/hooks/useAtlasSearch.ts`

```typescript
// lib/hooks/useAtlasSearch.ts
'use client';

import { useState, useCallback } from 'react';
import { atlasSearch } from '@/lib/services/atlas-client';
import type { AtlasSearchParams, AtlasEvent } from '@/lib/types/atlas';

interface UseAtlasSearchReturn {
  events: AtlasEvent[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  search: (params: AtlasSearchParams) => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useAtlasSearch(): UseAtlasSearchReturn {
  const [events, setEvents] = useState<AtlasEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [lastParams, setLastParams] = useState<AtlasSearchParams | null>(null);

  const search = useCallback(async (params: AtlasSearchParams) => {
    setLoading(true);
    setError(null);
    try {
      const result = await atlasSearch(params);
      setEvents(result.items);
      setTotal(result.total);
      setCursor(result.cursor);
      setLastParams(params);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || !lastParams || loading) return;
    setLoading(true);
    try {
      const result = await atlasSearch({ ...lastParams, cursor });
      setEvents((prev) => [...prev, ...result.items]);
      setCursor(result.cursor);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load more failed');
    } finally {
      setLoading(false);
    }
  }, [cursor, lastParams, loading]);

  return { events, total, loading, error, hasMore: cursor !== null, search, loadMore };
}
```

### 5.4 Atlas Tickets Hook

**File:** `lib/hooks/useAtlasTickets.ts`

```typescript
// lib/hooks/useAtlasTickets.ts
'use client';

import { useState, useCallback } from 'react';
import { atlasListTickets } from '@/lib/services/atlas-client';
import type { AtlasTicketType } from '@/lib/types/atlas';

export function useAtlasTickets() {
  const [tickets, setTickets] = useState<AtlasTicketType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async (eventId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await atlasListTickets(eventId);
      setTickets(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, []);

  return { tickets, loading, error, fetchTickets };
}
```

**Environment variables:**

> **AUDIT FIX W3 [7-C2]:** Correct env var names verified against `.env.example`.

| Variable | Required | Status | Purpose |
|----------|----------|--------|---------|
| `NEXT_PUBLIC_ATLAS_REGISTRY_URL` | Yes (for Atlas) | **NEW** | Atlas Registry service URL |
| `NEXT_PUBLIC_LMD_BE` | Already exists | Existing (`.env.example:22`) | Backend URL for Atlas REST endpoints |

---

## 6. Task 2: AI Chat Cards and Panes

### 6.1 Card Type Extensions

> **AUDIT FIX W3 [7-C4]:** Update utils.ts FIRST (types), then CardList.tsx (rendering).

**File:** `lib/components/features/ai/cards/utils.ts`

Add to the existing `CardItem` type union:

```typescript
import type { AtlasEvent, AtlasTicketComparison, AtlasPurchaseReceipt, AtlasCheckoutInfo } from '@/lib/types/atlas';

export type CardItem =
  | { type: 'event'; data: Event; link?: string }
  | { type: 'ticket'; data: Ticket; link?: string }
  | { type: 'space'; data: Space; link?: string }
  | { type: 'guest'; data: EventGuestDetail; link?: string }
  // Atlas types
  | { type: 'atlas_event'; data: AtlasEvent; link?: string }
  | { type: 'atlas_comparison'; data: AtlasTicketComparison[]; link?: string }
  | { type: 'atlas_payment_link'; data: AtlasCheckoutInfo }
  | { type: 'atlas_receipt'; data: AtlasPurchaseReceipt };
```

### 6.2 CardList.tsx Modifications

**File:** `lib/components/features/ai/cards/CardList.tsx`

> **AUDIT FIX W3 [7-C4]:** Card rendering in CardList.tsx, not Messages.tsx. Replace `.exhaustive()` at line 38 with `.otherwise(() => null)` to allow new types without exhaustive match errors during incremental development.

The existing match block at lines 25-38:

```typescript
// BEFORE (current code):
match(card)
  .with({ type: 'event' }, (c) => <EventCard key={idx} data={c.data} link={c.link} />)
  .with({ type: 'ticket' }, (c) => <TicketCard key={idx} data={c.data} link={c.link} />)
  .with({ type: 'space' }, (c) => <SpaceCard key={idx} data={c.data} link={c.link} />)
  .with({ type: 'guest' }, (c) => <GuestRow key={idx} data={c.data} />)
  .exhaustive()
```

Replace with:

```typescript
// AFTER:
match(card)
  .with({ type: 'event' }, (c) => <EventCard key={idx} data={c.data} link={c.link} />)
  .with({ type: 'ticket' }, (c) => <TicketCard key={idx} data={c.data} link={c.link} />)
  .with({ type: 'space' }, (c) => <SpaceCard key={idx} data={c.data} link={c.link} />)
  .with({ type: 'guest' }, (c) => <GuestRow key={idx} data={c.data} />)
  .with({ type: 'atlas_event' }, (c) => <AtlasEventCard key={idx} event={c.data} />)
  .with({ type: 'atlas_comparison' }, (c) => <TicketComparePane key={idx} comparisons={c.data} onSelectTicket={() => {}} />)
  .with({ type: 'atlas_payment_link' }, (c) => <PaymentLinkCard key={idx} checkout={c.data} />)
  .with({ type: 'atlas_receipt' }, (c) => <AtlasReceiptCard key={idx} receipt={c.data} />)
  .otherwise(() => null)
```

Add imports at the top of CardList.tsx:

```typescript
import { AtlasEventCard } from './AtlasEventCard';
import { PaymentLinkCard } from './PaymentLinkCard';
import { AtlasReceiptCard } from './AtlasReceiptCard';
import { TicketComparePane } from '../panes/TicketComparePane';
```

### 6.3 AtlasEventCard

**File:** `lib/components/features/ai/cards/AtlasEventCard.tsx`

```typescript
// lib/components/features/ai/cards/AtlasEventCard.tsx
'use client';

import { type FC } from 'react';
import type { AtlasEvent } from '@/lib/types/atlas';

interface AtlasEventCardProps {
  event: AtlasEvent;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (eventId: string) => void;
  onClick?: (event: AtlasEvent) => void;
}

export const AtlasEventCard: FC<AtlasEventCardProps> = ({
  event,
  selectable,
  selected,
  onSelect,
  onClick,
}) => {
  // ... component body
};
```

**Layout:**

```
┌──────────────────────────────────────────────┐
│ [□]  [image 38x38]  Title of Event           │
│                     Mar 21 · Tresor Berlin    │
│                     $18.00 · ● Available      │
│                     via Lemonade              │
└──────────────────────────────────────────────┘
```

- Checkbox (if `selectable`): left-aligned, `border-card-border`, checked state uses `bg-accent-400`.
- Image: 38x38 rounded, from `event.image_url`. Fallback: first letter of title on `bg-overlay-secondary`.
- Title: `text-primary`, truncated to 1 line.
- Subtitle: date formatted + `event.location.name`. `text-secondary`.
- Price + availability: `event.price?.display` + colored dot (green=available `text-success-500`, yellow=limited `text-warning-300`, red=sold_out `text-danger-500`). `text-tertiary`.
- Source platform: "via {platform}" in `text-quaternary`.
- On click: if `event.source.platform === 'lemonade'`, navigate to `/e/{event.id}`. Otherwise, open `event.source.url` in new tab.

### 6.4 EventSearchPane

**File:** `lib/components/features/ai/panes/EventSearchPane.tsx`

> **AUDIT FIX W3 [7-H4]:** EventSearchPane receives pre-fetched data from the AI agent via chat message metadata (type: 'atlas_event' cards). It does NOT fetch client-side. The data structure is an array of `AtlasEvent` objects from the agent's `atlas_search` tool result.

```typescript
// lib/components/features/ai/panes/EventSearchPane.tsx
'use client';

import { type FC } from 'react';
import { AtlasEventCard } from '../cards/AtlasEventCard';
import type { AtlasEvent } from '@/lib/types/atlas';

interface EventSearchPaneProps {
  events: AtlasEvent[];
  total: number;
  sources: Array<{ platform: string; count: number }>;
}

export const EventSearchPane: FC<EventSearchPaneProps> = ({
  events,
  total,
  sources,
}) => {
  // ... component body
};
```

**Layout:**

- Header: "{total} events found" with source platform chips (e.g., "Lemonade ×3", "Eventbrite ×2").
- Scrollable list of `AtlasEventCard` components (not selectable — just display cards).
- Empty state: "No events found."

### 6.5 TicketComparePane

**File:** `lib/components/features/ai/panes/TicketComparePane.tsx`

> **AUDIT FIX W3 [7-H4]:** TicketComparePane receives pre-fetched comparison data from the AI agent. The metadata structure is: `{ type: 'atlas_comparison', data: AtlasTicketComparison[] }`. No client-side fetching.

```typescript
// lib/components/features/ai/panes/TicketComparePane.tsx
'use client';

import { type FC } from 'react';
import type { AtlasTicketComparison } from '@/lib/types/atlas';

interface TicketComparePaneProps {
  comparisons: AtlasTicketComparison[];
  onSelectTicket: (eventId: string, ticketTypeId: string) => void;
}

export const TicketComparePane: FC<TicketComparePaneProps> = ({
  comparisons,
  onSelectTicket,
}) => {
  // ... component body
};
```

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│  Compare Tickets                           2 events │
├──────────────────────┬──────────────────────────────┤
│  Tresor: Pulse       │  Sisyphos Garden Opening     │
│  Mar 21 · 23:00      │  Mar 21 · 14:00              │
│  Tresor Berlin       │  Sisyphos                    │
│                      │                              │
│  General Admission   │  Early Bird                  │
│  EUR 18.00 · 42 left │  EUR 15.00 · 20 left         │
│                      │                              │
│  VIP Backstage       │  General Admission           │
│  EUR 55.00 · 5 left  │  EUR 22.00 · available       │
├──────────────────────┴──────────────────────────────┤
│  Best value: Sisyphos Early Bird at EUR 15.00       │
└─────────────────────────────────────────────────────┘
```

- Columns: One per event, horizontal scroll on mobile. `border-r border-card-border` between columns.
- Event header: title (`text-primary`), date/time (`text-secondary`), venue (`text-tertiary`).
- Ticket rows: name, price (`text-primary font-medium`), availability.
- Footer: Best value recommendation — cheapest on-sale ticket. `text-accent-400`.

### 6.6 PaymentLinkCard

> **AUDIT FIX W3 [7-C5]:** Replaces PurchaseConfirmPane. Simple card with "Pay Now" link — no Stripe Elements, no payment method selector.

**File:** `lib/components/features/ai/cards/PaymentLinkCard.tsx`

```typescript
// lib/components/features/ai/cards/PaymentLinkCard.tsx
'use client';

import { type FC } from 'react';
import type { AtlasCheckoutInfo } from '@/lib/types/atlas';

interface PaymentLinkCardProps {
  checkout: AtlasCheckoutInfo;
}

export const PaymentLinkCard: FC<PaymentLinkCardProps> = ({ checkout }) => {
  // ... component body
};
```

**Layout:**

```
┌──────────────────────────────────────────┐
│  Payment Required                        │
│                                          │
│  Amount: EUR 36.00 (≈ 38.52 USDC)       │
│  Payment methods: Card, USDC             │
│                                          │
│  Hold expires in 4:32                    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │        Pay Now →                 │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

- Amount: `checkout.amount` + `checkout.currency` in `text-primary text-lg font-semibold`. USDC equivalent in `text-secondary`.
- Payment methods: joined from `checkout.payment_methods` array.
- Hold countdown: computed from `checkout.expires_at`. Uses `setInterval` updating every second. When expired: disable button, show "Hold expired — ask the agent for a new link" in `text-danger-500`.
- "Pay Now" button: `<a href={checkout.checkout_url} target="_blank" rel="noopener noreferrer">`. Styled as `block w-full text-center bg-accent-400 text-primary rounded-sm py-3 font-medium`.

### 6.7 AtlasReceiptCard

**File:** `lib/components/features/ai/cards/AtlasReceiptCard.tsx`

```typescript
// lib/components/features/ai/cards/AtlasReceiptCard.tsx
'use client';

import { type FC } from 'react';
import type { AtlasPurchaseReceipt } from '@/lib/types/atlas';

interface AtlasReceiptCardProps {
  receipt: AtlasPurchaseReceipt;
}

export const AtlasReceiptCard: FC<AtlasReceiptCardProps> = ({ receipt }) => {
  // ... component body
};
```

**Layout:**

```
┌──────────────────────────────────────────┐
│  ✓ Purchase Confirmed                   │
│                                          │
│  2x General Admission · Tresor: Pulse    │
│  Paid: EUR 36.72 via USDC               │
│  Transaction: 0xabc...123               │
│                                          │
│  Tickets sent to:                        │
│  • Alice (alice@example.com)             │
│  • Bob (bob@example.com)                 │
│                                          │
│  ─────────────────────────────────────── │
│  You earned $0.10 USDC cashback!         │
│  ─────────────────────────────────────── │
│  Verify with Self.xyz to earn 2x →      │
└──────────────────────────────────────────┘
```

- Success header: checkmark icon + "Purchase Confirmed" in `text-success-500`.
- Ticket details: count + type + event title.
- Payment: amount + method + truncated transaction ID.
- Attendees: list with name and email.
- Reward section (if `receipt.reward_info?.cashback_earned`): `bg-overlay-secondary rounded-sm p-3`.
  - Cashback in `text-accent-400 font-medium`.

> **AUDIT FIX W3 [7-M2]:** Verification prompt links to the existing `GetVerifiedModal` (at `web-new/lib/components/features/modals/GetVerifiedModal.tsx`), NOT a non-existent `/settings/verification` page. On click, import and open the modal.

  - If `receipt.reward_info?.verification_prompt`: clickable text in `text-accent-400` that opens `GetVerifiedModal` via the existing modal system. The modal calls `CreateSelfVerificationRequestDocument` to initiate the Self.xyz flow.

---

## 7. Task 3: Atlas Discovery Page

### 7.1 Route

> **AUDIT FIX W3 [7-M4]:** Route uses `[domain]` param (consistent with existing web-new routing pattern at `app/[domain]/`).

**File:** `app/[domain]/(default)/explore/atlas/page.tsx`

```typescript
import { AtlasExplore } from '@/lib/components/features/explore/AtlasExplore';

export const metadata = {
  title: 'Atlas Events — Discover Events Across All Platforms',
  description: 'Search for events from Lemonade, Eventbrite, Lu.ma, Meetup, and more via Atlas Protocol.',
};

export default function AtlasExplorePage() {
  return <AtlasExplore />;
}
```

### 7.2 AtlasExplore Component

**File:** `lib/components/features/explore/AtlasExplore.tsx`

> **AUDIT FIX W3 [7-H3]:** Graceful degradation when Atlas is unavailable.

```typescript
// lib/components/features/explore/AtlasExplore.tsx
'use client';

import { type FC, useState, useCallback } from 'react';
import { AtlasSearchBar } from './AtlasSearchBar';
import { AtlasEventGrid } from './AtlasEventGrid';
import { useAtlasSearch } from '@/lib/hooks/useAtlasSearch';
import { isAtlasEnabled } from '@/lib/services/atlas-client';
import type { AtlasSearchParams } from '@/lib/types/atlas';

export const AtlasExplore: FC = () => {
  const { events, total, loading, error, hasMore, search, loadMore } = useAtlasSearch();
  const [hasSearched, setHasSearched] = useState(false);

  // > **AUDIT FIX W3 [7-M4]:** Feature flag — render nothing if Atlas env vars not set
  if (!isAtlasEnabled()) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
        <p className="text-secondary text-sm">Atlas Events discovery coming soon.</p>
      </div>
    );
  }

  const handleSearch = async (params: AtlasSearchParams) => {
    setHasSearched(true);
    await search(params);
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Atlas Events</h1>
        <p className="text-sm text-secondary mt-1">
          Discover events from all connected platforms
        </p>
      </div>

      <AtlasSearchBar onSearch={handleSearch} loading={loading} />

      {error && <div className="text-danger-500 text-sm">{error}</div>}

      {hasSearched && (
        <AtlasEventGrid
          events={events}
          total={total}
          loading={loading}
          hasMore={hasMore}
          onLoadMore={loadMore}
        />
      )}
    </div>
  );
};
```

### 7.3 AtlasSearchBar

**File:** `lib/components/features/explore/AtlasSearchBar.tsx`

```typescript
// lib/components/features/explore/AtlasSearchBar.tsx
'use client';

import { type FC, useState } from 'react';
import type { AtlasSearchParams } from '@/lib/types/atlas';

interface AtlasSearchBarProps {
  onSearch: (params: AtlasSearchParams) => void;
  loading: boolean;
}

export const AtlasSearchBar: FC<AtlasSearchBarProps> = ({ onSearch, loading }) => {
  // ... component body
};
```

**Layout:**

- Text input: full-width, `bg-overlay-secondary border border-card-border rounded-sm`, placeholder "Search events across all platforms..."
- Filter row: category dropdown, date presets (today / this week / this weekend / custom), price range (free / under $25 / under $50 / any).
- Search button: `bg-accent-400 text-primary rounded-sm px-4 py-2`. Disabled while loading.

### 7.4 AtlasEventGrid

**File:** `lib/components/features/explore/AtlasEventGrid.tsx`

```typescript
// lib/components/features/explore/AtlasEventGrid.tsx
'use client';

import { type FC } from 'react';
import { AtlasEventCard } from '../ai/cards/AtlasEventCard';
import type { AtlasEvent } from '@/lib/types/atlas';

interface AtlasEventGridProps {
  events: AtlasEvent[];
  total: number;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export const AtlasEventGrid: FC<AtlasEventGridProps> = ({
  events,
  total,
  loading,
  hasMore,
  onLoadMore,
}) => {
  // ... component body
};
```

**Layout:**

- Result count: "{total} events found" in `text-secondary text-sm`.
- Grid: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`.
- Each cell: `AtlasEventCard` (no checkbox — click navigates).
- Load more: button at bottom if `hasMore`. `bg-(--btn-tertiary)` style.
- Loading skeleton: 6 placeholder cards with shimmer animation.
- Empty state: "No events found. Try a different search." in `text-tertiary`.

### 7.5 Explore.tsx Modification

**File:** `lib/components/features/explore/Explore.tsx`

Add after the existing `FeaturedCommunityHubs` section:

```typescript
import { isAtlasEnabled } from '@/lib/services/atlas-client';
import Link from 'next/link';

// Inside the component, after FeaturedCommunityHubs:
{isAtlasEnabled() && (
  <div className="flex items-center justify-between">
    <h2 className="text-lg font-semibold text-primary">Atlas Events</h2>
    <Link href="/explore/atlas" className="text-sm text-accent-400">
      View All →
    </Link>
  </div>
)}
```

---

## 8. Task 4: Reward Dashboard

### 8.1 Space Management Integration

> **AUDIT FIX W3 [7-H2]:** Exact integration point: `app/[domain]/(blank)/s/manage/[uid]/layout.tsx:16-25`. Add "Rewards" to the `menu` array.

**File:** `app/[domain]/(blank)/s/manage/[uid]/layout.tsx`

Add to the `menu` array (between "Payments" and "Launchpad"):

```typescript
const menu = [
  { name: 'Overview', page: 'overview' },
  { name: 'Events', page: 'events' },
  { name: 'Submissions', page: 'submissions' },
  { name: 'People', page: 'people' },
  { name: 'Agents', page: 'agents' },
  { name: 'Payments', page: 'payments' },
  { name: 'Rewards', page: 'rewards' },  // NEW — Atlas rewards dashboard
  { name: 'Launchpad', page: 'launchpad' },
  { name: 'Settings', page: 'settings' },
];
```

**Route page:** `app/[domain]/(blank)/s/manage/[uid]/rewards/page.tsx`

```typescript
import { RewardDashboard } from '@/lib/components/features/space-manage/RewardDashboard';

export default function RewardsPage({ params }: { params: { uid: string } }) {
  return <RewardDashboard spaceId={params.uid} />;
}
```

### 8.2 RewardDashboard Component

**File:** `lib/components/features/space-manage/RewardDashboard.tsx`

> **AUDIT FIX W3 [7-H3]:** Graceful degradation if Phase 4 resolvers are unavailable. Uses try-catch on GraphQL query and shows "coming soon" fallback.
> **AUDIT FIX W3 [7-H1]:** Phase 4 GraphQL resolver names are EXPECTED (Phase 4 not yet merged). The implementing agent MUST verify these query names against actual Phase 4 resolvers: `atlasGetRewardBalances`, `atlasGetFeeDistributions`. If these don't exist, the fallback UI is shown.

```typescript
// lib/components/features/space-manage/RewardDashboard.tsx
'use client';

import { type FC, useEffect, useState } from 'react';
import { useQuery } from '@/lib/graphql/request/hooks';
import { RewardHistory } from './RewardHistory';
import { RewardVerificationBanner } from './RewardVerificationBanner';
import { isAtlasEnabled } from '@/lib/services/atlas-client';
import type { AtlasRewardBalance, AtlasRewardTransaction } from '@/lib/types/atlas';

interface RewardDashboardProps {
  spaceId: string;
}

// USDC BigInt string (6 decimals) → display string
function formatUsdc(bigIntStr: string): string {
  const num = Number(bigIntStr) / 1_000_000;
  return `$${num.toFixed(2)}`;
}

export const RewardDashboard: FC<RewardDashboardProps> = ({ spaceId }) => {
  const [available, setAvailable] = useState(true);

  // > **AUDIT FIX W3 [7-M4]:** Feature flag
  if (!isAtlasEnabled()) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
        <p className="text-secondary text-sm">Atlas Rewards coming soon.</p>
      </div>
    );
  }

  // > **AUDIT FIX W3 [7-H3]:** GraphQL query may not exist yet.
  // > Phase 4 adds resolvers: atlasGetRewardBalances(space_id), atlasGetFeeDistributions(space_id, limit)
  // > If the resolver doesn't exist, GraphQL returns an error → catch and show fallback.
  // > Implementing agent: replace these document references with actual generated document
  // > imports once Phase 4 codegen is available.

  // Placeholder: actual GraphQL query usage goes here.
  // The implementing agent should use:
  //   const { data: balanceData, error: balanceError } = useQuery(AtlasGetRewardBalancesDocument, {
  //     variables: { space_id: spaceId },
  //   });
  //
  // If balanceError or no data, render the "coming soon" fallback.

  // ... component body renders:
  // 1. RewardVerificationBanner (if user is unverified)
  // 2. Balance cards: 3-column grid (Earned, Pending, Paid Out)
  // 3. Volume tier info
  // 4. RewardHistory section
};
```

**Layout:**

```
┌──────────────────────────────────────────────────────┐
│  Atlas Rewards                                       │
│                                                      │
│  [Verify with Self.xyz to earn 2x cashback →]        │  ← RewardVerificationBanner
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐       │
│  │ Earned   │  │ Pending  │  │ Paid Out     │       │
│  │ $12.45   │  │ $3.20    │  │ $9.25        │       │
│  │ USDC     │  │ USDC     │  │ USDC         │       │
│  │ all time │  │ in hold  │  │ to date      │       │
│  └──────────┘  └──────────┘  └──────────────┘       │
│                                                      │
│  Your Tier: Standard (0.6% cashback)                 │
│  Next tier: $10K+ monthly GMV → 0.8%                 │
│                                                      │
│  ────────────────────────────────────────────────    │
│  Recent Activity                                     │
│  [RewardHistory component]                           │
└──────────────────────────────────────────────────────┘
```

- Balance cards: `grid grid-cols-3 gap-3`. Each: `bg-overlay-secondary rounded-sm p-4`. Amount `text-primary text-xl font-semibold`. Label `text-tertiary text-xs`.
- `accrued_usdc` = total earned. `pending_usdc` = in 14-day hold. `paid_out_usdc` = disbursed.
- Volume tier: based on thresholds from Phase 4 (0/$10K/$50K/$250K).

### 8.3 RewardHistory Component

**File:** `lib/components/features/space-manage/RewardHistory.tsx`

```typescript
// lib/components/features/space-manage/RewardHistory.tsx
'use client';

import { type FC } from 'react';
import type { AtlasRewardTransaction } from '@/lib/types/atlas';

interface RewardHistoryProps {
  transactions: AtlasRewardTransaction[];
  loading: boolean;
}

export const RewardHistory: FC<RewardHistoryProps> = ({ transactions, loading }) => {
  // ... component body
};
```

**Layout:**

- List of rows: date, event title (placeholder — resolve from event_id), cashback amount, status badge.
- Status badges:
  - `pending_hold`: yellow — `bg-warning-100/10 text-warning-300` + "Hold: X days left"
  - `available`: green — `bg-success-100/10 text-success-500`
  - `paid_out`: gray — `text-tertiary`
  - `clawed_back` / `cancelled`: red — `text-danger-500`
- Empty state: "No reward activity yet. Sell tickets via Atlas to start earning."

### 8.4 RewardVerificationBanner

**File:** `lib/components/features/space-manage/RewardVerificationBanner.tsx`

> **AUDIT FIX W3 [7-M2]:** Links to `GetVerifiedModal` (existing modal), not a non-existent page.

```typescript
// lib/components/features/space-manage/RewardVerificationBanner.tsx
'use client';

import { type FC } from 'react';

interface RewardVerificationBannerProps {
  verified: boolean;
  currentRate: string;
  boostedRate: string;
  onVerifyClick: () => void;  // opens GetVerifiedModal
}

export const RewardVerificationBanner: FC<RewardVerificationBannerProps> = ({
  verified,
  currentRate,
  boostedRate,
  onVerifyClick,
}) => {
  if (verified) return null;

  return (
    <div className="flex items-center justify-between rounded-sm bg-overlay-secondary border border-accent-400/20 p-4">
      <div>
        <p className="text-sm font-medium text-primary">
          Earn {boostedRate} cashback instead of {currentRate}
        </p>
        <p className="text-xs text-secondary mt-0.5">
          Verify your identity with Self.xyz to unlock boosted rewards
        </p>
      </div>
      <button
        onClick={onVerifyClick}
        className="text-sm font-medium text-accent-400 whitespace-nowrap"
      >
        Verify Now →
      </button>
    </div>
  );
};
```

The parent (`RewardDashboard`) opens `GetVerifiedModal` from `web-new/lib/components/features/modals/GetVerifiedModal.tsx` when the button is clicked. The modal initiates the Self.xyz verification flow via `CreateSelfVerificationRequestDocument` GraphQL mutation.

---

## 9. Testing Strategy

> **AUDIT FIX W3 [7-M3]:** Sample test showing fetch() mock pattern for jsdom.

### Unit Tests

| Test | File | What to verify |
|------|------|----------------|
| Atlas HTTP client | `atlas-client.test.ts` | URL construction, error handling, response parsing, `isAtlasEnabled()` |
| useAtlasSearch hook | `useAtlasSearch.test.ts` | State transitions, cursor pagination, error states |
| AtlasEventCard | `AtlasEventCard.test.tsx` | Renders title, price, availability, source platform |
| EventSearchPane | `EventSearchPane.test.tsx` | Renders event list, source chips, total count |
| TicketComparePane | `TicketComparePane.test.tsx` | Renders columns, best value recommendation |
| PaymentLinkCard | `PaymentLinkCard.test.tsx` | Renders amount, "Pay Now" link opens in new tab, countdown timer, disabled when expired |
| AtlasReceiptCard | `AtlasReceiptCard.test.tsx` | Renders receipt, cashback, verification prompt triggers modal |
| RewardDashboard | `RewardDashboard.test.tsx` | Renders balances, tier info, shows fallback when Phase 4 unavailable |
| CardList Atlas cases | `CardList.test.tsx` | All 4 Atlas card types render without errors |

### Sample Test Pattern (fetch mock)

```typescript
// __tests__/lib/services/atlas-client.test.ts
// jsdom does NOT provide fetch — must mock explicitly

import { atlasSearch } from '@/lib/services/atlas-client';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  process.env.NEXT_PUBLIC_ATLAS_REGISTRY_URL = 'https://registry.test';
  process.env.NEXT_PUBLIC_LMD_BE = 'https://backend.test';
  mockFetch.mockReset();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ATLAS_REGISTRY_URL;
  delete process.env.NEXT_PUBLIC_LMD_BE;
});

describe('atlasSearch', () => {
  it('sends correct URL and headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], cursor: null, total: 0, sources: [] }),
    });

    await atlasSearch({ q: 'techno', limit: 10 });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://registry.test/atlas/v1/search?q=techno&limit=10',
      expect.objectContaining({
        headers: { 'Atlas-Version': '1.0' },
      }),
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(atlasSearch({ q: 'test' })).rejects.toThrow('Atlas search failed: 500');
  });
});
```

### Integration Tests

| Test | What to verify |
|------|----------------|
| AI chat + Atlas search | Message with atlas_event cards renders AtlasEventCard components |
| AI chat + purchase flow | PaymentLinkCard renders with checkout URL → AtlasReceiptCard after completion |
| Atlas explore page | Search bar → results grid → load more pagination |
| Atlas explore (disabled) | Shows "coming soon" when env var missing |
| Reward dashboard | Balance cards show correct values |
| Reward dashboard (no Phase 4) | Shows "Rewards coming soon" fallback |

---

## 10. Environment Variables

New variables (add to `.env` and deployment config):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NEXT_PUBLIC_ATLAS_REGISTRY_URL` | Yes (for Atlas features) | — | Atlas Registry service URL |

Existing variables reused:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_LMD_BE` | Backend URL for Atlas REST endpoints (existing, `.env.example:22`) |

---

> **AUDIT FIX W3 [7-M1]:** Tailwind tokens verified against `web-new/app/styles/themes/dark.css`. All tokens used in this IMPL exist:
> - `text-primary`, `text-secondary`, `text-tertiary`, `text-quaternary` — line 9-12 of dark.css
> - `bg-overlay-primary`, `bg-overlay-secondary` — line 22-23 of dark.css
> - `border-card-border` — line 15 of dark.css (`--color-card-border`)
> - `bg-accent-400` — maps to `--color-violet-400` via `globals.css:110`
> - `text-success-500`, `text-danger-500`, `text-warning-300` — standard palette

## 11. Deployment Sequence

1. Phase 2 (Atlas endpoints on backend) deployed and tested, including P2-NEW-1 checkout endpoint.
2. Phase 3 (Atlas Registry) deployed and indexing Spaces.
3. Phase 4 (Reward resolvers) deployed — required for reward dashboard. If not ready, dashboard shows fallback.
4. Phase 6 (Atlas MCP tools on lemonade-ai) deployed — required for AI chat flow.
5. Set `NEXT_PUBLIC_ATLAS_REGISTRY_URL` env var.
6. Deploy web-new with the new code.
7. Verify: Atlas explore page loads, AI chat Atlas cards render, reward dashboard shows data or fallback.
