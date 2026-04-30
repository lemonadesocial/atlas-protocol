/**
 * Conformance tests for @atlasprotocol/mpp.
 *
 * The canonical Machine Payments Protocol spec at https://mpp.dev does not
 * publish public test vectors as of 2026-04-30. The reference TypeScript
 * SDK (`mppx`, https://github.com/wevm/mppx) includes test fixtures only as
 * part of its own internal test files, not as a portable conformance suite.
 *
 * This test file therefore documents that fact, and asserts deterministic
 * round-trip + canonicalization properties against locally-generated
 * vectors. When upstream test vectors are published, this file should be
 * extended to load them. (See SPEC-NOTES.md §Test Vectors.)
 */

import { describe, expect, it } from "vitest";

import { canonicalize, decode, encode, serialize } from "../envelope.js";
import type { MppEnvelope } from "../types/envelope.js";
import type { MppPayload } from "../types/payload.js";

const VECTOR_TEMPO_CHARGE: MppPayload = {
  rail: "usdc-tempo",
  intent: "charge",
  realm: "api.example.com",
  paymentId: "pay_qB3wErTyU7iOpAsD9fGhJk",
  amount: "1.00",
  currency: "0x20c0000000000000000000000000000000000001",
  recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  expires: "2026-04-30T18:00:00.000Z",
};

const VECTOR_STRIPE_SPT: MppPayload = {
  rail: "stripe-spt",
  intent: "charge",
  realm: "api.example.com",
  paymentId: "pi_3PqwertyZxYwVuTsrQpOnMlK",
  amount: "49.99",
  currency: "usd",
  description: "Premium ticket",
  metadata: { event_id: "evt_atlas_launch" },
};

describe("conformance: round-trip determinism", () => {
  it.each([
    ["tempo charge", VECTOR_TEMPO_CHARGE],
    ["stripe spt", VECTOR_STRIPE_SPT],
  ])("%s — encode/decode is identity", (_label, vector) => {
    const envelope = encode(vector);
    const back = decode(envelope);
    expect(back).toEqual({ intent: "charge", ...vector });
  });

  it.each([
    ["tempo charge", VECTOR_TEMPO_CHARGE],
    ["stripe spt", VECTOR_STRIPE_SPT],
  ])("%s — canonicalize is order-independent", (_label, vector) => {
    const envelope = encode(vector);
    const reordered: MppEnvelope = {
      request: envelope.request,
      header: envelope.header,
    };
    expect(canonicalize(envelope)).toBe(canonicalize(reordered));
  });

  it("produces a stable wire form (snapshot-style assertion)", () => {
    const wire = serialize(encode(VECTOR_TEMPO_CHARGE));
    // base64url alphabet, no padding
    expect(wire).toMatch(/^[A-Za-z0-9_-]+$/);
    // Decoded JSON must contain the canonical sorted keys at top level.
    const decoded = Buffer.from(wire.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const firstKey = decoded.match(/^\{"([^"]+)"/)?.[1];
    expect(firstKey).toBe("header");
  });
});
