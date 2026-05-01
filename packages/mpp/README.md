# @atlasprotocol/mpp

Standalone implementation of the **Machine Payments Protocol (MPP)** envelope, plus an optional JWS signing layer and an optional x402 client helper for agent-side payment + retry.

> The package has zero coupling to `@atlasprotocol/server-sdk`. It can be used by any HTTP-402 server or agent client.

## Two surfaces

`@atlasprotocol/mpp` exposes two independent surfaces. Pick the one you need — they do not depend on each other and you can use either alone.

| Surface                  | Import                              | What it does                                                                                                            | Runtime deps          |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Wire format** (always) | `@atlasprotocol/mpp`                | `encode` / `decode` / `serialize` / `deserialize` for the canonical Challenge / Credential / Receipt envelope. Optional `signEnvelope` / `verifyEnvelope` JWS layer. | `jose` only           |
| **x402 client** (opt-in) | `@atlasprotocol/mpp/x402`           | `fetchWithPayment` — drop-in `fetch` that handles a 402 by paying on-chain (default: USDC ERC-20 via viem) and retrying. | `viem` (peer, optional) |

The wire format is intentionally chain-agnostic: it does not verify on-chain payments and it does not move funds. **On-chain verification (server-side) and payment + retry (client-side) are the consumer's job.** The `x402` subpath is a reference client implementation; the server-side counterpart lives in your own backend (see `lemonade-backend/src/app/services/atlas/mpp.ts` for the canonical reference).

## Install

```bash
pnpm add @atlasprotocol/mpp
# Add viem only if you plan to use the x402 subpath:
pnpm add viem
```

## Wire format

### Encode + decode an envelope

```ts
import { encode, decode, serialize, deserialize } from "@atlasprotocol/mpp";

const envelope = encode({
  rail: "usdc-base",
  realm: "api.example.com",
  paymentId: "pay_abc123",
  amount: "12.50",
  currency: "usd",
  recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  description: "Ticket: Lemonade x ATLAS Launch",
  expires: "2026-04-30T18:00:00.000Z",
  metadata: { event_id: "evt_42" },
});

const wire = serialize(envelope);
const recovered = decode(deserialize(wire));
```

### Sign + verify with JWS (ES256)

```ts
import { generateKeyPair } from "jose";
import { encode, signEnvelope, verifyEnvelope } from "@atlasprotocol/mpp";

const { privateKey, publicKey } = await generateKeyPair("ES256");

const envelope = encode({
  rail: "usdc-tempo",
  realm: "api.example.com",
  paymentId: "pay_signed",
  amount: "5.00",
  currency: "usd",
  recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
});

const signed = await signEnvelope(envelope, {
  alg: "ES256",
  kid: "organizer-key-1",
  key: privateKey,
});

const result = await verifyEnvelope(signed, { alg: "ES256", key: publicKey });
if (result.valid) {
  console.log("payload", result.payload);
}
```

## Server-side: verify a paid credential

The package gives you envelope decode for free; on-chain proof is yours to add. Sketch:

```ts
import { decode, deserialize } from "@atlasprotocol/mpp";
import { createPublicClient, http, parseAbiItem } from "viem";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export async function verifyCredential(wire: string) {
  const payload = decode(deserialize(wire));
  // 1. Sanity-check rail / recipient / amount against your config.
  // 2. Pull tx hash from the credential metadata.
  const txHash = payload.metadata?.tx_hash;
  if (!txHash) return { valid: false, error: "missing tx_hash" };
  // 3. Resolve the tx receipt and walk its logs for a USDC Transfer that
  //    pays >= the expected amount to your receiver.
  const client = createPublicClient({ transport: http(process.env.RPC_URL) });
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  // ... walk receipt.logs against TRANSFER_EVENT ...
  return { valid: true, txHash };
}
```

The full reference (~75 lines) lives at `lemonade-backend/src/app/services/atlas/mpp-onchain.ts` in the consuming repo.

## Client-side: pay a 402 challenge

