import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decode, deserialize, encode, serialize } from "../envelope.js";
import {
  fetchWithPaymentSpt,
  MppPaymentRefusedError,
  type FetchWithPaymentSptOptions,
} from "../stripe-mpp/index.js";
import type { MppPayload } from "../types/payload.js";

const RECEIVER = "stripe:acct_atlas_demo";
const PAYMENT_INTENT_ID = "pi_test_atlas_001";
const CHALLENGE_ID = "ch_hold_xyz";

interface PaymentMethodEntry {
  type: string;
  amount?: string;
  currency?: string;
  payment_intent_id?: string;
  chain_id?: number;
}

function buildChallengePayload(args: {
  paymentMethods: PaymentMethodEntry[];
  recipient?: string;
  amount?: string;
  currency?: string;
  rail?: string;
}): MppPayload {
  return {
    rail: args.rail ?? "stripe-spt",
    intent: "charge",
    realm: "atlas",
    paymentId: CHALLENGE_ID,
    amount: args.amount ?? "12.50",
    currency: args.currency ?? "usd",
    recipient: args.recipient ?? RECEIVER,
    description: "ATLAS purchase evt_1 hold=hold_xyz",
    expires: "2030-01-01T00:00:00.000Z",
    metadata: {
      challenge_id: CHALLENGE_ID,
      payment_methods: JSON.stringify(args.paymentMethods),
    },
  };
}

function buildChallengeWire(args: Parameters<typeof buildChallengePayload>[0]): string {
  return serialize(encode(buildChallengePayload(args)));
}

