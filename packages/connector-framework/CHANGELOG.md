# Changelog

All notable changes to this package will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2](https://github.com/lemonadesocial/atlas-protocol/compare/connector-framework-v0.3.1...connector-framework-v0.3.2) (2026-05-04)


### Bug Fixes

* **connector-framework:** add npm homepage link ([5f73036](https://github.com/lemonadesocial/atlas-protocol/commit/5f7303636350023975729694b4c6747cf1250ad1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/server-sdk bumped to 0.6.1

## [0.3.1](https://github.com/lemonadesocial/atlas-protocol/compare/connector-framework-v0.3.0...connector-framework-v0.3.1) (2026-05-03)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/server-sdk bumped to 0.6.0
    * @atlasprotocol/types bumped to 0.2.0

## [0.3.0](https://github.com/lemonadesocial/atlas-protocol/compare/connector-framework-v0.2.2...connector-framework-v0.3.0) (2026-05-03)


### Features

* **types,server-sdk,ipfs:** document types consolidation + complete cleanup ([#49](https://github.com/lemonadesocial/atlas-protocol/issues/49)) ([4e6b3e2](https://github.com/lemonadesocial/atlas-protocol/commit/4e6b3e26c33fe5796cb696b7055fd19bc85df4f5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/server-sdk bumped to 0.5.0
    * @atlasprotocol/types bumped to 0.1.0

## [0.2.2](https://github.com/lemonadesocial/atlas-protocol/compare/connector-framework-v0.2.1...connector-framework-v0.2.2) (2026-05-03)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/server-sdk bumped to 0.4.0

## [0.2.1](https://github.com/lemonadesocial/atlas-protocol/compare/connector-framework-v0.2.0...connector-framework-v0.2.1) (2026-05-03)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/server-sdk bumped to 0.3.0

## [0.2.0](https://github.com/lemonadesocial/atlas-protocol/compare/connector-framework-v0.1.2...connector-framework-v0.2.0) (2026-05-02)


### Features

* **server-sdk:** adoption polish — idempotency, rate limiting, validation ([#37](https://github.com/lemonadesocial/atlas-protocol/issues/37)) ([5820403](https://github.com/lemonadesocial/atlas-protocol/commit/5820403fec5047cd00316e0dd2b6f51573551abb))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @atlasprotocol/server-sdk bumped to 0.2.0

## [0.1.2](https://github.com/lemonadesocial/atlas-protocol/compare/connector-framework-v0.1.1...connector-framework-v0.1.2) (2026-05-01)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 0.2.0
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 0.2.0

## [0.1.1](https://github.com/lemonadesocial/atlas-protocol/compare/connector-framework-v0.1.0...connector-framework-v0.1.1) (2026-04-30)


### Bug Fixes

* clarify intent across remaining [@atlasprotocol](https://github.com/atlasprotocol) packages ([#20](https://github.com/lemonadesocial/atlas-protocol/issues/20)) ([782c89c](https://github.com/lemonadesocial/atlas-protocol/commit/782c89ce8880a60f5a8c9b108387e099bac5d266))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 0.1.1
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 0.1.1

## 0.1.0 (2026-04-30)


### Features

* **connector-framework:** abstract Connector interface and types ([3902520](https://github.com/lemonadesocial/atlas-protocol/commit/39025209e0e266ca0fcdb45909c8bb57c8bf6c5d))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @atlasprotocol/server-sdk bumped to 0.1.0
  * peerDependencies
    * @atlasprotocol/server-sdk bumped to 0.1.0

## [0.1.0] - 2026-04-30

### Added

- `Connector` interface defining the `search`, `getEvent`, and `listTicketTypes` operations every source-platform adapter implements.
- `ConnectorCapabilities` descriptor for advertising supported operations and realtime support.
- `SearchParams` type covering free-text query, date range, geographic radius search, pagination limit, and opaque cursor.
- `AuthContext` discriminated union supporting OAuth2 (with optional refresh token) and API-key authentication.
- Structured error hierarchy: `ConnectorError` base class plus `AuthExpiredError`, `RateLimitError` (carries optional `retryAfterSeconds`), and `NotFoundError`.
- Re-export of `AtlasEvent` and `AtlasTicketType` peer types from `@atlasprotocol/server-sdk` via the connector return-type contracts.

### Notes

Packaging linter audit (publint / arethetypeswrong) surfaced the following non-critical items that are not fixed in this release:

- ESM-only package — CommonJS consumers must use dynamic `import()`. By design (`"type": "module"`).
- `pkg.repository.url` lacks a `git+` prefix (cosmetic publint suggestion only).
- `pkg.main` is set; `pkg.exports` is the modern equivalent. Migration to `exports` is a breaking change deferred to a future minor release.
