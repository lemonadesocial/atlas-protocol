/**
 * @atlasprotocol/mpp/stripe-mpp — agent-side helper for HTTP 402 challenges
 * that offer Stripe SPT (Stablecoin Payment Token) as a payment rail.
 *
 * Sibling to `@atlasprotocol/mpp/x402` (on-chain USDC settlement). Where
 * x402 settles the challenge by sending an ERC-20 transfer, stripe-mpp
 * settles it by completing a Stripe PaymentIntent through a caller-supplied
 * callback (`opts.getSpt`) — keeping user-authorization concerns OUT of this
 * package and IN the agent surface (Claude / ChatGPT / Gemini) where they
 * belong.
 *
 * The helper is intentionally narrow:
 *   - one rail: Stripe SPT (currency = "usd")
 *   - one retry — a second 402 on retry is surfaced verbatim
 *   - no JWS, no replay store
 *   - no Stripe SDK dependency — the caller owns the Stripe call
 */

import {
  decode,
  deserialize,
  encode,
  serialize,
  type MppEnvelope,
  type MppPayload,
} from "../index.js";

/**
 * Reason a 402 was refused without paying. Surfaced as an instance member so
 * callers can branch on `err instanceof MppPaymentRefusedError` and inspect
 * `err.reason` without parsing the message.
 */
export type MppPaymentRefusedReason =
  | "challenge-missing"
  | "challenge-malformed"
  | "no_stripe_method_offered"
  | "receiver-not-allowed"
  | "amount-exceeds-cap"
  | "amount-malformed"
  | "currency-not-usd"
  | "spt-callback-failed";

/**
 * Thrown when a 402 challenge fails the safety checks in
 * {@link FetchWithPaymentSptOptions}, or when `opts.getSpt` rejects. Distinct
 * from network errors so callers can decide whether to alert ("server asked
 * us to pay an unknown receiver") vs retry ("the SPT callback failed").
 */
export class MppPaymentRefusedError extends Error {
  public readonly reason: MppPaymentRefusedReason;
  public readonly challenge: MppPayload | undefined;

  constructor(
    reason: MppPaymentRefusedReason,
    message: string,
    challenge: MppPayload | undefined = undefined,
  ) {
    super(message);
    this.name = "MppPaymentRefusedError";
    this.reason = reason;
    this.challenge = challenge;
  }
}

/**
 * Description of the Stripe SPT method, lifted out of the challenge envelope
 * before {@link FetchWithPaymentSptOptions.getSpt} is called.
 */
export interface StripeSptChallenge {
  /** Charged amount in cents. Derived from the challenge `amount` decimal. */
  amount: number;
  /** ISO-4217 currency. Always "usd" — non-usd challenges are rejected upstream. */
  currency: "usd";
  /** Challenge id from the MPP envelope header (`paymentId`). */
  challenge_id: string;
  /** Server realm (host) — useful for the agent to surface to the user. */
  realm: string;
  /**
   * Optional Stripe-side merchant identifier the caller may want to verify
   * against `allowedReceivers`. Pulled from the challenge payload's
   * `recipient` field.
   */
  receiver?: string;
}

export interface FetchWithPaymentSptOptions {
  /**
   * Caller-supplied Stripe SPT callback. Returns the Stripe
   * `payment_intent_id` once the user has authorized + the charge has
   * settled. The agent surface (Claude / ChatGPT / Gemini) is responsible
   * for showing the user the amount, getting consent, and calling the
   * Stripe API itself — this package never sees Stripe credentials.
   */
  getSpt: (challenge: StripeSptChallenge) => Promise<string>;
  /**
   * Hard cap (in cents) above which the helper refuses to call `getSpt`.
   * Required — without it the helper would try to charge any amount the
   * server demanded.
   */
  maxAmountUsdCents: number;
  /**
   * Allowlist of acceptable Stripe-side receivers (account ids, business
   * names, or whatever convention the platform exposes in the challenge
   * `recipient` field). Compared case-sensitively. If the challenge does
   * not carry a recipient, the request is rejected.
   */
  allowedReceivers: readonly string[];
  /** Notification hook for instrumented agents (logging, metrics). */
  onPayment?: (info: { paymentIntentId: string; amountCents: number; receiver: string }) => void;
}

