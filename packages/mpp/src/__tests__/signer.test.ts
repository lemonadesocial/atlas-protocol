import { describe, expect, it } from "vitest";
import { generateKeyPair, exportJWK } from "jose";

import { encode } from "../envelope.js";
import { signEnvelope, verifyEnvelope } from "../signer.js";
import type { MppPayload } from "../types/payload.js";

const PAYLOAD: MppPayload = {
  rail: "usdc-base",
  intent: "charge",
  realm: "api.example.com",
  paymentId: "pay_signer_test",
  amount: "5.00",
  currency: "usd",
  recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  metadata: { foo: "bar" },
};

describe("signEnvelope + verifyEnvelope (ES256)", () => {
  it("signs and verifies a round-trip envelope", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const envelope = encode(PAYLOAD);

    const signed = await signEnvelope(envelope, {
      alg: "ES256",
      kid: "test-key-1",
      key: privateKey,
    });

    expect(signed.alg).toBe("ES256");
    expect(signed.kid).toBe("test-key-1");
    expect(typeof signed.jws).toBe("string");
    expect(signed.jws.split(".")).toHaveLength(3);

    const result = await verifyEnvelope(signed, {
      alg: "ES256",
      key: publicKey,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.envelope).toEqual(envelope);
      expect(result.payload).toEqual(PAYLOAD);
    }
  });

  it("rejects a tampered jws (one byte flipped)", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const signed = await signEnvelope(encode(PAYLOAD), {
      alg: "ES256",
      key: privateKey,
    });

    // Flip one base64url char in the payload segment.
    const parts = signed.jws.split(".");
    const payload = parts[1] ?? "";
    const flipped =
      payload.length > 0 ? (payload[0] === "A" ? "B" : "A") + payload.slice(1) : payload;
    const tampered = `${parts[0]}.${flipped}.${parts[2]}`;

    const result = await verifyEnvelope(
      { ...signed, jws: tampered },
      { alg: "ES256", key: publicKey },
    );

    expect(result.valid).toBe(false);
  });

  it("rejects verification with a wrong public key", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const { publicKey: otherPublicKey } = await generateKeyPair("ES256");
    const signed = await signEnvelope(encode(PAYLOAD), {
      alg: "ES256",
      key: privateKey,
    });

    const result = await verifyEnvelope(signed, {
      alg: "ES256",
      key: otherPublicKey,
    });

    expect(result.valid).toBe(false);
  });
});

describe("signEnvelope + verifyEnvelope (EdDSA)", () => {
  it("signs and verifies a round-trip envelope", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
    });
    const envelope = encode(PAYLOAD);

    const signed = await signEnvelope(envelope, {
      alg: "EdDSA",
      key: privateKey,
    });

    expect(signed.alg).toBe("EdDSA");

    const result = await verifyEnvelope(signed, {
      alg: "EdDSA",
      key: publicKey,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload).toEqual(PAYLOAD);
    }
  });
});

describe("signEnvelope + verifyEnvelope (JWK input)", () => {
  it("accepts JWK input on both sign and verify", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const privateJwk = await exportJWK(privateKey);
    const publicJwk = await exportJWK(publicKey);

    const envelope = encode(PAYLOAD);
    const signed = await signEnvelope(envelope, {
      alg: "ES256",
      kid: "jwk-test",
      jwk: privateJwk,
    });

    const result = await verifyEnvelope(signed, {
      alg: "ES256",
      jwk: publicJwk,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload).toEqual(PAYLOAD);
    }
  });
});

describe("signEnvelope + verifyEnvelope (HS256 symmetric)", () => {
  it("signs and verifies with a shared secret", async () => {
    const secret = new Uint8Array(32);
    for (let i = 0; i < 32; i++) secret[i] = (i * 7 + 1) & 0xff;

    const envelope = encode(PAYLOAD);
    const signed = await signEnvelope(envelope, {
      alg: "HS256",
      key: secret,
    });

    const result = await verifyEnvelope(signed, {
      alg: "HS256",
      key: secret,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload).toEqual(PAYLOAD);
    }

    // Wrong secret -> rejection.
    const wrongSecret = new Uint8Array(32).fill(0xaa);
    const wrong = await verifyEnvelope(signed, {
      alg: "HS256",
      key: wrongSecret,
    });
    expect(wrong.valid).toBe(false);
  });
});
