# @atlasprotocol/server-sdk

Host a compliant ATLAS Protocol endpoint from any Node HTTP framework. The SDK ships the three primitives every ATLAS server needs — `.well-known/atlas.json` manifest generation, source-platform → ATLAS schema mapping, and multi-chain payment verification — with no Koa/Express/Fastify lock-in and no implicit database access. Drop it into your existing API to expose your event catalog to ATLAS-aware agents and clients.

## Install

```bash
pnpm add @atlasprotocol/server-sdk
```

## Quickstart

```ts
import {
  generateManifest,
  toAtlasEvent,
  verifyPayment,
  type ServerSdkConfig,
} from '@atlasprotocol/server-sdk';

const config: ServerSdkConfig = {
  platform: { name: 'Lemonade', url: 'https://lemonade.social' },
  domain: 'atlas.lemonade.social',
  feeSchedule: { protocolFeePercent: 2, platformFeePercent: 3.5 },
  paymentMethods: [
    { type: 'base_usdc', receiverAddress: '0x...' },
    { type: 'stripe_spt', stripeSecretKey: process.env.STRIPE_SECRET_KEY! },
  ],
  signingKeys: [/* JWKs */],
  rateLimits: { searchPerMinute: 100, purchasePerMinute: 10 },
};

const manifest = generateManifest(config);                // serve at /.well-known/atlas.json
const event    = toAtlasEvent(myEvent, mySpace, ticketTypes, {
  sourcePlatform: 'lemonade',
  platformUrl:    'https://app.lemonade.social',
  baseUrl:        'https://atlas.lemonade.social',
  acceptedPaymentMethods: ['base_usdc', 'stripe_spt'],
});
const result   = await verifyPayment(config, proof, params);
```

## Configuration (`ServerSdkConfig`)

| Field | Description |
|-------|-------------|
| `platform` | Branding (`name`, `url`, optional `logoUrl`, `description`, `contactEmail`) embedded in the manifest. |
| `domain` | ATLAS API base host (`atlas.example.com`). The SDK derives `endpoints.events`, `endpoints.search`, etc. from this. |
| `feeSchedule` | `{ protocolFeePercent, platformFeePercent, paymentProcessingNote? }` — advertised in the manifest and used by the schema mapper. |
| `paymentMethods` | Array of `PaymentMethodConfig`. Each entry declares the chain/scheme and its receiver address (EVM) or API credential (Stripe). |
| `signingKeys` | JWK array advertised in the manifest. Used by clients to verify signed receipts. |
| `rateLimits` | `{ searchPerMinute, purchasePerMinute }` — advertised in the manifest. |
| `logger` | Optional `Logger` (`debug`/`info`/`warn`/`error`). Defaults to a no-op logger. |

## Supported chains

| Method | Chain | Default RPC | Default confirmations |
|--------|-------|-------------|------------------------|
| `tempo_usdc` | Tempo (4217) | `https://rpc.tempo.xyz` | 1 |
| `base_usdc` | Base (8453) | `https://mainnet.base.org` | 12 |
| `arbitrum_usdc` | Arbitrum (42161) | `https://arb1.arbitrum.io/rpc` | 64 |
| `polygon_usdc` | Polygon (137) | `https://polygon-rpc.com` | 128 |
| `optimism_usdc` | Optimism (10) | `https://mainnet.optimism.io` | 10 |
| `zksync_usdc` | zkSync Era (324) | `https://mainnet.era.zksync.io` | 1 |
| `stripe_spt` | Stripe Stablecoin Payment Token | n/a | n/a |

For Stripe SPT, pass a `verifyStripe` callback to `verifyPayment(config, proof, params, deps)` — the SDK does not bundle the Stripe SDK, so you wire your own.

For replay protection, pass a `deps.isReplay(proof)` callback that checks your payment store; if omitted, replay protection is the host application's responsibility.

## Hold lifecycle

Every 402 challenge is backed by a server-side **hold** that locks the requested inventory until payment lands or the hold expires. The SDK ships an in-memory `HoldStore` for tests / single-process deployments and a `createHold` helper that enforces the protocol's 300-second minimum TTL.

