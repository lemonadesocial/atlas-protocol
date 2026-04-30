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

## Spec reference

See [`../../specs/01-PROTOCOL-SPEC.md`](../../specs/01-PROTOCOL-SPEC.md) for the full ATLAS Protocol manifest format, capability list, and signing-key requirements.

## License

MIT
