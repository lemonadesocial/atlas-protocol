# Changelog

## [0.6.0](https://github.com/lemonadesocial/atlas-protocol/compare/server-sdk-v0.5.0...server-sdk-v0.6.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* **contracts,server-sdk:** FeeRouter.settle now accepts a FeeSplit[] array of stacked platform fees and emits richer PaymentSettled. New reverseSettle function and REFUND_ROLE for refund flow. Protocol fee default lowered from 2% to 0.5%. Caps added: MAX_TOTAL_PLATFORM_FEES_BPS=2000 (20%), MIN_ORGANIZER_BPS=7000 (70%). server-sdk: buildSettleTx signature change, new buildReverseSettleTx helper. ATLAS pre-production; no contracts deployed; safe to break ABI.

### Features

* **contracts,server-sdk:** atlasTicket v2 — multi-chain, burn, custodial pattern ([#55](https://github.com/lemonadesocial/atlas-protocol/issues/55)) ([e2d3115](https://github.com/lemonadesocial/atlas-protocol/commit/e2d311579f5ec4d5854926390af0a4666832da65))
* **contracts,server-sdk:** feeRouter v2 — stacked fees, refund, 0.5% protocol fee ([#54](https://github.com/lemonadesocial/atlas-protocol/issues/54)) ([555fee0](https://github.com/lemonadesocial/atlas-protocol/commit/555fee05264ecc941cb627c3333956b315ac527e))
* **contracts,server-sdk:** rewardLedger v2 — refund/reverse rewards ([#56](https://github.com/lemonadesocial/atlas-protocol/issues/56)) ([41e8ac2](https://github.com/lemonadesocial/atlas-protocol/commit/41e8ac257fbe55976f81dfe680d240d1df6a80bf))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/types bumped to 0.2.0

## [0.5.0](https://github.com/lemonadesocial/atlas-protocol/compare/server-sdk-v0.4.0...server-sdk-v0.5.0) (2026-05-03)


### Features

* **types,server-sdk,ipfs:** document types consolidation + complete cleanup ([#49](https://github.com/lemonadesocial/atlas-protocol/issues/49)) ([4e6b3e2](https://github.com/lemonadesocial/atlas-protocol/commit/4e6b3e26c33fe5796cb696b7055fd19bc85df4f5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/types bumped to 0.1.0

## [0.4.0](https://github.com/lemonadesocial/atlas-protocol/compare/server-sdk-v0.3.0...server-sdk-v0.4.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* **ipfs,server-sdk:** Pinner.pin(content) is removed in favor of pinJson(obj) and pinBytes(content). generateReceipt is now async and returns { receipt, cid? } instead of AtlasReceipt directly. ATLAS is pre-production; no external consumers yet.

### Features

* **contracts,server-sdk:** add AtlasTicket NFT contract + SDK helpers ([#41](https://github.com/lemonadesocial/atlas-protocol/issues/41)) ([55f239b](https://github.com/lemonadesocial/atlas-protocol/commit/55f239b0742a8be1afa1e63accab9a2ab69c50a5))
* **contracts,server-sdk:** add RewardLedger accrual + claim contract + SDK helpers ([#43](https://github.com/lemonadesocial/atlas-protocol/issues/43)) ([97f0464](https://github.com/lemonadesocial/atlas-protocol/commit/97f04643264b3d4d131c864defca6b88b73f0f17))
* **ipfs,server-sdk:** typed Pinner interface (pinJson/pinBytes) + receipt auto-pinning ([#44](https://github.com/lemonadesocial/atlas-protocol/issues/44)) ([4ea0da2](https://github.com/lemonadesocial/atlas-protocol/commit/4ea0da243e5098bc7472d1d8254b6cecd95be474))
* **server-sdk,examples:** end-to-end integration test + dual-protocol-server polish ([#45](https://github.com/lemonadesocial/atlas-protocol/issues/45)) ([020d9c9](https://github.com/lemonadesocial/atlas-protocol/commit/020d9c961dfefc9f57a9cf882b620d4b8255248c))


### Bug Fixes

* **server-sdk:** drop @atlasprotocol/ipfs workspace dep to break release-please cycle ([#46](https://github.com/lemonadesocial/atlas-protocol/issues/46)) ([509f85f](https://github.com/lemonadesocial/atlas-protocol/commit/509f85f5af2855396262d82163567616ad3b95c1))

## [0.3.0](https://github.com/lemonadesocial/atlas-protocol/compare/server-sdk-v0.2.0...server-sdk-v0.3.0) (2026-05-03)


### Features

* **server-sdk:** adoption polish — idempotency, rate limiting, validation ([#37](https://github.com/lemonadesocial/atlas-protocol/issues/37)) ([5820403](https://github.com/lemonadesocial/atlas-protocol/commit/5820403fec5047cd00316e0dd2b6f51573551abb))
* **server-sdk:** correctness layer — receipts, holds, replay, expiry, approval flow ([#35](https://github.com/lemonadesocial/atlas-protocol/issues/35)) ([ad369c6](https://github.com/lemonadesocial/atlas-protocol/commit/ad369c6f2df2c31b3057ed22eaf1dd0ba54c9dee))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/mpp bumped to 0.3.0

## [0.2.0](https://github.com/lemonadesocial/atlas-protocol/compare/server-sdk-v0.2.0...server-sdk-v0.2.0) (2026-05-02)


### Features

* **server-sdk:** adoption polish — idempotency, rate limiting, validation ([#37](https://github.com/lemonadesocial/atlas-protocol/issues/37)) ([5820403](https://github.com/lemonadesocial/atlas-protocol/commit/5820403fec5047cd00316e0dd2b6f51573551abb))
* **server-sdk:** correctness layer — receipts, holds, replay, expiry, approval flow ([#35](https://github.com/lemonadesocial/atlas-protocol/issues/35)) ([ad369c6](https://github.com/lemonadesocial/atlas-protocol/commit/ad369c6f2df2c31b3057ed22eaf1dd0ba54c9dee))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/mpp bumped to 0.2.0

## [0.2.0](https://github.com/lemonadesocial/atlas-protocol/compare/server-sdk-v0.1.1...server-sdk-v0.2.0) (2026-05-01)


### Features

* **server-sdk:** add challenge gen, Stripe verifier, multi-L2 specs ([#25](https://github.com/lemonadesocial/atlas-protocol/issues/25)) ([4bbc3bf](https://github.com/lemonadesocial/atlas-protocol/commit/4bbc3bfd4285b7889926c7334dccc078dc19d226))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/mpp bumped to 0.2.0

## [0.1.1](https://github.com/lemonadesocial/atlas-protocol/compare/server-sdk-v0.1.0...server-sdk-v0.1.1) (2026-04-30)


### Bug Fixes

* clarify intent across remaining [@atlasprotocol](https://github.com/atlasprotocol) packages ([#20](https://github.com/lemonadesocial/atlas-protocol/issues/20)) ([782c89c](https://github.com/lemonadesocial/atlas-protocol/commit/782c89ce8880a60f5a8c9b108387e099bac5d266))

## 0.1.0 (2026-04-30)


### Features

* **server-sdk:** extract @atlas/server-sdk from lemonade-backend reference implementation ([a8d06e0](https://github.com/lemonadesocial/atlas-protocol/commit/a8d06e086d9b780c12ae9080ecb08f22efa322de))

## 0.1.0

Initial release.

- `generateManifest(config, options?)` and `generateSpaceManifest(config, args)` build the canonical `.well-known/atlas.json` shape.
- `createWellKnownHandler(config)` returns a framework-agnostic Node `http` request handler.
- `toAtlasEvent(event, space, ticketTypes, options)` and `toAtlasTicketType(ticketType, event, options)` convert source-platform data into ATLAS JSON-LD.
- `verifyPayment(config, proof, params, deps?)` verifies multi-chain USDC transfers (Tempo, Base, Arbitrum, Polygon, Optimism, zkSync) via viem and delegates Stripe SPT verification to a host-supplied callback.
- Public types: `AtlasEvent`, `AtlasTicketType`, `AtlasManifest`, `AtlasPurchaseChallenge`, `AtlasPaymentProof`, `AtlasPaymentVerifyResult`.
- Pluggable `Logger` interface; defaults to a no-op so the package emits nothing unless wired up.

### Notes

Packaging linter audit (publint / arethetypeswrong) surfaced the following non-critical items that are not fixed in this release:

- ESM-only package — CommonJS consumers must use dynamic `import()`. By design (`"type": "module"`).
- `pkg.repository.url` lacks a `git+` prefix (cosmetic publint suggestion only).
- `pkg.main` is set; `pkg.exports` is the modern equivalent. Migration to `exports` is a breaking change deferred to a future minor release.
