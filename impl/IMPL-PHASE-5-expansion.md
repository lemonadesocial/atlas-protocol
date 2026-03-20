# IMPL-PHASE-5-EXPANSION: Multi-Chain + Additional Connectors + Tier Limits

**Produced by:** Bridge Agent
**Date:** March 19, 2026
**Source:** Atlas Protocol UNIFIED-STRATEGY.md Phase 5
**Status:** READY FOR LEAD ROUTING

## Execution Status
| Field | Value |
|-------|-------|
| **Stage** | `IMPL: READY` |
| **Progress** | 0/11 work packages |
| **Assigned to** | Pending Lead Agent routing |
| **PRs** | None yet |
| **Blocked by** | None |
| **Karen Review** | Pending |
| **Last updated** | 2026-03-19 |

---

## Overview

Phase 5 delivers three capabilities:

1. **Multi-chain expansion** — Add Arbitrum, Polygon, Optimism, ZKSync as Atlas payment options; add Solana USDC as Atlas payment
> **AUDIT FIX [P5-C5]:** Updated from 4 connectors to 5 (added Meetup).
2. **Additional event source connectors** — Meetup, Dice, Resident Advisor, Generic Webhook, Generic API connectors
3. **Connector tier limits** — Enforce connector slot limits per subscription tier (Free=1, Pro=2, Plus=4, Max=6, Enterprise=unlimited)

All three streams are independent and can be worked in parallel.

---

## Part A: Multi-Chain Expansion

### WP-1: New Chain Documents (MongoDB Seed/Migration)

**Repo:** lemonade-backend
**Depends on:** Nothing
**Effort:** 1-2 hours

Add chain documents to the `chains` collection. The `Chain` model already supports all required fields (verified at `lemonade-backend/src/app/models/chain.ts:50-284`).

Create a migration file at `src/db/migrations/<timestamp>-add-atlas-evm-chains.ts`:

```typescript
// Migration: add Arbitrum, Polygon, Optimism, ZKSync chains
// Pattern: see existing chain documents in the chains collection

const NEW_CHAINS = [
  {
    active: true,
    platform: 'ethereum',
    chain_id: '42161',
    name: 'Arbitrum One',
    code_name: 'arbitrum',
    rpc_url: 'https://arb1.arbitrum.io/rpc',
    block_explorer_url: 'https://arbiscan.io',
    block_explorer_name: 'Arbiscan',
    block_explorer_for_tx: '/tx/',
    block_explorer_for_token: '/token/',
    block_explorer_for_address: '/address/',
    block_time: 1,
    safe_confirmations: 64,
    tokens: [
      {
        active: true,
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // native USDC on Arbitrum
        is_native: false,
      },
    ],
  },
  {
    active: true,
    platform: 'ethereum',
    chain_id: '137',
    name: 'Polygon PoS',
    code_name: 'polygon',
    rpc_url: 'https://polygon-rpc.com',
    block_explorer_url: 'https://polygonscan.com',
    block_explorer_name: 'PolygonScan',
    block_explorer_for_tx: '/tx/',
    block_explorer_for_token: '/token/',
    block_explorer_for_address: '/address/',
    block_time: 2,
    safe_confirmations: 128,
    tokens: [
      {
        active: true,
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // native USDC on Polygon
        is_native: false,
      },
    ],
  },
  {
    active: true,
    platform: 'ethereum',
    chain_id: '10',
    name: 'Optimism',
    code_name: 'optimism',
    rpc_url: 'https://mainnet.optimism.io',
    block_explorer_url: 'https://optimistic.etherscan.io',
    block_explorer_name: 'Optimism Explorer',
    block_explorer_for_tx: '/tx/',
    block_explorer_for_token: '/token/',
    block_explorer_for_address: '/address/',
    block_time: 2,
    safe_confirmations: 10,
    tokens: [
      {
        active: true,
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        contract: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // native USDC on Optimism
        is_native: false,
      },
    ],
  },
  {
    active: true,
    platform: 'ethereum',
    chain_id: '324',
    name: 'ZKSync Era',
    code_name: 'zksync',
    rpc_url: 'https://mainnet.era.zksync.io',
    block_explorer_url: 'https://explorer.zksync.io',
    block_explorer_name: 'ZKSync Explorer',
    block_explorer_for_tx: '/tx/',
    block_explorer_for_token: '/token/',
    block_explorer_for_address: '/address/',
    block_time: 1,
    safe_confirmations: 1, // ZK proofs provide finality
    tokens: [
      {
        active: true,
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
> **AUDIT FIX [P5-H1]:** Updated ZKSync USDC address from bridged USDC.e (`0x1d17...`) to native Circle-issued USDC.
        contract: '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4', // native USDC on ZKSync Era
        is_native: false,
      },
    ],
  },
];
```

**Verification:** After migration, `ChainModel.find({ active: true })` should return the new chains alongside existing ones (Base, Tempo, Ethereum mainnet, etc.).

**Note:** USDC contract addresses above are the **native USDC** (Circle-issued) contracts, NOT bridged versions. Verify against https://www.circle.com/en/usdc-multichain before deploying to production.

---

### WP-2: Solana as Atlas Payment Option

**Repo:** lemonade-backend
**Depends on:** Nothing (existing Solana infra is ready)
**Effort:** 2-3 days

Lemonade already has Solana payment account support:
- `PaymentAccountType.solana` exists at `lemonade-backend/src/app/models/new-payment-account.ts:10`
- `SolanaAccount extends BlockchainAccount` at line 98-99 (has `address`, `network`, `currencies`)
- `BlockchainPlatform.solana` exists at `lemonade-backend/src/app/models/chain.ts:11`

**What to build:**

#### 2a. Solana USDC Chain Document

Add to the same migration as WP-1 (or separate if routed to a different agent):

```typescript
{
  active: true,
  platform: 'solana',
  chain_id: 'solana-mainnet', // Solana uses string identifiers, not numeric
  name: 'Solana',
  code_name: 'solana',
  rpc_url: 'https://api.mainnet-beta.solana.com',
  block_explorer_url: 'https://solscan.io',
  block_explorer_name: 'Solscan',
  block_explorer_for_tx: '/tx/',
  block_explorer_for_token: '/token/',
  block_explorer_for_address: '/account/',
  block_time: 0.4,
  safe_confirmations: 32, // finalized commitment level
  tokens: [
    {
      active: true,
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC SPL token mint
      is_native: false,
    },
  ],
}
```

#### 2b. Atlas Payment Verification Service for Solana

Solana payment verification differs from EVM chains. EVM uses EIP-712 typed data and `eth_getTransactionReceipt`. Solana uses SPL token transfers verified via the Solana JSON-RPC API.

**New file:** `src/app/services/atlas/solana-payment-verifier.ts`

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

interface SolanaPaymentVerification {
  txSignature: string;
  expectedAmount: bigint;    // in USDC minor units (6 decimals)
  expectedMint: string;      // USDC SPL mint address
  expectedRecipient: string; // Space's Solana wallet address
  rpcUrl: string;
}

interface VerificationResult {
  verified: boolean;
  error?: string;
  blockTime?: number;
}

