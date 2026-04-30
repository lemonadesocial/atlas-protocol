# @atlas/mpp Spec Notes

> Audit log for every spec decision made while implementing `@atlas/mpp`.
> Keep this file alongside the source — `MPP-GAP-XXX` references in code
> resolve to numbered entries in `§Gaps / TODOs` below.

## Reference Sources

All URLs accessed **2026-04-30**.

- <https://mpp.dev/overview> — MPP landing page; lists canonical method identifiers (`tempo`, `stripe`, `card`, `lightning`, `solana`, `stellar`, `monad`, `custom`).
- <https://mpp.dev/protocol> — Protocol overview; defines the Challenge / Credential / Receipt three-phase flow.
- <https://mpp.dev/protocol/challenges> — Challenge envelope schema (canonical fields: `id`, `realm`, `method`, `intent`, `request`, `expires`, `description`, `digest`, `opaque`); HMAC-SHA256 binding sequence `realm | method | intent | request | expires | digest | opaque`.
- <https://mpp.dev/protocol/credentials> — Credential envelope (`Authorization: Payment <base64url-JSON>`); payload echoes challenge + carries method-specific proof; optional `source` DID (e.g. `did:pkh:eip155:4217:0x...`).
- <https://mpp.dev/protocol/receipts> — Receipt envelope (`Payment-Receipt: <base64url-JSON>`); fields `challengeId`, `method`, `reference`, `settlement`, `status`, `timestamp`.
- <https://mpp.dev/protocol/http-402> — HTTP 402 Problem-Details error formats; canonical type identifiers (`invalid-challenge`, `malformed-credential`, `method-unsupported`, `payment-expired`, `payment-insufficient`, `payment-required`, `verification-failed`).
- <https://mpp.dev/protocol/transports/mcp> — MCP / JSON-RPC transport binding; uses error code `-32042` and nests credentials/receipts under `_meta.org.paymentauth/credential` and `_meta.org.paymentauth/receipt`.
- <https://mpp.dev/payment-methods/custom> — Custom-method definition surface (`Method.from`, `Method.toClient`, `Method.toServer`).
- <https://docs.stripe.com/payments/machine/mpp> — Stripe MPP integration page; pins API version `2026-03-04.preview`; documents the `mppx` test CLI.
- <https://docs.stripe.com/payments/machine/mpp/quickstart> — Confirms the `Authorization: Payment ...`, `WWW-Authenticate: Payment ...`, and `Authentication-Info` headers.
- <https://github.com/wevm/mppx> — Canonical reference TypeScript SDK (`mppx`). Source files inspected (under MIT licence): `src/Challenge.ts`, `src/Credential.ts`, `src/Receipt.ts`, `src/Method.ts`, `src/PaymentRequest.ts`, `src/tempo/Methods.ts`, `src/stripe/Methods.ts`. Not vendored; used as a structural reference for field names and HMAC binding order.
- RFC 7515 (JOSE / JWS), RFC 7518 (JWA), RFC 8037 (EdDSA), RFC 8785 (JCS).

## Spec Version

The canonical spec at mpp.dev does **not** publish a numeric version
identifier — only a build label (`mpp.dev@<git-sha>`). The Stripe
integration page pins the related API version at `2026-03-04.preview`.

`@atlas/mpp` writes the literal `mpp_ver: "1.0"` into the protected
header of every envelope (see `MPP-GAP-001`). This is opaque to the
canonical spec (which does not reserve a `mpp_ver` field) and is safe
to ignore for upstream consumers.

## Conformance Notes

