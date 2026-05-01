import { encode, serialize } from "@atlasprotocol/mpp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AtlasMppRoutingConfig, ViemAccount, ViemChainLike } from "../config.js";
import { routeDualProtocol402 } from "../dual-protocol-router.js";

const RECEIVER_EVM = "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00" as const;
const RECEIVER_STRIPE = "stripe:acct_atlas_demo";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const TX_HASH = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;
const PI_ID = "pi_test_atlas_001";

const ACCOUNT: ViemAccount = { address: "0x0000000000000000000000000000000000000001" };
const CHAIN: ViemChainLike = {
  id: 84532,
  name: "Base Sepolia",
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
};

interface PaymentMethodEntry {
  type: string;
  amount?: string;
  currency?: string;
  recipient?: string;
  chain_id?: number;
  token?: string;
  rpc_url?: string;
  confirmations?: number;
  payment_intent_id?: string;
}

function buildChallengeWire(args: {
  primaryRail: string;
  primaryAmount: string;
  primaryCurrency: string;
  primaryRecipient: string;
  paymentMethods: PaymentMethodEntry[];
}): string {
  return serialize(
    encode({
      rail: args.primaryRail,
      intent: "charge",
      realm: "atlas",
      paymentId: "ch_hold_xyz",
      amount: args.primaryAmount,
      currency: args.primaryCurrency,
      recipient: args.primaryRecipient,
      description: "ATLAS purchase evt_1",
      expires: "2030-01-01T00:00:00.000Z",
      metadata: {
        challenge_id: "ch_hold_xyz",
        payment_methods: JSON.stringify(args.paymentMethods),
      },
    }),
  );
}

function build402(challengeWire: string): Response {
  return new Response(JSON.stringify({ challenge: challengeWire }), {
    status: 402,
    headers: { "content-type": "application/json" },
  });
}

function dualOfferWire(): string {
  return buildChallengeWire({
    primaryRail: "usdc-base-sepolia",
    primaryAmount: "0.001000",
    primaryCurrency: USDC_BASE_SEPOLIA,
    primaryRecipient: RECEIVER_EVM,
    paymentMethods: [
      {
        type: "base_sepolia_usdc",
        amount: "0.001000",
        recipient: RECEIVER_EVM,
        chain_id: 84532,
        token: USDC_BASE_SEPOLIA,
        rpc_url: "https://sepolia.base.org",
        confirmations: 1,
      },
      {
        type: "stripe_spt",
        amount: "0.00",
        currency: "usd",
        recipient: RECEIVER_STRIPE,
      },
    ],
  });
}

function x402OnlyOfferWire(): string {
  return buildChallengeWire({
    primaryRail: "usdc-base-sepolia",
    primaryAmount: "0.001000",
    primaryCurrency: USDC_BASE_SEPOLIA,
    primaryRecipient: RECEIVER_EVM,
    paymentMethods: [
      {
        type: "base_sepolia_usdc",
        amount: "0.001000",
        recipient: RECEIVER_EVM,
        chain_id: 84532,
        token: USDC_BASE_SEPOLIA,
        rpc_url: "https://sepolia.base.org",
        confirmations: 1,
      },
    ],
  });
}

