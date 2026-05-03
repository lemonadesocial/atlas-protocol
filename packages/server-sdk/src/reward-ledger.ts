import { decodeEventLog, encodeFunctionData, type PublicClient } from "viem";

import { getRewardLedgerAddress } from "./deployments.js";

/**
 * Helpers for the ATLAS Stage 3 RewardLedger.
 *
 * The on-chain contract is a UUPS-upgradeable accrual ledger that tracks
 * per-recipient organizer / attendee / referral rewards in stablecoin.
 * Recordings are idempotent per `(paymentId, kind)` — a second
 * `recordReward` call for the same tuple reverts on chain. Recipients
 * withdraw via `claim()` (to themselves) or `claimTo(destination)`. The
 * ledger is funded through `fund(amount)` — typically called by the
 * FeeRouter or backend settlement service.
 *
 * Server-side integrators usually want to:
 *
 *   1. Build `recordReward` / `claim` / `claimTo` / `fund` calldata to
 *      sign with a hot wallet (or relay through a meta-transaction
 *      service).
 *   2. Read a recipient's accrued balance via `getRewardBalance`.
 *   3. Decode `RewardRecorded` / `Claimed` / `Funded` events from a
 *      transaction receipt.
 *   4. Look up the deployed contract address for the chain they are
 *      settling on.
 *
 * This module is framework-agnostic and depends only on `viem`.
 */

/**
 * Reward kind enum — TS-side mirror of the on-chain `IRewardLedger.RewardKind` enum.
 *
 * Values 0/1/2 are part of the public ABI. **Do not reorder** without a
 * coordinated upgrade across the contract, this SDK, and any indexer that
 * consumes `RewardRecorded` event topics.
 */
export enum RewardKind {
  Organizer = 0,
  Attendee = 1,
  Referral = 2,
}

