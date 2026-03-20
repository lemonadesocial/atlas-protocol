# @atlas/client — Client SDK Specification

> Technical specification for the agent-side SDK that lets any AI agent discover and purchase event tickets through Atlas.

## Overview

`@atlas/client` is a TypeScript SDK that gives AI agents full access to the Atlas Protocol: federated event discovery across all sources (organizer-connected platforms, integrated platforms, Atlas-native platforms), ticket pricing, and purchase with automatic 402 payment handling.

The SDK abstracts the MPP (Machine Payment Protocol) 402 challenge-response flow so agents never deal with payment plumbing directly. Search, pick, pay — done.

## Installation

```bash
npm install @atlas/client
```

```bash
yarn add @atlas/client
```

```bash
pnpm add @atlas/client
```

## Quick Start

```typescript
import { AtlasClient, TempoPaymentHandler } from '@atlas/client'

const atlas = new AtlasClient({
  registryUrl: 'https://registry.atlas.events',
  agentId: 'agent:my-travel-bot',
})

// Set up payment (USDC on Tempo — <$0.001 fees)
const payment = new TempoPaymentHandler({
  privateKey: process.env.TEMPO_PRIVATE_KEY!,
})

// Search across all sources
const events = await atlas.search({
  q: 'techno',
  lat: 52.52,
  lng: 13.4,
  radius_km: 25,
})

// Get ticket types for best match
const tickets = await atlas.listTickets(events.items[0].id)

// Purchase — 402 handling is automatic
const receipt = await atlas.purchase(events.items[0].id, {
  ticketTypeId: tickets[0].id,
  quantity: 2,
  attendees: [
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' },
  ],
  paymentHandler: payment,
})

// receipt.credentials contains Verifiable Credentials (one per attendee)
console.log(receipt.credentials[0].ticketUrl)
```

---

## Core API

### `AtlasClient`

```typescript
class AtlasClient {
  constructor(options: AtlasClientOptions)

  // Discovery
  search(params: SearchParams): Promise<SearchResult>
  getEvent(eventId: string): Promise<AtlasEvent>

  // Ticketing
  listTickets(eventId: string): Promise<TicketType[]>
  getTicketPrice(eventId: string, params: PriceParams): Promise<PriceQuote>

  // Purchase
  purchase(eventId: string, params: PurchaseParams): Promise<PurchaseReceipt>

  // Availability
  subscribe(eventId: string, handler: AvailabilityHandler): Subscription

  // Verification
  verifyTicket(credentialJwt: string): Promise<VerificationResult>
}
```

### `AtlasClientOptions`

```typescript
interface AtlasClientOptions {
  /** Atlas Registry URL. Default: https://registry.atlas.events */
  registryUrl?: string

  /** Agent identity for attribution and rate limits */
  agentId?: string

  /** API key (optional — enables higher rate limits) */
  apiKey?: string

  /** Cache configuration */
  cache?: CacheOptions

  /** Request timeout in ms. Default: 30_000 */
  timeout?: number

  /** Retry configuration */
  retry?: RetryOptions
}
```

---

## Search

### `atlas.search(params)`

Search across all Atlas sources: organizer-connected platform accounts, integrated platforms, and Atlas-native platforms. Results are federated — the agent sees a unified list regardless of origin.

```typescript
interface SearchParams {
  /** Keyword query (title, description, tags) */
  q?: string

  /** Location-based search */
  lat?: number
  lng?: number
  radius_km?: number

  /** Date range (ISO 8601) */
  start_after?: string
  start_before?: string

  /** Category filter */
  category?: EventCategory | EventCategory[]

  /** Price range in USD (filters across all currencies at current rates) */
  price_min?: number
  price_max?: number

  /** Only show events the agent can pay for with a given method */
  payment_method?: 'tempo_usdc' | 'stripe_card' | 'stripe_wallet' | 'lightning'

  /** Sort order */
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'date_asc' | 'date_desc' | 'distance'

  /** Cursor-based pagination */
  cursor?: string

  /** Page size. Default: 20, Max: 100 */
  limit?: number
}
```

### `SearchResult`

