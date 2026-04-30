# Changelog

All notable changes to this package will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-30

### Added

- `EventbriteConnector` class implementing the `@atlas/connector-framework` `Connector` interface (`search`, `getEvent`, `listTicketTypes`).
- `EventbriteApiClient` thin REST wrapper over `https://www.eventbriteapi.com/v3/` with injectable `fetch` for testability.
- Pure mappers `eventbriteEventToAtlas` and `eventbriteTicketClassToAtlas` covering name, description, start/end, venue + geo, organizer, status, online vs in-person attendance mode, currency, pricing breakdown (base + fees + tax), availability with sold-out / few-remaining / hidden detection, and metadata pass-through.
- OAuth2 PKCE helpers (`generatePkcePair`, `buildAuthorizeUrl`, `exchangeCodeForToken`, `refreshAccessToken`) implementing RFC 7636.
- Mapping of upstream HTTP errors to connector-framework errors: 401/403 → `AuthExpiredError`, 429 → `RateLimitError` (with `retryAfterSeconds`), 404 on `getEvent` → `null`, other failures → `ConnectorError`.
- Mapper unit tests over deterministic Eventbrite fixtures and connector tests with a mocked `fetch`.
