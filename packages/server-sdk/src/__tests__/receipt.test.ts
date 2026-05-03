import { describe, expect, it, vi } from "vitest";

import type { PinOptions, PinResult, Pinner } from "@atlasprotocol/ipfs";

import {
  ATLAS_CREDENTIALS_V1_CONTEXT,
  ATLAS_RECEIPT_TYPES,
  W3C_VC_V1_CONTEXT,
  generateReceipt,
} from "../receipt.js";

const BASE_OPTS = {
  holdId: "hold_xyz789",
  eventId: "evt_abc123",
  attendee: "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
  organizerAddress: "did:web:bjc.events",
  amount: "25.000000",
  currency: "USDC",
  issuedAt: "2026-04-14T21:05:30Z",
} as const;

describe("generateReceipt — x402 rail", () => {
  it("emits a W3C VC with the AtlasTicketReceipt type and x402 settlement fields", async () => {
    const { receipt } = await generateReceipt({
      ...BASE_OPTS,
      paymentMethod: "x402",
      txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      settlementChain: "base",
    });

    expect(receipt["@context"]).toEqual([W3C_VC_V1_CONTEXT, ATLAS_CREDENTIALS_V1_CONTEXT]);
    expect(receipt.type).toEqual([...ATLAS_RECEIPT_TYPES]);
    expect(receipt.issuer).toBe("did:web:bjc.events");
    expect(receipt.issuanceDate).toBe("2026-04-14T21:05:30Z");
    expect(receipt.credentialSubject).toEqual({
      id: BASE_OPTS.attendee,
      event_id: "evt_abc123",
      hold_id: "hold_xyz789",
      settlement: {
        method: "x402",
        amount: "25.000000",
        currency: "USDC",
        tx_hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        chain: "base",
      },
    });
    // unsigned: no proof block in v1
    expect(receipt.proof).toBeUndefined();
  });

  it("propagates ticketTypeId and quantity into credentialSubject when supplied", async () => {
    const { receipt } = await generateReceipt({
      ...BASE_OPTS,
      paymentMethod: "x402",
      txHash: "0x" + "f".repeat(64),
      settlementChain: "base",
      ticketTypeId: "tt_ga_001",
      quantity: 2,
      credentialId: "urn:atlas:receipt:rec_abc123",
    });

    expect(receipt.id).toBe("urn:atlas:receipt:rec_abc123");
    expect(receipt.credentialSubject.ticket_type).toBe("tt_ga_001");
    expect(receipt.credentialSubject.quantity).toBe(2);
  });

  it("throws when txHash is missing on x402 rail", async () => {
    await expect(
      generateReceipt({
        ...BASE_OPTS,
        paymentMethod: "x402",
        settlementChain: "base",
      } as never),
    ).rejects.toThrow(/txHash is required/);
  });

  it("throws when settlementChain is missing on x402 rail", async () => {
    await expect(
      generateReceipt({
        ...BASE_OPTS,
        paymentMethod: "x402",
        txHash: "0x" + "0".repeat(64),
      } as never),
    ).rejects.toThrow(/settlementChain is required/);
  });
});

describe("generateReceipt — stripe_spt rail", () => {
  it("emits a W3C VC with stripe settlement fields and no chain/tx_hash", async () => {
    const { receipt } = await generateReceipt({
      ...BASE_OPTS,
      paymentMethod: "stripe_spt",
      paymentIntentId: "pi_test_123",
      currency: "USD",
      amount: "25.00",
    });

    expect(receipt.credentialSubject.settlement).toEqual({
      method: "stripe_spt",
      amount: "25.00",
      currency: "USD",
      payment_intent_id: "pi_test_123",
    });
    expect(receipt.credentialSubject.settlement.tx_hash).toBeUndefined();
    expect(receipt.credentialSubject.settlement.chain).toBeUndefined();
  });

  it("throws when paymentIntentId is missing on stripe rail", async () => {
    await expect(
      generateReceipt({
        ...BASE_OPTS,
        paymentMethod: "stripe_spt",
      } as never),
    ).rejects.toThrow(/paymentIntentId is required/);
  });
});