```typescript
interface SearchResult {
  items: AtlasEvent[]
  cursor: string | null    // null when no more pages
  total: number            // estimated total matches
  sources: SourceSummary[] // which platforms contributed results
}
```

### Pagination

Atlas uses cursor-based pagination. Pass the `cursor` from the previous response to get the next page:

```typescript
let cursor: string | undefined
const allEvents: AtlasEvent[] = []

do {
  const result = await atlas.search({ q: 'jazz', cursor, limit: 50 })
  allEvents.push(...result.items)
  cursor = result.cursor ?? undefined
} while (cursor)
```

---

## Event Model

```typescript
interface AtlasEvent {
  /** Globally unique Atlas event ID */
  id: string

  /** Human-readable title */
  title: string

  /** Event description (plain text or markdown) */
  description: string

  /** Start time (ISO 8601 with timezone) */
  start: string

  /** End time (ISO 8601 with timezone) */
  end: string

  /** Venue / location */
  location: {
    name: string
    address?: string
    lat: number
    lng: number
    city?: string
    country?: string
  }

  /** Categories / tags */
  categories: EventCategory[]

  /** Organizer info */
  organizer: {
    name: string
    verified: boolean
    atlas_id: string
  }

  /** Price summary (cheapest available ticket) */
  price: {
    amount: number
    currency: string     // 'USD', 'USDC', 'EUR', etc.
    display: string      // '$25.00'
  } | null               // null = free event

  /** Source platform */
  source: {
    platform: string     // 'lemonade', 'eventbrite', 'luma', etc.
    url: string          // original event URL
  }

  /** Availability status */
  availability: 'available' | 'limited' | 'sold_out' | 'not_on_sale'

  /** Cover image URL */
  image_url?: string

  /** Accepted payment methods */
  payment_methods: PaymentMethod[]
}

type EventCategory =
  | 'music' | 'tech' | 'arts' | 'sports' | 'food'
  | 'business' | 'health' | 'education' | 'community'
  | 'nightlife' | 'film' | 'gaming' | 'other'

type PaymentMethod = 'tempo_usdc' | 'stripe_card' | 'stripe_wallet' | 'lightning'
```

---

## Ticketing

### `atlas.listTickets(eventId)`

Returns all ticket types for an event with current pricing and availability.

```typescript
interface TicketType {
  id: string
  name: string                // 'General Admission', 'VIP', etc.
  description?: string
  price: {
    amount: number
    currency: string
    display: string
  }
  available: number | null    // null = unlimited
  limit_per_order: number     // max per purchase
  sale_start?: string         // ISO 8601
  sale_end?: string           // ISO 8601
  on_sale: boolean
}
```

### `atlas.getTicketPrice(eventId, params)`

Get an exact price quote including fees, discounts, and currency conversion.

```typescript
interface PriceParams {
  ticketTypeId: string
  quantity: number
  discount_code?: string
  payment_method?: PaymentMethod
}

interface PriceQuote {
  subtotal: { amount: number; currency: string; display: string }
  protocol_fee: { amount: number; currency: string; display: string }
  platform_fee: { amount: number; currency: string; display: string }
  discount: { amount: number; currency: string; display: string } | null
  total: { amount: number; currency: string; display: string }
  /** USDC equivalent for Tempo payments */
  total_usdc: number
  /** Quote valid until (ISO 8601) */
  expires_at: string
  /** Quote ID to reference during purchase */
  quote_id: string
}
```

```typescript
const quote = await atlas.getTicketPrice(event.id, {
  ticketTypeId: tickets[0].id,
  quantity: 2,
  payment_method: 'tempo_usdc',
})

console.log(`Total: ${quote.total.display} (${quote.total_usdc} USDC)`)
console.log(`Valid until: ${quote.expires_at}`)
```

---

## Purchase

### `atlas.purchase(eventId, params)`

Initiates a ticket purchase. The SDK handles the full MPP 402 flow internally:

1. POST purchase request to Atlas
2. Receive 402 Payment Required with challenge
3. Call the `paymentHandler` to sign/create payment credential
4. Retry the request with the payment credential attached
5. Receive purchase receipt with Verifiable Credentials

