# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 (2026-04-30)


### Features

* **agent-tools:** extract @atlas/agent-tools from lemonade-ai reference implementation ([8d01d99](https://github.com/lemonadesocial/atlas-protocol/commit/8d01d99c7c0332822999fd6f5ac1b9b63312b618))

## [0.1.0] — Unreleased

### Added

- Initial agent-side tooling for the ATLAS Protocol, extracted from the
  reference implementation.
- `createAtlasHttpClient(config)` — low-level HTTP client speaking the
  Registry and Backend surfaces, with one-shot retry on transient errors and
  pass-through of HTTP 402 payment challenges to the caller.
- `buildAtlasLangChainTools(options)` — returns the four protocol tools as
  LangChain `DynamicStructuredTool` instances, with an optional
  caller-state generic and an `onResult` hook for surfacing tool output into
  caller-owned state.
- `registerAtlasMcpTools(server, config)` — registers the four protocol
  tools on an `McpServer`.
- `registerAtlasMcpResources(server, options)` — registers the
  `atlas://pricing` resource (always) and `atlas://verification` (when a
  `loadVerificationStatus` loader is supplied).
- `registerAtlasMcpPrompts(server, config)` — registers the three starter
  prompts (`find_events_near_me`, `compare_ticket_prices`,
  `buy_tickets_for_event`).
- Public type surface re-exported from the package entry point.

### Changed (vs. reference impl)

- No `process.env` reads inside the package — all configuration is explicit.
- Pino logger replaced with a minimal `Logger` interface; defaults to a no-op.
- LangChain state coupling replaced with a generic `TState` parameter and an
  optional `onResult` hook.
- Standardized on Zod v4.
- Verification resource accepts a pluggable `loadVerificationStatus` loader,
  decoupling the package from any specific identity provider.

### Notes

Packaging linter audit (publint / arethetypeswrong) surfaced the following non-critical items that are not fixed in this release:

- ESM-only package — CommonJS consumers must use dynamic `import()`. By design (`"type": "module"`).
- `pkg.repository.url` lacks a `git+` prefix (cosmetic publint suggestion only).
- `pkg.main` is set; `pkg.exports` is the modern equivalent. Migration to `exports` is a breaking change deferred to a future minor release.
