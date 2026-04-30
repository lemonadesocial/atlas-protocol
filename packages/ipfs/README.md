# @atlas/ipfs

Deterministic CID generation and pinning service abstractions for the ATLAS Protocol.

This package provides two things:

1. A small, dependency-light helper that turns any ATLAS payload (event, receipt, arbitrary JSON) into a stable, content-addressed identifier (CIDv1, raw codec, sha256, base32-lowercase).
2. A pluggable `Pinner` interface with first-party implementations for **Pinata**, **Web3.Storage**, **Filebase**, and a self-hosted **Kubo** daemon.

## Install

```bash
pnpm add @atlas/ipfs @atlas/server-sdk
```

`@atlas/server-sdk` is a peer dependency — `generateEventCid` accepts `AtlasEvent` from there.

## Quickstart — deterministic CID for an AtlasEvent

```ts
import { generateEventCid } from '@atlas/ipfs';
import type { AtlasEvent } from '@atlas/server-sdk';

const event: AtlasEvent = /* ... your AtlasEvent ... */;
const cid = await generateEventCid(event);
// e.g. "bafkrei..."
```

The same logical event — regardless of key insertion order — always yields the same CID.

## Quickstart — deterministic CID for a receipt

```ts
import { generateReceiptCid, type AtlasReceipt } from '@atlas/ipfs';

const receipt: AtlasReceipt = {
  purchase_id: 'p_123',
  event_id: 'e_abc',
  ticket_type_id: 'tt_1',
  buyer: '0x...',
  organizer: '0x...',
  amount: '25.00',
  currency: 'USD',
  rail: 'tempo_usdc',
  paid_at: '2026-04-30T12:00:00.000Z',
};
const cid = await generateReceiptCid(receipt);
```

## Choose your pinner

All pinners implement the same `Pinner` interface:

```ts
interface Pinner {
  pin(content: Uint8Array, opts?: PinOptions): Promise<PinResult>;
  unpin(cid: string): Promise<void>;
  isPinned(cid: string): Promise<boolean>;
}
```

### Pinata

```ts
import { PinataPinner } from '@atlas/ipfs';

const pinner = new PinataPinner({ jwt: process.env.PINATA_JWT! });
const { cid, size } = await pinner.pin(payload, { name: 'event.json' });
```

### Web3.Storage

```ts
import { Web3StoragePinner } from '@atlas/ipfs';

const pinner = new Web3StoragePinner({
  apiToken: process.env.W3UP_TOKEN!,
  spaceDID: 'did:key:...',
});
await pinner.pin(payload);
```

### Filebase

```ts
import { FilebasePinner } from '@atlas/ipfs';

const pinner = new FilebasePinner({
  apiToken: process.env.FILEBASE_TOKEN!,
  bucket: 'atlas-events',
});
await pinner.pin(payload);
```

### Kubo (self-hosted)

```ts
import { KuboPinner } from '@atlas/ipfs';

const pinner = new KuboPinner({ apiUrl: 'http://localhost:5001' });
await pinner.pin(payload);
```

## Determinism guarantee

`canonicalize(value)` and `generateCid(bytes)` are pure: identical logical inputs produce byte-identical canonical bytes and therefore byte-identical CIDs. The serialization rules are documented at the top of `src/canonicalize.ts`. Notably:

- Object keys are sorted lexicographically at every depth.
- `Date` values become ISO-8601 UTC strings.
- `undefined`-valued object fields are omitted (never serialized as `null`).
- `NaN`, `Infinity`, `BigInt`, `Map`, `Set`, cycles all throw.
- `-0` is normalized to `0`.

## Notes

- All pinner constructors take a config object. The package never reads environment variables — pass credentials in explicitly.
- `fetch` is injectable on every pinner for testing and for environments with custom HTTP transports.
- This package depends on `multiformats` and nothing else heavy. There is intentionally no Helia or w3up SDK dependency.
