import { decodeEventLog, encodeFunctionData } from "viem";

import { getFeeRouterAddress } from "./deployments.js";

/**
 * Helpers for the ATLAS FeeRouter v2.
 *
 * The on-chain contract is a UUPS-upgradeable stablecoin payment splitter that
 * routes a single settlement into:
 *
 *   - the organizer share (the seller of record),
 *   - a protocol fee paid to the treasury,
 *   - zero or more "platform fee" legs — stacked cuts taken by intermediaries
 *     (Lemonade, partners, etc.) on top of the protocol fee.
 *
 * v2 also adds a refund flow: a `reverseSettle` call funded jointly by the
 * platform/organizer wallet and any platform-fee recipients that have
 * pre-approved the contract to pull their cuts back. The default protocol fee
 * is **0.5%** (50 bps). Platform fees are capped at 20% of the gross amount
 * and the organizer must always receive at least 70%.
 *
 * Server-side integrators usually want to:
 *
 *   1. Build `settle` calldata (with a stacked `FeeSplit[]` array) to sign
 *      with a hot wallet (or relay through a meta-transaction service).
 *   2. Build `reverseSettle` calldata to issue a refund.
 *   3. Decode `PaymentSettled` / `PaymentReversed` events from a
 *      transaction receipt.
 *   4. Look up the deployed FeeRouter proxy address for the target chain.
 *
 * This module is framework-agnostic and depends only on `viem` (already pulled
 * in by the SDK for payment verification).
 */