| Field                       | Source                                                                                | Status                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `header.id`                 | `mpp.dev/protocol/challenges`                                                         | Verified — populated from `payload.paymentId`. HMAC binding NOT computed here (see Notes below).  |
| `header.realm`              | `mpp.dev/protocol/challenges`                                                         | Verified.                                                                                         |
| `header.method`             | `mpp.dev/protocol/challenges`                                                         | Verified — validated against the canonical `[a-z][a-z0-9:_-]*` grammar.                            |
| `header.intent`             | `mpp.dev/protocol/challenges`                                                         | Verified — defaults to `"charge"` when omitted at encode time (matches spec example default).      |
| `header.expires`            | `mpp.dev/protocol/challenges`                                                         | Verified — passes through verbatim as ISO-8601.                                                   |
| `header.description`        | `mpp.dev/protocol/challenges`                                                         | Verified.                                                                                         |
| `header.digest`             | `mpp.dev/protocol/challenges`                                                         | Verified — format pinned to `sha-256=<base64>` per spec but not enforced on encode.               |
| `header.mpp_ver`            | NOT in canonical spec                                                                 | `MPP-GAP-001` — local convention.                                                                 |
| `header.ttl`                | NOT in canonical spec                                                                 | `MPP-GAP-001` — local convention; surfaced because the task brief lists it.                        |
| `request.amount`            | `mpp.dev/protocol/challenges` example + `mppx/src/tempo/Methods.ts` + `stripe/Methods.ts` | Verified — decimal string, conversion to micro-units left to the caller.                          |
| `request.currency`          | Same                                                                                  | Verified.                                                                                         |
| `request.recipient`         | Same                                                                                  | Verified.                                                                                         |
| `request.organizer`         | NOT in canonical spec                                                                 | `MPP-GAP-002` — see below.                                                                        |
| `request.items`             | NOT in canonical spec                                                                 | `MPP-GAP-002` — see below.                                                                        |
| `request.metadata`          | Stripe `Methods.ts` carries `metadata` inside `methodDetails`; no canonical pin       | `MPP-GAP-002` — see below.                                                                        |
| `opaque`                    | `mpp.dev/protocol/challenges`                                                         | Wire shape supported on the envelope type; not currently populated by `encode()`.                 |
| Canonicalization (sorted keys, no whitespace) | RFC 8785 + `mppx/src/PaymentRequest.ts` (`Json.canonicalize`)               | `MPP-GAP-003` — see below.                                                                        |
| Signing layer (JWS)         | NOT in canonical spec; RFC 7515                                                       | Local extension — see `signer.ts` header comment + README §Conformance status.                    |

### Note on HMAC challenge IDs vs JWS

The canonical spec binds challenge `id` to `realm | method | intent | request | expires | digest | opaque` via HMAC-SHA256, then expects the server (which holds the secret) to verify the id on inbound credentials. This package does **not** compute the HMAC — `@atlas/mpp` is a standalone envelope/sign/verify layer and the caller supplies the `paymentId`. The JWS layer in `signer.ts` is provided as a complementary cross-domain authenticity mechanism. A future minor release can add a thin `bindChallengeId({ secretKey })` helper if needed.

## Gaps / TODOs

1. **MPP-GAP-001 — Protected-header version + ttl fields.**
   The canonical mpp.dev spec exposes neither a numeric protocol version nor a TTL field on the challenge header. The task brief lists `mpp_ver` and `ttl` under the protected header.
   _Resolution:_ Accept both as optional/local fields. `mpp_ver` defaults to the literal `"1.0"`; `ttl` is an `MppPayload`-level optional that round-trips through `header.ttl`. Both are ignored by spec-conformant servers (extra fields in the request payload are explicitly tolerated by the spec). Referenced in `src/envelope.ts` and `src/types/envelope.ts`.

2. **MPP-GAP-002 — `items` / `metadata` / `organizer` placement.**
   The canonical Challenge schema leaves the `request` object method-specific (`tempo` and `stripe` methods both ship a flat amount/currency/recipient shape). The task brief explicitly requires line items, metadata, and an organizer identifier on the developer-facing payload.
   _Resolution:_ `encode()` writes these into reserved keys on `request` (`request.organizer`, `request.items`, `request.metadata`). `decode()` reads them back. Servers that do not understand these keys will simply ignore them — they do not collide with any canonical method-defined field. Referenced in `src/envelope.ts` (`RESERVED_REQUEST_KEYS`).

3. **MPP-GAP-003 — JCS canonicalization (RFC 8785) implementation.**
   The canonical spec uses `Json.canonicalize` from `ox` (per `mppx/src/PaymentRequest.ts`). RFC 8785 mandates sorted keys + no whitespace + canonical IEEE-754 number formatting.
   _Resolution:_ `canonicalize()` implements sorted keys + no whitespace via `JSON.stringify` over a key-sorted object tree. Number canonicalization is **not** specifically implemented; the envelope shape only carries decimal **strings** for amounts (per spec), integers for `quantity` and `ttl`, and ISO-8601 strings for timestamps — no IEEE-754 fractional values. Adequate for the current envelope type but a `Json.canonicalize`-grade routine would be needed if free-form numeric metadata were ever permitted. Referenced in `src/envelope.ts` (`canonicalize`, `sortKeysDeep`).

## Test Vectors

No public test vectors located. The canonical mpp.dev spec does not publish a portable conformance suite as of 2026-04-30; the `mppx` reference SDK includes vectors only embedded in its own internal `*.test.ts` files (under MIT). `paymentauth.org` is referenced by the spec as a future IETF home but did not return a usable corpus when fetched.

`src/__tests__/conformance.test.ts` therefore documents the absence of upstream vectors and instead asserts:

- Deterministic `encode` / `decode` round-trip for two sample payloads (`tempo-charge`, `stripe-spt`) drawn from the canonical examples on mpp.dev.
- `canonicalize()` output is order-independent at the top level.
- The wire form uses the base64url alphabet without padding.

When upstream vectors are published, this file should be expanded with the source URL and the file extended to load + assert against them byte-for-byte.
