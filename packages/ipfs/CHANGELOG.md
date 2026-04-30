# Changelog

All notable changes to `@atlas/ipfs` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-30

### Added

- `canonicalize(value)` — deterministic UTF-8 JSON serialization with sorted keys, ISO-8601 dates, JCS-style omission of `undefined` fields, and rejection of non-finite numbers / BigInt / Map / Set / cycles.
- `generateCid(bytes)` — CIDv1 (raw codec, sha256, base32 lowercase) for an arbitrary byte payload.
- `generateEventCid(event)` — deterministic CID for an `AtlasEvent` (peer-dep on `@atlas/server-sdk`).
- `generateReceiptCid(receipt)` — deterministic CID for an `AtlasReceipt` (interim local type until standardized).
- `Pinner` interface plus four implementations: `PinataPinner`, `Web3StoragePinner`, `FilebasePinner`, `KuboPinner`.
- All pinner constructors accept an injectable `fetch`; no environment variables are read by the package.
