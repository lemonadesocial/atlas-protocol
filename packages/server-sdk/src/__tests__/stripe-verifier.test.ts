import { describe, expect, it, vi } from "vitest";

import { verifyStripePayment, type StripeLike } from "../stripe-verifier.js";

function makeStripe(intent: {
  status: string;
  currency: string;
  amount: number;
  id?: string;
}): StripeLike {
  return {
    paymentIntents: {
      retrieve: vi.fn(() =>
        Promise.resolve({
          id: intent.id ?? "pi_test",
          status: intent.status,
          currency: intent.currency,
          amount: intent.amount,
        }),
      ),
    },
  };
}

describe("verifyStripePayment", () => {
  it("accepts a succeeded USD intent that matches the expected micros", async () => {
    // 12.50 USD = 1250 cents = 12_500_000 USD-micros
    const stripe = makeStripe({ status: "succeeded", currency: "usd", amount: 1250 });
    const result = await verifyStripePayment(stripe, "pi_x", 12_500_000n);
    expect(result.valid).toBe(true);
    expect(result.verified_amount_usd).toBeCloseTo(12.5);
  });

  it("accepts a charge that differs by 1 cent (boundary)", async () => {
    const stripe = makeStripe({ status: "succeeded", currency: "usd", amount: 1250 });
    // expected 12.51 USD, charged 12.50 USD — exactly 1 cent off
    const result = await verifyStripePayment(stripe, "pi_x", 12_510_000n);
    expect(result.valid).toBe(true);
  });

  it("rejects when status is not succeeded", async () => {
    const stripe = makeStripe({ status: "requires_action", currency: "usd", amount: 1250 });
    const result = await verifyStripePayment(stripe, "pi_x", 12_500_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/status.*requires_action/);
  });

  it("rejects when currency is not usd", async () => {
    const stripe = makeStripe({ status: "succeeded", currency: "eur", amount: 1250 });
    const result = await verifyStripePayment(stripe, "pi_x", 12_500_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/currency.*eur/);
  });

  it("normalizes uppercase currency", async () => {
    const stripe = makeStripe({ status: "succeeded", currency: "USD", amount: 1250 });
    const result = await verifyStripePayment(stripe, "pi_x", 12_500_000n);
    expect(result.valid).toBe(true);
  });

  it("rejects when charged amount differs by more than 1 cent", async () => {
    const stripe = makeStripe({ status: "succeeded", currency: "usd", amount: 1200 });
    // expected 12.50 USD, charged 12.00 USD — 50 cents off
    const result = await verifyStripePayment(stripe, "pi_x", 12_500_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not match expected/);
  });

  it("surfaces stripe.paymentIntents.retrieve errors", async () => {
    const stripe: StripeLike = {
      paymentIntents: {
        retrieve: vi.fn(() => Promise.reject(new Error("Stripe API: no such payment_intent"))),
      },
    };
    const result = await verifyStripePayment(stripe, "pi_unknown", 12_500_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no such payment_intent/);
  });
});