> **AUDIT FIX [P5-H2]:** Changed Solana commitment from `confirmed` to `finalized` — confirmed txs can be reverted. Matches `safe_confirmations: 32` in chain doc.
> **AUDIT FIX [P5-H3]:** Added replay protection — check tx signature uniqueness against existing payment records before accepting.
export async function verifySolanaPayment(
  params: SolanaPaymentVerification,
): Promise<VerificationResult> {
  // Replay protection: reject if this tx signature was already used for another payment
  const existingPayment = await NewPaymentModel.findOne({
    'transfer_metadata.tx_hash': params.txSignature,
  }).lean();
  if (existingPayment) {
    return { verified: false, error: 'Transaction signature already used for a previous payment' };
  }

  const connection = new Connection(params.rpcUrl, 'finalized');

  const tx = await connection.getParsedTransaction(params.txSignature, {
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  });

  if (!tx || !tx.meta) {
    return { verified: false, error: 'Transaction not found or not confirmed' };
  }

  if (tx.meta.err) {
    return { verified: false, error: 'Transaction failed on-chain' };
  }

  // Find the SPL token transfer instruction matching our expected parameters
  const instructions = tx.transaction.message.instructions;
  const innerInstructions = tx.meta.innerInstructions ?? [];

  // Check pre/post token balances for the recipient's associated token account
  const recipientAta = await getAssociatedTokenAddress(
    new PublicKey(params.expectedMint),
    new PublicKey(params.expectedRecipient),
  );

  const preBalance = tx.meta.preTokenBalances?.find(
    (b) => b.mint === params.expectedMint && b.owner === params.expectedRecipient,
  );
  const postBalance = tx.meta.postTokenBalances?.find(
    (b) => b.mint === params.expectedMint && b.owner === params.expectedRecipient,
  );

  const preAmount = BigInt(preBalance?.uiTokenAmount.amount ?? '0');
  const postAmount = BigInt(postBalance?.uiTokenAmount.amount ?? '0');
  const received = postAmount - preAmount;

  if (received < params.expectedAmount) {
    return {
      verified: false,
      error: `Received ${received.toString()} but expected ${params.expectedAmount.toString()}`,
    };
  }

  return { verified: true, blockTime: tx.blockTime ?? undefined };
}
```

**Dependencies:** `@solana/web3.js`, `@solana/spl-token` (check if already in package.json — Lemonade has existing Solana infra).

#### 2c. Atlas 402 Challenge — Solana Payment Method

The Atlas 402 challenge response (from Phase 2) must include Solana as a payment option. The challenge format for Solana differs from EVM:

```typescript
// Add to the Atlas challenge builder service
// EVM challenge uses: { chainId, contractAddress, amount, recipientAddress, tokenAddress }
// Solana challenge uses:

interface SolanaAtlasPaymentOption {
  method: 'solana_usdc';
  network: 'solana-mainnet';
  mint: string;              // USDC SPL token mint address
  recipient: string;         // Space owner's Solana wallet address
  amount: string;            // Amount in minor units (6 decimals)
  label: string;             // "Pay 25.00 USDC on Solana"
}
```

**Key difference from EVM:** No EIP-712 typed data signature. Payment is a standard SPL token transfer. Verification checks the transaction's token balance changes rather than event log decoding.

**Existing file to modify:** The Atlas purchase endpoint (from Phase 2) — add `solana_usdc` to the accepted payment method enum and route to `verifySolanaPayment()` for verification.

---

### WP-3: Per-Space Payment Method Configuration

**Repo:** lemonade-backend
**Depends on:** WP-1, WP-2
**Effort:** 1-2 days

Spaces already have `payment_accounts` (verified at `lemonade-backend/src/app/models/space.ts:179`). The Atlas purchase endpoint must dynamically construct the 402 challenge based on which payment accounts the Space has configured.

**Logic:**

```typescript
// In the Atlas challenge builder:
async function buildAtlasPaymentOptions(spaceId: ObjectId): Promise<PaymentOption[]> {
  const space = await SpaceModel.findById(spaceId)
    .populate('payment_accounts')
    .lean();

  const options: PaymentOption[] = [];

  for (const account of space.payment_accounts ?? []) {
    const pa = account as NewPaymentAccount;

    if (pa.type === PaymentAccountType.ethereum && pa.active) {
      const ethAccount = pa.account_info as EthereumAccount;
      // Look up chain to get USDC contract address
      const chain = await ChainModel.findOne({ chain_id: ethAccount.network, active: true }).lean();
      const usdcToken = chain?.tokens?.find((t) => t.symbol === 'USDC' && t.active);

      if (chain && usdcToken) {
        options.push({
          method: `${chain.code_name}_usdc`, // e.g., 'arbitrum_usdc', 'polygon_usdc'
          chainId: chain.chain_id,
          tokenAddress: usdcToken.contract,
          recipientAddress: ethAccount.address,
          amount: '<calculated_amount>',
          decimals: usdcToken.decimals,
          label: `Pay on ${chain.name}`,
        });
      }
    }

    if (pa.type === PaymentAccountType.solana && pa.active) {
      const solAccount = pa.account_info as SolanaAccount;
      options.push({
        method: 'solana_usdc',
        network: 'solana-mainnet',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        recipient: solAccount.address,
        amount: '<calculated_amount>',
        label: 'Pay on Solana',
      });
    }
  }

  return options;
}
```

**Files to modify:**
- Atlas purchase endpoint (Phase 2) — replace hardcoded payment methods with dynamic `buildAtlasPaymentOptions()`
- Atlas payment verification router — add routing for `solana_usdc` to `verifySolanaPayment()`

---

## Part B: Additional Connectors

All connectors follow the `ConnectorPlugin` interface defined at `lemonade-backend/src/app/models/types/connector-plugin.ts:106-129`. Reference implementation: `lemonade-backend/src/connectors/google-sheets/index.ts`.

Registration pattern (at `lemonade-backend/src/connectors/index.ts:72-73`):
```typescript
register(GoogleSheetsConnector);
register(AirtableConnector);
// Add new connectors here
```

### WP-4: Meetup Connector (moved from Phase 1)

**Repo:** lemonade-backend
**Depends on:** Nothing (ExternalEventMapping model and event-sync-utils.ts already exist from Phase 1)
**Effort:** 2-3 days

> **Why deferred from Phase 1:** Meetup is mostly free events behind a Meetup Pro API paywall ($200/yr for organizers to get API access). Eventbrite + Lu.ma cover higher-value segments for launch. Meetup is still valuable for community/recurring event inventory.

**New directory:** `src/connectors/meetup/`

**API reference:** Meetup GraphQL API (`https://api.meetup.com/gql`)

**Auth:** OAuth2 (no PKCE)
- Authorization URL: `https://secure.meetup.com/oauth2/authorize`
- Token URL: `https://secure.meetup.com/oauth2/access`
- Scopes: `event_management`, `rsvp`
- Meetup issues refresh tokens with **1-hour expiry** on access tokens. The `refreshToken` method MUST be implemented.

**Documented limitation:** Organizers need **Meetup Pro** ($200/yr) for API access. This should be noted in the connector description and in the Space settings UI when connecting.

**Config vars to add to `src/config/index.ts`:**
```typescript
export const meetupClientId = env.get('MEETUP_CLIENT_ID').asString();
export const meetupClientSecret = env.get('MEETUP_CLIENT_SECRET').asString();
```

**Manifest:**
```typescript
manifest: {
  id: 'meetup',
  name: 'Meetup',
  description: 'Import events, RSVPs, and ticket types from Meetup groups. Requires Meetup Pro API access ($200/yr).',
  icon: 'meetup',
  category: 'events',
  authType: 'oauth2',
  oauthConfig: {
    authorizationUrl: 'https://secure.meetup.com/oauth2/authorize',
    tokenUrl: 'https://secure.meetup.com/oauth2/access',
    scopes: ['event_management', 'rsvp'],
    pkce: false,
  },
  capabilities: ['canImport', 'canSync'],
  configSchema: [
    {
      key: 'groupUrlname',
      label: 'Meetup Group',
      type: 'select',
      required: true,
      fetchOptions: 'listGroups',
    },
  ],
},
```

**Actions:**

| Action ID | Name | triggerTypes | Description |
|-----------|------|-------------|-------------|
| `sync-events` | Sync Events | `['manual', 'scheduled', 'ai']` | Fetches upcoming and recent events from the connected Meetup group. |
| `sync-rsvps` | Sync RSVPs | `['manual', 'scheduled', 'ai']` | Imports RSVPs from a specific Meetup event. |
| `sync-ticket-types` | Sync Ticket Types | `['manual', 'ai']` | Imports event fee/ticket info as Lemonade ticket types. |
| `list-events` | List Meetup Events | `['ai']` | Lists events without syncing. |

**Key GraphQL Queries:**

