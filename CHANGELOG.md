# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
### Added
- Monorepo structure with pnpm workspaces.
- Foundry skeleton for protocol contracts.
- CI pipeline for typecheck, lint, build, test.
- `@atlas/agent-tools` v0.1.0 — agent-side tooling (LangChain tool builder, MCP tool/resource/prompt registrars, x402-aware HTTP client) extracted from the lemonade-ai reference implementation.
- `@atlas/server-sdk` v0.1.0 — framework-agnostic server primitives (manifest generator, schema mapper, multi-chain payment verifier) extracted from the lemonade-backend reference implementation.
- `@atlas/connector-framework` v0.1.0 — abstract `Connector` interface and error hierarchy that external event platforms implement to emit ATLAS-compliant events.
- `@atlas/connector-eventbrite-example` v0.1.0 — first reference connector (Eventbrite v3) demonstrating the framework, including OAuth2 PKCE auth helpers and pure mappers.
- `contracts/FeeRouter.sol` — Stage 1 UUPS-upgradeable contract that splits incoming USDC payments at a configurable bps fee, with idempotent settlement, role-gated admin, pause, and a 256-run fuzz test suite under Foundry.
- `@atlas/mpp` v0.1.0 — Machine Payments Protocol envelope encoder, decoder, and optional JOSE/JWS signing layer (https://mpp.dev/protocol).
- `@atlas/ipfs` v0.1.0 — deterministic JSON canonicalization, CIDv1 generation (raw + sha256 + base32), and a `Pinner` abstraction with Pinata, Web3.Storage, Filebase, and Kubo backends.