```typescript
interface PurchaseParams {
  ticketTypeId: string
  quantity: number
  attendees: Attendee[]
  paymentHandler: PaymentHandler
  /** Optional quote ID from getTicketPrice (locks price) */
  quote_id?: string
  /** Idempotency key (auto-generated if omitted) */
  idempotency_key?: string
}

interface Attendee {
  name: string
  email: string
}

interface PurchaseReceipt {
  /** Atlas purchase ID */
  purchase_id: string
  /** One Verifiable Credential per attendee */
  credentials: TicketCredential[]
  /** Payment confirmation */
  payment: {
    method: PaymentMethod
    amount: number
    currency: string
    transaction_id: string
  }
  /** ISO 8601 timestamp */
  purchased_at: string
}

interface TicketCredential {
  /** JWT-encoded Verifiable Credential */
  jwt: string
  /** Decoded credential fields */
  decoded: {
    attendee: { name: string; email: string }
    event_id: string
    event_title: string
    ticket_type: string
    seat?: string
    valid_from: string
    valid_until: string
  }
  /** Deep link to ticket (if supported by source platform) */
  ticketUrl?: string
  /** QR code data for check-in */
  qrData: string
}
```

### Purchase Example

```typescript
const receipt = await atlas.purchase(event.id, {
  ticketTypeId: tickets[0].id,
  quantity: 1,
  attendees: [{ name: 'Alice', email: 'alice@example.com' }],
  paymentHandler: new TempoPaymentHandler({
    privateKey: process.env.TEMPO_PRIVATE_KEY!,
  }),
})

console.log(`Purchase ${receipt.purchase_id} confirmed`)
console.log(`Transaction: ${receipt.payment.transaction_id}`)
console.log(`Ticket JWT: ${receipt.credentials[0].jwt}`)
```

---

## Payment Handlers

Payment handlers are pluggable. The SDK ships three built-in handlers and exposes an interface for custom implementations.

### `PaymentHandler` Interface

```typescript
interface PaymentHandler {
  /** Which payment method this handler supports */
  method: PaymentMethod

  /**
   * Given a 402 challenge from Atlas, produce a payment credential.
   * The SDK calls this automatically during purchase.
   */
  handleChallenge(challenge: PaymentChallenge): Promise<PaymentCredential>
}

interface PaymentChallenge {
  /** Amount to pay */
  amount: number
  currency: string
  /** Recipient address or account */
  recipient: string
  /** Challenge nonce */
  nonce: string
  /** Expiry (ISO 8601) — payment must complete before this */
  expires_at: string
  /** Payment-method-specific data */
  metadata: Record<string, unknown>
}

interface PaymentCredential {
  /** Payment method used */
  method: PaymentMethod
  /** Proof of payment (transaction hash, token, invoice preimage, etc.) */
  proof: string
  /** Additional method-specific fields */
  metadata?: Record<string, unknown>
}
```

### `TempoPaymentHandler` (USDC on Tempo)

Primary payment method. Sub-cent fees, instant settlement.

```typescript
import { TempoPaymentHandler } from '@atlas/client'

const handler = new TempoPaymentHandler({
  /** Private key for signing USDC transfers */
  privateKey: string
  /** Tempo RPC endpoint. Default: mainnet */
  rpcUrl?: string
  /** Max gas price in gwei. Default: 50 */
  maxGasPrice?: number
})
```

### `StripePaymentHandler` (Cards + Wallets via SPTs)

For agents whose users pay with traditional payment methods.

```typescript
import { StripePaymentHandler } from '@atlas/client'

const handler = new StripePaymentHandler({
  /**
   * Callback to create a Stripe Payment Token (SPT).
   * The SDK provides the amount + currency; you return the token
   * from your Stripe integration (client-side or server-side).
   */
  createToken: async (amount: number, currency: string) => {
    // Your Stripe integration here
    return 'spt_xxx'
  }
})
```

### `LightningPaymentHandler` (Bitcoin Lightning)

For agents operating in the Bitcoin ecosystem.

