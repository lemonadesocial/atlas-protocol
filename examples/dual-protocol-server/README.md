# dual-protocol-server

Reference event platform: a Hono service that exposes the four ATLAS endpoints (manifest, search, event detail, purchase) from its own in-memory event store.

The point of this example is to show how an event platform — Lemonade, Eventbrite, a dance-music collective, a regional ticketing startup — can install three packages and accept agent purchases over both rails:

- `@atlasprotocol/server-sdk` — challenge generation, multi-L2 chain specs, native Stripe verifier, manifest helper.
- `@atlasprotocol/mpp` — wire format (encode/decode/serialize) for the 402 challenge.
- `stripe`, `viem` — only the underlying SDKs the server actually calls.

There is **no central protocol-managed database** and **no registry server** in this phase. Each event platform serves ATLAS endpoints from its own database; aggregators (multi-platform search) are a convenience layer anyone can build later.

## Endpoints

| Method | Path | What |
|--------|------|------|
| `GET` | `/.well-known/atlas.json` | Spec-aligned manifest (uses `generateAtlasManifest` from server-sdk). |
| `GET` | `/atlas/v1/search?q=&city=&date_from=&date_to=` | Search the local event store. |
| `GET` | `/atlas/v1/events/:id` | Canonical JSON-LD event detail. |
| `POST` | `/atlas/v1/events/:id/purchase` | First call → `402` with both rails. Retry with `Authorization: MPP <wire>` → confirmation. |

## Run

```bash
pnpm install
pnpm -r build

cd examples/dual-protocol-server
cp .env.example .env
# edit .env — at minimum set ORGANIZER_ADDRESS and STRIPE_SECRET_KEY (if accepting fiat)

pnpm dev          # tsx, fastest path
# or
pnpm build && pnpm start
```

The server prints the four endpoint URLs on startup.

## Test each endpoint with `curl`

```bash
# Manifest
curl -s http://localhost:4001/.well-known/atlas.json | jq

# Search
curl -s "http://localhost:4001/atlas/v1/search?city=Brooklyn" | jq
curl -s "http://localhost:4001/atlas/v1/search?q=jazz&date_from=2026-06-01" | jq

# Event detail
curl -s http://localhost:4001/atlas/v1/events/evt_jazz_brooklyn_001 | jq

# Purchase — first call returns 402 with the MPP challenge
curl -i -X POST http://localhost:4001/atlas/v1/events/evt_jazz_brooklyn_001/purchase \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"ticket_type_id":"tt_ga_001","quantity":2}'
```

The 402 response body looks like:

```json
{
  "challenge": "<base64url-MPP-envelope>",
  "challenge_id": "ch_hold_xxxxxxxx",
  "event_id": "evt_jazz_brooklyn_001",
  "hold_id": "hold_xxxxxxxx",
  "expected_amount_usdc_micros": "50000000",
  "expires_at": "2026-...",
  "payment_methods": [
    { "type": "base_usdc", "chain_id": 8453, "token": "0x833589...", "recipient": "0x...", "amount": "50.000000", "confirmations": 12, "rpc_url": "https://mainnet.base.org" },
    { "type": "optimism_usdc", "chain_id": 10, "...": "..." },
    { "type": "arbitrum_usdc", "chain_id": 42161, "...": "..." },
    { "type": "stripe_spt", "amount": "50.00", "currency": "usd" }
  ]
}
```

The `WWW-Authenticate` header carries the same envelope as `MPP realm="...", challenge="<wire>"`.

## Test the dual-protocol flow with the agent client

The companion example at [`examples/agent-dual-client/`](../agent-dual-client/) (PR 6) demonstrates how an agent picks a rail and retries against this server. Recipe:

```bash
# In one terminal:
cd examples/dual-protocol-server && pnpm dev

# In another terminal:
cd examples/agent-dual-client
cp .env.example .env
# edit .env to point TARGET_URL at this server and configure either x402 or
# stripe-mpp credentials
pnpm dev
```

## Optional on-chain + IPFS integration

The example wires the post-settlement integration steps end-to-end behind env vars: minting an AtlasTicket NFT, recording an organizer reward in the RewardLedger, and pinning the W3C VC receipt to IPFS. **All three are independently optional.** When the corresponding env var is missing, the example logs a warning and the response carries a `skipped` reason instead of failing — so the example is runnable locally without any on-chain or pinning credentials.

