# Changelog

All notable changes to `@atlas/mpp` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-30

### Added
- Initial release of the standalone MPP envelope package.
- `encode()` / `decode()` for the canonical Machine Payments Protocol challenge envelope (per <https://mpp.dev/protocol>).
- `serialize()` / `deserialize()` for the base64url-JCS wire form suitable for `WWW-Authenticate` and `Authorization` headers.
- `signEnvelope()` / `verifyEnvelope()` JWS signing layer (RFC 7515) supporting `ES256`, `EdDSA`, `RS256`, and `HS256`.
- `SUPPORTED_RAILS` enum (`usdc-base`, `usdc-tempo`, `usdc-arbitrum`, `usdc-polygon`, `usdc-optimism`, `stripe-spt`) with `isSupportedRail` and `isValidMethodIdentifier` guards.
- Type exports for `MppEnvelope`, `MppHeader`, `MppPayload`, `MppLineItem`, `SignedMppEnvelope`, `SigningKey`, `VerificationKey`, `Rail`.
- Conformance tests covering round-trip determinism and JCS-style canonical key ordering. See `SPEC-NOTES.md` for the gap log.