List groups (for `fetchConfigOptions`):
```graphql
query {
  self {
    groupMemberships(input: { first: 50 }) {
      edges { node { group { urlname, name }, role } }
    }
  }
}
```
Filter to roles `ORGANIZER` or `COORGANIZER`.

List events:
```graphql
query ($urlname: String!) {
  groupByUrlname(urlname: $urlname) {
    upcomingEvents(input: { first: 50 }) {
      edges {
        node {
          id, title, description, dateTime, endTime, duration, eventUrl, imageUrl,
          eventType, onlineVenue { url },
          venue { name, address, city, state, postalCode, country, lat, lng },
          feeSettings { amount, currency, accepts },
          rsvpSettings { rsvpLimit }
        }
      }
      pageInfo { hasNextPage, endCursor }
    }
  }
}
```

List RSVPs:
```graphql
query ($eventId: ID!) {
  event(id: $eventId) {
    rsvps(input: { first: 100 }) {
      edges { node { id, status, member { id, name, email } } }
      pageInfo { hasNextPage, endCursor }
    }
  }
}
```

**Rate limits:** 200 requests/hour per OAuth token. Implement 500ms delay between GraphQL queries.

**Null-email handling (CRITICAL):** Meetup's GraphQL API may NOT return member emails unless the user has opted in. The connector MUST:
- Skip attendees where email is null/undefined
- Track skipped count in a `skippedNoEmail` counter
- Include in ActionResult message: `"Synced 42 attendees, skipped 8 (no email — Meetup privacy settings)"`
- Log skipped attendees at `debug` level with Meetup username
- Do NOT create EventJoinRequest or Ticket records without an email

**Meetup-to-NormalizedEvent mapping:**
```typescript
function normalizeMeetupEvent(node: MeetupEventNode): NormalizedEvent {
  const endTime = node.endTime
    ? new Date(node.endTime)
> **AUDIT FIX [P5-M4]:** Meetup GraphQL API returns `duration` in milliseconds. Changed from `* 60000` (assumed minutes) to direct use. Implementer MUST verify from Meetup API docs: if seconds, use `* 1000`; if ms, use directly.
    : new Date(new Date(node.dateTime).getTime() + (node.duration ? node.duration : 7200000));
  return {
    externalId: node.id,
    title: node.title,
    description: node.description,  // Meetup returns HTML
    start: new Date(node.dateTime),
    end: endTime,
    coverUrl: node.imageUrl,
    virtual: node.eventType === 'ONLINE',
    virtualUrl: node.onlineVenue?.url,
    address: node.venue ? {
      street_1: node.venue.address, city: node.venue.city, region: node.venue.state,
      postal: node.venue.postalCode, country: node.venue.country,
      latitude: node.venue.lat, longitude: node.venue.lng, title: node.venue.name,
    } : undefined,
    externalUrl: node.eventUrl,
    currency: node.feeSettings?.currency,
  };
}
```

**TypeScript interfaces:**
```typescript
interface MeetupVenue { name?: string; address?: string; city?: string; state?: string; postalCode?: string; country?: string; lat?: number; lng?: number; }
interface MeetupOnlineVenue { url?: string; }
interface MeetupFeeSettings { amount: number; currency: string; accepts: string; }
interface MeetupRsvpSettings { rsvpLimit?: number; }
interface MeetupEventNode { id: string; title: string; description?: string; dateTime: string; endTime?: string; duration?: number; eventUrl: string; imageUrl?: string; eventType: string; venue?: MeetupVenue; onlineVenue?: MeetupOnlineVenue; feeSettings?: MeetupFeeSettings; rsvpSettings?: MeetupRsvpSettings; }
interface MeetupRsvpNode { id: string; status: string; member: { id: string; name?: string; email?: string; }; }
interface MeetupPageInfo { hasNextPage: boolean; endCursor?: string; }
interface MeetupConnection<T> { edges: { node: T }[]; pageInfo: MeetupPageInfo; }
```

**Frontend:** Add `meetup: \`${ASSET_PREFIX}/assets/images/connectors/connector-meetup.png\`` to `CONNECTOR_ICON_MAP` and source the Meetup red "M" swirl icon.

> **AUDIT FIX [P5-M5]:** Added requirement to include 'meetup' in the scheduled sync job's connectorType filter.

**Registration:** Add `register(MeetupConnector)` in `src/connectors/index.ts`. Add `MEETUP_CLIENT_ID` and `MEETUP_CLIENT_SECRET` env vars to `src/config/index.ts`. **Also add `'meetup'` to the `connectorType.$in` array in the existing `connector-sync.ts` scheduled job** (at `src/app/jobs/connector-sync.ts`) so Meetup connections are included in automated sync runs.

---

### WP-5: Dice Connector

**Repo:** lemonade-backend
**Depends on:** Nothing
**Effort:** 2-3 days

Dice (dice.fm) is a music/nightlife events platform. Their API is not publicly documented but provides partner/promoter endpoints.

**New directory:** `src/connectors/dice/`

**Files:**
- `src/connectors/dice/index.ts` — main ConnectorPlugin implementation
- `src/connectors/dice/types.ts` — Dice API response types
- `src/connectors/dice/api.ts` — Dice API client wrapper

```typescript
// src/connectors/dice/index.ts
import { type ConnectorPlugin } from '..';

const DiceConnector: ConnectorPlugin = {
  manifest: {
    id: 'dice',
    name: 'Dice',
    description: 'Sync events and attendees from Dice (dice.fm) — music and nightlife events.',
    icon: 'dice',
    category: 'events',
    authType: 'api_key', // Dice uses partner API keys
    capabilities: ['canImport', 'canSync'],
    webhookEvents: [],
    configSchema: [
      {
        key: 'promoter_id',
        label: 'Promoter ID',
        type: 'text',
        required: true,
      },
    ],
  },

  actions: [
    {
      id: 'sync-events',
      name: 'Sync Events',
      description: 'Import events from your Dice promoter account into this Space.',
      inputSchema: [
        { name: 'from_date', type: 'string', description: 'Start date (ISO 8601)', required: false },
        { name: 'to_date', type: 'string', description: 'End date (ISO 8601)', required: false },
      ],
      outputType: 'confirmation',
      triggerTypes: ['manual', 'scheduled', 'ai'],
      requiredCapabilities: ['canImport'],
    },
    {
      id: 'sync-attendees',
      name: 'Sync Attendees',
      description: 'Import attendee list from a Dice event.',
      inputSchema: [
        { name: 'eventId', type: 'string', description: 'Lemonade event ID to sync attendees into', required: true },
        { name: 'diceEventId', type: 'string', description: 'Dice event ID to pull attendees from', required: true },
      ],
      outputType: 'confirmation',
      triggerTypes: ['manual', 'ai'],
      requiredCapabilities: ['canImport'],
    },
  ],

  // OAuth methods — Dice uses API key auth, so these are no-ops
  getAuthUrl(): string { throw new Error('Dice uses API key auth, not OAuth'); },
  async handleCallback(): Promise<never> { throw new Error('Dice uses API key auth, not OAuth'); },
  async refreshToken(): Promise<never> { throw new Error('Dice uses API key auth, not OAuth'); },
  async revokeToken(): Promise<void> { /* API key — nothing to revoke */ },

  async executeAction(actionId, params, context) {
    const apiKey = context.credentials.apiKey;
    if (!apiKey) return { success: false, error: 'No API key available' };
    const promoterId = context.config.promoter_id as string;
    if (!promoterId) return { success: false, error: 'Promoter ID not configured' };

    if (actionId === 'sync-events') {
      return syncDiceEvents(apiKey, promoterId, params, context);
    }
    if (actionId === 'sync-attendees') {
      return syncDiceAttendees(apiKey, params, context);
    }

    return { success: false, error: `Unknown action: ${actionId}` };
  },
};

export default DiceConnector;
```

**Note on Dice API:** If Dice does not offer a public API, the implementing agent should:
1. Check https://developers.dice.fm or https://dice.fm/partners for current API docs
2. If no API is available, implement as a webhook-based connector instead (Dice sends event data to our webhook endpoint)
3. Document the API status in the PR description