// ABI subset for FeeRouter v2 — keep in sync with contracts/src/FeeRouter.sol.
// Full artifact in contracts/forge-out/FeeRouter.sol/FeeRouter.json.
export const FEE_ROUTER_ABI = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "totalAmount", type: "uint256" },
      { name: "paymentId", type: "bytes32" },
      {
        name: "platformFees",
        type: "tuple[]",
        components: [
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reverseSettle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "paymentId", type: "bytes32" },
      { name: "buyer", type: "address" },
      { name: "refundAmount", type: "uint256" },
      {
        name: "feesToReverse",
        type: "tuple[]",
        components: [
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isSettled",
    stateMutability: "view",
    inputs: [{ name: "paymentId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isRefunded",
    stateMutability: "view",
    inputs: [{ name: "paymentId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "feeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "stablecoin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "setFeeBps",
    stateMutability: "nonpayable",
    inputs: [{ name: "newBps", type: "uint16" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setTreasury",
    stateMutability: "nonpayable",
    inputs: [{ name: "newTreasury", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "pause",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "unpause",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "event",
    name: "PaymentSettled",
    inputs: [
      { name: "paymentId", type: "bytes32", indexed: true },
      { name: "organizer", type: "address", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "organizerAmount", type: "uint256", indexed: false },
      { name: "protocolFee", type: "uint256", indexed: false },
      {
        name: "platformFees",
        type: "tuple[]",
        indexed: false,
        components: [
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PaymentReversed",
    inputs: [
      { name: "paymentId", type: "bytes32", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "refundAmount", type: "uint256", indexed: false },
      {
        name: "feesReversed",
        type: "tuple[]",
        indexed: false,
        components: [
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
    anonymous: false,
  },
  // Custom errors — exposed so integrators can decode revert reasons.
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  {
    type: "error",
    name: "PaymentAlreadySettled",
    inputs: [{ name: "paymentId", type: "bytes32" }],
  },
  {
    type: "error",
    name: "FeeBpsTooHigh",
    inputs: [
      { name: "bps", type: "uint16" },
      { name: "maxBps", type: "uint16" },
    ],
  },
  { type: "error", name: "PlatformFeesAboveCap", inputs: [] },
  { type: "error", name: "OrganizerShareBelowFloor", inputs: [] },
  {
    type: "error",
    name: "PaymentNotSettled",
    inputs: [{ name: "paymentId", type: "bytes32" }],
  },
  {
    type: "error",
    name: "PaymentAlreadyRefunded",
    inputs: [{ name: "paymentId", type: "bytes32" }],
  },
  { type: "error", name: "RefundAmountInvalid", inputs: [] },
] as const;

/** A single platform-fee leg in a stacked settlement. */
export interface FeeSplit {
  /** Recipient wallet address. */
  recipient: `0x${string}`;
  /** Stablecoin amount (in the token's smallest unit, e.g. micro-USDC). */
  amount: bigint;
}

/** A minimal unsigned transaction shape suitable for `walletClient.sendTransaction`. */
export interface UnsignedTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

/** Inputs to {@link buildSettleTx}. */
export interface BuildSettleTxOpts {
  /** FeeRouter proxy address on the target chain. */
  feeRouter: `0x${string}`;
  /** Recipient of the organizer share. */
  organizer: `0x${string}`;
  /** Gross stablecoin amount pulled from the caller (token's smallest unit). */
  totalAmount: bigint;
  /** Unique payment identifier; the contract reverts on re-use. */
  paymentId: `0x${string}`;
  /**
   * Optional platform-fee legs taken on top of the protocol fee. Each entry is
   * paid out to its `recipient`. Sum is capped at 20% of `totalAmount`. Defaults
   * to an empty array (no platform fees, only protocol fee + organizer split).
   */
  platformFees?: readonly FeeSplit[];
}

/**
 * Build the calldata for `FeeRouter.settle(...)`. The returned object is a
 * plain unsigned tx ready to feed into `walletClient.sendTransaction` or any
 * other signer/relayer.
 *
 * `value` is always `0n` because settle() is non-payable — the caller funds
 * `totalAmount` via a prior ERC-20 approval to the FeeRouter contract.
 */
export function buildSettleTx(opts: BuildSettleTxOpts): UnsignedTx {
  const data = encodeFunctionData({
    abi: FEE_ROUTER_ABI,
    functionName: "settle",
    args: [opts.organizer, opts.totalAmount, opts.paymentId, opts.platformFees ?? []],
  });
  return { to: opts.feeRouter, data, value: 0n };
}

/** Inputs to {@link buildReverseSettleTx}. */
export interface BuildReverseSettleTxOpts {
  /** FeeRouter proxy address on the target chain. */
  feeRouter: `0x${string}`;
  /** The original `paymentId` that was settled. */
  paymentId: `0x${string}`;
  /** Buyer wallet that should receive the refund. */
  buyer: `0x${string}`;
  /** Total stablecoin amount returned to the buyer (token's smallest unit). */
  refundAmount: bigint;
  /**
   * Platform-fee recipients that must return their cut. Each listed recipient
   * must have pre-approved the FeeRouter to pull `amount`. Recipients NOT in
   * this list keep their cut, and the caller (`msg.sender`) covers the
   * difference. Defaults to an empty array.
   */
  feesToReverse?: readonly FeeSplit[];
}

/**
 * Build the calldata for `FeeRouter.reverseSettle(...)`. The caller MUST hold
 * `REFUND_ROLE` on the FeeRouter and must have approved the contract for at
 * least `refundAmount - sum(feesToReverse)` of stablecoin.
 */
export function buildReverseSettleTx(opts: BuildReverseSettleTxOpts): UnsignedTx {
  const data = encodeFunctionData({
    abi: FEE_ROUTER_ABI,
    functionName: "reverseSettle",
    args: [opts.paymentId, opts.buyer, opts.refundAmount, opts.feesToReverse ?? []],
  });
  return { to: opts.feeRouter, data, value: 0n };
}

/** Decoded `PaymentSettled` event payload. */
export interface DecodedPaymentSettledEvent {
  paymentId: `0x${string}`;
  organizer: `0x${string}`;
  totalAmount: bigint;
  organizerAmount: bigint;
  protocolFee: bigint;
  platformFees: readonly FeeSplit[];
}

/**
 * Decode a `PaymentSettled` log from a transaction receipt. Returns `null` if
 * the log does not match the FeeRouter `PaymentSettled` event signature
 * (e.g. an ERC-20 Transfer log, or an event from a different contract).
 *
 * Pass each entry of `receipt.logs` through this helper and keep the
 * non-null results.
 */
export function parsePaymentSettledEvent(log: {
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
}): DecodedPaymentSettledEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: FEE_ROUTER_ABI,
      eventName: "PaymentSettled",
      topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      data: log.data,
      strict: true,
    });
    if (decoded.eventName !== "PaymentSettled") return null;
    const { paymentId, organizer, totalAmount, organizerAmount, protocolFee, platformFees } =
      decoded.args;
    return {
      paymentId,
      organizer,
      totalAmount,
      organizerAmount,
      protocolFee,
      platformFees: platformFees.map((f) => ({ recipient: f.recipient, amount: f.amount })),
    };
  } catch {
    // viem throws when the topic[0] does not match the event signature, when
    // the topic count is wrong, or when the data cannot be decoded against
    // the schema. All of those mean "not a PaymentSettled log" for our caller.
    return null;
  }
}

/** Decoded `PaymentReversed` event payload. */
export interface DecodedPaymentReversedEvent {
  paymentId: `0x${string}`;
  buyer: `0x${string}`;
  refundAmount: bigint;
  feesReversed: readonly FeeSplit[];
}

/**
 * Decode a `PaymentReversed` log from a transaction receipt. Returns `null` if
 * the log does not match the FeeRouter `PaymentReversed` event signature.
 */
export function parsePaymentReversedEvent(log: {
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
}): DecodedPaymentReversedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: FEE_ROUTER_ABI,
      eventName: "PaymentReversed",
      topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      data: log.data,
      strict: true,
    });
    if (decoded.eventName !== "PaymentReversed") return null;
    const { paymentId, buyer, refundAmount, feesReversed } = decoded.args;
    return {
      paymentId,
      buyer,
      refundAmount,
      feesReversed: feesReversed.map((f) => ({ recipient: f.recipient, amount: f.amount })),
    };
  } catch {
    return null;
  }
}

/**
 * Convenience re-export of {@link getFeeRouterAddress} under a name that reads
 * naturally next to the helpers above. Both names point at the same
 * deployments.json-backed lookup.
 */
export function getFeeRouterContractAddress(chainSlug: string): string | undefined {
  return getFeeRouterAddress(chainSlug);
}
