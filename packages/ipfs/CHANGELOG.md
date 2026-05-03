# Changelog

All notable changes to `@atlasprotocol/ipfs` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0](https://github.com/lemonadesocial/atlas-protocol/compare/ipfs-v0.2.0...ipfs-v0.3.0) (2026-05-03)


### Features

* **types,server-sdk,ipfs:** document types consolidation + complete cleanup ([#49](https://github.com/lemonadesocial/atlas-protocol/issues/49)) ([4e6b3e2](https://github.com/lemonadesocial/atlas-protocol/commit/4e6b3e26c33fe5796cb696b7055fd19bc85df4f5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/types bumped to 1.0.0

## [0.2.0](https://github.com/lemonadesocial/atlas-protocol/compare/ipfs-v0.1.6...ipfs-v0.2.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* **ipfs,server-sdk:** Pinner.pin(content) is removed in favor of pinJson(obj) and pinBytes(content). generateReceipt is now async and returns { receipt, cid? } instead of AtlasReceipt directly. ATLAS is pre-production; no external consumers yet.

### Features

* **ipfs,server-sdk:** typed Pinner interface (pinJson/pinBytes) + receipt auto-pinning ([#44](https://github.com/lemonadesocial/atlas-protocol/issues/44)) ([4ea0da2](https://github.com/lemonadesocial/atlas-protocol/commit/4ea0da243e5098bc7472d1d8254b6cecd95be474))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 0.4.0
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 0.4.0

## [0.1.6](https://github.com/lemonadesocial/atlas-protocol/compare/ipfs-v0.1.5...ipfs-v0.1.6) (2026-05-03)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 0.3.0
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 0.3.0

## [0.1.5](https://github.com/lemonadesocial/atlas-protocol/compare/ipfs-v0.1.4...ipfs-v0.1.5) (2026-05-02)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 0.2.0
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 0.2.0

## [0.1.4](https://github.com/lemonadesocial/atlas-protocol/compare/ipfs-v0.1.3...ipfs-v0.1.4) (2026-05-01)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 0.2.0
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 0.2.0

## [0.1.3](https://github.com/lemonadesocial/atlas-protocol/compare/ipfs-v0.1.2...ipfs-v0.1.3) (2026-04-30)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 0.1.1
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 0.1.1

## [0.1.2](https://github.com/lemonadesocial/atlas-protocol/compare/ipfs-v0.1.1...ipfs-v0.1.2) (2026-04-30)


### Bug Fixes

* **ipfs:** document canonicalization step in generateEventCid jsdoc ([#16](https://github.com/lemonadesocial/atlas-protocol/issues/16)) ([cb8a90a](https://github.com/lemonadesocial/atlas-protocol/commit/cb8a90afa5872c5cc8cefbf091019fda6a41c41e))

## [0.1.1](https://github.com/lemonadesocial/atlas-protocol/compare/ipfs-v0.1.0...ipfs-v0.1.1) (2026-04-30)


### Bug Fixes

* **ipfs:** clarify generateCid input contract in jsdoc ([#13](https://github.com/lemonadesocial/atlas-protocol/issues/13)) ([3592ea4](https://github.com/lemonadesocial/atlas-protocol/commit/3592ea4e25cfe719ba159077008110e8f7a87a24))

## 0.1.0 (2026-04-30)


### Features

* **ipfs:** @atlas/ipfs deterministic CID generation and pinning service abstraction ([9478012](https://github.com/lemonadesocial/atlas-protocol/commit/9478012e5beaeb4de9e53fe9dc8517141330f561))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 0.1.0
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 0.1.0

## [0.1.0] - 2026-04-30

### Added

- `canonicalize(value)` — deterministic UTF-8 JSON serialization with sorted keys, ISO-8601 dates, JCS-style omission of `undefined` fields, and rejection of non-finite numbers / BigInt / Map / Set / cycles.
- `generateCid(bytes)` — CIDv1 (raw codec, sha256, base32 lowercase) for an arbitrary byte payload.
- `generateEventCid(event)` — deterministic CID for an `AtlasEvent` (peer-dep on `@atlasprotocol/server-sdk`).
- `generateReceiptCid(receipt)` — deterministic CID for an `AtlasReceipt` (interim local type until standardized).
- `Pinner` interface plus four implementations: `PinataPinner`, `Web3StoragePinner`, `FilebasePinner`, `KuboPinner`.
- All pinner constructors accept an injectable `fetch`; no environment variables are read by the package.

### Notes

Packaging linter audit (publint / arethetypeswrong) surfaced the following non-critical items that are not fixed in this release:

- ESM-only package — CommonJS consumers must use dynamic `import()`. By design (`"type": "module"`).
- `pkg.repository.url` lacks a `git+` prefix (cosmetic publint suggestion only).
- `pkg.main` is set; `pkg.exports` is the modern equivalent. Migration to `exports` is a breaking change deferred to a future minor release.