---

### WP-6: Resident Advisor Connector

**Repo:** lemonade-backend
**Depends on:** Nothing
**Effort:** 2-3 days

Resident Advisor (ra.co) is the primary platform for electronic music events. RA has historically not provided a public API; they operate a GraphQL endpoint at `https://ra.co/graphql` that powers their frontend.

**New directory:** `src/connectors/resident-advisor/`

```typescript
// src/connectors/resident-advisor/index.ts
import { type ConnectorPlugin } from '..';

const ResidentAdvisorConnector: ConnectorPlugin = {
  manifest: {
    id: 'resident-advisor',
    name: 'Resident Advisor',
    description: 'Sync electronic music events from Resident Advisor (ra.co).',
    icon: 'resident-advisor',
    category: 'events',
    authType: 'api_key', // RA promoter access token or scraping approach
    capabilities: ['canImport', 'canSync'],
    webhookEvents: [],
    configSchema: [
      {
        key: 'promoter_url',
        label: 'Promoter Page URL',
        type: 'text',
        required: true,
        // e.g., https://ra.co/promoters/12345
      },
      {
        key: 'region',
        label: 'Region',
        type: 'select',
        required: false,
        fetchOptions: 'listRegions',
      },
    ],
  },

  actions: [
    {
      id: 'sync-events',
      name: 'Sync Events',
      description: 'Import upcoming events from your Resident Advisor promoter page.',
      inputSchema: [
        { name: 'from_date', type: 'string', description: 'Start date (ISO 8601)', required: false },
        { name: 'limit', type: 'number', description: 'Max events to import (default: 50)', required: false },
      ],
      outputType: 'confirmation',
      triggerTypes: ['manual', 'scheduled', 'ai'],
      requiredCapabilities: ['canImport'],
    },
  ],

  getAuthUrl(): string { throw new Error('RA uses API key auth'); },
  async handleCallback(): Promise<never> { throw new Error('RA uses API key auth'); },
  async refreshToken(): Promise<never> { throw new Error('RA uses API key auth'); },
  async revokeToken(): Promise<void> {},

  async fetchConfigOptions(optionKey, _credentials) {
    if (optionKey === 'listRegions') {
      // Static list of RA regions
      return [
        { value: 'berlin', label: 'Berlin' },
        { value: 'london', label: 'London' },
        { value: 'amsterdam', label: 'Amsterdam' },
        { value: 'new-york', label: 'New York' },
        { value: 'los-angeles', label: 'Los Angeles' },
        { value: 'ibiza', label: 'Ibiza' },
        { value: 'tokyo', label: 'Tokyo' },
        { value: 'paris', label: 'Paris' },
      ];
    }
    return [];
  },

  async executeAction(actionId, params, context) {
    if (actionId === 'sync-events') {
      return syncRAEvents(params, context);
    }
    return { success: false, error: `Unknown action: ${actionId}` };
  },
};

export default ResidentAdvisorConnector;
```

> **AUDIT FIX [P5-M6]:** Flagged legal review as a prerequisite for the reverse-engineering approach. RA's internal API is undocumented and may violate their ToS.

**PREREQUISITE: Legal review MUST be completed before implementing options 2 or 3 below.** Reverse-engineering RA's internal GraphQL API or scraping their pages may violate RA's Terms of Service. Obtain legal sign-off before proceeding with any approach other than an official API partnership.

**Implementation strategy for RA data access:**
1. **Preferred:** Check if RA offers a promoter API (contact RA partnerships). If yes, use it.
2. **Fallback (REQUIRES LEGAL REVIEW):** RA's internal GraphQL endpoint (`ra.co/graphql`) can be queried for public event data. The implementing agent should reverse-engineer the query format from RA's frontend network requests.
3. **Last resort (REQUIRES LEGAL REVIEW):** Structured HTML parsing of public promoter pages. Use a headless approach or server-side fetch with cheerio.

**The implementing agent must document which approach was used and any rate-limiting considerations.**

---

### WP-7: Generic Webhook Connector

**Repo:** lemonade-backend
**Depends on:** Nothing
**Effort:** 3-4 days

The most powerful connector — allows ANY platform with outgoing webhooks to push event data into Lemonade. The user configures a field mapping that translates incoming JSON to Lemonade Event fields.

**New directory:** `src/connectors/generic-webhook/`

```typescript
// src/connectors/generic-webhook/index.ts
import { type ConnectorPlugin, type ActionContext, type ActionResult } from '..';

// Field mapping defines how to extract Lemonade event fields from incoming JSON
interface FieldMapping {
  title: string;          // JSON path, e.g., "event.name" or "data.title"
  description?: string;   // JSON path
  start_date: string;     // JSON path — value must be ISO 8601 or Unix timestamp
  end_date?: string;      // JSON path
  location_name?: string; // JSON path
  location_address?: string;
  image_url?: string;     // JSON path
  external_id: string;    // JSON path — unique identifier from source platform
  external_url?: string;  // JSON path
}

const GenericWebhookConnector: ConnectorPlugin = {
  manifest: {
    id: 'generic-webhook',
    name: 'Webhook',
    description: 'Receive events from any platform that supports outgoing webhooks. Configure a field mapping to translate incoming data.',
    icon: 'webhook',
    category: 'events',
    authType: 'api_key', // The "API key" is the webhook secret for signature verification
    capabilities: ['canImport', 'canWebhook'],
    webhookEvents: ['event.created', 'event.updated', 'event.deleted'],
    configSchema: [
      {
        key: 'webhook_secret',
        label: 'Webhook Secret (for signature verification)',
        type: 'text',
        required: false,
      },
      {
        key: 'signature_header',
        label: 'Signature Header Name',
        type: 'text',
        required: false,
        // e.g., "X-Webhook-Signature", "X-Hub-Signature-256"
      },
      {
        key: 'signature_algorithm',
        label: 'Signature Algorithm',
        type: 'select',
        required: false,
        fetchOptions: 'listSignatureAlgorithms',
      },
      {
        key: 'field_mapping',
        label: 'Field Mapping (JSON)',
        type: 'text', // UI renders as a JSON editor
        required: true,
        // Value is a JSON string of FieldMapping
      },
    ],
  },

  actions: [
    {
      id: 'receive-events',
      name: 'Receive Events',
      description: 'Triggered when the external platform sends a webhook. Automatically processes incoming event data.',
      inputSchema: [],
      outputType: 'confirmation',
      triggerTypes: ['webhook'],
      requiredCapabilities: ['canWebhook'],
    },
    {
      id: 'list-received',
      name: 'List Received Events',
      description: 'View events received via webhook that have been imported into this Space.',
      inputSchema: [
        { name: 'limit', type: 'number', description: 'Max results (default: 20)', required: false },
      ],
      outputType: 'data',
      triggerTypes: ['manual', 'ai'],
      requiredCapabilities: ['canImport'],
    },
  ],

  // Auth — webhook connector uses the auto-generated webhook secret on the Connection
  getAuthUrl(): string { throw new Error('Webhook connector does not use OAuth'); },
  async handleCallback(): Promise<never> { throw new Error('Webhook connector does not use OAuth'); },
  async refreshToken(): Promise<never> { throw new Error('Webhook connector does not use OAuth'); },
  async revokeToken(): Promise<void> {},

  async fetchConfigOptions(optionKey) {
    if (optionKey === 'listSignatureAlgorithms') {
      return [
        { value: 'hmac-sha256', label: 'HMAC-SHA256 (most common)' },
        { value: 'hmac-sha1', label: 'HMAC-SHA1' },
        { value: 'none', label: 'No signature verification' },
      ];
    }
    return [];
  },

  verifyWebhookSignature(payload: Buffer, signature: string, secret: string, config?: Record<string, unknown>): boolean {
    const crypto = require('crypto');
    // > **AUDIT FIX R3 [CC-6]:** Webhook signature verification now respects configured algorithm.
    // > Switch on config.signature_algorithm: 'hmac-sha256' → SHA-256, 'hmac-sha1' → SHA-1, 'none' → skip.
    // > Default to SHA-256 if not set.
    const algorithm = (config?.signature_algorithm as string) ?? 'hmac-sha256';
    if (algorithm === 'none') return true; // No signature verification configured
    let hashAlgo: string;
    switch (algorithm) {
      case 'hmac-sha1':
        hashAlgo = 'sha1';
        break;
      case 'hmac-sha256':
      default:
        hashAlgo = 'sha256';
        break;
    }
    const expected = crypto.createHmac(hashAlgo, secret).update(payload).digest('hex');
> **AUDIT FIX [P5-M3]:** Added length check before timingSafeEqual — throws on mismatched buffer lengths.
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  },

  async handleWebhook(event: string, payload: unknown, context: ActionContext): Promise<void> {
    // Parse the payload using the configured field_mapping
    const fieldMapping = JSON.parse(context.config.field_mapping as string) as FieldMapping;
    // Extract fields using JSON path resolution
    // Create or update Lemonade Event in the Space
    // ... (implementation detail for the executing agent)
  },

  async executeAction(actionId, params, context): Promise<ActionResult> {
    if (actionId === 'list-received') {
      return listReceivedEvents(params, context);
    }
    return { success: false, error: `Unknown action: ${actionId}` };
  },
};

export default GenericWebhookConnector;
```

