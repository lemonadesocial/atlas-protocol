import { describe, expect, it, vi } from "vitest";

import { verifyPayment, SUPPORTED_PAYMENT_METHODS } from "../payment-verify.js";
import type { ServerSdkConfig } from "../config.js";
import type { AtlasPaymentVerifyResult } from "../types/index.js";

const TEST_RECEIVER = "0x1111111111111111111111111111111111111111";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function makeConfig(): Pick<ServerSdkConfig, "paymentMethods" | "logger"> {
  return {
    paymentMethods: [
      { type: "tempo_usdc", receiverAddress: TEST_RECEIVER },
      { type: "base_usdc", receiverAddress: TEST_RECEIVER },
      { type: "stripe_spt", stripeSecretKey: "sk_test_xxx" },
    ],
  };
}

function paddedAddressTopic(addr: string): `0x${string}` {
  // 32-byte topic: 12 zero bytes + 20-byte address.
  const hex = addr.toLowerCase().replace(/^0x/, "");
  return `0x${"0".repeat(64 - hex.length)}${hex}`;
}

function microUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

function bigintToHexData(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

/**
 * Build a viem-shaped fake PublicClient that returns a fixed receipt + block
 * number. We only stub the methods verifyPayment uses.
 */
function fakeEvmClient(opts: {
  receipt: {
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: Array<{ address: string; topics: string[]; data: string }>;
  } | null;
  currentBlock: bigint;
}) {
  return {
    getTransactionReceipt: vi.fn(async () => opts.receipt),
    getBlockNumber: vi.fn(async () => opts.currentBlock),
  } as unknown as Parameters<
    NonNullable<Parameters<typeof verifyPayment>[3]>["evmClient"]
  >[0] extends never
    ? never
    : ReturnType<NonNullable<Parameters<typeof verifyPayment>[3]>["evmClient"]>;
}

describe("SUPPORTED_PAYMENT_METHODS", () => {
  it("exposes all chains migrated from lemonade-backend", () => {
    expect(SUPPORTED_PAYMENT_METHODS).toEqual([
      "tempo_usdc",
      "base_usdc",
      "arbitrum_usdc",
      "polygon_usdc",
      "optimism_usdc",
      "zksync_usdc",
      "stripe_spt",
    ]);
  });
});

describe("verifyPayment — replay protection", () => {
  it("rejects when isReplay returns true", async () => {
    const result = await verifyPayment(
      makeConfig(),
      { type: "base_usdc", transaction_hash: "0xabc" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
      { isReplay: async () => true },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/replay/i);
  });
});

describe("verifyPayment — input validation", () => {
  it("rejects unsupported payment types", async () => {
    const result = await verifyPayment(
      makeConfig(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { type: "bitcoin_lightning" as any },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unsupported payment type/);
  });

  it("rejects EVM proofs missing transaction_hash", async () => {
    const result = await verifyPayment(
      makeConfig(),
      { type: "base_usdc" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/transaction_hash/);
  });

  it("rejects stripe proofs missing payment_intent_id", async () => {
    const result = await verifyPayment(
      makeConfig(),
      { type: "stripe_spt" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/payment_intent_id/);
  });

  it("rejects stripe proofs without a verifyStripe dep", async () => {
    const result = await verifyPayment(
      makeConfig(),
      { type: "stripe_spt", payment_intent_id: "pi_1" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Stripe SPT verification not configured/);
  });
});

describe("verifyPayment — Stripe verification", () => {
  it("delegates to verifyStripe and forwards its result", async () => {
    const verifyStripe = vi.fn(
      async (id: string, _amount: number): Promise<AtlasPaymentVerifyResult> => ({
        valid: true,
        verified_amount_usd: 50,
      }),
    );

    const result = await verifyPayment(
      makeConfig(),
      { type: "stripe_spt", payment_intent_id: "pi_42" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
      { verifyStripe },
    );

    expect(verifyStripe).toHaveBeenCalledWith("pi_42", 50);
    expect(result).toEqual({ valid: true, verified_amount_usd: 50 });
  });
});

describe("verifyPayment — EVM USDC verification (success)", () => {
  it("accepts a matching USDC transfer with sufficient confirmations", async () => {
    const expectedAmountUsd = 50;
    const transferLog = {
      address: BASE_USDC,
      topics: [
        TRANSFER_TOPIC,
        paddedAddressTopic("0x9999999999999999999999999999999999999999"),
        paddedAddressTopic(TEST_RECEIVER),
      ],
      data: bigintToHexData(microUnits(expectedAmountUsd)),
    };

    const client = fakeEvmClient({
      receipt: {
        status: "success",
        blockNumber: 1_000_000n,
        logs: [transferLog],
      },
      currentBlock: 1_000_000n + 20n, // > 12 confirmations
    });

    const result = await verifyPayment(
      makeConfig(),
      { type: "base_usdc", transaction_hash: "0xdeadbeef" },
      { expected_amount_usd: expectedAmountUsd, challenge_id: "ch_1" },
      { evmClient: () => client },
    );

    expect(result).toEqual({ valid: true, verified_amount_usd: expectedAmountUsd });
  });
});

describe("verifyPayment — EVM USDC verification (failure modes)", () => {
  it("rejects when the receipt is missing (tx not on-chain)", async () => {
    const client = fakeEvmClient({ receipt: null, currentBlock: 1_000_000n });

    const result = await verifyPayment(
      makeConfig(),
      { type: "base_usdc", transaction_hash: "0xdeadbeef" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
      { evmClient: () => client },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not found on-chain/);
  });

  it("rejects when the transaction reverted", async () => {
    const client = fakeEvmClient({
      receipt: { status: "reverted", blockNumber: 1_000_000n, logs: [] },
      currentBlock: 1_000_000n + 100n,
    });

    const result = await verifyPayment(
      makeConfig(),
      { type: "base_usdc", transaction_hash: "0xdeadbeef" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
      { evmClient: () => client },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reverted/);
  });

  it("rejects when confirmations are insufficient", async () => {
    const transferLog = {
      address: BASE_USDC,
      topics: [
        TRANSFER_TOPIC,
        paddedAddressTopic("0x9999999999999999999999999999999999999999"),
        paddedAddressTopic(TEST_RECEIVER),
      ],
      data: bigintToHexData(microUnits(50)),
    };
    const client = fakeEvmClient({
      receipt: { status: "success", blockNumber: 1_000_000n, logs: [transferLog] },
      currentBlock: 1_000_000n + 1n, // only 1 confirmation, base needs 12
    });

    const result = await verifyPayment(
      makeConfig(),
      { type: "base_usdc", transaction_hash: "0xdeadbeef" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
      { evmClient: () => client },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Insufficient confirmations/);
  });

  it("rejects a transfer to the wrong recipient", async () => {
    const wrongReceiver = "0x2222222222222222222222222222222222222222";
    const transferLog = {
      address: BASE_USDC,
      topics: [
        TRANSFER_TOPIC,
        paddedAddressTopic("0x9999999999999999999999999999999999999999"),
        paddedAddressTopic(wrongReceiver),
      ],
      data: bigintToHexData(microUnits(50)),
    };
    const client = fakeEvmClient({
      receipt: { status: "success", blockNumber: 1_000_000n, logs: [transferLog] },
      currentBlock: 1_000_000n + 100n,
    });

    const result = await verifyPayment(
      makeConfig(),
      { type: "base_usdc", transaction_hash: "0xdeadbeef" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
      { evmClient: () => client },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/No matching USDC transfer/);
  });

  it("rejects a transfer with the wrong amount (outside tolerance)", async () => {
    const transferLog = {
      address: BASE_USDC,
      topics: [
        TRANSFER_TOPIC,
        paddedAddressTopic("0x9999999999999999999999999999999999999999"),
        paddedAddressTopic(TEST_RECEIVER),
      ],
      // Sent 25 USDC instead of 50 — way outside the 0.1% tolerance.
      data: bigintToHexData(microUnits(25)),
    };
    const client = fakeEvmClient({
      receipt: { status: "success", blockNumber: 1_000_000n, logs: [transferLog] },
      currentBlock: 1_000_000n + 100n,
    });

    const result = await verifyPayment(
      makeConfig(),
      { type: "base_usdc", transaction_hash: "0xdeadbeef" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
      { evmClient: () => client },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/No matching USDC transfer/);
  });

  it("rejects when no USDC Transfer event is present", async () => {
    const client = fakeEvmClient({
      receipt: { status: "success", blockNumber: 1_000_000n, logs: [] },
      currentBlock: 1_000_000n + 100n,
    });

    const result = await verifyPayment(
      makeConfig(),
      { type: "base_usdc", transaction_hash: "0xdeadbeef" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
      { evmClient: () => client },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/No USDC Transfer event/);
  });
});

describe("verifyPayment — error handling", () => {
  it("returns valid=false with error message on unexpected errors", async () => {
    const result = await verifyPayment(
      makeConfig(),
      { type: "stripe_spt", payment_intent_id: "pi_test" },
      { expected_amount_usd: 50, challenge_id: "ch_1" },
      {
        isReplay: async () => {
          throw new Error("database offline");
        },
      },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBe("database offline");
  });
});
