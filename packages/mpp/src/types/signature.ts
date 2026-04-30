import type { JWK, KeyLike } from "jose";

/**
 * Supported JWS signing algorithms for the @atlasprotocol/mpp envelope.
 *
 * - "ES256"  — ECDSA P-256 with SHA-256 (default; RFC 7518 §3.4)
 * - "EdDSA"  — Ed25519 / Ed448 (RFC 8037)
 * - "RS256"  — RSASSA-PKCS1-v1_5 with SHA-256 (RFC 7518 §3.3)
 * - "HS256"  — HMAC SHA-256 (symmetric; RFC 7518 §3.2)
 */
export type SigningAlg = "ES256" | "EdDSA" | "RS256" | "HS256";

/**
 * A signing key. Either a runtime `KeyLike` (CryptoKey / KeyObject), a
 * Uint8Array (for HS256), or a JWK with private parameters.
 */
export type SigningKey =
  | { alg?: SigningAlg; kid?: string; key: KeyLike }
  | { alg?: SigningAlg; kid?: string; key: Uint8Array }
  | { alg?: SigningAlg; kid?: string; jwk: JWK };

/**
 * A verification key. Same shape as `SigningKey` but the JWK form should
 * carry only public parameters for asymmetric algorithms.
 */
export type VerificationKey =
  | { alg?: SigningAlg; key: KeyLike }
  | { alg?: SigningAlg; key: Uint8Array }
  | { alg?: SigningAlg; jwk: JWK };

/**
 * Discriminator helpers — true if the key is in raw bytes form.
 */
export function isRawBytesKey<T extends { key?: unknown }>(k: T): k is T & { key: Uint8Array } {
  return "key" in k && typeof k.key === "object" && k.key !== null && k.key instanceof Uint8Array;
}

/**
 * Discriminator helper — true if the key is in JWK form.
 */
export function isJwkKey<T>(k: T): k is T & { jwk: JWK } {
  return typeof k === "object" && k !== null && "jwk" in k;
}