// ABI subset for RewardLedger — keep in sync with contracts/src/RewardLedger.sol.
// Full artifact in contracts/forge-out/RewardLedger.sol/RewardLedger.json.
export const REWARD_LEDGER_ABI = [
  {
    type: "function",
    name: "recordReward",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "amount", type: "uint256" },
      { name: "paymentId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimTo",
    stateMutability: "nonpayable",
    inputs: [{ name: "destination", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isRecorded",
    stateMutability: "view",
    inputs: [
      { name: "paymentId", type: "bytes32" },
      { name: "kind", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
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
    name: "RewardRecorded",
    inputs: [
      { name: "paymentId", type: "bytes32", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "kind", type: "uint8", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "claimer", type: "address", indexed: true },
      { name: "destination", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Funded",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

/** A minimal unsigned transaction shape suitable for `walletClient.sendTransaction`. */
export interface RewardLedgerTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

/** Inputs to {@link buildRecordRewardTx}. */
export interface BuildRecordRewardTxOpts {
  /** RewardLedger proxy address on the target chain. */
  contract: `0x${string}`;
  /** Recipient to credit. */
  recipient: `0x${string}`;
  /** Reward category (Organizer / Attendee / Referral). */
  kind: RewardKind;
  /** Amount of stablecoin (6-decimal units) to credit. */
  amount: bigint;
  /** Off-chain payment identifier the reward derives from. */
  paymentId: `0x${string}`;
}

/**
 * Build the calldata for `RewardLedger.recordReward(...)`. The returned
 * object is a plain unsigned tx ready to feed into
 * `walletClient.sendTransaction` or any other signer/relayer.
 *
 * `value` is always `0n` because `recordReward` is non-payable.
 */
export function buildRecordRewardTx(opts: BuildRecordRewardTxOpts): RewardLedgerTx {
  const data = encodeFunctionData({
    abi: REWARD_LEDGER_ABI,
    functionName: "recordReward",
    args: [opts.recipient, opts.kind, opts.amount, opts.paymentId],
  });
  return { to: opts.contract, data, value: 0n };
}

/** Inputs to {@link buildClaimTx}. */
export interface BuildClaimTxOpts {
  /** RewardLedger proxy address on the target chain. */
  contract: `0x${string}`;
}

/** Build the calldata for `RewardLedger.claim()`. */
export function buildClaimTx(opts: BuildClaimTxOpts): RewardLedgerTx {
  const data = encodeFunctionData({
    abi: REWARD_LEDGER_ABI,
    functionName: "claim",
    args: [],
  });
  return { to: opts.contract, data, value: 0n };
}

/** Inputs to {@link buildClaimToTx}. */
export interface BuildClaimToTxOpts {
  /** RewardLedger proxy address on the target chain. */
  contract: `0x${string}`;
  /** Address that should receive the stablecoin transfer. */
  destination: `0x${string}`;
}

/** Build the calldata for `RewardLedger.claimTo(destination)`. */
export function buildClaimToTx(opts: BuildClaimToTxOpts): RewardLedgerTx {
  const data = encodeFunctionData({
    abi: REWARD_LEDGER_ABI,
    functionName: "claimTo",
    args: [opts.destination],
  });
  return { to: opts.contract, data, value: 0n };
}

/** Inputs to {@link buildFundTx}. */
export interface BuildFundTxOpts {
  /** RewardLedger proxy address on the target chain. */
  contract: `0x${string}`;
  /** Amount of stablecoin (6-decimal units) to deposit. */
  amount: bigint;
}

/**
 * Build the calldata for `RewardLedger.fund(amount)`. The caller must have
 * already approved the ledger to spend at least `amount` of the configured
 * stablecoin.
 */
export function buildFundTx(opts: BuildFundTxOpts): RewardLedgerTx {
  const data = encodeFunctionData({
    abi: REWARD_LEDGER_ABI,
    functionName: "fund",
    args: [opts.amount],
  });
  return { to: opts.contract, data, value: 0n };
}

/** Inputs to {@link getRewardBalance}. */
export interface GetRewardBalanceOpts {
  /** RewardLedger proxy address on the target chain. */
  contract: `0x${string}`;
  /** Recipient whose accrued balance to query. */
  recipient: `0x${string}`;
}

/**
 * Read a recipient's accrued unclaimed balance from the ledger. The caller
 * is responsible for instantiating their own viem `PublicClient` (so the
 * SDK does not pin a transport).
 */
export async function getRewardBalance(
  client: PublicClient,
  opts: GetRewardBalanceOpts,
): Promise<bigint> {
  const result = await client.readContract({
    address: opts.contract,
    abi: REWARD_LEDGER_ABI,
    functionName: "balanceOf",
    args: [opts.recipient],
  });
  return result;
}

/** Decoded `RewardRecorded` event payload. */
export interface DecodedRewardRecordedEvent {
  paymentId: `0x${string}`;
  recipient: `0x${string}`;
  kind: RewardKind;
  amount: bigint;
}

/** Decoded `Claimed` event payload. */
export interface DecodedClaimedEvent {
  claimer: `0x${string}`;
  destination: `0x${string}`;
  amount: bigint;
}

/** Decoded `Funded` event payload. */
export interface DecodedFundedEvent {
  from: `0x${string}`;
  amount: bigint;
}

/**
 * Decode a `RewardRecorded` log from a transaction receipt. Returns `null`
 * if the log does not match the RewardLedger `RewardRecorded` event
 * signature (e.g. an unrelated log, or an event from a different contract).
 */
export function parseRewardRecordedEvent(log: {
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
}): DecodedRewardRecordedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: REWARD_LEDGER_ABI,
      eventName: "RewardRecorded",
      topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      data: log.data,
      strict: true,
    });
    if (decoded.eventName !== "RewardRecorded") return null;
    const { paymentId, recipient, kind, amount } = decoded.args;
    return { paymentId, recipient, kind, amount };
  } catch {
    return null;
  }
}

/**
 * Decode a `Claimed` log from a transaction receipt. Returns `null` if the
 * log does not match the RewardLedger `Claimed` event signature.
 */
export function parseClaimedEvent(log: {
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
}): DecodedClaimedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: REWARD_LEDGER_ABI,
      eventName: "Claimed",
      topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      data: log.data,
      strict: true,
    });
    if (decoded.eventName !== "Claimed") return null;
    const { claimer, destination, amount } = decoded.args;
    return { claimer, destination, amount };
  } catch {
    return null;
  }
}

/**
 * Decode a `Funded` log from a transaction receipt. Returns `null` if the
 * log does not match the RewardLedger `Funded` event signature.
 */
export function parseFundedEvent(log: {
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
}): DecodedFundedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: REWARD_LEDGER_ABI,
      eventName: "Funded",
      topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      data: log.data,
      strict: true,
    });
    if (decoded.eventName !== "Funded") return null;
    const { from, amount } = decoded.args;
    return { from, amount };
  } catch {
    return null;
  }
}

/**
 * Convenience re-export of {@link getRewardLedgerAddress} under a name that
 * reads naturally next to the helpers above. Both names point at the same
 * deployments.json-backed lookup.
 */
export function getRewardLedgerContractAddress(chainSlug: string): string | undefined {
  return getRewardLedgerAddress(chainSlug);
}
