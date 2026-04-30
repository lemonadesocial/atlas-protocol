# Changelog

All notable changes to this package will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-30

### Added

- Next.js 15 App Router skeleton (React 19) demonstrating the operator side of the ATLAS Protocol.
- In-memory event store seeded with three demo events; create flow via Server Action that redirects to the event detail page.
- Event detail page renders both the source-platform fields and the canonical schema produced by `toAtlasEvent` from `@atlasprotocol/server-sdk`.
- `/api/.well-known/atlas.json` route serving a manifest built with `generateManifest` from the same SDK.
- `getAtlasConfig` helper composing a `ServerSdkConfig` from environment variables with sensible local defaults.
- Vitest unit test asserting required fields on the generated manifest.
- ESLint, Prettier, and TypeScript configuration aligned with the monorepo conventions (Bundler module resolution, `composite: false` override required by Next.js).