**Key implementation details:**

1. **Webhook URL format:** When a user connects the webhook connector, they get a unique URL: `https://api.lemonade.social/webhooks/connectors/generic-webhook/<connectionId>`. This URL is displayed in the UI for the user to paste into their external platform's webhook settings.

> **AUDIT FIX [P5-M1]:** Added JSON path sanitization (block prototype pollution) and payload size limit.
2. **Field mapping resolver:** Implement a `resolveJsonPath(obj, path)` utility that extracts values from nested JSON. Support dot notation (`event.name`), bracket notation (`data['events'][0]`), and array indexing. **Security: Sanitize JSON paths — reject any path containing `__proto__`, `constructor`, or `prototype` segments. Add payload size limit of 1MB max — reject webhook payloads exceeding this before processing.**

3. **Event upsert logic:** Use `external_id` from the mapping to deduplicate. If an event with matching `external_id` + `spaceId` exists, update it; otherwise, create it.

4. **Webhook signature:** The `webhookSecret` field on the `Connection` model (`lemonade-backend/src/app/models/connection.ts:90`) is already auto-generated. Use it if no custom `webhook_secret` is in config.

---

### WP-8: Generic API Connector

**Repo:** lemonade-backend
**Depends on:** Nothing
**Effort:** 4-5 days (most complex connector)

A configurable REST or GraphQL adapter that can pull event data from any API. The user provides endpoint URLs, auth config, field mappings, and pagination settings.

**New directory:** `src/connectors/generic-api/`

```typescript
// src/connectors/generic-api/types.ts

export interface ApiAuthConfig {
  type: 'api_key' | 'bearer' | 'oauth2' | 'none';
  // For api_key:
  header_name?: string;     // e.g., "X-API-Key"
  key_prefix?: string;      // e.g., "Bearer " (if non-standard)
  // For oauth2:
  token_url?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
}

export interface PaginationConfig {
  type: 'cursor' | 'offset' | 'page' | 'none';
  // For cursor:
  cursor_param?: string;     // query param name, e.g., "after"
  cursor_path?: string;      // JSON path to next cursor in response
  // For offset:
  offset_param?: string;     // e.g., "offset"
  limit_param?: string;      // e.g., "limit"
  page_size?: number;
  // For page:
  page_param?: string;       // e.g., "page"
  total_path?: string;       // JSON path to total count
}

export interface EndpointConfig {
  url: string;               // Full URL or path appended to base_url
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  // For POST (e.g., GraphQL):
  body_template?: string;    // JSON template with {{variable}} placeholders
}

export interface ApiFieldMapping {
  events_path: string;       // JSON path to the array of events in response
  title: string;
  description?: string;
  start_date: string;
  end_date?: string;
  location_name?: string;
  location_address?: string;
  image_url?: string;
  external_id: string;
  external_url?: string;
}
```

```typescript
// src/connectors/generic-api/index.ts
import { type ConnectorPlugin } from '..';

const GenericApiConnector: ConnectorPlugin = {
  manifest: {
    id: 'generic-api',
    name: 'API',
    description: 'Connect to any REST or GraphQL API that provides event data. Configure endpoints, authentication, field mapping, and pagination.',
    icon: 'api',
    category: 'events',
    authType: 'api_key', // Stores the API key/bearer token for the external API
    capabilities: ['canImport', 'canSync'],
    webhookEvents: [],
    configSchema: [
      {
        key: 'base_url',
        label: 'Base URL',
        type: 'text',
        required: true,
        // e.g., "https://api.example.com/v1"
      },
      {
        key: 'auth_config',
        label: 'Authentication Config (JSON)',
        type: 'text',
        required: true,
        // JSON string of ApiAuthConfig
      },
      {
        key: 'event_list_endpoint',
        label: 'Event List Endpoint (JSON)',
        type: 'text',
        required: true,
        // JSON string of EndpointConfig
      },
      {
        key: 'event_detail_endpoint',
        label: 'Event Detail Endpoint (JSON, optional)',
        type: 'text',
        required: false,
        // JSON string of EndpointConfig — with {{eventId}} placeholder
      },
      {
        key: 'field_mapping',
        label: 'Field Mapping (JSON)',
        type: 'text',
        required: true,
        // JSON string of ApiFieldMapping
      },
      {
        key: 'pagination_config',
        label: 'Pagination Config (JSON)',
        type: 'text',
        required: false,
        // JSON string of PaginationConfig
      },
    ],
  },

  actions: [
    {
      id: 'sync-events',
      name: 'Sync Events',
      description: 'Fetch events from the configured API and import them into this Space.',
      inputSchema: [
        { name: 'from_date', type: 'string', description: 'Filter events after this date (ISO 8601)', required: false },
        { name: 'max_pages', type: 'number', description: 'Maximum pages to fetch (default: 10)', required: false },
      ],
      outputType: 'confirmation',
      triggerTypes: ['manual', 'scheduled', 'ai'],
      requiredCapabilities: ['canImport'],
    },
    {
      id: 'test-connection',
      name: 'Test Connection',
      description: 'Verify the API endpoint is reachable and returns valid data.',
      inputSchema: [],
      outputType: 'confirmation',
      triggerTypes: ['manual'],
      requiredCapabilities: ['canImport'],
    },
  ],

  getAuthUrl(): string { throw new Error('Generic API uses API key auth'); },
  async handleCallback(): Promise<never> { throw new Error('Generic API uses API key auth'); },
  async refreshToken(): Promise<never> { throw new Error('Generic API uses API key auth'); },
  async revokeToken(): Promise<void> {},

  async executeAction(actionId, params, context) {
    if (actionId === 'test-connection') {
      return testApiConnection(context);
    }
    if (actionId === 'sync-events') {
      return syncApiEvents(params, context);
    }
    return { success: false, error: `Unknown action: ${actionId}` };
  },
};

export default GenericApiConnector;
```

**Key implementation details:**

1. **Config parsing:** All config values are stored as JSON strings (due to the `text` config field type). Parse them in `executeAction` with proper validation and error messages.

2. **Pagination loop:**
```typescript
async function fetchAllPages(
  baseUrl: string,
  endpoint: EndpointConfig,
  auth: ApiAuthConfig,
  apiKey: string,
  pagination: PaginationConfig,
  maxPages: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let cursor: string | undefined;
  let offset = 0;
  let page = 1;

  for (let i = 0; i < maxPages; i++) {
    const url = buildUrl(baseUrl, endpoint, pagination, { cursor, offset, page });
    const response = await fetchWithAuth(url, endpoint, auth, apiKey);
    results.push(response);

    // Determine if there are more pages
    if (pagination.type === 'cursor') {
      const nextCursor = resolveJsonPath(response, pagination.cursor_path!);
      if (!nextCursor) break;
      cursor = nextCursor as string;
    } else if (pagination.type === 'offset') {
      offset += pagination.page_size ?? 50;
      // Check if we got fewer results than page_size
    } else if (pagination.type === 'page') {
      page++;
      const total = resolveJsonPath(response, pagination.total_path!) as number;
      if (page * (pagination.page_size ?? 50) >= total) break;
    } else {
      break; // type === 'none'
    }
  }

  return results;
}
```

