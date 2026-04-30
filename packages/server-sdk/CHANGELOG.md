# Changelog

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
