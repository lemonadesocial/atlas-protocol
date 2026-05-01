import { decode, deserialize } from "@atlasprotocol/mpp";
import { describe, expect, it } from "vitest";

import {
  generateMppChallenge,
  type AtlasMppChallengePayload,
  type StripeSptPaymentMethodEntry,
  type X402PaymentMethodEntry,
} from "../challenge.js";

const ORGANIZER = "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00" as const;

describe("generateMppChallenge — round-trip", () => {
  it("encoded envelope decodes back to the same MPP payload", () => {
    const result = generateMppChallenge({
      eventId: "evt_42",
      holdId: "hold_xyz",
      amountUsdcMicros: 12_500_000n,
      organizerAddress: ORGANIZER,
      acceptedChains: ["base_usdc"],
      acceptStripe: false,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });

    const recoveredEnvelope = deserialize(
      result.headerValue.match(/challenge="([^"]+)"/)?.[1] ?? "",
    );
    const recoveredPayload = decode(recoveredEnvelope);

    expect(recoveredPayload.paymentId).toBe("ch_hold_xyz");
    expect(recoveredPayload.amount).toBe("12.500000");
    expect(recoveredPayload.recipient).toBe(ORGANIZER);
    expect(recoveredPayload.organizer).toBe(ORGANIZER);
    expect(recoveredPayload.realm).toBe("atlas");
    expect(recoveredPayload.metadata?.event_id).toBe("evt_42");
    expect(recoveredPayload.metadata?.hold_id).toBe("hold_xyz");

    // payment_methods is JSON-encoded into metadata so it survives the
    // string-only metadata shape.
    const pmFromMetadata = JSON.parse(
      recoveredPayload.metadata?.payment_methods ?? "[]",
    ) as AtlasMppChallengePayload["payment_methods"];
    expect(pmFromMetadata).toHaveLength(1);
    expect(pmFromMetadata[0]?.type).toBe("base_usdc");
  });
});

describe("generateMppChallenge — x402-only", () => {
  it("emits one x402 entry per acceptedChain and no stripe entry", () => {
    const result = generateMppChallenge({
      eventId: "evt_1",
      holdId: "h_1",
      amountUsdcMicros: 25_000_000n,
      organizerAddress: ORGANIZER,
      acceptedChains: ["base_usdc", "optimism_usdc", "arbitrum_usdc"],
      acceptStripe: false,
    });
    expect(result.payload.payment_methods).toHaveLength(3);
    const types = result.payload.payment_methods.map((m) => m.type);
    expect(types).toEqual(["base_usdc", "optimism_usdc", "arbitrum_usdc"]);
    expect(result.payload.payment_methods.every((m) => m.type !== "stripe_spt")).toBe(true);

    const baseEntry = result.payload.payment_methods[0] as X402PaymentMethodEntry;
    expect(baseEntry.chain_id).toBe(8453);
    expect(baseEntry.token.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(baseEntry.amount).toBe("25.000000");
    expect(baseEntry.recipient).toBe(ORGANIZER);
  });
});

describe("generateMppChallenge — stripe-only", () => {
  it("emits one stripe_spt entry and no x402 entries", () => {
    const result = generateMppChallenge({
      eventId: "evt_1",
      holdId: "h_1",
      amountUsdcMicros: 12_500_000n,
      organizerAddress: ORGANIZER,
      acceptedChains: [],
      acceptStripe: true,
      stripePaymentIntentId: "pi_test_123",
    });

    expect(result.payload.payment_methods).toHaveLength(1);
    const stripe = result.payload.payment_methods[0] as StripeSptPaymentMethodEntry;
    expect(stripe.type).toBe("stripe_spt");
    expect(stripe.amount).toBe("12.50");
    expect(stripe.currency).toBe("usd");
    expect(stripe.payment_intent_id).toBe("pi_test_123");
  });
});

describe("generateMppChallenge — dual-rail (both)", () => {
  it("emits x402 entries followed by a stripe_spt entry", () => {
    const result = generateMppChallenge({
      eventId: "evt_1",
      holdId: "h_1",
      amountUsdcMicros: 12_500_000n,
      organizerAddress: ORGANIZER,
      acceptedChains: ["base_usdc", "worldchain_usdc"],
      acceptStripe: true,
    });

    const types = result.payload.payment_methods.map((m) => m.type);
    expect(types).toEqual(["base_usdc", "worldchain_usdc", "stripe_spt"]);
  });

  it("WWW-Authenticate header advertises the FIRST accepted chain as the primary rail", () => {
    const result = generateMppChallenge({
      eventId: "evt_1",
      holdId: "h_1",
      amountUsdcMicros: 12_500_000n,
      organizerAddress: ORGANIZER,
      acceptedChains: ["arbitrum_usdc", "base_usdc"],
      acceptStripe: true,
    });
    expect(result.headerValue).toMatch(/^MPP realm="atlas", challenge="/);
    const wire = result.headerValue.match(/challenge="([^"]+)"/)?.[1];
    const payload = decode(deserialize(wire ?? ""));
    expect(payload.rail).toBe("usdc-arbitrum");
  });
});

describe("generateMppChallenge — validation", () => {
  it("throws when no rails are configured", () => {
    expect(() =>
      generateMppChallenge({
        eventId: "evt_1",
        holdId: "h_1",
        amountUsdcMicros: 12_500_000n,
        organizerAddress: ORGANIZER,
        acceptedChains: [],
        acceptStripe: false,
      }),
    ).toThrow(/at least one accepted rail/);
  });

  it("throws when amount is zero or negative", () => {
    expect(() =>
      generateMppChallenge({
        eventId: "evt_1",
        holdId: "h_1",
        amountUsdcMicros: 0n,
        organizerAddress: ORGANIZER,
        acceptedChains: ["base_usdc"],
        acceptStripe: false,
      }),
    ).toThrow(/amountUsdcMicros must be > 0/);
  });
});

describe("generateMppChallenge — overrides", () => {
  it("uses a per-chain receiver override when supplied", () => {
    const customReceiver = "0x000000000000000000000000000000000000beef" as const;
    const result = generateMppChallenge({
      eventId: "evt_1",
      holdId: "h_1",
      amountUsdcMicros: 12_500_000n,
      organizerAddress: ORGANIZER,
      acceptedChains: ["base_usdc", "optimism_usdc"],
      acceptStripe: false,
      receiversByChain: { optimism_usdc: customReceiver },
    });

    const opEntry = result.payload.payment_methods.find(
      (m) => m.type === "optimism_usdc",
    ) as X402PaymentMethodEntry;
    expect(opEntry.recipient).toBe(customReceiver);
    const baseEntry = result.payload.payment_methods.find(
      (m) => m.type === "base_usdc",
    ) as X402PaymentMethodEntry;
    expect(baseEntry.recipient).toBe(ORGANIZER);
  });

  it("flags experimental chains in the payload", () => {
    const result = generateMppChallenge({
      eventId: "evt_1",
      holdId: "h_1",
      amountUsdcMicros: 12_500_000n,
      organizerAddress: ORGANIZER,
      acceptedChains: ["megaeth_usdm"],
      acceptStripe: false,
    });
    const entry = result.payload.payment_methods[0] as X402PaymentMethodEntry;
    expect(entry.experimental).toBe(true);
  });
});