> **AUDIT FIX [P5-M2]:** Strengthened SSRF protections — DNS resolution check, private IP blocking, HTTPS-only, redirect rejection.
3. **Security (SSRF prevention):** Validate `base_url`: HTTPS only (reject HTTP). Resolve DNS first and check resolved IP against private ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x, 127.x, ::1, fc00::/7). Reject redirects to private IP ranges. Add timeout (30s) and response size limit (5MB) to prevent abuse.

4. **Rate limiting:** Implement per-connection rate limiting (max 60 requests/minute to external APIs) to be a good citizen.

---

### WP-9: Register All New Connectors

**Repo:** lemonade-backend
**File to modify:** `src/connectors/index.ts`
**Depends on:** WP-4, WP-5, WP-6, WP-7, WP-8 (all connectors)

Add registrations after existing connectors:

> **AUDIT FIX [P5-C4]:** Added missing MeetupConnector import and registration.

```typescript
import MeetupConnector from './meetup';
import DiceConnector from './dice';
import ResidentAdvisorConnector from './resident-advisor';
import GenericWebhookConnector from './generic-webhook';
import GenericApiConnector from './generic-api';

// ... existing registrations ...
register(GoogleSheetsConnector);
register(AirtableConnector);
// Phase 5 connectors
register(MeetupConnector);
register(DiceConnector);
register(ResidentAdvisorConnector);
register(GenericWebhookConnector);
register(GenericApiConnector);
```

---

## Part C: Connector Tier Limits

### WP-10: Subscription-Based Connector Slot Enforcement

**Repo:** lemonade-backend
**Depends on:** Nothing (can start immediately)
**Effort:** 1-2 days

The TODO is already marked in the codebase at `lemonade-backend/src/graphql/resolvers/connector.ts:177`:
```typescript
// TODO: Enforce tier-based connector slot limits here
```

The subscription feature config system already exists and is the correct pattern to use (verified at `lemonade-backend/src/app/services/subscription-feature-config.ts`).

> **AUDIT FIX [P5-C1]:** Renumbered sub-sections from 9a-9d to 10a-10d (WP-10, not WP-9).

#### 10a. Add `connector_slots` Feature Config

Add to `DEFAULT_FEATURE_CONFIGS` in `src/app/services/subscription-feature-config.ts`:

```typescript
connector_slots: {
  feature_code: 'connector_slots',
  feature_type: FeatureType.numeric_limit,
  description: 'Maximum number of third-party connectors a Space can have simultaneously',
  tiers: {
    free: { enabled: true, limit: 1 },
    pro: { enabled: true, limit: 2 },
    plus: { enabled: true, limit: 4 },
    max: { enabled: true, limit: 6 },
    enterprise: { enabled: true, limit: 0 }, // 0 = unlimited
  },
},
```

**Convention note:** In this codebase, `limit: 0` with `enabled: true` means **unlimited** (verified by examining how `getFeatureLimit()` returns 0 and callers treat 0 as unlimited — see `premium_themes`, `config_versions`, etc. at `subscription-feature-config.ts:100-108,230-238`).

#### 10b. Enforce in `connectPlatform` Mutation

Modify `src/graphql/resolvers/connector.ts`, replace the TODO comment:

```typescript
// In connectPlatform mutation, after the existing duplicate check:

// Enforce tier-based connector slot limits
const space = await SpaceModel.findById(spaceId).lean();
if (!space) throw new Error('Space not found');

const effectiveTier = resolveEffectiveTier(
  space.subscription_tier ?? 'free',
  space.subscription_status,
  space.subscription_renewal_date,
);
const maxSlots = await getFeatureLimit(effectiveTier, 'connector_slots');

> **AUDIT FIX [P5-H4]:** Added explicit check for -1 (disabled). `getFeatureLimit` returns -1 when feature is disabled for the tier — `maxSlots > 0` incorrectly treats -1 as "don't enforce" (unlimited).
if (maxSlots === -1) {
  throw new ForbiddenError('Connectors are disabled for this subscription tier');
}
if (maxSlots > 0) { // 0 = unlimited
  const currentCount = await ConnectionModel.countDocuments({
    spaceId,
    status: { $ne: ConnectionStatus.pending },
  });

  if (currentCount >= maxSlots) {
    const error = {
      error: 'connector_limit_reached',
      message: `Your ${effectiveTier} plan allows ${maxSlots} connector(s). Upgrade to connect more.`,
      current_count: currentCount,
      max_slots: maxSlots,
      current_tier: effectiveTier,
      upgrade_url: `https://app.lemonade.social/settings/billing?upgrade=true&feature=connector_slots`,
    };
    assert.ok(false, 402, JSON.stringify(error));
  }
}
```

**Imports to add** at top of `connector.ts`:
```typescript
import assert from 'http-assert';
import { ForbiddenError } from 'apollo-server-koa';
import { SpaceModel } from '../../app/models/space';
import { getFeatureLimit, resolveEffectiveTier } from '../../app/services/subscription-feature-config';
```

#### 10c. Immediate Enforcement on Downgrade

> **AUDIT FIX R2 [E15]:** This section OVERRIDES the R1 grace period behavior. Connectors beyond the new tier limit are suspended IMMEDIATELY on downgrade — no grace period. Grace periods apply to other features (themes, page generations) but NOT connector limits. The previous R1 fix that "only blocks NEW connections" is insufficient — excess existing connections must also be suspended.

When a Space downgrades (e.g., Plus -> Free), connections beyond the new tier limit are **DISABLED IMMEDIATELY**. They are NOT deleted, but suspended with `status: 'suspended_tier_limit'`.

**New function:** Add `enforceConnectorLimitsOnDowngrade(spaceId, newTier)` to `src/app/services/connector-tier-enforcement.ts`:

```typescript
import { ConnectionModel, ConnectionStatus } from '../models/connection';
import { ExternalEventMappingModel } from '../models/external-event-mapping';
import { EventModel } from '../models/event';
import { getFeatureLimit } from './subscription-feature-config';
import { toolRegistrarService } from './tool-registrar';
// > **AUDIT FIX R3 [E15-2]:** Removed phantom `atlasRegistryService.deIndexConnectionEvents` import.
// > De-indexing is now done directly via ExternalEventMappingModel + EventModel.atlas_searchable flag.

/**
 * Immediately enforces connector limits when a Space downgrades.
 * Suspends excess connections using LIFO ordering (most recently connected first).
 * Called from the subscription change webhook/handler.
 */
