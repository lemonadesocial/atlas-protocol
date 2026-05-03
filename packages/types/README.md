# @atlasprotocol/types

Shared TypeScript type definitions for the ATLAS Protocol. This is a pure-types package — no runtime code, no schema validators, no dependencies beyond `typescript` itself.

## What lives here

- **`AtlasEvent`** and supporting interfaces (`AtlasEventLocation`, `AtlasEventOrganizer`, `AtlasEventAvailability`, `AtlasEventStatus`, `AtlasPriceRange`)
- **`AtlasTicketType`** and supporting interfaces (`AtlasFee`, `AtlasPricing`, `AtlasTicketAvailability`, `AtlasTicketRestrictions`, `AtlasCancellationPolicy`)
- **`AtlasManifest`** and supporting interfaces
- **`AtlasPurchaseChallenge`**, **`AtlasPaymentMethod`**, **`AtlasPaymentMethodType`**, **`AtlasPaymentProof`**
- **`AtlasReceipt`** (W3C VC shape), **`AtlasReceiptCredentialSubject`**, **`AtlasReceiptSettlement`**, **`AtlasReceiptProof`**, **`ReceiptPaymentMethod`**
- **`Pinner`**, **`PinOptions`**, **`PinResult`**, **`FetchLike`** — IPFS pinning service abstraction

## Why a separate package

`@atlasprotocol/server-sdk` and `@atlasprotocol/ipfs` both need these shapes. Without a shared types package, the two SDKs would form a workspace dependency cycle (server-sdk imports `Pinner` from ipfs; ipfs imports `AtlasEvent` from server-sdk). Lifting the pure type definitions into this package lets each SDK depend only on `@atlasprotocol/types`, which depends on nothing.

## Install

```bash
pnpm add @atlasprotocol/types
```

Most consumers will not need this directly — `@atlasprotocol/server-sdk` and `@atlasprotocol/ipfs` re-export everything they consume from here for back-compat.

## Adoption

The protocol types in this package are the canonical definitions consumed across the SDK:

- `@atlasprotocol/server-sdk` imports `AtlasEvent`, `AtlasTicketType`, `AtlasManifest`, `AtlasPurchaseChallenge`, `AtlasReceipt`, and `Pinner` from here. Existing imports from `@atlasprotocol/server-sdk` keep working because server-sdk re-exports the same types — both paths resolve to the identical declarations, so they are mutually assignable.
- `@atlasprotocol/ipfs` imports `AtlasEvent` (consumed by `generateEventCid`) and the `Pinner` / `PinOptions` / `PinResult` / `FetchLike` interfaces from here. The four bundled pinner implementations (`PinataPinner`, `Web3StoragePinner`, `FilebasePinner`, `KuboPinner`) all implement the canonical `Pinner` from `@atlasprotocol/types`.
- `@atlasprotocol/connector-framework` imports `AtlasEvent` and `AtlasTicketType` from here directly.

New consumer code can import from `@atlasprotocol/types` directly; old code that imports the same names from `@atlasprotocol/server-sdk` or `@atlasprotocol/ipfs` continues to compile unchanged.