| Env var | Role |
|---------|------|
| `ATLAS_TICKET_ADDRESS` | AtlasTicket proxy address on the settlement chain. Pull from [`deployments.json`](../../deployments.json) once your chain is deployed. Required to mint. |
| `REWARD_LEDGER_ADDRESS` | RewardLedger proxy address on the settlement chain. Required to credit the organizer reward. |
| `WALLET_PRIVATE_KEY` | Server-side signer. MUST hold the MINTER role on AtlasTicket and the RECORDER role on RewardLedger. |
| `RPC_URL` | viem transport for the settlement chain. |
| `SETTLEMENT_CHAIN_NAME` | Display name embedded in the receipt's `settlement.chain` field. Defaults to `base`. |
| `PINATA_JWT` | Pinata JWT — when set, the receipt is pinned to Pinata and the returned CID surfaces in the response body. |
| `WEB3_STORAGE_TOKEN` + `WEB3_STORAGE_SPACE_DID` | Alternative pinner. Used only when `PINATA_JWT` is not set. |

See [`./.env.example`](./.env.example) for the complete list with comments.

### Full purchase flow with `curl`

```bash
# 1. Issue the challenge (no Authorization → server returns 402).
curl -i -X POST http://localhost:4001/atlas/v1/events/evt_jazz_brooklyn_001/purchase \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"ticket_type_id":"tt_ga_001","quantity":1}'

# 2. The agent settles the challenge off-band (on-chain transfer or Stripe
#    PaymentIntent confirmation), then re-presents the same request with
#    Authorization: MPP <wire>:
curl -i -X POST http://localhost:4001/atlas/v1/events/evt_jazz_brooklyn_001/purchase \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Authorization: MPP <base64url-credential-from-the-402-challenge>" \
  -d '{"ticket_type_id":"tt_ga_001","quantity":1}'

# 3. The 200 response carries the receipt + (when configured) cid + ticket
#    + reward tx hashes:
# {
#   "atlas:status": "confirmed",
#   "atlas:settlement": { ... },
#   "atlas:ticket":  { "tokenId": "1", "txHash": "0x..." } | { "skipped": "..." },
#   "atlas:reward":  { "amount": "1000000", "recipient": "0x...", "txHash": "0x..." } | { "skipped": "..." },
#   "atlas:receipt": { /* W3C VC */ },
#   "atlas:cid":     "bafkrei..." | null
# }
```

## Adapting this pattern to your own DB

The four routes are intentionally small. To plug your own platform in:

1. Replace `src/data.ts` with whatever wraps your existing event/ticket store. The route handlers call `findEvent`, `findTicketType`, `lookupOrCreateHold`, and `markSettled` — keep those signatures and you can swap the storage layer freely.
2. Replace `ORGANIZER_ADDRESS` with the per-event FeeRouter address you deployed in PR 4's runbooks. For multi-organizer platforms, return a different `recipient` per event by passing `receiversByChain` to `generateMppChallenge`.
3. Wire `STRIPE_SECRET_KEY` to your existing Stripe account if you want to keep accepting fiat.
4. Add real auth (the example skips API-key validation — production would check a Bearer token or session cookie before issuing the challenge).
5. Keep idempotency-key handling (the example stores it in-memory; production must use the same store as your hold table so retries return the same hold).
6. Set `ATLAS_TICKET_ADDRESS`, `REWARD_LEDGER_ADDRESS`, and `PINATA_JWT` (or the Web3.Storage pair) to enable the on-chain mint + reward + pinned-receipt integration the example performs.

## What this example does NOT do (yet)

- **Replay protection on the MPP credential layer.** The SDK's `verifyMppCredential` + `InMemoryReplayStore` are available; production deployments should wire them in.
- **Multi-tenancy.** Each instance speaks for one platform. If you're hosting many platforms, deploy one instance per platform domain (matches the "well-known per origin" model in `01-PROTOCOL-SPEC.md`).
- **Auth.** The example accepts any request. Add API key / OAuth / session validation before using in production.
- **Receipt signing.** `generateReceipt` returns an unsigned W3C VC; the example does not attach an ES256 JWS proof block. Sign with a key listed in the platform's `signing_keys` manifest before publishing.
