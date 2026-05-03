import { decodeEventLog, encodeFunctionData } from "viem";

import { getAtlasTicketAddress } from "./deployments.js";

/**
 * Helpers for the ATLAS Stage 2 AtlasTicket NFT (v2 — burn flow + custodial-wallet pattern).
 *
 * The on-chain contract is a UUPS-upgradeable ERC-721 with idempotent
 * mints keyed by `paymentId` — a second mint attempt for the same
 * `paymentId` reverts on chain. The v2 contract adds:
 *
 *   - A `BURNER_ROLE` and `burn(tokenId, paymentId)` function used by the
 *     settlement service when reversing a payment via FeeRouter.reverseSettle().
 *   - An `emailHash` argument on `mint(...)` so email-only buyers can be
 *     issued tickets to an ATLAS-managed custodial wallet and the buyer's
 *     keccak256(lowercase email) is stored on-chain for off-chain joining.
 *     Wallet-first buyers pass `0x00…00` for this argument.
 *
 * Server-side integrators usually want to:
 *
 *   1. Build a `mint` calldata blob to sign with a hot wallet (or to
 *      relay through a meta-transaction service).
 *   2. Decode `TicketMinted` events from a transaction receipt to learn
 *      which tokenId was issued.
 *   3. Build a `burn` calldata blob for refund-side reversal of a ticket.
 *   4. Decode `TicketBurned` events to confirm a burn settled on chain.
 *   5. Look up the deployed contract address for the chain they are
 *      settling on.
 *
 * This module is framework-agnostic and depends only on `viem` (which the
 * SDK already pulls in for payment verification).
 */

// ABI subset for AtlasTicket — keep in sync with contracts/src/AtlasTicket.sol.
// Full artifact in contracts/forge-out/AtlasTicket.sol/AtlasTicket.json.
export const ATLAS_TICKET_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "eventId", type: "uint256" },
      { name: "paymentId", type: "bytes32" },
      { name: "tokenURI_", type: "string" },
      { name: "emailHash", type: "bytes32" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "paymentId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "paymentIdOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "eventIdOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "emailHashOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "BURNER_ROLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "MINTER_ROLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
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
    name: "TicketMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "eventId", type: "uint256", indexed: true },
      { name: "paymentId", type: "bytes32", indexed: false },
      { name: "tokenURI", type: "string", indexed: false },
      { name: "emailHash", type: "bytes32", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TicketBurned",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "paymentId", type: "bytes32", indexed: true },
    ],
    anonymous: false,
  },
] as const;

/** All-zero bytes32, used for non-custodial mints (no email hash recorded). */
export const EMPTY_EMAIL_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/** Inputs to {@link buildMintTicketTx}. */
export interface BuildMintTicketTxOpts {
  /** AtlasTicket proxy address on the target chain. */
  contract: `0x${string}`;
  /** Recipient of the freshly minted ticket NFT. May be the ATLAS custodial holder. */
  to: `0x${string}`;
  /** Off-chain event identifier the ticket belongs to. */
  eventId: bigint;
  /** Unique payment identifier; the contract reverts on re-use. */
  paymentId: `0x${string}`;
  /** Token URI (typically an IPFS CID). */
  tokenURI: string;
  /**
   * keccak256 of the buyer's lowercase email when the buyer purchased with email
   * only (custodial-wallet flow). Pass {@link EMPTY_EMAIL_HASH} (or omit) for
   * wallet-first buyers — the contract treats `bytes32(0)` as "no email hash".
   */
  emailHash?: `0x${string}`;
}

/** A minimal unsigned transaction shape suitable for `walletClient.sendTransaction`. */
export interface MintTicketTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

/**
 * Build the calldata for `AtlasTicket.mint(...)`. The returned object is a
 * plain unsigned tx ready to feed into `walletClient.sendTransaction` or
 * any other signer/relayer.
 *
 * `value` is always `0n` because mint() is non-payable — settlement of the
 * ticket price happens through FeeRouter, not AtlasTicket.
 *
 * For custodial-wallet (email-only) buyers, pass the ATLAS custodial holder
 * as `to` and a non-zero `emailHash`. For wallet-first buyers, pass the buyer's
 * wallet as `to` and either omit `emailHash` or pass {@link EMPTY_EMAIL_HASH}.
 */