function build402Response(challengeWire: string, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ challenge: challengeWire, payment_id: CHALLENGE_ID }), {
    status: 402,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function baseOpts(overrides: Partial<FetchWithPaymentSptOptions> = {}): FetchWithPaymentSptOptions {
  return {
    getSpt: vi.fn(() => Promise.resolve(PAYMENT_INTENT_ID)),
    maxAmountUsdCents: 5000, // $50.00 cap
    allowedReceivers: [RECEIVER],
    ...overrides,
  };
}

describe("fetchWithPaymentSpt", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("returns the response unchanged when not a 402", async () => {
    const ok = new Response("hi", { status: 200 });
    fetchSpy.mockResolvedValueOnce(ok);

    const opts = baseOpts();
    const got = await fetchWithPaymentSpt("https://example.com/free", undefined, opts);

    expect(got.status).toBe(200);
    expect(await got.text()).toBe("hi");
    expect(opts.getSpt).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws no_stripe_method_offered when 402 lacks a stripe_spt entry", async () => {
    const wire = buildChallengeWire({
      paymentMethods: [{ type: "base_usdc", chain_id: 8453, amount: "0.001000" }],
    });
    fetchSpy.mockResolvedValueOnce(build402Response(wire));

    const opts = baseOpts();
    await expect(fetchWithPaymentSpt("https://example.com", undefined, opts)).rejects.toMatchObject(
      {
        name: "MppPaymentRefusedError",
        reason: "no_stripe_method_offered",
      },
    );
    expect(opts.getSpt).not.toHaveBeenCalled();
  });

  it("rejects when the offered amount exceeds maxAmountUsdCents", async () => {
    const wire = buildChallengeWire({
      paymentMethods: [{ type: "stripe_spt", amount: "100.00", currency: "usd" }],
      amount: "100.00",
    });
    fetchSpy.mockResolvedValueOnce(build402Response(wire));

    const opts = baseOpts({ maxAmountUsdCents: 5000 });
    const err = await fetchWithPaymentSpt("https://example.com", undefined, opts).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MppPaymentRefusedError);
    expect((err as MppPaymentRefusedError).reason).toBe("amount-exceeds-cap");
    expect(opts.getSpt).not.toHaveBeenCalled();
  });

  it("rejects when the receiver is not in allowedReceivers", async () => {
    const wire = buildChallengeWire({
      paymentMethods: [{ type: "stripe_spt", amount: "12.50", currency: "usd" }],
      recipient: "stripe:acct_attacker",
    });
    fetchSpy.mockResolvedValueOnce(build402Response(wire));

    const opts = baseOpts({ allowedReceivers: [RECEIVER] });
    await expect(fetchWithPaymentSpt("https://example.com", undefined, opts)).rejects.toMatchObject(
      {
        name: "MppPaymentRefusedError",
        reason: "receiver-not-allowed",
      },
    );
    expect(opts.getSpt).not.toHaveBeenCalled();
  });

  it("rejects non-USD stripe_spt offers", async () => {
    const wire = buildChallengeWire({
      paymentMethods: [{ type: "stripe_spt", amount: "12.50", currency: "eur" }],
    });
    fetchSpy.mockResolvedValueOnce(build402Response(wire));

    const opts = baseOpts();
    await expect(fetchWithPaymentSpt("https://example.com", undefined, opts)).rejects.toMatchObject(
      {
        name: "MppPaymentRefusedError",
        reason: "currency-not-usd",
      },
    );
  });

  it("happy path: calls getSpt, retries with Authorization: MPP <wire>, returns 200", async () => {
    const wire = buildChallengeWire({
      paymentMethods: [
        { type: "base_usdc", chain_id: 8453, amount: "0.001000" },
        { type: "stripe_spt", amount: "12.50", currency: "usd" },
      ],
    });
    const onPayment = vi.fn();

    fetchSpy.mockResolvedValueOnce(build402Response(wire)).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "paid", paymentIntentId: PAYMENT_INTENT_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const getSpt = vi.fn(() => Promise.resolve(PAYMENT_INTENT_ID));
    const opts = baseOpts({ getSpt, onPayment });

    const got = await fetchWithPaymentSpt("https://example.com/purchase", undefined, opts);

    expect(got.status).toBe(200);

    // getSpt was called with the right shape.
    expect(getSpt).toHaveBeenCalledTimes(1);
    const sptCall = getSpt.mock.calls[0]?.[0] as {
      amount: number;
      currency: string;
      challenge_id: string;
      realm: string;
      receiver: string;
    };
    expect(sptCall.amount).toBe(1250);
    expect(sptCall.currency).toBe("usd");
    expect(sptCall.challenge_id).toBe(CHALLENGE_ID);
    expect(sptCall.receiver).toBe(RECEIVER);

    // onPayment was notified.
    expect(onPayment).toHaveBeenCalledWith({
      paymentIntentId: PAYMENT_INTENT_ID,
      amountCents: 1250,
      receiver: RECEIVER,
    });

    // Retry has the right Authorization header carrying a credential whose
    // metadata.payment_intent_id matches what getSpt returned.
    const retry = fetchSpy.mock.calls[1] as [string | URL, RequestInit | undefined];
    const retryHeaders = new Headers(retry[1]?.headers);
    const auth = retryHeaders.get("Authorization");
    expect(auth).toMatch(/^MPP /);
    const credentialWire = auth!.slice("MPP ".length);
    const credentialPayload = decode(deserialize(credentialWire));
    expect(credentialPayload.metadata?.payment_intent_id).toBe(PAYMENT_INTENT_ID);
    expect(credentialPayload.paymentId).toBe(CHALLENGE_ID);
    expect(credentialPayload.amount).toBe("12.50");
    // Pre-existing metadata is preserved.
    expect(credentialPayload.metadata?.challenge_id).toBe(CHALLENGE_ID);
  });

  it("does not loop: a second 402 on retry is surfaced verbatim", async () => {
    const wire = buildChallengeWire({
      paymentMethods: [{ type: "stripe_spt", amount: "12.50", currency: "usd" }],
    });
    fetchSpy
      .mockResolvedValueOnce(build402Response(wire))
      .mockResolvedValueOnce(build402Response(wire));

    const opts = baseOpts();
    const got = await fetchWithPaymentSpt("https://example.com", undefined, opts);

    expect(got.status).toBe(402);
    expect(opts.getSpt).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to WWW-Authenticate header when JSON body is absent", async () => {
    const wire = buildChallengeWire({
      paymentMethods: [{ type: "stripe_spt", amount: "12.50", currency: "usd" }],
    });
    fetchSpy
      .mockResolvedValueOnce(
        new Response("", {
          status: 402,
          headers: {
            "WWW-Authenticate": `MPP realm="atlas", challenge="${wire}"`,
          },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const opts = baseOpts();
    const got = await fetchWithPaymentSpt("https://example.com", undefined, opts);
    expect(got.status).toBe(200);
    expect(opts.getSpt).toHaveBeenCalledTimes(1);
  });

  it("throws challenge-missing when 402 has no MPP envelope at all", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "payment required" }), {
        status: 402,
        headers: { "content-type": "application/json" },
      }),
    );

    const opts = baseOpts();
    await expect(fetchWithPaymentSpt("https://example.com", undefined, opts)).rejects.toMatchObject(
      {
        name: "MppPaymentRefusedError",
        reason: "challenge-missing",
      },
    );
  });

  it("wraps a getSpt rejection as spt-callback-failed", async () => {
    const wire = buildChallengeWire({
      paymentMethods: [{ type: "stripe_spt", amount: "12.50", currency: "usd" }],
    });
    fetchSpy.mockResolvedValueOnce(build402Response(wire));

    const opts = baseOpts({
      getSpt: () => Promise.reject(new Error("user declined")),
    });
    const err = await fetchWithPaymentSpt("https://example.com", undefined, opts).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MppPaymentRefusedError);
    expect((err as MppPaymentRefusedError).reason).toBe("spt-callback-failed");
    expect((err as MppPaymentRefusedError).message).toMatch(/user declined/);
  });
});