async function enforceConnectorLimitsOnDowngrade(
  spaceId: ObjectId,
  newTier: string,
): Promise<{ suspended: string[]; remaining: number }> {
  const maxSlots = await getFeatureLimit(newTier, 'connector_slots');

  // 0 = unlimited, no enforcement needed
  if (maxSlots === 0) return { suspended: [], remaining: 0 };

  // Count active (non-pending, non-suspended) connections
  const activeConnections = await ConnectionModel.find({
    spaceId,
    status: { $nin: [ConnectionStatus.pending, 'suspended_tier_limit'] },
  })
    .sort({ createdAt: -1 }) // LIFO — most recently connected first
    .lean();

  if (activeConnections.length <= maxSlots) {
    return { suspended: [], remaining: 0 };
  }

  // Suspend excess connections (LIFO — most recently connected get suspended first)
  const toSuspend = activeConnections.slice(0, activeConnections.length - maxSlots);
  const suspendedIds: string[] = [];

  for (const conn of toSuspend) {
    // 1. Update connection status
    await ConnectionModel.updateOne(
      { _id: conn._id },
      { $set: { status: 'suspended_tier_limit', suspendedAt: new Date() } },
    );
    suspendedIds.push(conn._id.toString());

    // 2. Unregister AI tools for this connection
    await toolRegistrarService.unregisterConnectionTools(conn._id);

    // 3. De-index events from this connection in Atlas search
    // > **AUDIT FIX R3 [E15-2]:** Replaced phantom `deIndexConnectionEvents` call with
    // > implementable approach using ExternalEventMapping + atlas_searchable flag.
    // Query all Lemonade event IDs mapped to this connection:
    const mappings = await ExternalEventMappingModel.find({ connectionId: conn._id }).lean();
    const eventIds = mappings.map(m => m.lemonadeEventId);
    // Set atlas_searchable: false on each Event document (additive field, see Phase 2)
    if (eventIds.length > 0) {
      await EventModel.updateMany(
        { _id: { $in: eventIds } },
        { $set: { atlas_searchable: false } },
      );
    }
    // Phase 2 search controller filters: atlas_searchable: { $ne: false }
    // Phase 3 Registry naturally stops returning these events
  }

  return { suspended: suspendedIds, remaining: activeConnections.length - toSuspend.length };
}
```

**Integration point:** Call `enforceConnectorLimitsOnDowngrade(spaceId, newTier)` from the subscription change handler (the webhook or mutation that processes tier changes). This is typically in `src/app/services/subscription.ts` or the Stripe webhook handler — wherever `subscription_tier` is updated on the Space document, add the call immediately after the update.

**Behavior summary:**
- Excess connections are suspended in **LIFO order** (most recently connected suspended first)
- Suspended connections get `status: 'suspended_tier_limit'`
- AI tools registered by suspended connections are unregistered via the tool-registrar
- Events from suspended connections are de-indexed from Atlas search (via `atlas_searchable: false`)
- Connections are NOT deleted — if the user upgrades again, they can be reactivated
- The UI shows "X connector(s) were suspended due to your plan change. Upgrade to reactivate them."

> **AUDIT FIX R3 [F-5]:** Orphaned tickets on suspended connections — explicit behavior documentation:
> Events from suspended connections **remain valid in lemonade-backend**. Existing tickets are **NOT affected**. The event is only removed from Atlas Registry search results (`atlas_searchable: false`). Attendees can still check in. The organizer can still manage the event via the Lemonade dashboard. Only NEW Atlas discovery and purchase is blocked for those events.
> **AtlasFeeDistribution records for suspended connections are NOT retroactively affected.** Rewards already earned from ticket sales on those events are kept. Suspension only prevents future Atlas-mediated sales.

**Reactivation:** When a Space upgrades to a tier that accommodates their suspended connections, run the reverse: find connections with `status: 'suspended_tier_limit'`, change status back to `active`, re-register tools, and re-index events (set `atlas_searchable` back to `true` on their Event documents via ExternalEventMappingModel lookup). Implement as `reactivateConnectorsOnUpgrade(spaceId, newTier)` in the same file.

> **AUDIT FIX R3 [E15-3]:** The `atlas_searchable` field on Event documents is the coordination point between Phase 5 (connection suspension) and Phase 2 (Atlas search). Phase 2 adds the `atlas_searchable` field to the Event model (additive boolean, optional, defaults to `undefined` which is truthy). Phase 2 search controller filters with `atlas_searchable: { $ne: false }` so existing events are unaffected. Phase 5 sets `atlas_searchable: false` when suspending connections and restores it on reactivation. Phase 3 Registry naturally stops returning events with `atlas_searchable: false` because they won't appear in Space search results fed to the Registry.

#### 10d. GraphQL Query for Connector Limit Info

Add a new query to `src/graphql/resolvers/connector.ts` for the frontend to display limit info:

```typescript
@ObjectType()
class ConnectorSlotInfo {
  @Field(() => Int)
  used!: number;

  @Field(() => Int)
  max!: number; // 0 = unlimited

  @Field()
  canAddMore!: boolean;

  @Field()
  currentTier!: string;
}

// In ConnectorResolver class:
@Query(() => ConnectorSlotInfo)
async connectorSlotInfo(
  @Ctx() { ctx }: Context,
  @Arg('spaceId') spaceId: string,
): Promise<ConnectorSlotInfo> {
  const { userId } = await authorize(ctx);
  await assertSpaceApiPermission(userId, new Types.ObjectId(spaceId), this.connectorSlotInfo.name);

  const space = await SpaceModel.findById(spaceId).lean();
  if (!space) throw new Error('Space not found');

  const effectiveTier = resolveEffectiveTier(
    space.subscription_tier ?? 'free',
    space.subscription_status,
    space.subscription_renewal_date,
  );
  const maxSlots = await getFeatureLimit(effectiveTier, 'connector_slots');

  const used = await ConnectionModel.countDocuments({
    spaceId: new Types.ObjectId(spaceId),
    status: { $ne: ConnectionStatus.pending },
  });

  return {
    used,
    max: maxSlots,
    canAddMore: maxSlots === 0 || used < maxSlots,
    currentTier: effectiveTier,
  };
}
```

Add the `ConnectorSlotInfo` type to `src/graphql/types/connector.ts`.

---

### WP-11: Frontend Updates

**Repo:** web-new
**Depends on:** WP-9 (connectors registered), WP-10 (slot info query)
**Effort:** 2-3 days

> **AUDIT FIX [P5-C2]:** Renumbered sub-sections from 10a-10e to 11a-11e (WP-11, not WP-10).

#### 11a. Connector Icons

Add new entries to `CONNECTOR_ICON_MAP` in `web-new/lib/components/features/upgrade-to-pro/utils.ts:20-34`:

```typescript
export const CONNECTOR_ICON_MAP: Record<string, string> = {
  // ... existing entries ...
  meetup: `${ASSET_PREFIX}/assets/images/connectors/connector-meetup.png`,
  dice: `${ASSET_PREFIX}/assets/images/connectors/connector-dice.png`,
  'resident-advisor': `${ASSET_PREFIX}/assets/images/connectors/connector-resident-advisor.png`,
  'generic-webhook': `${ASSET_PREFIX}/assets/images/connectors/connector-webhook.png`,
  'generic-api': `${ASSET_PREFIX}/assets/images/connectors/connector-api.png`,
};
```

**Assets needed:** Create/obtain PNG icons (64x64 or 128x128) for Meetup (red "M" swirl), Dice, Resident Advisor, Webhook (generic webhook icon), and API (generic endpoint icon). Place in `public/assets/images/connectors/`.

#### 11b. Connector Slot Indicator

In the Connectors tab (`web-new/lib/components/features/upgrade-to-pro/Connectors.tsx`), add a slot usage indicator:

```tsx
// Query connector slot info
const { data: slotInfo } = useQuery(connectorSlotInfoQuery, { spaceId });

// Render indicator
<div className="flex items-center gap-2 text-sm text-secondary">
  <span>{slotInfo.used}/{slotInfo.max === 0 ? '∞' : slotInfo.max} connectors</span>
  {!slotInfo.canAddMore && (
    <UpgradeButton feature="connector_slots" />
  )}
