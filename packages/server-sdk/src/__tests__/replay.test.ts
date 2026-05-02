import { encode, type MppPayload } from "@atlasprotocol/mpp";
import { describe, expect, it } from "vitest";

import { InMemoryReplayStore, credentialHash } from "../replay.js";

const SAMPLE_PAYLOAD: MppPayload = {
  rail: "usdc-base",
  realm: "atlas",
  paymentId: "ch_hold_xyz",
  intent: "charge",
  amount: "12.500000",
  currency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  organizer: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  expires: "2030-01-01T00:00:00.000Z",
  description: "ATLAS purchase test",
};

describe("credentialHash", () => {
  it("is deterministic for the same envelope", () => {
    const env = encode(SAMPLE_PAYLOAD);
    expect(credentialHash(env)).toBe(credentialHash(env));
  });

  it("returns a 64-char hex string (sha256)", () => {
    const env = encode(SAMPLE_PAYLOAD);
    const h = credentialHash(env);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when any envelope field changes", () => {
    const a = credentialHash(encode(SAMPLE_PAYLOAD));
    const b = credentialHash(encode({ ...SAMPLE_PAYLOAD, paymentId: "ch_other" }));
    expect(a).not.toBe(b);
  });
});

describe("InMemoryReplayStore.markCredentialUsed", () => {
  it("returns {first: true} on first call, {first: false} on retry", async () => {
    const store = new InMemoryReplayStore();
    const env = encode(SAMPLE_PAYLOAD);
    const h = credentialHash(env);

    expect(await store.markCredentialUsed(h)).toEqual({ first: true });
    expect(await store.markCredentialUsed(h)).toEqual({ first: false });
  });

  it("isCredentialUsed reflects the persisted state", async () => {
    const store = new InMemoryReplayStore();
    const env = encode(SAMPLE_PAYLOAD);
    const h = credentialHash(env);

    expect(await store.isCredentialUsed(h)).toBe(false);
    await store.markCredentialUsed(h);
    expect(await store.isCredentialUsed(h)).toBe(true);
  });

  it("treats different credential hashes independently", async () => {
    const store = new InMemoryReplayStore();
    const a = credentialHash(encode(SAMPLE_PAYLOAD));
    const b = credentialHash(encode({ ...SAMPLE_PAYLOAD, paymentId: "ch_b" }));

    expect(await store.markCredentialUsed(a)).toEqual({ first: true });
    expect(await store.markCredentialUsed(b)).toEqual({ first: true });
    expect(await store.isCredentialUsed(a)).toBe(true);
    expect(await store.isCredentialUsed(b)).toBe(true);
  });
});

describe("InMemoryReplayStore TTL", () => {
  it("evicts entries past the configured TTL", async () => {
    let nowMs = 1_000_000;
    const store = new InMemoryReplayStore({ ttlMs: 1000, now: () => nowMs });
    const h = credentialHash(encode(SAMPLE_PAYLOAD));

    expect(await store.markCredentialUsed(h)).toEqual({ first: true });
    expect(await store.isCredentialUsed(h)).toBe(true);

    // Advance past TTL — entry should be evicted on next access.
    nowMs += 2_000;
    expect(await store.isCredentialUsed(h)).toBe(false);
    // After eviction the same hash is treated as fresh again.
    expect(await store.markCredentialUsed(h)).toEqual({ first: true });
  });

  it("does NOT evict entries within the TTL window", async () => {
    let nowMs = 0;
    const store = new InMemoryReplayStore({ ttlMs: 10_000, now: () => nowMs });
    const h = credentialHash(encode(SAMPLE_PAYLOAD));

    await store.markCredentialUsed(h);
    nowMs += 5_000;
    expect(await store.isCredentialUsed(h)).toBe(true);
  });
});
