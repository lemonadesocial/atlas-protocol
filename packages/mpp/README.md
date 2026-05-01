# @atlasprotocol/mpp

Standalone implementation of the **Machine Payments Protocol (MPP)** envelope, plus an optional JWS signing layer and two optional client helpers for agent-side payment + retry: `x402` (on-chain USDC) and `stripe-mpp` (Stripe SPT).

> The package has zero coupling to `@atlasprotocol/server-sdk`. It can be used by any HTTP-402 server or agent client.

## Three surfaces

`@atlasprotocol/mpp` exposes three independent surfaces. Pick the one you need — they do not depend on each other and you can use any subset alone.

| Surface                       | Import                              | What it does                                                                                                            | Runtime deps          |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Wire format** (always)      | `@atlasprotocol/mpp`                | `encode` / `decode` / `serialize` / `deserialize` for the canonical Challenge / Credential / Receipt envelope. Optional `signEnvelope` / `verifyEnvelope` JWS layer. | `jose` only           |
| **x402 client** (opt-in)      | `@atlasprotocol/mpp/x402`           | `fetchWithPayment` — drop-in `fetch` that handles a 402 by paying on-chain (default: USDC ERC-20 via viem) and retrying. | `viem` (peer, optional) |
| **stripe-mpp client** (opt-in) | `@atlasprotocol/mpp/stripe-mpp`     | `fetchWithPaymentSpt` — drop-in `fetch` that handles a 402 by completing a Stripe SPT (Stablecoin Payment Token) charge through a caller-supplied callback and retrying. | none                  |

The wire format is intentionally chain-agnostic: it does not verify on-chain payments and it does not move funds. **On-chain verification (server-side), x402 settlement (client-side), and Stripe authorization + SPT minting (client-side) are the consumer's job.** The `x402` and `stripe-mpp` subpaths are reference client implementations; the server-side counterpart lives in `@atlasprotocol/server-sdk` (`generateMppChallenge`, `verifyPayment`, `verifyStripePayment`).

## Install

```bash
pnpm add @atlasprotocol/mpp
# Add viem only if you plan to use the x402 subpath:
pnpm add viem
# stripe-mpp has no runtime deps — the agent surface owns the Stripe call.
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

## Client-side: pay a 402 challenge with Stripe SPT

The `stripe-mpp` subpath gives you a drop-in `fetch` that handles a 402 by completing a Stripe Stablecoin Payment Token charge. Stripe's SPT pipeline lets the buyer pay in fiat (cards / Apple Pay / Google Pay / Link) and converts to USDC server-side. **The Stripe SDK call lives in your code, not in this package** — `stripe-mpp` calls back into your `getSpt` so the agent surface (Claude / ChatGPT / Gemini) can show the user the amount, get authorization, and complete the PaymentIntent however it wants.

```ts
import { fetchWithPaymentSpt } from "@atlasprotocol/mpp/stripe-mpp";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const response = await fetchWithPaymentSpt(
  "https://api.example.com/atlas/v1/events/evt_42/purchase",
  { method: "POST", body: JSON.stringify({ ticket_type_id: "ga", quantity: 1 }) },
  {
    // Safety: refuse 402s asking for more than this. In CENTS (USD).
    maxAmountUsdCents: 5000,
    // Safety: only complete SPTs for known platform receivers.
    allowedReceivers: ["stripe:acct_atlas_demo"],
    // Caller-owned: prompt the user, complete the Stripe PaymentIntent,
    // return the payment_intent_id once it has succeeded.
    getSpt: async ({ amount, currency, challenge_id }) => {
      // amount is in cents; currency is always "usd"
      const intent = await stripe.paymentIntents.create({
        amount,
        currency,
        confirm: true,
        payment_method: process.env.PAYMENT_METHOD_ID,
        metadata: { atlas_challenge: challenge_id },
      });
      if (intent.status !== "succeeded") {
        throw new Error(`Stripe intent did not succeed: ${intent.status}`);
      }
      return intent.id;
    },
    onPayment: ({ paymentIntentId, amountCents }) => {
      console.log(`paid ${amountCents}¢ via Stripe, intent=${paymentIntentId}`);
    },
  },
);
```

Failure modes:

- **No 402** → response is returned unchanged.
- **Safety check fails** → throws `MppPaymentRefusedError` with `err.reason` set to one of `no_stripe_method_offered`, `receiver-not-allowed`, `amount-exceeds-cap`, `amount-malformed`, `currency-not-usd`, `challenge-malformed`, `challenge-missing`. **No call to `getSpt` is made.**
- **`getSpt` rejects** → wrapped as `MppPaymentRefusedError` with `reason: "spt-callback-failed"`.
- **Server returns 402 again on retry** → that response is returned. The helper does not loop.

The retry credential carries the Stripe `payment_intent_id` in `metadata.payment_intent_id` — the form the server-side `verifyStripePayment` (in `@atlasprotocol/server-sdk`) inspects when accepting a settlement.

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