/**
 * Drop-in `fetch` that handles a single 402 → SPT → retry round.
 *
 * Behavior:
 *   1. Issue `fetch(url, init)`.
 *   2. If the response is not 402, return it unchanged.
 *   3. If it is 402:
 *      a. Parse the challenge envelope from the JSON body
 *         (`{ challenge: <wire>, ... }`) or `WWW-Authenticate: MPP …` header.
 *      b. Locate a `stripe_spt` entry inside `payload.metadata.payment_methods`
 *         (server-sdk's `generateMppChallenge` puts the array there). Throws
 *         `no_stripe_method_offered` if absent.
 *      c. Validate amount ≤ `opts.maxAmountUsdCents`, currency === "usd",
 *         and recipient ∈ `opts.allowedReceivers`.
 *      d. Call `opts.getSpt({ amount, currency, challenge_id })`. The
 *         callback returns a Stripe `payment_intent_id`.
 *      e. Build a credential envelope echoing the challenge plus
 *         `metadata.payment_intent_id`. Retry with
 *         `Authorization: MPP <credential-wire>`.
 *      f. Don't loop — return whatever the retry produces, even if it's a
 *         second 402.
 */
export async function fetchWithPaymentSpt(
  url: string | URL,
  init: RequestInit | undefined,
  opts: FetchWithPaymentSptOptions,
): Promise<Response> {
  const response = await fetch(url, init);

  if (response.status !== 402) {
    return response;
  }

  // Response bodies may only be read once — pass a clone to the parser so
  // the original is still available if the helper bails out.
  const challengeWire = await extractChallengeWire(response.clone());
  if (!challengeWire) {
    throw new MppPaymentRefusedError(
      "challenge-missing",
      "402 response did not carry an MPP challenge (no `challenge` body field, no WWW-Authenticate: MPP header)",
    );
  }

  let envelope: MppEnvelope;
  let payload: MppPayload;
  try {
    envelope = deserialize(challengeWire);
    payload = decode(envelope);
  } catch (err) {
    throw new MppPaymentRefusedError(
      "challenge-malformed",
      `failed to decode MPP challenge: ${errMsg(err)}`,
    );
  }

  const stripeMethod = pickStripeMethod(payload);
  if (!stripeMethod) {
    throw new MppPaymentRefusedError(
      "no_stripe_method_offered",
      "challenge does not offer a stripe_spt payment method",
      payload,
    );
  }

  if (stripeMethod.currency !== "usd") {
    throw new MppPaymentRefusedError(
      "currency-not-usd",
      `stripe_spt method currency is "${stripeMethod.currency}", only "usd" is supported`,
      payload,
    );
  }

  const amountCents = parseUsdDecimalAsCents(stripeMethod.amount);
  if (amountCents === null) {
    throw new MppPaymentRefusedError(
      "amount-malformed",
      `stripe_spt amount "${stripeMethod.amount}" is not a USD decimal`,
      payload,
    );
  }
  if (amountCents > opts.maxAmountUsdCents) {
    throw new MppPaymentRefusedError(
      "amount-exceeds-cap",
      `challenge amount ${amountCents} cents exceeds maxAmountUsdCents=${opts.maxAmountUsdCents}`,
      payload,
    );
  }

  const receiver = payload.recipient ?? "";
  if (!opts.allowedReceivers.some((r) => r === receiver)) {
    throw new MppPaymentRefusedError(
      "receiver-not-allowed",
      `challenge recipient "${receiver}" is not in allowedReceivers`,
      payload,
    );
  }

  let paymentIntentId: string;
  try {
    paymentIntentId = await opts.getSpt({
      amount: amountCents,
      currency: "usd",
      challenge_id: payload.paymentId,
      realm: payload.realm,
      receiver,
    });
  } catch (err) {
    throw new MppPaymentRefusedError(
      "spt-callback-failed",
      `getSpt callback failed: ${errMsg(err)}`,
      payload,
    );
  }

  if (!paymentIntentId || typeof paymentIntentId !== "string") {
    throw new MppPaymentRefusedError(
      "spt-callback-failed",
      "getSpt callback did not return a string payment_intent_id",
      payload,
    );
  }

  opts.onPayment?.({ paymentIntentId, amountCents, receiver });

  const credential = buildCredentialFromChallenge(payload, envelope, paymentIntentId);
  const credentialWire = serialize(credential);

  const retryHeaders = new Headers(init?.headers);
  retryHeaders.set("Authorization", `MPP ${credentialWire}`);

  return await fetch(url, { ...init, headers: retryHeaders });
}

