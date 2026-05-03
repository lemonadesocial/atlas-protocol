import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  pad,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  buildReverseSettleTx,
  buildSettleTx,
  FEE_ROUTER_ABI,
  getFeeRouterContractAddress,
  parsePaymentReversedEvent,
  parsePaymentSettledEvent,
  type FeeSplit,
} from "../fee-router.js";

const FEE_ROUTER = "0x1111111111111111111111111111111111111111" as const;
const ORGANIZER = "0x2222222222222222222222222222222222222222" as const;
const BUYER = "0x3333333333333333333333333333333333333333" as const;
const PLATFORM_A = "0x4444444444444444444444444444444444444444" as const;
const PLATFORM_B = "0x5555555555555555555555555555555555555555" as const;
const PAYMENT_ID = keccak256(toHex("payment-1"));

describe("buildSettleTx", () => {
  it("encodes a known input to the expected calldata (with platform fees)", () => {
    const platformFees: FeeSplit[] = [
      { recipient: PLATFORM_A, amount: 30_000_000n },
      { recipient: PLATFORM_B, amount: 50_000_000n },
    ];

    const tx = buildSettleTx({
      feeRouter: FEE_ROUTER,
      organizer: ORGANIZER,
      totalAmount: 1_000_000_000n,
      paymentId: PAYMENT_ID,
      platformFees,
    });

    const expected = encodeFunctionData({
      abi: FEE_ROUTER_ABI,
      functionName: "settle",
      args: [ORGANIZER, 1_000_000_000n, PAYMENT_ID, platformFees],
    });

    expect(tx.data).toBe(expected);
    expect(tx.to).toBe(FEE_ROUTER);
    expect(tx.value).toBe(0n);
  });

  it("defaults platformFees to an empty array", () => {
    const tx = buildSettleTx({
      feeRouter: FEE_ROUTER,
      organizer: ORGANIZER,
      totalAmount: 100_000_000n,
      paymentId: PAYMENT_ID,
    });

    const expected = encodeFunctionData({
      abi: FEE_ROUTER_ABI,
      functionName: "settle",
      args: [ORGANIZER, 100_000_000n, PAYMENT_ID, []],
    });
    expect(tx.data).toBe(expected);
  });

  it("calldata round-trips through decodeFunctionData", () => {
    const platformFees: FeeSplit[] = [{ recipient: PLATFORM_A, amount: 12_345_678n }];

    const tx = buildSettleTx({
      feeRouter: FEE_ROUTER,
      organizer: ORGANIZER,
      totalAmount: 999_999n,
      paymentId: PAYMENT_ID,
      platformFees,
    });

    const decoded = decodeFunctionData({ abi: FEE_ROUTER_ABI, data: tx.data });
    expect(decoded.functionName).toBe("settle");
    // viem types args as `readonly unknown[]` for the union; assert the shape we expect.
    const [organizer, totalAmount, paymentId, fees] = decoded.args as readonly [
      `0x${string}`,
      bigint,
      `0x${string}`,
      readonly { recipient: `0x${string}`; amount: bigint }[],
    ];
    expect(organizer.toLowerCase()).toBe(ORGANIZER.toLowerCase());
    expect(totalAmount).toBe(999_999n);
    expect(paymentId).toBe(PAYMENT_ID);
    expect(fees).toHaveLength(1);
    expect(fees[0]!.recipient.toLowerCase()).toBe(PLATFORM_A.toLowerCase());
    expect(fees[0]!.amount).toBe(12_345_678n);
  });
});

describe("buildReverseSettleTx", () => {
  it("encodes a known input to the expected calldata (with feesToReverse)", () => {
    const feesToReverse: FeeSplit[] = [{ recipient: PLATFORM_A, amount: 30_000_000n }];

    const tx = buildReverseSettleTx({
      feeRouter: FEE_ROUTER,
      paymentId: PAYMENT_ID,
      buyer: BUYER,
      refundAmount: 1_000_000_000n,
      feesToReverse,
    });

    const expected = encodeFunctionData({
      abi: FEE_ROUTER_ABI,
      functionName: "reverseSettle",
      args: [PAYMENT_ID, BUYER, 1_000_000_000n, feesToReverse],
    });

    expect(tx.data).toBe(expected);
    expect(tx.to).toBe(FEE_ROUTER);
    expect(tx.value).toBe(0n);
  });

  it("defaults feesToReverse to an empty array", () => {
    const tx = buildReverseSettleTx({
      feeRouter: FEE_ROUTER,
      paymentId: PAYMENT_ID,
      buyer: BUYER,
      refundAmount: 100_000_000n,
    });

    const expected = encodeFunctionData({
      abi: FEE_ROUTER_ABI,
      functionName: "reverseSettle",
      args: [PAYMENT_ID, BUYER, 100_000_000n, []],
    });
    expect(tx.data).toBe(expected);
  });

  it("calldata round-trips through decodeFunctionData", () => {
    const feesToReverse: FeeSplit[] = [
      { recipient: PLATFORM_A, amount: 30_000_000n },
      { recipient: PLATFORM_B, amount: 50_000_000n },
    ];

    const tx = buildReverseSettleTx({
      feeRouter: FEE_ROUTER,
      paymentId: PAYMENT_ID,
      buyer: BUYER,
      refundAmount: 1_000_000_000n,
      feesToReverse,
    });

    const decoded = decodeFunctionData({ abi: FEE_ROUTER_ABI, data: tx.data });
    expect(decoded.functionName).toBe("reverseSettle");
    const [paymentId, buyer, refundAmount, fees] = decoded.args as readonly [
      `0x${string}`,
      `0x${string}`,
      bigint,
      readonly { recipient: `0x${string}`; amount: bigint }[],
    ];
    expect(paymentId).toBe(PAYMENT_ID);
    expect(buyer.toLowerCase()).toBe(BUYER.toLowerCase());
    expect(refundAmount).toBe(1_000_000_000n);
    expect(fees).toHaveLength(2);
    expect(fees[1]!.amount).toBe(50_000_000n);
  });
});

