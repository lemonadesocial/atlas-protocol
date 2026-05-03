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