function stripeOnlyOfferWire(): string {
  return buildChallengeWire({
    primaryRail: "stripe-spt",
    primaryAmount: "12.50",
    primaryCurrency: "usd",
    primaryRecipient: RECEIVER_STRIPE,
    paymentMethods: [
      { type: "stripe_spt", amount: "12.50", currency: "usd", recipient: RECEIVER_STRIPE },
    ],
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
  vi.resetModules();
});

function baseRouting(overrides: Partial<AtlasMppRoutingConfig> = {}): AtlasMppRoutingConfig {
  return {
    allowedReceivers: [RECEIVER_EVM, RECEIVER_STRIPE],
    maxAmountUsdCents: 5000,
    ...overrides,
  };
}

/**
 * Mock the dynamically-imported `@atlasprotocol/mpp/x402` module so that
 * `fetchWithPayment` runs the real implementation with our injected
 * `paymentStrategy` (no viem, no live RPC). Returns the spy so tests can
 * assert on it.
 */
function mockX402WithPaymentStrategy(paymentStrategy: () => Promise<`0x${string}`>): void {
  vi.doMock("@atlasprotocol/mpp/x402", async (importOriginal) => {
    const actual: typeof import("@atlasprotocol/mpp/x402") = await importOriginal();
    return {
      ...actual,
      fetchWithPayment: vi.fn(
        async (
          url: string | URL,
          init: RequestInit | undefined,
          opts: Parameters<typeof actual.fetchWithPayment>[2],
        ) => actual.fetchWithPayment(url, init, { ...opts, paymentStrategy }),
      ),
    };
  });
}

describe("routeDualProtocol402 — auto routing", () => {
  it("auto-routes to x402 when only x402 + viemAccount provided", async () => {
    const wire = x402OnlyOfferWire();
    const initial = build402(wire);
    // The helper re-fetches inside (idempotent on the server) and on 402 pays + retries.
    fetchSpy
      .mockResolvedValueOnce(build402(wire))
      .mockResolvedValueOnce(new Response("paid", { status: 200 }));

    const paymentStrategy = vi.fn(() => Promise.resolve(TX_HASH));
    mockX402WithPaymentStrategy(paymentStrategy);

    const { routeDualProtocol402: routeFn } = await import("../dual-protocol-router.js");
    const result = await routeFn(
      "https://api.example.com/buy",
      { method: "POST" },
      initial,
      baseRouting({
        viemAccount: ACCOUNT,
        chain: CHAIN,
        allowedStablecoins: [USDC_BASE_SEPOLIA],
        maxAmountUsdcMicro: 10_000n,
      }),
    );

    expect(result.kind).toBe("paid");
    if (result.kind === "paid") {
      expect(result.rail).toBe("x402");
      expect(result.response.status).toBe(200);
    }
    expect(paymentStrategy).toHaveBeenCalledTimes(1);
  });

  it("auto-routes to stripe-mpp when only stripe + getSpt provided", async () => {
    const wire = stripeOnlyOfferWire();
    const initial = build402(wire);
    fetchSpy
      .mockResolvedValueOnce(build402(wire))
      .mockResolvedValueOnce(new Response("paid", { status: 200 }));

    const getSpt = vi.fn(() => Promise.resolve(PI_ID));
    const result = await routeDualProtocol402(
      "https://api.example.com/buy",
      { method: "POST" },
      initial,
      baseRouting({ getSpt }),
    );

    expect(result.kind).toBe("paid");
    if (result.kind === "paid") {
      expect(result.rail).toBe("stripe-mpp");
      expect(result.response.status).toBe(200);
    }
    expect(getSpt).toHaveBeenCalledTimes(1);
  });

  it("returns unrouted when neither client opts provided (back-compat)", async () => {
    const wire = dualOfferWire();
    const initial = build402(wire);

    const result = await routeDualProtocol402(
      "https://api.example.com/buy",
      { method: "POST" },
      initial,
      baseRouting(),
    );

    expect(result.kind).toBe("unrouted");
    if (result.kind === "unrouted") {
      expect(result.reason).toBe("no-client-opts");
      expect(result.challenge.offers).toHaveLength(2);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("routeDualProtocol402 — preferredRail explicit", () => {
  it("uses x402 when preferredRail = 'x402'", async () => {
    const wire = dualOfferWire();
    const initial = build402(wire);
    fetchSpy
      .mockResolvedValueOnce(build402(wire))
      .mockResolvedValueOnce(new Response("paid", { status: 200 }));

    const paymentStrategy = vi.fn(() => Promise.resolve(TX_HASH));
    const getSpt = vi.fn(() => Promise.resolve(PI_ID));
    mockX402WithPaymentStrategy(paymentStrategy);

    const { routeDualProtocol402: routeFn } = await import("../dual-protocol-router.js");
    const result = await routeFn(
      "https://api.example.com/buy",
      { method: "POST" },
      initial,
      baseRouting({
        preferredRail: "x402",
        viemAccount: ACCOUNT,
        chain: CHAIN,
        allowedStablecoins: [USDC_BASE_SEPOLIA],
        maxAmountUsdcMicro: 10_000n,
        getSpt,
      }),
    );

    expect(result.kind).toBe("paid");
    if (result.kind === "paid") expect(result.rail).toBe("x402");
    expect(paymentStrategy).toHaveBeenCalledTimes(1);
    expect(getSpt).not.toHaveBeenCalled();
  });

  it("uses stripe-mpp when preferredRail = 'stripe-mpp'", async () => {
    const wire = dualOfferWire();
    const initial = build402(wire);
    fetchSpy
      .mockResolvedValueOnce(build402(wire))
      .mockResolvedValueOnce(new Response("paid", { status: 200 }));

    const getSpt = vi.fn(() => Promise.resolve(PI_ID));
    const paymentStrategy = vi.fn(() => Promise.resolve(TX_HASH));

    const result = await routeDualProtocol402(
      "https://api.example.com/buy",
      { method: "POST" },
      initial,
      baseRouting({
        preferredRail: "stripe-mpp",
        viemAccount: ACCOUNT,
        chain: CHAIN,
        allowedStablecoins: [USDC_BASE_SEPOLIA],
        maxAmountUsdcMicro: 10_000n,
        getSpt,
      }),
    );

    expect(result.kind).toBe("paid");
    if (result.kind === "paid") expect(result.rail).toBe("stripe-mpp");
    expect(getSpt).toHaveBeenCalledTimes(1);
    expect(paymentStrategy).not.toHaveBeenCalled();
  });

  it("returns preferred-rail-missing-opts when preferredRail is set but its opts are missing", async () => {
    const wire = dualOfferWire();
    const initial = build402(wire);

    const result = await routeDualProtocol402(
      "https://api.example.com/buy",
      { method: "POST" },
      initial,
      // preferredRail = "x402" but no viemAccount / chain
      baseRouting({ preferredRail: "x402" }),
    );

    expect(result.kind).toBe("unrouted");
    if (result.kind === "unrouted") expect(result.reason).toBe("preferred-rail-missing-opts");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns no-mpp-envelope when 402 lacks an envelope", async () => {
    const initial = new Response(JSON.stringify({ error: "payment required" }), {
      status: 402,
      headers: { "content-type": "application/json" },
    });

    const result = await routeDualProtocol402(
      "https://api.example.com/buy",
      undefined,
      initial,
      baseRouting({ viemAccount: ACCOUNT, chain: CHAIN }),
    );

    expect(result.kind).toBe("unrouted");
    if (result.kind === "unrouted") expect(result.reason).toBe("no-mpp-envelope");
  });
});
