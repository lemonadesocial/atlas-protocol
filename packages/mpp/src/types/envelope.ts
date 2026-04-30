/**
 * Wire-shape types for an MPP envelope.
 *
 * Canonical reference: https://mpp.dev/protocol (accessed 2026-04-30).
 *
 * The MPP envelope is a base64url-encoded JCS-canonicalized JSON object
 * that carries three logical sections:
 *
 *   1. A "header" with method/intent/realm + a stable challenge id
 *      (the MPP `Challenge` object).
 *   2. A "request" payload — the method-specific charge details.
 *   3. Optional unprotected metadata (passed through `opaque`).
 *
 * The shape below mirrors the canonical fields exactly. Optional fields
 * use `undefined`-typed slots so that `exactOptionalPropertyTypes` callers
 * can omit them rather than passing `undefined`.
 */

/**
 * Method identifier — see `rails.ts` for the canonical pattern.
 *
 * Carried verbatim on the wire so non-supported methods can still flow
 * through `decode()` for clients that have not been upgraded.
 */
export type MppMethod = string;

/**
 * Intent identifier (e.g. "charge", "session"). Free-form per spec.
 */
export type MppIntent = string;

/**
 * The MPP envelope header — corresponds 1:1 to the canonical Challenge
 * object at https://mpp.dev/protocol/challenges.
 */
export interface MppHeader {
  /** MPP protocol version (e.g. "1.0"). See SPEC-NOTES.md §Version. */
  mpp_ver: string;
  /** HMAC-bound challenge id. */
  id: string;
  /** Server realm (typically the API hostname). */
  realm: string;
  /** Payment method / rail identifier. */
  method: MppMethod;
  /** Intent type (e.g. "charge"). */
  intent: MppIntent;
  /** Optional ISO-8601 expiry. */
  expires?: string;
  /** Optional human-readable description. */
  description?: string;
  /** Optional request body digest, format "sha-256=<base64>". */
  digest?: string;
  /**
   * Optional ttl in seconds. Not part of the canonical spec — surfaced here
   * because the task brief lists it under the protected header. Documented
   * as MPP-GAP-001 in SPEC-NOTES.md.
   */
  ttl?: number;
}

/**
 * Method-specific request payload. This is the data object the organizer
 * publishes alongside the challenge — amount, currency, recipient, and any
 * method-specific extras (memo, splits, etc.).
 *
 * Kept open-ended (`Record<string, unknown>`) so we can accept any
 * canonical or future MPP method without coupling to method schemas.
 */
export type MppRequest = Record<string, unknown>;

/**
 * The full MPP envelope — the in-memory shape produced by `encode()` and
 * consumed by `decode()`. Wire encoding (base64url JCS) is handled
 * separately by `serialize()` / `deserialize()`.
 */
export interface MppEnvelope {
  header: MppHeader;
  request: MppRequest;
  /**
   * Server-defined opaque correlation map. Per spec
   * (https://mpp.dev/protocol/challenges) clients MUST NOT modify.
   */
  opaque?: Record<string, string>;
}

/**
 * A signed MPP envelope. Carries either:
 *   - the compact JWS string (default; matches RFC 7515 compact serialization)
 *   - and the original envelope for ergonomic access without re-decoding.
 *
 * The JWS layer is an @atlasprotocol/mpp extension above the canonical spec —
 * see SPEC-NOTES.md §Signing for the rationale.
 */
export interface SignedMppEnvelope {
  /** RFC 7515 compact JWS over the canonical JSON-stringified envelope. */
  jws: string;
  /** The envelope that was signed (kept for caller convenience). */
  envelope: MppEnvelope;
  /**
   * Algorithm used. One of "ES256" | "EdDSA" | "RS256" | "HS256".
   * Echoed from the JWS protected header for caller convenience.
   */
  alg: string;
  /** Optional key id, echoed from the JWS protected header. */
  kid?: string;
}