The `x402` subpath gives you a drop-in `fetch` that pays once and retries. Suitable for agents that want machine-to-machine commerce without owning the on-chain plumbing.

```ts
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { fetchWithPayment } from "@atlasprotocol/mpp/x402";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);

const response = await fetchWithPayment(
  "https://api.example.com/mpp/v1/ping-paid",
  { method: "GET" },
  {
    account,
    chain: baseSepolia,
    // Safety: refuse 402s asking us to pay anyone outside this list.
    allowedReceivers: ["0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00"],
    // Safety: refuse 402s asking for tokens we don't recognise.
    allowedStablecoins: ["0x036CbD53842c5426634e7929541eC2318f3dCF7e"], // Base Sepolia USDC
    // Safety: hard cap, in 6-decimal USDC micro-units. 1_000n = $0.001.
    maxAmountUsdcMicro: 10_000n,
    waitForConfirmations: 1,
    onPayment: ({ txHash, amount }) => {
      console.log(`paid ${amount} micro-USDC, tx=${txHash}`);
    },
  },
);

if (response.status === 200) {
  console.log(await response.json());
}
```

Failure modes:

- **No 402** → response is returned unchanged.
- **Safety check fails** (receiver/token not allowed, or amount > cap) → throws `MppPaymentRefusedError` with `err.reason` set to one of `receiver-not-allowed`, `stablecoin-not-allowed`, `amount-exceeds-cap`, `amount-malformed`, `challenge-malformed`, `challenge-missing`. **No on-chain payment is made.**
- **viem call fails** (RPC error, revert) → the underlying viem error propagates.
- **Server returns 402 again on retry** → that response is returned. The helper does not loop.

## Safety

`fetchWithPayment` is a wallet-drain footgun if you skip the allowlist. Treat the safety options as required — none have defaults that "just work":

- **`allowedReceivers`** — every 402 names a recipient. If you do not pin this, a malicious or compromised endpoint can ask your agent to pay any address. List the recipients you actually expect.
- **`allowedStablecoins`** — same logic for the token contract. USDC on Base Sepolia is a different contract than USDC on Base mainnet; chain-mismatched 402s should not pay.
- **`maxAmountUsdcMicro`** — per-request cap in 6-decimal micro-units. 1 USDC = `1_000_000n`. Pick the smallest cap that covers the endpoints you call.

For a multi-endpoint agent, scope these to the specific call (e.g. wrap `fetchWithPayment` in a thin per-endpoint wrapper that pins the allowlists).

## Supported rails

```ts
import { SUPPORTED_RAILS } from "@atlasprotocol/mpp";
// 'usdc-base' | 'usdc-tempo' | 'usdc-arbitrum' | 'usdc-polygon' | 'usdc-optimism' | 'stripe-spt'
```

`@atlasprotocol/mpp` accepts any rail string that conforms to the canonical MPP method identifier grammar — `isValidMethodIdentifier(s)` — so non-supported rails still flow through `decode()`.

## Conformance status

This package follows the canonical MPP wire shape published at <https://mpp.dev/protocol> (accessed 2026-04-30). It implements:

- The `Challenge` / `Credential` / `Receipt` envelope shape.
- Base64url-encoded JCS-canonicalized JSON for the request payload.
- The canonical method identifier grammar (lowercase alpha + digits + `:_-`).
- The reserved fields (`id`, `realm`, `method`, `intent`, `request`, `expires`, `description`, `digest`, `opaque`).

The MPP spec does **not** mandate JWS for envelope authenticity (it pins challenge ids via HMAC-SHA256 and lets each method define its own credential payload signature). The JWS layer in this package is an `@atlasprotocol/mpp` extension above the canonical spec — it is the natural choice when you want a single signed blob with cross-domain verifiability.

For every field where the spec leaves an ambiguity (organizer identity, line items, free-form metadata, MPP version literal), the implementation flags an `MPP-GAP-XXX` and documents the resolution in [`SPEC-NOTES.md`](./SPEC-NOTES.md).

## License

MIT
