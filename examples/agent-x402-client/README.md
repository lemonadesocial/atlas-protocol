# agent-x402-client

Reference example: an agent paying an HTTP 402 challenge with `@atlasprotocol/mpp/x402`.

The script hits a paid endpoint, lets `fetchWithPayment` settle the USDC transfer on Base Sepolia, and prints the 200 response.

## Prerequisites

- Node 24+ and `pnpm` (the repo's standard toolchain).
- A funded **Base Sepolia** wallet — testnet USDC + testnet ETH for gas.
  - Get testnet ETH from <https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet>.
  - Get testnet USDC from <https://faucet.circle.com/> (Base Sepolia).
- A running paid endpoint. The default URL points at a local
  `lemonade-backend` exposing `GET /mpp/v1/ping-paid` on `:4000` — see
  `lemonade-backend/src/app/routers/mpp.ts`. Any other server that returns a
  402 with an `@atlasprotocol/mpp` challenge body works too.

## Run

```bash
pnpm install
pnpm -r build

cd examples/agent-x402-client

# Required env:
export AGENT_PRIVATE_KEY=0x...                          # funded Base Sepolia wallet
export ALLOWED_RECEIVERS=0x...                          # comma-separated; the receiver(s) you're willing to pay
export ALLOWED_STABLECOINS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC
export MAX_AMOUNT_USDC_MICRO=10000                      # 10_000 micro = 0.01 USDC

# Optional:
export TARGET_URL=http://localhost:4000/mpp/v1/ping-paid
export RPC_URL=https://sepolia.base.org

pnpm dev   # tsx — fastest path
# or:
pnpm build && pnpm start
```

Expected output on success:

```
agent address: 0x...
target:        http://localhost:4000/mpp/v1/ping-paid
cap:           10000 micro-USDC
receivers:     0x...
stablecoins:   0x036CbD53842c5426634e7929541eC2318f3dCF7e
paid 1000 micro-USDC, tx=0x...
status:        200
body:          {"message":"paid pong","timestamp":"...","txHash":"0x..."}
```

## What this example does NOT do

- **JWS challenge signing.** `@atlasprotocol/mpp` ships an opt-in JWS layer for cross-domain envelope authenticity, but the x402 helper does not invoke it — challenge integrity for a single-server flow is bounded by HMAC challenge ids on the server side. JWS becomes interesting once challenges flow across organizations.
- **Replay protection.** Once a credential is settled on-chain, anyone who sees it can replay it against the same endpoint until the server rotates. The reference server in `lemonade-backend` does not yet pin a nonce store; a real production deployment would.
- **Agent framework integration.** This is plain `fetch`. Wiring it into LangChain / OpenAI tools / MCP is straightforward but not the point of this sample.

## Safety

The required env vars (`ALLOWED_RECEIVERS`, `ALLOWED_STABLECOINS`, `MAX_AMOUNT_USDC_MICRO`) are mandatory for a reason: without them the helper would settle any 402 it receives, including ones that point at an attacker's address. Pin the smallest values that cover your endpoint.

## License

MIT
