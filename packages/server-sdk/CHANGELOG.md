# Changelog

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