```ts
import { createHold, InMemoryHoldStore } from '@atlasprotocol/server-sdk';

const store = new InMemoryHoldStore();

const hold = createHold({
  eventId: 'evt_abc123',
  ticketTypeId: 'tt_ga_001',
  quantity: 2,
  attendee: '0x...',
  organizerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
  totalAmountUsdMicros: 50_000_000n,
  idempotencyKey: req.headers['idempotency-key'],
  ttlSeconds: 300,
});
await store.create(hold);

// Later, when the agent submits a payment proof:
const result = await store.consume(hold.id, idempotencyKey);
switch (result.status) {
  case 'consumed':         /* mint receipt + tickets */ break;
  case 'already_consumed': /* return original receipt */ break;
  case 'expired':          /* respond 410 hold_expired */ break;
  case 'not_found':        /* respond 404 */ break;
}

// Periodic sweep — releases inventory back into circulation.
await store.expireOlderThan(new Date());
```

Production hosts should implement the `HoldStore` interface against Redis (or any store that supports atomic compare-and-set) so `consume` is atomic across replicas.

## Replay protection

Every accepted MPP credential is fingerprinted with a SHA-256 hash of its canonical (JCS) wire bytes. The replay store rejects a second presentation of the same credential — by the same agent or any other.

```ts
import { InMemoryReplayStore, verifyMppCredential } from '@atlasprotocol/server-sdk';

const replayStore = new InMemoryReplayStore({ ttlMs: 24 * 60 * 60 * 1000 });

const result = await verifyMppCredential(envelope, challengeId, {
  replayStore,
  // Delegate the host's deeper payment verification (e.g. on-chain RPC).
  verify: (env) => myPaymentVerifier(env),
});

if (!result.valid) {
  switch (result.error) {
    case 'replayed':           return res.status(409).json({ error: 'replay_rejected' });
    case 'expired':            return res.status(410).json({ error: 'hold_expired' });
    case 'challenge_mismatch': return res.status(422).json({ error: 'challenge_mismatch' });
    case 'invalid_envelope':   return res.status(400).json({ error: 'bad_request' });
    case 'verification_failed': return res.status(402).json({ error: 'payment_invalid', message: result.message });
  }
}
```

The replay store enforces the 24-hour idempotency window from the protocol spec (§3.6). Production hosts should back the `ReplayStore` interface with Redis using `SET … NX EX <ttl>` for atomicity.

## Receipts

Successful purchases produce a W3C Verifiable Credential receipt that mirrors the canonical `AtlasTicketReceipt` schema (`01-whitepaper/docs/02-SCHEMAS.md` §5 and `01-PROTOCOL-SPEC.md` §4). `generateReceipt` returns an unsigned credential — the host attaches an ES256 JWS proof block before publishing.

`generateReceipt` is **async** and returns `{ receipt, cid? }`. The `cid` is populated when an optional `pinner` is supplied (see *Receipt auto-pinning* below).

```ts
import { generateReceipt } from '@atlasprotocol/server-sdk';

// On-chain settlement:
const { receipt } = await generateReceipt({
  holdId: 'hold_xyz789',
  eventId: 'evt_abc123',
  attendee: '0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e',
  organizerAddress: 'did:web:bjc.events',
  paymentMethod: 'x402',
  txHash: '0xabcdef…',
  settlementChain: 'base',
  amount: '50.000000',
  currency: 'USDC',
  ticketTypeId: 'tt_ga_001',
  quantity: 2,
});

// Stripe SPT settlement:
const { receipt: stripeReceipt } = await generateReceipt({
  /* …same fields… */
  paymentMethod: 'stripe_spt',
  paymentIntentId: 'pi_test_123',
  amount: '50.00',
  currency: 'USD',
});
```

The returned credential includes the canonical `@context` (`https://www.w3.org/2018/credentials/v1` and `https://atlas.events/credentials/v1`) and `type: ["VerifiableCredential", "AtlasTicketReceipt"]`. Sign with ES256 using a key listed in the issuer's `signing_keys` manifest.

### Receipt auto-pinning

Pass a `pinner` from `@atlasprotocol/ipfs` and the receipt is canonicalized and pinned to IPFS in the same call. The returned `cid` is the content-addressed identifier of the canonicalized receipt JSON.

```ts
import { generateReceipt } from '@atlasprotocol/server-sdk';
import { PinataPinner } from '@atlasprotocol/ipfs';

const pinner = new PinataPinner({ jwt: process.env.PINATA_JWT! });

const { receipt, cid } = await generateReceipt({
  holdId: 'hold_xyz789',
  eventId: 'evt_abc123',
  attendee: '0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e',
  organizerAddress: 'did:web:bjc.events',
  paymentMethod: 'x402',
  txHash: '0xabcdef…',
  settlementChain: 'base',
  amount: '50.000000',
  currency: 'USDC',
  pinner,
});
console.log(cid); // bafy… — the pinned, canonicalized receipt
```