// --- internal helpers -----------------------------------------------------

/**
 * Try the JSON body first (`{ challenge: <wire> }`), fall back to the
 * `WWW-Authenticate: MPP realm="...", challenge="<wire>"` header. Mirrors
 * the contract used by `@atlasprotocol/mpp/x402`.
 */
async function extractChallengeWire(response: Response): Promise<string | null> {
  try {
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await response.json()) as { challenge?: unknown };
      if (typeof body.challenge === "string" && body.challenge.length > 0) {
        return body.challenge;
      }
    }
  } catch {
    // fall through to WWW-Authenticate
  }

  const wwwAuth = response.headers.get("www-authenticate");
  if (!wwwAuth) return null;

  const match = /(?:^|[\s,])(?:MPP|Bearer)\s.*?challenge="([^"]+)"/i.exec(wwwAuth);
  return match?.[1] ?? null;
}

interface OfferedStripeMethod {
  amount: string;
  currency: string;
  payment_intent_id?: string;
}

/**
 * Pick the `stripe_spt` entry out of `payload.metadata.payment_methods`.
 * Returns `null` if no such entry exists. The server-sdk's
 * `generateMppChallenge` JSON-encodes the payment_methods array into the
 * envelope's `metadata.payment_methods` slot — this helper inverts that
 * exactly.
 */
function pickStripeMethod(payload: MppPayload): OfferedStripeMethod | null {
  const raw = payload.metadata?.payment_methods;
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (e["type"] !== "stripe_spt") continue;
    const amount = e["amount"];
    const currency = e["currency"];
    if (typeof amount !== "string" || typeof currency !== "string") return null;
    const result: OfferedStripeMethod = { amount, currency };
    const pi = e["payment_intent_id"];
    if (typeof pi === "string") result.payment_intent_id = pi;
    return result;
  }
  return null;
}

/**
 * Parse a 2-decimal USD string ("12.50") into integer cents (1250). Returns
 * `null` for any malformed input — the helper rejects such challenges
 * upstream rather than silently rounding.
 */
function parseUsdDecimalAsCents(decimal: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(decimal)) return null;
  const [whole, fraction = ""] = decimal.split(".");
  const fractionPadded = fraction.padEnd(2, "0");
  const cents = Number.parseInt(whole ?? "0", 10) * 100 + Number.parseInt(fractionPadded, 10);
  return Number.isFinite(cents) ? cents : null;
}

/**
 * Build the credential envelope from the challenge envelope. Echoes every
 * challenge field verbatim and adds `payment_intent_id` to
 * `metadata` — mirrors how `x402/index.ts` adds `tx_hash` for on-chain rails.
 */
function buildCredentialFromChallenge(
  challenge: MppPayload,
  challengeEnvelope: MppEnvelope,
  paymentIntentId: string,
): MppEnvelope {
  const metadata: Record<string, string> = {
    ...(challenge.metadata ?? {}),
    payment_intent_id: paymentIntentId,
  };

  const credentialPayload: MppPayload = {
    ...challenge,
    metadata,
  };

  const encoded = encode(credentialPayload);
  if (challengeEnvelope.opaque !== undefined) {
    encoded.opaque = { ...challengeEnvelope.opaque };
  }
  return encoded;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
