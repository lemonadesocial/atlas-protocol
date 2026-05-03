# @atlasprotocol/ipfs

Deterministic CID generation and pinning service abstractions for the ATLAS Protocol.

This package provides two things:

1. A small, dependency-light helper that turns any ATLAS payload (event, receipt, arbitrary JSON) into a stable, content-addressed identifier (CIDv1, raw codec, sha256, base32-lowercase).
2. A pluggable `Pinner` interface with first-party implementations for **Pinata**, **Web3.Storage**, **Filebase**, and a self-hosted **Kubo** daemon.

## Install

```bash
pnpm add @atlasprotocol/ipfs
```

`generateEventCid` accepts an `AtlasEvent` from `@atlasprotocol/types`. That package is pulled in transitively through `@atlasprotocol/ipfs` — install it explicitly only if you import the type yourself.

## Quickstart — deterministic CID for an AtlasEvent

```ts
import { generateEventCid } from '@atlasprotocol/ipfs';
import type { AtlasEvent } from '@atlasprotocol/types';

const event: AtlasEvent = /* ... your AtlasEvent ... */;
const cid = await generateEventCid(event);
// e.g. "bafkrei..."
```

The same logical event — regardless of key insertion order — always yields the same CID.

## Quickstart — deterministic CID for a receipt

```ts
import { generateReceiptCid, type AtlasReceipt } from '@atlasprotocol/ipfs';

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
  pinJson(obj: unknown, opts?: PinOptions): Promise<PinResult>;
  pinBytes(content: Uint8Array, opts?: PinOptions): Promise<PinResult>;
  unpin(cid: string): Promise<void>;
  isPinned(cid: string): Promise<boolean>;
}
```

### Why two methods?

`pinJson` canonicalizes its input (sorted keys at every depth, no whitespace, see `canonicalize.ts`) before encoding to UTF-8 bytes and uploading. `pinBytes` pins the bytes you hand it, verbatim.

Picking the right method is a **type-level correctness gate**, not just an ergonomics choice. With a single `pin(bytes)` API it is trivially possible for two callers to serialize the same logical object with different key orders and end up with different CIDs — a silent integrity-verification footgun. Splitting the API forces the decision: if you have an `object`, you want `pinJson`; if you have raw `Uint8Array`, you want `pinBytes`.

### Two semantically equivalent objects → same CID

```ts
const a = { foo: 1, bar: { x: 1, y: 2 } };
const b = { bar: { y: 2, x: 1 }, foo: 1 };

const r1 = await pinner.pinJson(a);
const r2 = await pinner.pinJson(b);

r1.cid === r2.cid; // true — canonical bytes are identical
```

Equivalently, `pinJson(obj)` is exactly `pinBytes(canonicalize(obj))` with the JSON filename default applied. Use `pinBytes(canonicalize(obj))` only if you need to inspect or sign the canonical bytes yourself before upload.

### Pinata

```ts
import { PinataPinner } from '@atlasprotocol/ipfs';

const pinner = new PinataPinner({ jwt: process.env.PINATA_JWT! });

// JSON: canonicalized, then pinned. Default filename atlas-payload.json.
const { cid, size } = await pinner.pinJson(receipt, { name: 'event.json' });

// Raw bytes (e.g. an image): pinned verbatim.
await pinner.pinBytes(imageBytes, { name: 'cover.png' });
```

### Web3.Storage

```ts
import { Web3StoragePinner } from '@atlasprotocol/ipfs';

const pinner = new Web3StoragePinner({
  apiToken: process.env.W3UP_TOKEN!,
  spaceDID: 'did:key:...',
});
await pinner.pinJson(receipt);
await pinner.pinBytes(imageBytes, { name: 'cover.png' });
```

### Filebase

```ts
import { FilebasePinner } from '@atlasprotocol/ipfs';

const pinner = new FilebasePinner({
  apiToken: process.env.FILEBASE_TOKEN!,
  bucket: 'atlas-events',
});
await pinner.pinJson(receipt);
await pinner.pinBytes(imageBytes, { name: 'cover.png' });
```

### Kubo (self-hosted)

```ts
import { KuboPinner } from '@atlasprotocol/ipfs';

const pinner = new KuboPinner({ apiUrl: 'http://localhost:5001' });
await pinner.pinJson(receipt);
await pinner.pinBytes(imageBytes, { name: 'cover.png' });
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
