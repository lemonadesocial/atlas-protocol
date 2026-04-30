# Changelog

All notable changes to `@atlasprotocol/ipfs` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-04-30)


### Features

* **ipfs:** @atlas/ipfs deterministic CID generation and pinning service abstraction ([9478012](https://github.com/lemonadesocial/atlas-protocol/commit/9478012e5beaeb4de9e53fe9dc8517141330f561))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 1.0.0
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 1.0.0

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