export function buildMintTicketTx(opts: BuildMintTicketTxOpts): MintTicketTx {
  const data = encodeFunctionData({
    abi: ATLAS_TICKET_ABI,
    functionName: "mint",
    args: [
      opts.to,
      opts.eventId,
      opts.paymentId,
      opts.tokenURI,
      opts.emailHash ?? EMPTY_EMAIL_HASH,
    ],
  });
  return { to: opts.contract, data, value: 0n };
}

/** Inputs to {@link buildBurnTicketTx}. */
export interface BuildBurnTicketTxOpts {
  /** AtlasTicket proxy address on the target chain. */
  contract: `0x${string}`;
  /** ERC-721 token id to burn. */
  tokenId: bigint;
  /** paymentId originally associated with the ticket; emitted in TicketBurned. */
  paymentId: `0x${string}`;
}

/** Identical shape to {@link MintTicketTx}; alias kept for call-site clarity. */
export type BurnTicketTx = MintTicketTx;

/**
 * Build the calldata for `AtlasTicket.burn(tokenId, paymentId)`. The returned
 * object is a plain unsigned tx ready to feed into `walletClient.sendTransaction`
 * or any other signer/relayer.
 *
 * `value` is always `0n` because burn() is non-payable. The signing wallet
 * must hold `BURNER_ROLE` on the AtlasTicket proxy or the on-chain call reverts.
 */
export function buildBurnTicketTx(opts: BuildBurnTicketTxOpts): BurnTicketTx {
  const data = encodeFunctionData({
    abi: ATLAS_TICKET_ABI,
    functionName: "burn",
    args: [opts.tokenId, opts.paymentId],
  });
  return { to: opts.contract, data, value: 0n };
}

/** Decoded `TicketMinted` event payload. */
export interface DecodedTicketMintedEvent {
  tokenId: bigint;
  to: `0x${string}`;
  eventId: bigint;
  paymentId: `0x${string}`;
  tokenURI: string;
  /**
   * keccak256(lowercase email) when the ticket was minted via the custodial-wallet
   * flow; {@link EMPTY_EMAIL_HASH} (`0x00…00`) when the buyer supplied a
   * self-custody wallet.
   */
  emailHash: `0x${string}`;
}

/**
 * Decode a `TicketMinted` log from a transaction receipt. Returns `null` if
 * the log does not match the AtlasTicket `TicketMinted` event signature
 * (e.g. a transfer log, or an event from a different contract).
 *
 * Pass each entry of `receipt.logs` through this helper and keep the
 * non-null results.
 */
export function parseTicketMintedEvent(log: {
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
}): DecodedTicketMintedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: ATLAS_TICKET_ABI,
      eventName: "TicketMinted",
      topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      data: log.data,
      strict: true,
    });
    if (decoded.eventName !== "TicketMinted") return null;
    const { tokenId, to, eventId, paymentId, tokenURI, emailHash } = decoded.args;
    return { tokenId, to, eventId, paymentId, tokenURI, emailHash };
  } catch {
    // viem throws when the topic[0] does not match the event signature, when
    // the topic count is wrong, or when the data cannot be decoded against
    // the schema. All of those mean "not a TicketMinted log" for our caller.
    return null;
  }
}

/** Decoded `TicketBurned` event payload. */
export interface DecodedTicketBurnedEvent {
  tokenId: bigint;
  paymentId: `0x${string}`;
}

/**
 * Decode a `TicketBurned` log from a transaction receipt. Returns `null` if
 * the log does not match the AtlasTicket `TicketBurned` event signature
 * (e.g. a transfer log, or an event from a different contract).
 *
 * Pass each entry of `receipt.logs` through this helper and keep the
 * non-null results.
 */
export function parseTicketBurnedEvent(log: {
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
}): DecodedTicketBurnedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: ATLAS_TICKET_ABI,
      eventName: "TicketBurned",
      topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      data: log.data,
      strict: true,
    });
    if (decoded.eventName !== "TicketBurned") return null;
    const { tokenId, paymentId } = decoded.args;
    return { tokenId, paymentId };
  } catch {
    return null;
  }
}

/**
 * Convenience re-export of {@link getAtlasTicketAddress} under a name that
 * reads naturally next to the helpers above. Both names point at the same
 * deployments.json-backed lookup.
 */
export function getAtlasTicketContractAddress(chainSlug: string): string | undefined {
  return getAtlasTicketAddress(chainSlug);
}