describe("generateReceipt — JSON round-trip", () => {
  it("survives JSON.parse(JSON.stringify(receipt)) byte-for-byte", async () => {
    const { receipt } = await generateReceipt({
      ...BASE_OPTS,
      paymentMethod: "x402",
      txHash: "0x" + "1".repeat(64),
      settlementChain: "arbitrum",
      ticketTypeId: "tt_vip_002",
      quantity: 1,
    });

    const roundTripped = JSON.parse(JSON.stringify(receipt)) as typeof receipt;
    // arrays are not the same reference, but values must match
    expect(roundTripped["@context"]).toEqual([...receipt["@context"]]);
    expect(roundTripped.type).toEqual([...receipt.type]);
    expect(roundTripped.credentialSubject).toEqual(receipt.credentialSubject);
    expect(roundTripped.issuer).toBe(receipt.issuer);
    expect(roundTripped.issuanceDate).toBe(receipt.issuanceDate);
  });
});

describe("generateReceipt — defaults", () => {
  it("defaults issuanceDate to the current ISO timestamp when omitted", async () => {
    const before = Date.now();
    const { receipt } = await generateReceipt({
      holdId: "h",
      eventId: "e",
      attendee: "0x",
      organizerAddress: "did:web:test",
      amount: "1.000000",
      currency: "USDC",
      paymentMethod: "x402",
      txHash: "0x" + "0".repeat(64),
      settlementChain: "base",
    });
    const issued = new Date(receipt.issuanceDate).getTime();
    const after = Date.now();
    expect(issued).toBeGreaterThanOrEqual(before);
    expect(issued).toBeLessThanOrEqual(after + 1);
  });
});

describe("generateReceipt — required field validation", () => {
  for (const field of [
    "amount",
    "currency",
    "attendee",
    "organizerAddress",
    "eventId",
    "holdId",
  ] as const) {
    it(`throws when ${field} is empty`, async () => {
      const opts = {
        ...BASE_OPTS,
        paymentMethod: "x402" as const,
        txHash: "0x" + "0".repeat(64),
        settlementChain: "base",
        [field]: "",
      };
      await expect(generateReceipt(opts)).rejects.toThrow(new RegExp(`${field} is required`));
    });
  }
});

describe("generateReceipt — auto-pinning", () => {
  function makeMockPinner(overrides: Partial<Pinner> = {}): {
    pinner: Pinner;
    pinJsonSpy: ReturnType<typeof vi.fn>;
  } {
    const pinJsonSpy = vi.fn(
      (_obj: unknown, _opts?: PinOptions): Promise<PinResult> =>
        Promise.resolve({ cid: "bafkreireceipt", size: 123 }),
    );
    const pinBytesSpy = vi.fn(
      (_content: Uint8Array, _opts?: PinOptions): Promise<PinResult> =>
        Promise.resolve({ cid: "bafkreireceipt", size: 123 }),
    );
    const unpinSpy = vi.fn((_cid: string): Promise<void> => Promise.resolve());
    const isPinnedSpy = vi.fn((_cid: string): Promise<boolean> => Promise.resolve(true));
    const pinner: Pinner = {
      pinJson: pinJsonSpy,
      pinBytes: pinBytesSpy,
      unpin: unpinSpy,
      isPinned: isPinnedSpy,
      ...overrides,
    };
    return { pinner, pinJsonSpy };
  }

  const VALID_X402 = {
    ...BASE_OPTS,
    paymentMethod: "x402" as const,
    txHash: "0x" + "a".repeat(64),
    settlementChain: "base",
  };

  it("with a Pinner, returns receipt + cid and forwards canonical JSON", async () => {
    const { pinner, pinJsonSpy } = makeMockPinner();
    const result = await generateReceipt({ ...VALID_X402, pinner });

    expect(result.cid).toBe("bafkreireceipt");
    expect(result.receipt.credentialSubject.hold_id).toBe(BASE_OPTS.holdId);

    expect(pinJsonSpy).toHaveBeenCalledTimes(1);
    const [pinnedObj, pinOpts] = pinJsonSpy.mock.calls[0] as [unknown, PinOptions];
    expect(pinnedObj).toBe(result.receipt);
    expect(pinOpts).toEqual({ name: `atlas-receipt-${BASE_OPTS.holdId}` });
  });

  it("without a Pinner, returns receipt only and cid is undefined", async () => {
    const result = await generateReceipt(VALID_X402);
    expect(result.cid).toBeUndefined();
    expect(result.receipt).toBeDefined();
  });

  it("auto-pinning happens after validation — invalid receipt throws BEFORE pinJson is called", async () => {
    const { pinner, pinJsonSpy } = makeMockPinner();
    await expect(
      generateReceipt({
        ...VALID_X402,
        pinner,
        // strip the required field to force validation failure
        txHash: undefined,
      } as never),
    ).rejects.toThrow(/txHash is required/);
    expect(pinJsonSpy).not.toHaveBeenCalled();
  });
});
