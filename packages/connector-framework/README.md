# @atlasprotocol/connector-framework

The `@atlasprotocol/connector-framework` package defines the contract every source-platform adapter implements so an ATLAS host can index, search, and fetch events from heterogeneous ticketing platforms (Eventbrite, Lu.ma, Meetup, etc.) through one uniform interface. It ships only types, capability descriptors, and structured error classes — there is no runtime dependency on any specific platform, and connectors stay stateless with respect to credentials by accepting an `AuthContext` per call.

## How to write a connector

1. Add `@atlasprotocol/connector-framework` and `@atlasprotocol/server-sdk` to your package dependencies.
2. Export an object that implements the `Connector` interface:
   - Set `id`, `name`, and `authMethod` (`'oauth2'` or `'apikey'`).
   - Declare `capabilities` so the host knows which operations to expose.
   - Implement `search`, `getEvent`, and `listTicketTypes`. Each method receives the request parameters plus an `AuthContext` and returns ATLAS-shaped data (`AtlasEvent`, `AtlasTicketType`).
3. Map upstream errors to the framework's error types: throw `AuthExpiredError` on 401, `RateLimitError(message, retryAfterSeconds)` on 429, and return `null` from `getEvent` for 404 (do not throw).
4. Keep mappers as pure functions in a `mappers.ts` so they can be unit tested against deterministic fixtures.

See [`examples/connector-eventbrite`](../../examples/connector-eventbrite/) for a complete reference implementation that covers OAuth2 PKCE, REST pagination, and field-by-field upstream → ATLAS mapping with full test coverage.

## License

MIT
