# @atlasprotocol/connector-eventbrite-example

Reference implementation of an ATLAS Protocol connector for [Eventbrite](https://www.eventbrite.com/platform/api). Demonstrates how to fulfill the `@atlasprotocol/connector-framework` `Connector` contract by wrapping a third-party REST API: OAuth2 PKCE authorization, paginated `search`, single-event lookup, and ticket-class enumeration, with deterministic pure-function mappers from Eventbrite shapes to ATLAS JSON-LD.

> Marked `private: true` in `package.json` — this package is shipped as a learning resource, not a published artifact.

## Quickstart

1. Register an Eventbrite app at https://www.eventbrite.com/platform/api and copy the OAuth client id, client secret, and your private (personal) token.
2. Export the credentials. The connector itself reads no environment variables — these names follow the host application's `UPPER_SNAKE_CASE` convention so you can wire them into your own config layer:

   ```bash
   export EVENTBRITE_CLIENT_ID=...
   export EVENTBRITE_CLIENT_SECRET=...
   export EVENTBRITE_REDIRECT_URI=https://your-host.example.com/oauth/eventbrite/callback
   export EVENTBRITE_PRIVATE_TOKEN=...   # optional, for quick local testing
   ```
3. Construct the connector and call it from your host:

   ```ts
   import { EventbriteConnector } from '@atlasprotocol/connector-eventbrite-example';

   const connector = new EventbriteConnector({
     baseUrl: 'https://atlas.your-host.example.com',
     eventDefaults: { acceptedPaymentMethods: ['stripe_spt', 'base_usdc'] },
   });

   const events = await connector.search(
     { query: 'jazz', limit: 20 },
     { type: 'oauth2', accessToken: process.env.EVENTBRITE_PRIVATE_TOKEN! },
   );
   ```

## OAuth2 with PKCE

Eventbrite's OAuth2 flow follows the Authorization Code grant; for public clients we layer PKCE per [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636). The example exposes pure helpers in `src/auth.ts`:

- `generatePkcePair()` — emits a random 64-character `code_verifier` and the matching `S256` `code_challenge`.
- `buildAuthorizeUrl({ client, state, codeChallenge, scope })` — builds the URL the user is redirected to.
- `exchangeCodeForToken({ client, code, codeVerifier })` — completes the flow once Eventbrite redirects back with the auth code.
- `refreshAccessToken({ client, refreshToken })` — refreshes an expiring access token.

The host application owns persistence of `code_verifier`, `state`, and the issued tokens. The connector is stateless and accepts an `AuthContext` per call.

## Eventbrite search caveat

Eventbrite removed the public `/events/search/` endpoint in 2019. This example scopes search to the authenticated user's own events (`GET /users/me/events/`). For a production connector targeting a wider catalog, prefer the organization-scoped `GET /organizations/{org_id}/events/` endpoint and pipe the org id through the host's connector configuration.

`getEvent` and `listTicketTypes` are unaffected and behave as documented by Eventbrite (`GET /events/{id}/` and `GET /events/{id}/ticket_classes/`).

## Errors

The connector maps upstream errors onto the `@atlasprotocol/connector-framework` hierarchy:

| Upstream | Behavior |
|----------|----------|
| 401 / 403 | throws `AuthExpiredError` |
| 404 on `getEvent` | returns `null` |
| 429 | throws `RateLimitError`, with `retryAfterSeconds` populated from the `Retry-After` header when present |
| Other 4xx / 5xx | throws `ConnectorError` with a sanitized snippet of the upstream body |

## Running the tests

From the monorepo root:

```bash
pnpm --filter @atlasprotocol/connector-eventbrite-example test
```

Tests inject a mocked `fetch` via the connector's constructor — no network calls are made.

## License

MIT
