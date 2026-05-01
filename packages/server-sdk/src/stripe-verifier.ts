import type { AtlasPaymentVerifyResult } from "./types/index.js";

/**
 * Structural type for the subset of the Stripe SDK we touch. Declared this
 * way (instead of importing from `stripe`) so the package can compile without
 * Stripe installed — consumers who never accept fiat shouldn't have to load
 * the Stripe SDK to use this SDK.
 *
 * Pass any object that exposes a `paymentIntents.retrieve()` method whose
 * return value carries `status`, `currency`, and `amount`. This matches the
 * official `Stripe` constructor's surface as of Stripe Node SDK 14.x+.
 */
export interface StripeLike {
  paymentIntents: {
    retrieve(id: string): Promise<StripePaymentIntent>;
  };
}

export interface StripePaymentIntent {
  id: string;
  /** Stripe lifecycle status: "succeeded", "processing", "requires_action", etc. */
  status: string;
  /** Stripe charge amount in the SMALLEST currency unit (cents for USD). */
  amount: number;
  /** ISO-4217 currency code, lowercased ("usd"). */
  currency: string;
}

/**
 * Verify a Stripe SPT (Stablecoin Payment Token) PaymentIntent.
 *
 * Checks: status === "succeeded", currency === "usd", and the charged amount
 * matches the expected USD-micros amount within ±1 cent (10_000 micros).
 *
 * @param stripe - A Stripe SDK instance (or any object matching StripeLike).
 * @param paymentIntentId - The PaymentIntent identifier returned by Stripe.
 * @param expectedAmountUsdMicros - Expected amount in USD micros (1 USD = 1_000_000).
 */
export async function verifyStripePayment(
  stripe: StripeLike,
  paymentIntentId: string,
  expectedAmountUsdMicros: bigint,
): Promise<AtlasPaymentVerifyResult> {
  let intent: StripePaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe paymentIntents.retrieve failed";
    return { valid: false, error: message };
  }

  if (intent.status !== "succeeded") {
    return {
      valid: false,
      error: `Stripe PaymentIntent status is "${intent.status}", expected "succeeded"`,
    };
  }

  if (intent.currency.toLowerCase() !== "usd") {
    return {
      valid: false,
      error: `Stripe PaymentIntent currency is "${intent.currency}", expected "usd"`,
    };
  }

  // Stripe's `amount` is in cents. Convert to USD micros for comparison
  // (1 cent = 10_000 USD-micros). Tolerance is ±1 cent = 10_000 USD-micros.
  const chargedMicros = BigInt(intent.amount) * 10_000n;
  const diff =
    chargedMicros > expectedAmountUsdMicros
      ? chargedMicros - expectedAmountUsdMicros
      : expectedAmountUsdMicros - chargedMicros;
  const tolerance = 10_000n;
  if (diff > tolerance) {
    return {
      valid: false,
      error: `Stripe charged amount (${intent.amount} cents) does not match expected ${expectedAmountUsdMicros.toString()} USD-micros (diff ${diff.toString()} > tolerance ${tolerance.toString()})`,
    };
  }

  return {
    valid: true,
    verified_amount_usd: Number(chargedMicros) / 1_000_000,
  };
}