Any `Pinner` works: `PinataPinner`, `Web3StoragePinner`, `FilebasePinner`, or `KuboPinner`. `@atlasprotocol/ipfs` is an **optional** peer dependency — only install it if you opt into auto-pinning.

> **Breaking change in 0.4.0.** `generateReceipt` was previously sync and returned an `AtlasReceipt` directly. It is now `async` and returns `{ receipt, cid? }`. Migrate by adding `await` and destructuring `receipt`.

## Approval-required events

For events whose ticket type is `approval_required`, the server returns a 202 envelope instead of 402. The agent submits a join request, then receives a fresh 402 challenge once the host approves.

```ts
import { generateMppChallenge } from '@atlasprotocol/server-sdk';

const { payload } = generateMppChallenge({
  eventId: 'evt_gated',
  holdId: 'hold_pending',
  amountUsdcMicros: 50_000_000n,
  organizerAddress: '0x...',
  acceptedChains: ['base_usdc'],
  acceptStripe: false,
  requiresApproval: true,
  joinRequestId: 'jr_42',
});

ctx.status = 202;
ctx.body = payload;
// payload.status === 'pending_approval'
// no payment_methods, no WWW-Authenticate header
```

When the host approves, regenerate the challenge with `requiresApproval` omitted (the default), set the `WWW-Authenticate` header, and respond 402 to the agent's next purchase attempt.

## Idempotency

Wrap any side-effecting handler with `withIdempotency` so retried requests return the original outcome rather than re-running the work. The bundled `InMemoryIdempotencyStore` is process-local (good for tests / single-process deployments); production hosts should back the `IdempotencyStore` interface with Redis (`SET ... NX EX <ttl>`) or any TTL store that supports atomic compare-and-set.

```ts
import { InMemoryIdempotencyStore, withIdempotency } from '@atlasprotocol/server-sdk';

const store = new InMemoryIdempotencyStore();

app.post('/atlas/v1/events/:id/purchase', async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key') ?? defaultKey;
  return withIdempotency(store, idempotencyKey, 24 * 60 * 60, async () => {
    // … create hold, issue 402 challenge, etc.
    return responseSnapshot;
  });
});
```

Successful results are cached for `ttlSeconds`. Errors are deliberately NOT cached — a failed handler MUST be retryable.

## Rate limiting

Token-bucket limiting per identifier (MPP credential `payer_id` first, IP as fallback). The `createRateLimitMiddleware` factory returns a Hono-compatible middleware that responds 429 with a `Retry-After` header on block.

```ts
import { InMemoryRateLimiter, createRateLimitMiddleware } from '@atlasprotocol/server-sdk';

const purchaseLimiter = new InMemoryRateLimiter({
  capacity: 60,
  refillRatePerSecond: 1, // 60 req/min sustained
});

app.use(
  '/atlas/v1/events/:id/purchase',
  createRateLimitMiddleware({ limiter: purchaseLimiter }),
);
```

`hono` is a peer dependency — only install it if you use `createRateLimitMiddleware`. Hosts on other frameworks can implement their own adapter against the framework-agnostic `RateLimiter` interface.

## Schema validation

Zod schemas mirroring `01-whitepaper/docs/02-SCHEMAS.md` and the existing TypeScript interfaces. Use the `validate*` helpers for a discriminated union you can branch on without importing Zod, or compose the raw schemas (`AtlasManifestSchema`, `AtlasEventSchema`, `AtlasTicketTypeSchema`, `AtlasReceiptSchema`) into your own pipelines.

```ts
import {
  AtlasEventSchema,
  validateManifest,
  validateAtlasEvent,
  validateReceipt,
} from '@atlasprotocol/server-sdk';

const result = validateAtlasEvent(json);
if (!result.valid) {
  // result.errors[i].path identifies the offending field, e.g. ["atlas:availability"]
  return res.status(422).json({ error: 'invalid_event', details: result.errors });
}

// Or compose with your own pipeline:
const Listing = AtlasEventSchema.extend({ /* additional checks */ });
```

The schemas use `.passthrough()` so unknown ATLAS-namespaced fields (e.g. `atlas:promoted` on search results) survive validation; required fields and enums are still strictly checked.

## AtlasTicket NFT helpers

After a successful purchase, mint the corresponding ticket NFT with idempotent semantics —
calling `mint(...)` twice for the same `paymentId` reverts on chain, so retried settlement
jobs are safe by construction. The SDK ships viem-based helpers that build the calldata, parse
the resulting log, and look up the deployed contract address.

