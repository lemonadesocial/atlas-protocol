# Example — Next.js organizer app

Next.js 15 reference for the operator side of ATLAS — create events, expose them via the well-known manifest, and render the canonical ATLAS event schema produced by `@atlasprotocol/server-sdk`.

## Prerequisites

- Node.js 22+
- pnpm 9.15+

## Install + run

From the monorepo root:

```bash
pnpm install
pnpm build                                                      # builds workspace deps (server-sdk, connector-framework)
pnpm --filter @atlasprotocol/example-nextjs-organizer dev
```

Then visit <http://localhost:3000>.

## Tour

| Path                          | What it does                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `/`                           | Lists events from the in-memory store (three are seeded at startup).            |
| `/events/new`                 | Form + Server Action that creates a new event and redirects to its detail page. |
| `/events/[id]`                | Renders the source-platform fields plus the canonical ATLAS event JSON-LD.      |
| `/api/.well-known/atlas.json` | Serves the `AtlasManifest` produced by `generateManifest`.                      |

## Configuration

All values fall back to local-friendly defaults; override them via `.env.local`:

```
ATLAS_DOMAIN=your-domain.com
ATLAS_PLATFORM_NAME="Your Platform"
ATLAS_PLATFORM_URL=https://your-domain.com
ATLAS_PROTOCOL_FEE_PCT=2
ATLAS_PLATFORM_FEE_PCT=3
```

The example ships with `paymentMethods: []` and `signingKeys: []` in `src/lib/atlas-config.ts`. The manifest is therefore valid but advertises no settlement rails — production operators MUST replace these with real `PaymentMethodConfig` entries (e.g. `{ type: 'evm_usdc_base', receiverAddress: '0x...' }`) and real public JWKs.

## Customization

- **Storage** — swap `src/lib/event-store.ts` for a real DB (Postgres + Drizzle, MongoDB, etc.). Keep the `createEvent` / `listEvents` / `getEvent` signatures or update call sites accordingly.
- **Payment methods** — populate `paymentMethods` in `src/lib/atlas-config.ts` to advertise EVM USDC chains and/or Stripe SPT. The SDK uses these to verify on-chain transfers.
- **Signing keys** — populate `signingKeys` with the JWKs that sign your Atlas receipts so agents can verify them via `endpoints.receipt_verify`.

## Production readiness checklist

- [ ] Replace the in-memory store with persistent storage.
- [ ] Configure `paymentMethods` and `signingKeys` in `atlas-config.ts`.
- [ ] Set `ATLAS_DOMAIN` and `ATLAS_PLATFORM_URL` to the production hostnames.
- [ ] Implement the `/atlas/v1/events`, `/atlas/v1/search`, `/atlas/v1/events/{event_id}/purchase`, and `/atlas/v1/receipts/{receipt_id}/verify` endpoints advertised by the manifest.
- [ ] Add authentication / rate-limiting in front of the `Server Action` used for event creation.
- [ ] Run `pnpm build && pnpm test && pnpm lint` in CI.

## Scripts

| Script              | Action                             |
| ------------------- | ---------------------------------- |
| `pnpm dev`          | Next.js dev server on port 3000.   |
| `pnpm build`        | Production build via `next build`. |
| `pnpm start`        | Serve the production build.        |
| `pnpm test`         | Vitest unit tests.                 |
| `pnpm lint`         | `next lint --max-warnings=0`.      |
| `pnpm format:check` | Prettier check.                    |
| `pnpm typecheck`    | `tsc --noEmit`.                    |

## Related packages

- [`@atlasprotocol/server-sdk`](../../packages/server-sdk/README.md) — manifest generation, schema mapping, payment verification.
- [`@atlasprotocol/connector-framework`](../../packages/connector-framework/README.md) — connector interface for source-platform adapters.