```typescript
import { LightningPaymentHandler } from '@atlas/client'

const handler = new LightningPaymentHandler({
  /** Lightning node REST endpoint */
  nodeUrl: string
  /** Macaroon for authentication */
  macaroon: string
})
```

### Custom Payment Handler

Implement the `PaymentHandler` interface to support any payment method:

```typescript
import type { PaymentHandler, PaymentChallenge, PaymentCredential } from '@atlas/client'

class SolanaPaymentHandler implements PaymentHandler {
  method = 'solana_usdc' as const

  async handleChallenge(challenge: PaymentChallenge): Promise<PaymentCredential> {
    // 1. Build a USDC transfer on Solana
    // 2. Sign and submit the transaction
    // 3. Return the proof
    return {
      method: this.method,
      proof: transactionSignature,
      metadata: { slot: confirmedSlot },
    }
  }
}
```

---

## Auto-402 Handling

The 402 flow is fully transparent to the calling agent. Here is what happens internally:

```
Agent calls atlas.purchase(...)
  │
  ├─ SDK POSTs to Atlas purchase endpoint
  │
  ├─ Atlas responds 402 Payment Required
  │   Headers:
  │     X-Payment-Amount: 25.00
  │     X-Payment-Currency: USDC
  │     X-Payment-Recipient: 0xabc...
  │     X-Payment-Nonce: n_xxx
  │     X-Payment-Expires: 2026-03-19T12:00:00Z
  │
  ├─ SDK extracts challenge, calls paymentHandler.handleChallenge()
  │
  ├─ Payment handler signs transfer, returns credential
  │
  ├─ SDK retries POST with credential in X-Payment-Credential header
  │
  └─ Atlas verifies payment on-chain, returns PurchaseReceipt
```

The agent code sees none of this — it just awaits `atlas.purchase()` and gets a receipt.

### Hold Expiry Recovery

If the payment takes too long and the hold expires, the SDK:

1. Detects the `410 Gone` response (hold expired)
2. Requests a new hold from Atlas
3. Calls the payment handler again with the new challenge
4. Retries the purchase

This is also transparent — the agent only sees a slightly longer `purchase()` call.

---

## Streaming: Real-Time Availability

Subscribe to availability changes for an event via Server-Sent Events (SSE):

```typescript
const subscription = atlas.subscribe(event.id, {
  onAvailabilityChange(update) {
    console.log(`${update.ticketType}: ${update.available} remaining`)
  },
  onSoldOut(ticketTypeId) {
    console.log(`${ticketTypeId} sold out`)
  },
  onError(error) {
    console.error('Stream error:', error)
  },
})

// Later:
subscription.unsubscribe()
```

```typescript
interface Subscription {
  unsubscribe(): void
}

interface AvailabilityHandler {
  onAvailabilityChange?: (update: AvailabilityUpdate) => void
  onSoldOut?: (ticketTypeId: string) => void
  onPriceChange?: (update: PriceChangeUpdate) => void
  onError?: (error: AtlasError) => void
}

interface AvailabilityUpdate {
  ticketType: string
  available: number | null
  timestamp: string
}

interface PriceChangeUpdate {
  ticketType: string
  oldPrice: { amount: number; currency: string }
  newPrice: { amount: number; currency: string }
  timestamp: string
}
```

---

## Caching

The SDK caches platform manifests (which platforms are in the registry) and optionally caches search results.

```typescript
const atlas = new AtlasClient({
  registryUrl: 'https://registry.atlas.events',
  cache: {
    /** Cache platform manifests. Default: true, TTL: 1 hour */
    manifests: true,
    manifestTtl: 3600_000,

    /** Cache search results. Default: false (results change frequently) */
    search: false,
    searchTtl: 60_000,

    /** Custom cache store (default: in-memory LRU) */
    store: customCacheStore,
  },
})
```

### Custom Cache Store

```typescript
interface CacheStore {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown, ttl: number): Promise<void>
  delete(key: string): Promise<void>
}
```

Implement this interface to use Redis, SQLite, or any other backing store.

---

## Error Handling

