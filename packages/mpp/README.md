# @atlas/mpp

Standalone implementation of the **Machine Payments Protocol (MPP)** envelope — `encode` / `decode` / `serialize` / `deserialize`, plus an optional JWS signing layer for cross-domain authenticity.

> The package is dependency-free against `@atlas/server-sdk`. It can be used by any HTTP-402 server or agent client.

## Quickstart

```bash
pnpm add @atlas/mpp
```

### Encode + decode an envelope

```ts
import { encode, decode, serialize, deserialize } from '@atlas/mpp';

const envelope = encode({
  rail: 'usdc-base',
  realm: 'api.example.com',
  paymentId: 'pay_abc123',
  amount: '12.50',
  currency: 'usd',
  recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
  description: 'Ticket: Lemonade x ATLAS Launch',
  expires: '2026-04-30T18:00:00.000Z',
  metadata: { event_id: 'evt_42' },
});

// Wire form suitable for the WWW-Authenticate / Authorization header.
const wire = serialize(envelope);

// Inverse — recover the developer-facing payload.
const recovered = decode(deserialize(wire));
```

### Sign + verify with JWS (ES256)

```ts
import { generateKeyPair } from 'jose';
import { encode, signEnvelope, verifyEnvelope } from '@atlas/mpp';

const { privateKey, publicKey } = await generateKeyPair('ES256');

const envelope = encode({
  rail: 'usdc-tempo',
  realm: 'api.example.com',
  paymentId: 'pay_signed',
  amount: '5.00',
  currency: 'usd',
  recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
});

const signed = await signEnvelope(envelope, {
  alg: 'ES256',
  kid: 'organizer-key-1',
  key: privateKey,
});

const result = await verifyEnvelope(signed, { alg: 'ES256', key: publicKey });
if (result.valid) {
  console.log('payload', result.payload);
}
```

## Supported rails

```ts
import { SUPPORTED_RAILS } from '@atlas/mpp';
// 'usdc-base' | 'usdc-tempo' | 'usdc-arbitrum' | 'usdc-polygon' | 'usdc-optimism' | 'stripe-spt'
```

`@atlas/mpp` accepts any rail string that conforms to the canonical MPP method identifier grammar — `isValidMethodIdentifier(s)` — so non-supported rails still flow through `decode()`.

## Conformance status

This package follows the canonical MPP wire shape published at <https://mpp.dev/protocol> (accessed 2026-04-30). It implements:

- The `Challenge` / `Credential` / `Receipt` envelope shape.
- Base64url-encoded JCS-canonicalized JSON for the request payload.
- The canonical method identifier grammar (lowercase alpha + digits + `:_-`).
- The reserved fields (`id`, `realm`, `method`, `intent`, `request`, `expires`, `description`, `digest`, `opaque`).

The MPP spec does **not** mandate JWS for envelope authenticity (it pins challenge ids via HMAC-SHA256 and lets each method define its own credential payload signature). The JWS layer in this package is an `@atlas/mpp` extension above the canonical spec — it is the natural choice when you want a single signed blob with cross-domain verifiability.

For every field where the spec leaves an ambiguity (organizer identity, line items, free-form metadata, MPP version literal), the implementation flags an `MPP-GAP-XXX` and documents the resolution in [`SPEC-NOTES.md`](./SPEC-NOTES.md).

## License

MIT
