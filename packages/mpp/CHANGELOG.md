# Changelog

All notable changes to `@atlasprotocol/mpp` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/lemonadesocial/atlas-protocol/compare/mpp-v0.2.0...mpp-v0.2.0) (2026-05-02)


### Features

* **server-sdk:** correctness layer — receipts, holds, replay, expiry, approval flow ([#35](https://github.com/lemonadesocial/atlas-protocol/issues/35)) ([ad369c6](https://github.com/lemonadesocial/atlas-protocol/commit/ad369c6f2df2c31b3057ed22eaf1dd0ba54c9dee))

## [0.2.0](https://github.com/lemonadesocial/atlas-protocol/compare/mpp-v0.1.1...mpp-v0.2.0) (2026-05-01)


### Features

* **mpp:** add Stripe MPP client subpath for SPT-based payments ([#28](https://github.com/lemonadesocial/atlas-protocol/issues/28)) ([ca39281](https://github.com/lemonadesocial/atlas-protocol/commit/ca39281975dd4d1fe139e372be812012090398b3))
* **mpp:** add x402 client helper for agent-side payment handling ([#24](https://github.com/lemonadesocial/atlas-protocol/issues/24)) ([7108486](https://github.com/lemonadesocial/atlas-protocol/commit/7108486f0fc77be8166289e9377530f5fae7cd76))

## [0.1.1](https://github.com/lemonadesocial/atlas-protocol/compare/mpp-v0.1.0...mpp-v0.1.1) (2026-04-30)


### Bug Fixes

* clarify intent across remaining [@atlasprotocol](https://github.com/atlasprotocol) packages ([#20](https://github.com/lemonadesocial/atlas-protocol/issues/20)) ([782c89c](https://github.com/lemonadesocial/atlas-protocol/commit/782c89ce8880a60f5a8c9b108387e099bac5d266))

## 0.1.0 (2026-04-30)


### Features

* **mpp:** @atlas/mpp envelope encoder, signer, verifier (Stripe MPP) ([163255e](https://github.com/lemonadesocial/atlas-protocol/commit/163255e42f57aab6810e9468b09be1240d9c8f16))

## [0.1.0] - 2026-04-30

### Added
- Initial release of the standalone MPP envelope package.
- `encode()` / `decode()` for the canonical Machine Payments Protocol challenge envelope (per <https://mpp.dev/protocol>).
- `serialize()` / `deserialize()` for the base64url-JCS wire form suitable for `WWW-Authenticate` and `Authorization` headers.
- `signEnvelope()` / `verifyEnvelope()` JWS signing layer (RFC 7515) supporting `ES256`, `EdDSA`, `RS256`, and `HS256`.
- `SUPPORTED_RAILS` enum (`usdc-base`, `usdc-tempo`, `usdc-arbitrum`, `usdc-polygon`, `usdc-optimism`, `stripe-spt`) with `isSupportedRail` and `isValidMethodIdentifier` guards.
- Type exports for `MppEnvelope`, `MppHeader`, `MppPayload`, `MppLineItem`, `SignedMppEnvelope`, `SigningKey`, `VerificationKey`, `Rail`.
- Conformance tests covering round-trip determinism and JCS-style canonical key ordering. See `SPEC-NOTES.md` for the gap log.

### Notes

Packaging linter audit (publint / arethetypeswrong) surfaced the following non-critical items that are not fixed in this release:

- ESM-only package — CommonJS consumers must use dynamic `import()`. By design (`"type": "module"`).
- `pkg.repository.url` lacks a `git+` prefix (cosmetic publint suggestion only).
- `pkg.main` is set; `pkg.exports` is the modern equivalent. Migration to `exports` is a breaking change deferred to a future minor release.
