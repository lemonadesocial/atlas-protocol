# Changelog

All notable changes to this package will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