describe("parsePaymentSettledEvent", () => {
  it("decodes a synthetic log", () => {
    const totalAmount = 1_000_000_000n;
    const organizerAmount = 915_000_000n;
    const protocolFee = 5_000_000n;
    const platformFees: FeeSplit[] = [
      { recipient: PLATFORM_A, amount: 30_000_000n },
      { recipient: PLATFORM_B, amount: 50_000_000n },
    ];

    const topics = encodeEventTopics({
      abi: FEE_ROUTER_ABI,
      eventName: "PaymentSettled",
      args: { paymentId: PAYMENT_ID, organizer: ORGANIZER },
    });

    const data = encodeAbiParameters(
      [
        { name: "totalAmount", type: "uint256" },
        { name: "organizerAmount", type: "uint256" },
        { name: "protocolFee", type: "uint256" },
        {
          name: "platformFees",
          type: "tuple[]",
          components: [
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
          ],
        },
      ],
      [totalAmount, organizerAmount, protocolFee, platformFees],
    );

    const decoded = parsePaymentSettledEvent({ topics, data });
    expect(decoded).not.toBeNull();
    expect(decoded!.paymentId).toBe(PAYMENT_ID);
    expect(decoded!.organizer.toLowerCase()).toBe(ORGANIZER.toLowerCase());
    expect(decoded!.totalAmount).toBe(totalAmount);
    expect(decoded!.organizerAmount).toBe(organizerAmount);
    expect(decoded!.protocolFee).toBe(protocolFee);
    expect(decoded!.platformFees).toHaveLength(2);
    expect(decoded!.platformFees[0]!.amount).toBe(30_000_000n);
    expect(decoded!.platformFees[1]!.amount).toBe(50_000_000n);
  });

  it("returns null for unrelated logs", () => {
    // A Transfer-shaped log: topic[0] is the ERC-20 Transfer signature, not PaymentSettled.
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
    const fromTopic = pad(ORGANIZER, { size: 32 });
    const toTopic = pad(BUYER, { size: 32 });

    const decoded = parsePaymentSettledEvent({
      topics: [transferTopic, fromTopic, toTopic],
      data: "0x",
    });
    expect(decoded).toBeNull();
  });

  it("returns null for logs with no topics", () => {
    expect(parsePaymentSettledEvent({ topics: [], data: "0x" })).toBeNull();
  });
});

describe("parsePaymentReversedEvent", () => {
  it("decodes a synthetic log", () => {
    const refundAmount = 1_000_000_000n;
    const feesReversed: FeeSplit[] = [{ recipient: PLATFORM_A, amount: 30_000_000n }];

    const topics = encodeEventTopics({
      abi: FEE_ROUTER_ABI,
      eventName: "PaymentReversed",
      args: { paymentId: PAYMENT_ID, buyer: BUYER },
    });

    const data = encodeAbiParameters(
      [
        { name: "refundAmount", type: "uint256" },
        {
          name: "feesReversed",
          type: "tuple[]",
          components: [
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
          ],
        },
      ],
      [refundAmount, feesReversed],
    );

    const decoded = parsePaymentReversedEvent({ topics, data });
    expect(decoded).not.toBeNull();
    expect(decoded!.paymentId).toBe(PAYMENT_ID);
    expect(decoded!.buyer.toLowerCase()).toBe(BUYER.toLowerCase());
    expect(decoded!.refundAmount).toBe(refundAmount);
    expect(decoded!.feesReversed).toHaveLength(1);
    expect(decoded!.feesReversed[0]!.amount).toBe(30_000_000n);
  });

  it("returns null for unrelated logs", () => {
    expect(
      parsePaymentReversedEvent({
        topics: [keccak256(toHex("Unrelated(uint256)"))],
        data: "0x",
      }),
    ).toBeNull();
  });
});

describe("getFeeRouterContractAddress", () => {
  it("returns undefined for chains with null proxy", () => {
    expect(getFeeRouterContractAddress("base_usdc")).toBeUndefined();
    expect(getFeeRouterContractAddress("optimism_sepolia_usdc")).toBeUndefined();
  });

  it("returns undefined for unknown chain slugs", () => {
    expect(getFeeRouterContractAddress("not_a_real_chain")).toBeUndefined();
  });
});