```ts
import {
  buildMintTicketTx,
  getAtlasTicketContractAddress,
  parseTicketMintedEvent,
} from "@atlasprotocol/server-sdk";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const contract = getAtlasTicketContractAddress("base_usdc") as `0x${string}`;
const tx = buildMintTicketTx({
  contract,
  to: "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
  eventId: 4242n,
  paymentId: "0xabcd…", // bytes32 — same value used on the FeeRouter settle()
  tokenURI: "ipfs://Qm…", // points at the JSON-LD ticket payload
});

const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.MINTER_PRIVATE_KEY as `0x${string}`),
  chain: base,
  transport: http(),
});
const hash = await wallet.sendTransaction(tx);
```

Decode the resulting `TicketMinted` event from the receipt to learn which `tokenId` was issued:

```ts
import { parseTicketMintedEvent } from "@atlasprotocol/server-sdk";

for (const log of receipt.logs) {
  const decoded = parseTicketMintedEvent(log);
  if (decoded) {
    // decoded.tokenId, decoded.to, decoded.eventId, decoded.paymentId, decoded.tokenURI
    break;
  }
}
```

The contract is deployed via Nick's deterministic CREATE2 factory with salt
`atlas-protocol/AtlasTicket v0.1.0`, so the **implementation** address is identical on every
EVM chain. Per-chain proxy addresses live in `deployments.json` at the repo root and are
exposed via `getAtlasTicketAddress(chainSlug)` / `getAtlasTicketContractAddress(chainSlug)`
(both names point at the same lookup).

## RewardLedger helpers

RewardLedger is the Stage 3 accrual ledger. The recorder (typically the FeeRouter or backend
settlement service) credits per-recipient organizer / attendee / referral rewards in the
chain's stablecoin; recipients claim their accumulated balance on demand. Recordings are
idempotent per `(paymentId, kind)` — a second `recordReward` call for the same tuple reverts
on chain, so retried settlement jobs are safe by construction.

The SDK ships viem-based helpers that build the calldata, parse the resulting logs, and
look up the deployed contract address.

```ts
import {
  buildRecordRewardTx,
  getRewardLedgerContractAddress,
  RewardKind,
} from "@atlasprotocol/server-sdk";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const contract = getRewardLedgerContractAddress("base_usdc") as `0x${string}`;
const tx = buildRecordRewardTx({
  contract,
  recipient: "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
  kind: RewardKind.Organizer,
  amount: 600_000n, // 0.60 USDC at 6 decimals
  paymentId: "0xabcd…", // bytes32 — same value used on the FeeRouter settle()
});

const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.RECORDER_PRIVATE_KEY as `0x${string}`),
  chain: base,
  transport: http(),
});
const hash = await wallet.sendTransaction(tx);
```

A recipient withdraws their balance with `buildClaimTx`. The transaction is signed by the
recipient's own wallet — no role required, anyone can call `claim()` for themselves:

```ts
import { buildClaimTx } from "@atlasprotocol/server-sdk";

const claimTx = buildClaimTx({ contract });
const hash = await recipientWallet.sendTransaction(claimTx);
```

Read a recipient's accrued unclaimed balance with `getRewardBalance` — the caller supplies
their own viem `PublicClient` so the SDK does not pin a transport:

```ts
import { getRewardBalance } from "@atlasprotocol/server-sdk";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http() });
const balance = await getRewardBalance(client, {
  contract,
  recipient: "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
});
// balance is a bigint of unclaimed 6-decimal stablecoin units.
```

> **Enum stability.** The `RewardKind` enum (`Organizer = 0`, `Attendee = 1`, `Referral = 2`)
> is part of the on-chain ABI. Do **not** reorder the values without a coordinated upgrade
> across the contract, this SDK, and any indexer that decodes `RewardRecorded.kind` by integer
> value. The vitest suite pins these values so an accidental reorder fails the build.

The contract is deployed via Nick's deterministic CREATE2 factory with salt
`atlas-protocol/RewardLedger v0.1.0`. Per-chain proxy addresses live in `deployments.json`
at the repo root and are exposed via `getRewardLedgerAddress(chainSlug)` /
`getRewardLedgerContractAddress(chainSlug)`.

## Spec reference

See [`../../specs/01-PROTOCOL-SPEC.md`](../../specs/01-PROTOCOL-SPEC.md) for the full ATLAS Protocol manifest format, capability list, and signing-key requirements.

## License

MIT
