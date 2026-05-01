# agent-dual-client

Reference example: an agent paying an HTTP 402 challenge with both rails. Pairs with [`examples/dual-protocol-server/`](../dual-protocol-server/) — the server returns a 402 with both `base_usdc` and `stripe_spt` in `payment_methods`, and this client tries x402 first then falls back to stripe-mpp.

If neither rail is configured, the client prints a "configure one of …" message and exits cleanly without any side effects.

## Prerequisites

For end-to-end runs you need ONE of:

- **x402 (on-chain USDC)**: Node 24+, a funded wallet on whichever EVM chain the 402 targets, and the matching USDC contract address.
  - Free testnet ETH: <https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet>
  - Free testnet USDC: <https://faucet.circle.com/> (Base Sepolia)
- **stripe-mpp (Stripe SPT)**: a Stripe test secret key.

The `dual-protocol-server` example must also be running with a matching `ORGANIZER_ADDRESS` (for x402) or `STRIPE_SECRET_KEY` (for Stripe).

## Run

```bash
pnpm install
pnpm -r build

cd examples/agent-dual-client
cp .env.example .env
# edit .env to enable EITHER x402 OR stripe-mpp (or both)

pnpm dev    # tsx, fastest path
# or
pnpm build && pnpm start
```

## End-to-end recipe (curl + node)

In one terminal:

```bash
cd examples/dual-protocol-server
cp .env.example .env  # set ORGANIZER_ADDRESS to your funded wallet (for x402)
                      # or STRIPE_SECRET_KEY (for stripe-mpp)
pnpm dev
```

In another terminal:

```bash
# Sanity-check the server is up:
curl -s http://localhost:4001/.well-known/atlas.json | jq

# Issue the 402 manually first to inspect what the server is offering:
curl -i -X POST http://localhost:4001/atlas/v1/events/evt_jazz_brooklyn_001/purchase \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"ticket_type_id":"tt_ga_001","quantity":2}'

# Then run the agent:
cd examples/agent-dual-client
pnpm dev
```

Expected on success:

```
target: http://localhost:4001/atlas/v1/events/evt_jazz_brooklyn_001/purchase
body:   {"ticket_type_id":"tt_ga_001","quantity":1}
[x402] agent: 0x..., chain: Base Sepolia (84532)
[x402] paid 1000000 micro-USDC, tx=0x...
x402 status: 200
body:        {"atlas:status":"confirmed","atlas:holdId":"hold_...","atlas:settlement":{"rail":"x402","tx_hash":"0x...","settled_at":"...","amount_usd_micros":"1000000"}}
```

Or with Stripe:

```
[stripe-mpp] using payment_method=pm_card_visa, max=10000¢
[stripe-mpp] paid 100¢, intent=pi_...
stripe-mpp status: 200
body:              {"atlas:status":"confirmed","atlas:holdId":"hold_...","atlas:settlement":{"rail":"stripe-mpp","payment_intent_id":"pi_...","settled_at":"...","amount_usd_micros":"1000000"}}
```

## Behaviour

| Configured | Behaviour |
|------------|-----------|
| Neither rail | Prints "configure one of …" and exits with code 2 (no side effects). |
| Only x402 | Tries x402. Returns its result verbatim. |
| Only stripe-mpp | Tries stripe-mpp. Returns its result verbatim. |
| Both | Tries x402 first; falls back to stripe-mpp if x402 throws `MppPaymentRefusedError` or returns non-200. |

## Safety

The required env vars (`ALLOWED_RECEIVERS`, `ALLOWED_STABLECOINS`, `MAX_AMOUNT_USDC_MICRO` for x402; `ALLOWED_STRIPE_RECEIVERS`, `MAX_AMOUNT_USD_CENTS` for stripe-mpp) are mandatory for a reason: without them either helper would settle any 402 it received, including ones that point at an attacker's wallet or Stripe account. Pin the smallest values that cover your endpoints.

## What this example does NOT do

- **JWS challenge signing** — neither subpath of `@atlasprotocol/mpp` invokes JWS for a single-server flow.
- **Replay protection** — the helpers don't pin a nonce store. Production servers must.
- **Agent framework integration** — this is plain `fetch`. Wiring it into LangChain / OpenAI tools / MCP is the `@atlasprotocol/agent-tools` package, not this example.

## License

MIT
