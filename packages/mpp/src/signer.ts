/**
 * JWS sign / verify for MPP envelopes.
 *
 * The canonical Machine Payments Protocol (https://mpp.dev/protocol,
 * accessed 2026-04-30) does NOT mandate a JWS wrapper — challenges are
 * bound to their parameters via an HMAC-SHA256 challenge id, and credential
 * payloads carry method-specific signatures (e.g. raw EVM signatures over
 * a Tempo transaction). We provide a JWS layer above the canonical
 * envelope as an @atlasprotocol/mpp extension because:
 *
 *   1. The task brief asks for it.
 *   2. JOSE / RFC 7515 is the natural choice for cross-domain envelope
 *      authenticity when you want a single signed blob (not a header-only
 *      HMAC over server-defined inputs).
 *
 * Every payload signed here is the JCS-canonicalized JSON of the envelope
 * — `canonicalize()` from `envelope.ts` — so byte-level reproducibility
 * across implementations is preserved.
 *
 * Default algorithm: ES256 (ECDSA P-256, SHA-256). EdDSA / RS256 / HS256
 * are also supported.
 */

import { CompactSign, compactVerify, importJWK, type KeyLike } from "jose";

import { canonicalize, decode } from "./envelope.js";
import type { MppEnvelope, SignedMppEnvelope } from "./types/envelope.js";
import type { MppPayload } from "./types/payload.js";
import type { SigningAlg, SigningKey, VerificationKey } from "./types/signature.js";

const DEFAULT_ALG: SigningAlg = "ES256";

/**
 * Sign an envelope, producing a `SignedMppEnvelope` whose `jws` field is
 * the RFC 7515 compact serialization over the canonicalized envelope.
 */
export async function signEnvelope(
  envelope: MppEnvelope,
  key: SigningKey,
): Promise<SignedMppEnvelope> {
  const alg = key.alg ?? DEFAULT_ALG;
  const kid = key.kid;

  const cryptoKey = await resolveSigningKey(key, alg);

  const payloadBytes = new TextEncoder().encode(canonicalize(envelope));

  const signer = new CompactSign(payloadBytes).setProtectedHeader({
    alg,
    typ: "mpp+jws",
    ...(kid !== undefined && { kid }),
  });

  const jws = await signer.sign(cryptoKey);

  return {
    jws,
    envelope,
    alg,
    ...(kid !== undefined && { kid }),
  };
}

/**
 * Verify a signed envelope. Returns `{ valid: false }` for any failure —
 * tampered payload, bad signature, malformed JWS, or wrong key.
 *
 * On `{ valid: true }` the verified envelope and decoded developer payload
 * are returned for ergonomic single-call verification + consumption.
 */
export async function verifyEnvelope(
  signed: SignedMppEnvelope,
  publicKey: VerificationKey,
): Promise<
  | {
      valid: true;
      envelope: MppEnvelope;
      payload: MppPayload;
    }
  | { valid: false; error: string }
> {
  const alg: SigningAlg = publicKey.alg ?? (signed.alg as SigningAlg | undefined) ?? DEFAULT_ALG;

  let cryptoKey: KeyLike | Uint8Array;
  try {
    cryptoKey = await resolveVerificationKey(publicKey, alg);
  } catch (err) {
    return {
      valid: false,
      error: `key resolution failed: ${(err as Error).message}`,
    };
  }

  let payloadBytes: Uint8Array;
  try {
    const verified = await compactVerify(signed.jws, cryptoKey, {
      algorithms: [alg],
    });
    payloadBytes = verified.payload;
  } catch (err) {
    return {
      valid: false,
      error: `jws verification failed: ${(err as Error).message}`,
    };
  }

  let envelope: MppEnvelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(payloadBytes)) as MppEnvelope;
  } catch (err) {
    return {
      valid: false,
      error: `payload is not valid JSON: ${(err as Error).message}`,
    };
  }

  // Re-canonicalize and compare — defends against payloads that decode the
  // same JSON but carry non-canonical key ordering (which would still verify
  // under JWS but break our round-trip guarantee).
  const expected = canonicalize(envelope);
  const actual = new TextDecoder().decode(payloadBytes);
  if (expected !== actual) {
    return {
      valid: false,
      error: "payload was not JCS-canonical (key order or whitespace mismatch)",
    };
  }

  let payload: MppPayload;
  try {
    payload = decode(envelope);
  } catch (err) {
    return {
      valid: false,
      error: `envelope decode failed: ${(err as Error).message}`,
    };
  }

  return { valid: true, envelope, payload };
}

// --- internal helpers -----------------------------------------------------

async function resolveSigningKey(key: SigningKey, alg: SigningAlg): Promise<KeyLike | Uint8Array> {
  if ("jwk" in key) {
    const imported = await importJWK(key.jwk, alg);
    // `importJWK` may return either a `KeyLike` or a `Uint8Array` (for HS256).
    return imported;
  }
  return key.key;
}

async function resolveVerificationKey(
  key: VerificationKey,
  alg: SigningAlg,
): Promise<KeyLike | Uint8Array> {
  if ("jwk" in key) {
    const imported = await importJWK(key.jwk, alg);
    return imported;
  }
  return key.key;
}
