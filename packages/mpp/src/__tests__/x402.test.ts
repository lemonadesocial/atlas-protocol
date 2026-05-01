import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encode, serialize, deserialize, decode } from "../envelope.js";
import {
  MppPaymentRefusedError,
  fetchWithPayment,
  type FetchWithPaymentOptions,
  type PaymentStrategy,
  type ViemAccountLike,
  type ViemChainLike,
} from "../x402/index.js";
import type { MppPayload } from "../types/payload.js";

const RECEIVER = "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00" as const;
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const TX_HASH = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;

const ACCOUNT: ViemAccountLike = {
  address: "0x0000000000000000000000000000000000000001",
};

const CHAIN: ViemChainLike = {
  id: 84532,
  name: "Base Sepolia",
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
};

function buildChallengePayload(overrides: Partial<MppPayload> = {}): MppPayload {
  return {
    rail: "usdc-base",
    intent: "charge",
    realm: "lemonade-backend",
    paymentId: "mpp_test_001",
    amount: "0.001000",
    currency: USDC_BASE_SEPOLIA,
    recipient: RECEIVER,
    description: "paid pong (Base Sepolia USDC)",
    expires: "2030-01-01T00:00:00.000Z",
    ttl: 600,
    metadata: { chain_id: "84532", price_usdc_micro: "1000" },
    ...overrides,
  };
}

function buildChallengeWire(overrides: Partial<MppPayload> = {}): string {
  return serialize(encode(buildChallengePayload(overrides)));
}