```typescript
import { AtlasError, HoldExpiredError, PaymentFailedError, SoldOutError } from '@atlas/client'

try {
  const receipt = await atlas.purchase(event.id, purchaseParams)
} catch (error) {
  if (error instanceof SoldOutError) {
    // Ticket type sold out between search and purchase
    // error.alternatives contains other available ticket types
    console.log('Sold out. Alternatives:', error.alternatives)
  } else if (error instanceof PaymentFailedError) {
    // Payment handler failed (insufficient funds, network error, etc.)
    // SDK already retried per retry config
    console.log('Payment failed:', error.reason)
  } else if (error instanceof HoldExpiredError) {
    // Hold expired and SDK could not recover
    console.log('Hold expired. Retry the purchase.')
  } else if (error instanceof AtlasError) {
    // Generic Atlas error
    console.log(`Atlas error ${error.code}: ${error.message}`)
  }
}
```

### Error Codes

| Code | Meaning | Recommended Action |
|------|---------|-------------------|
| `SOLD_OUT` | No tickets available | Check `error.alternatives` for other ticket types |
| `HOLD_EXPIRED` | Payment window closed | Retry `purchase()` — a new hold will be created |
| `PAYMENT_FAILED` | Payment could not be completed | Check funds/balance, retry |
| `PAYMENT_TIMEOUT` | Payment handler did not respond in time | Check network, retry |
| `INVALID_ATTENDEE` | Attendee data validation failed | Fix attendee fields |
| `QUANTITY_EXCEEDED` | Exceeds per-order limit | Reduce quantity |
| `QUOTE_EXPIRED` | Price quote is no longer valid | Call `getTicketPrice()` again |
| `EVENT_CANCELLED` | Event was cancelled | No action possible |
| `RATE_LIMITED` | Too many requests | Back off, respect `Retry-After` header |
| `UNAUTHORIZED` | Invalid or missing API key | Check `apiKey` configuration |

### Retry Configuration

```typescript
const atlas = new AtlasClient({
  retry: {
    /** Max retries for transient failures. Default: 3 */
    maxRetries: 3,
    /** Base delay in ms (exponential backoff). Default: 1000 */
    baseDelay: 1000,
    /** Max delay in ms. Default: 10000 */
    maxDelay: 10000,
    /** Which errors to retry. Default: network errors + 429 + 5xx */
    retryOn: ['NETWORK_ERROR', 'RATE_LIMITED', 'SERVER_ERROR'],
  },
})
```

---

## TypeScript Types

All Atlas schemas are fully typed and exported:

```typescript
import type {
  // Client
  AtlasClientOptions,
  CacheOptions,
  RetryOptions,

  // Events
  AtlasEvent,
  EventCategory,
  SearchParams,
  SearchResult,

  // Tickets
  TicketType,
  PriceParams,
  PriceQuote,

  // Purchase
  PurchaseParams,
  PurchaseReceipt,
  TicketCredential,
  Attendee,

  // Payments
  PaymentHandler,
  PaymentChallenge,
  PaymentCredential,
  PaymentMethod,

  // Streaming
  Subscription,
  AvailabilityHandler,
  AvailabilityUpdate,
  PriceChangeUpdate,

  // Errors
  AtlasError,
  SoldOutError,
  PaymentFailedError,
  HoldExpiredError,
} from '@atlas/client'
```

---

## Environment Variables

The SDK reads these environment variables as defaults (all overridable via constructor options):

| Variable | Purpose | Default |
|----------|---------|---------|
| `ATLAS_REGISTRY_URL` | Registry endpoint | `https://registry.atlas.events` |
| `ATLAS_API_KEY` | API key for authenticated access | — |
| `ATLAS_AGENT_ID` | Agent identity for attribution | — |
| `TEMPO_PRIVATE_KEY` | Private key for TempoPaymentHandler | — |
| `TEMPO_RPC_URL` | Tempo RPC endpoint | mainnet |

---

## Versioning and Compatibility

- SDK follows semver. Major versions indicate breaking API changes.
- The SDK negotiates protocol versions with the Atlas Registry automatically.
- Minimum supported Node.js: 18.
- Browser support: ESM build available, but payment handlers that use private keys should only run server-side.