</div>
```

#### 11c. Upgrade Prompt When Limit Reached

When user clicks "Connect" and the `connectPlatform` mutation returns a 402 with `error: 'connector_limit_reached'`:
- Show a modal/toast: "You've reached the connector limit for your {tier} plan. Upgrade to add more connectors."
- Include an "Upgrade" CTA button that links to billing settings

#### 11d. Chain Selection for Atlas Payments

Update `web-new/lib/utils/crypto.ts` `getViemChainConfig()` — no changes needed since it already reads from the backend `chains` collection dynamically. The new chain documents from WP-1 will automatically appear.

Verify that `CryptoPayment.tsx` and the wallet connection flow correctly handle the new chain IDs (42161, 137, 10, 324). If any chain-specific Viem imports are needed (e.g., `import { arbitrum } from 'viem/chains'`), add them.

#### 11e. Generic Webhook/API Connector Config UI

The generic connectors have complex config schemas (JSON editors for field mapping, pagination, etc.). The existing `ConnectorDetail.tsx` renders config fields based on `configSchema`, but it currently only supports `text` and `select` types.

For Phase 5, enhance the config UI:
- For `field_mapping` and similar JSON config fields: render a code editor (Monaco or a simple `<textarea>` with JSON validation) instead of a plain text input
- Add a "Test Connection" button for the Generic API connector that calls the `test-connection` action
- For the Generic Webhook connector: display the webhook URL prominently after connection, with a "Copy" button

---

> **AUDIT FIX [P5-C3]:** Updated ALL WP numbers in dependency graph to reflect Meetup insertion at WP-4.
> **AUDIT FIX [P5-C6]:** Added Meetup (WP-4) to dependency graph and parallelization note.

## Dependency Graph

```
WP-1 (Chain docs) ─────────┐
                            ├──→ WP-3 (Per-Space payment config) ──→ WP-11d (FE chains)
WP-2 (Solana payment) ─────┘

WP-4 (Meetup) ────────────────┐
WP-5 (Dice) ──────────────────┤
WP-6 (Resident Advisor) ──────┤
WP-7 (Generic Webhook) ───────┼──→ WP-9 (Register all) ──→ WP-11a,b,e (FE connectors)
WP-8 (Generic API) ───────────┘

WP-10 (Tier limits) ──→ WP-11b,c (FE slot indicator + upgrade prompt)
```

**Parallelizable:** WP-1+2, WP-4, WP-5, WP-6, WP-7, WP-8, WP-10 can ALL start simultaneously.

---

> **AUDIT FIX [P5-C6]:** Added Meetup connector files to new files summary.

## New Files Summary

| File | Repo | Purpose |
|------|------|---------|
| `src/db/migrations/<ts>-add-atlas-evm-chains.ts` | lemonade-backend | Chain documents for Arbitrum, Polygon, Optimism, ZKSync, Solana |
| `src/app/services/atlas/solana-payment-verifier.ts` | lemonade-backend | Solana SPL token transfer verification |
| `src/app/services/connector-tier-enforcement.ts` | lemonade-backend | Connector limit enforcement on downgrade/upgrade (AUDIT FIX R2 [E15]) |
| `src/connectors/meetup/index.ts` | lemonade-backend | Meetup ConnectorPlugin |
| `src/connectors/meetup/types.ts` | lemonade-backend | Meetup API response types |
| `src/connectors/meetup/api.ts` | lemonade-backend | Meetup GraphQL API client |
| `src/connectors/dice/index.ts` | lemonade-backend | Dice ConnectorPlugin |
| `src/connectors/dice/types.ts` | lemonade-backend | Dice API response types |
| `src/connectors/dice/api.ts` | lemonade-backend | Dice API client |
| `src/connectors/resident-advisor/index.ts` | lemonade-backend | RA ConnectorPlugin |
| `src/connectors/resident-advisor/types.ts` | lemonade-backend | RA response types |
| `src/connectors/resident-advisor/api.ts` | lemonade-backend | RA data fetching |
| `src/connectors/generic-webhook/index.ts` | lemonade-backend | Webhook ConnectorPlugin |
| `src/connectors/generic-webhook/field-resolver.ts` | lemonade-backend | JSON path field mapping utility |
| `src/connectors/generic-api/index.ts` | lemonade-backend | API ConnectorPlugin |
| `src/connectors/generic-api/types.ts` | lemonade-backend | API config type definitions |
| `src/connectors/generic-api/fetcher.ts` | lemonade-backend | Paginated API fetcher with auth |
| `public/assets/images/connectors/connector-meetup.png` | web-new | Meetup icon |
| `public/assets/images/connectors/connector-dice.png` | web-new | Dice icon |
| `public/assets/images/connectors/connector-resident-advisor.png` | web-new | RA icon |
| `public/assets/images/connectors/connector-webhook.png` | web-new | Webhook icon |
| `public/assets/images/connectors/connector-api.png` | web-new | API icon |

## Existing Files to Modify

| File | Repo | Change |
|------|------|--------|
> **AUDIT FIX [P5-C6]:** Updated connector count from 4 to 5 (includes Meetup).
> **AUDIT FIX R3 [CC-7]:** `suspended_tier_limit` must be added to the ConnectionStatus enum. Without this, the string literal `'suspended_tier_limit'` used in queries and updates will not match the enum type, causing TypeScript errors or silent mismatches.
| `src/app/models/connection.ts` | lemonade-backend | Add `suspended_tier_limit = 'suspended_tier_limit'` to the `ConnectionStatus` enum |
| `src/connectors/index.ts` | lemonade-backend | Register 5 new connectors (Meetup, Dice, RA, Webhook, API) |
| `src/graphql/resolvers/connector.ts` | lemonade-backend | Add tier limit enforcement in `connectPlatform`, add `connectorSlotInfo` query |
| `src/graphql/types/connector.ts` | lemonade-backend | Add `ConnectorSlotInfo` output type |
| `src/app/services/subscription-feature-config.ts` | lemonade-backend | Add `connector_slots` to `DEFAULT_FEATURE_CONFIGS` |
| `lib/components/features/upgrade-to-pro/utils.ts` | web-new | Add 5 new connector icons to `CONNECTOR_ICON_MAP` (Meetup, Dice, RA, Webhook, API) |
| `lib/components/features/upgrade-to-pro/Connectors.tsx` | web-new | Add slot usage indicator, upgrade prompt |
| `lib/components/features/upgrade-to-pro/ConnectorDetail.tsx` | web-new | JSON editor for complex config fields, webhook URL display |

## Dependencies to Add

| Package | Repo | Purpose | Already present? |
|---------|------|---------|-----------------|
| `@solana/web3.js` | lemonade-backend | Solana RPC client | Check — likely yes (existing Solana support) |
| `@solana/spl-token` | lemonade-backend | SPL token ATA resolution | Check — likely yes |

---

## Testing Requirements

Each work package must include tests. Follow the pattern in `lemonade-backend/src/graphql/__test__/connector.test.ts`:

> **AUDIT FIX [P5-C6]:** Updated WP numbers in testing requirements and added Meetup tests.

1. **WP-4 (Meetup):** Test OAuth flow, GraphQL query parsing, null-email handling (skip attendees without email), duration unit conversion, pagination.
2. **WP-10 (Tier limits):** Test `connectPlatform` with each tier at and over limit. Test `enforceConnectorLimitsOnDowngrade` — verify LIFO suspension order, tool unregistration, registry de-indexing, and that connections at/under limit are untouched. Test reactivation on upgrade. Test `connectorSlotInfo` query. Test -1 (disabled) returns ForbiddenError. **(AUDIT FIX R2 [E15]: grace period test replaced with immediate enforcement test)**
3. **WP-7 (Webhook):** Test field mapping resolver with various JSON structures. Test signature verification with valid/invalid signatures. Test prototype pollution prevention in JSON paths. Test payload size limit.
4. **WP-8 (API):** Test pagination loop with each pagination type. Test SSRF prevention (private IP blocking, DNS resolution). Test timeout handling.
5. **WP-2 (Solana):** Test payment verification with mock transaction data. Test replay protection (duplicate tx signature rejection). Test `finalized` commitment level.

---

## Migration Checklist

Before merging to master:
- [ ] Run `yarn migrate:dev up` — new chain documents added
- [ ] Verify `ChainModel.find({ active: true })` returns all expected chains
> **AUDIT FIX [P5-C6]:** Updated connector count from 6 to 7 (2 existing + 5 new including Meetup).
- [ ] Verify `availableConnectors` GraphQL query returns all 7 connectors (2 existing + 5 new: Meetup, Dice, RA, Webhook, API)
- [ ] Verify `connectorSlotInfo` query returns correct limits for each tier
- [ ] Verify `connectPlatform` rejects when at tier limit
- [ ] Test Solana payment verification with a devnet transaction
- [ ] Verify USDC contract addresses against Circle's official docs