function build402Response(challengeWire: string, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ challenge: challengeWire, payment_id: "mpp_test_001" }), {
    status: 402,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function baseOpts(overrides: Partial<FetchWithPaymentOptions> = {}): FetchWithPaymentOptions {
  return {
    account: ACCOUNT,
    chain: CHAIN,
    allowedReceivers: [RECEIVER],
    allowedStablecoins: [USDC_BASE_SEPOLIA],
    maxAmountUsdcMicro: 10_000n,
    paymentStrategy: vi.fn<Parameters<PaymentStrategy>, ReturnType<PaymentStrategy>>(() =>
      Promise.resolve(TX_HASH),
    ),
    ...overrides,
  };
}

describe("fetchWithPayment", () => {
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
    const got = await fetchWithPayment("https://example.com/free", undefined, opts);

    expect(got.status).toBe(200);
    expect(await got.text()).toBe("hi");
    expect(opts.paymentStrategy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects when challenge recipient is not in allowedReceivers", async () => {
    const wire = buildChallengeWire({
      recipient: "0xDEADBEEFdeadbeefDEADBEEFdeadbeefDEADBEEF",
    });
    fetchSpy.mockResolvedValueOnce(build402Response(wire));

    const opts = baseOpts();
    await expect(fetchWithPayment("https://example.com", undefined, opts)).rejects.toMatchObject({
      name: "MppPaymentRefusedError",
      reason: "receiver-not-allowed",
    });
    expect(opts.paymentStrategy).not.toHaveBeenCalled();
  });

  it("rejects when challenge currency is not in allowedStablecoins", async () => {
    const wire = buildChallengeWire({
      currency: "0x1111111111111111111111111111111111111111",
    });
    fetchSpy.mockResolvedValueOnce(build402Response(wire));

    const opts = baseOpts();
    await expect(fetchWithPayment("https://example.com", undefined, opts)).rejects.toMatchObject({
      name: "MppPaymentRefusedError",
      reason: "stablecoin-not-allowed",
    });
    expect(opts.paymentStrategy).not.toHaveBeenCalled();
  });

  it("rejects when amount exceeds maxAmountUsdcMicro", async () => {
    const wire = buildChallengeWire({ amount: "0.020000" }); // 20_000 micro
    fetchSpy.mockResolvedValueOnce(build402Response(wire));

    const opts = baseOpts({ maxAmountUsdcMicro: 10_000n });
    const err = await fetchWithPayment("https://example.com", undefined, opts).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MppPaymentRefusedError);
    expect((err as MppPaymentRefusedError).reason).toBe("amount-exceeds-cap");
    expect(opts.paymentStrategy).not.toHaveBeenCalled();
  });

  it("happy path: pays, retries with Authorization: MPP <wire>, returns 200", async () => {
    const wire = buildChallengeWire();
    const onPayment = vi.fn();

    fetchSpy.mockResolvedValueOnce(build402Response(wire)).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "paid pong", txHash: TX_HASH }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const opts = baseOpts({ onPayment });
    const got = await fetchWithPayment("https://example.com/ping-paid", undefined, opts);

    expect(got.status).toBe(200);
    const body = (await got.json()) as { message: string };
    expect(body.message).toBe("paid pong");

    expect(opts.paymentStrategy).toHaveBeenCalledTimes(1);
    const stratCall = (opts.paymentStrategy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      account: ViemAccountLike;
      token: string;
      receiver: string;
      amountUsdcMicro: bigint;
      waitForConfirmations: number;
    };
    expect(stratCall.token).toBe(USDC_BASE_SEPOLIA);
    expect(stratCall.receiver).toBe(RECEIVER);
    expect(stratCall.amountUsdcMicro).toBe(1000n);
    expect(stratCall.waitForConfirmations).toBe(1);

    expect(onPayment).toHaveBeenCalledWith({
      txHash: TX_HASH,
      amount: 1000n,
      receiver: RECEIVER,
    });

    // Inspect the retry — the Authorization header MUST carry an MPP credential
    // whose decoded payload matches the challenge plus a tx_hash metadata entry.
    const retry = fetchSpy.mock.calls[1] as [string | URL, RequestInit | undefined];
    const retryHeaders = new Headers(retry[1]?.headers);
    const auth = retryHeaders.get("Authorization");
    expect(auth).toMatch(/^MPP /);
    const credentialWire = auth!.slice("MPP ".length);
    const credentialPayload = decode(deserialize(credentialWire));
    expect(credentialPayload.paymentId).toBe("mpp_test_001");
    expect(credentialPayload.recipient).toBe(RECEIVER);
    expect(credentialPayload.amount).toBe("0.001000");
    expect(credentialPayload.metadata?.tx_hash).toBe(TX_HASH);
    // Pre-existing challenge metadata is preserved.
    expect(credentialPayload.metadata?.chain_id).toBe("84532");
  });

  it("does not loop: a second 402 on retry is surfaced verbatim", async () => {
    const wire = buildChallengeWire();
    const second402 = build402Response(wire, {
      headers: { "content-type": "application/json" },
    });
    fetchSpy.mockResolvedValueOnce(build402Response(wire)).mockResolvedValueOnce(second402);

    const opts = baseOpts();
    const got = await fetchWithPayment("https://example.com", undefined, opts);

    expect(got.status).toBe(402);
    expect(opts.paymentStrategy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to WWW-Authenticate header when JSON body is absent", async () => {
    const wire = buildChallengeWire();
    fetchSpy
      .mockResolvedValueOnce(
        new Response("", {
          status: 402,
          headers: {
            "WWW-Authenticate": `MPP realm="lemonade-backend", challenge="${wire}"`,
          },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const opts = baseOpts();
    const got = await fetchWithPayment("https://example.com", undefined, opts);
    expect(got.status).toBe(200);
    expect(opts.paymentStrategy).toHaveBeenCalledTimes(1);
  });

  it("throws challenge-missing when 402 has no MPP envelope at all", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "payment required" }), {
        status: 402,
        headers: { "content-type": "application/json" },
      }),
    );

    const opts = baseOpts();
    await expect(fetchWithPayment("https://example.com", undefined, opts)).rejects.toMatchObject({
      name: "MppPaymentRefusedError",
      reason: "challenge-missing",
    });
  });
});
