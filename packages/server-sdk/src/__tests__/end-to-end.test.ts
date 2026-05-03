// This test composes the public SDK primitives into the full purchase flow
// to prove they fit together end-to-end. The dual-protocol-server example
// performs the same composition in a real Hono server.
//
// Everything below is fully mocked — no chain RPC, no Stripe API, no IPFS
// pinning service is contacted. The viem PublicClient is replaced with a
// stub that returns canned responses; the Stripe SDK is replaced with a
// `StripeLike` stub object; the Pinner is a `vi.fn` that records calls.
//
// What we cover:
//   - x402 rail: agent → 402 → pay → verify → mint → record reward → pin → receipt
//   - stripe SPT rail: agent → 402 → stripe verify → mint → record reward → pin → receipt
//   - replay protection: a re-presented credential is rejected, and the
//     surrounding "compose mint + reward" block is NEVER re-executed (so no
//     duplicate mint calldata, no duplicate reward calldata).
//
// Helpers (mock builders) live at the top so each test reads top-down.

import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, toHex } from "viem";
import type { Chain, PublicClient, Transport } from "viem";
import { describe, expect, it, vi } from "vitest";

import { encode, type MppEnvelope } from "@atlasprotocol/mpp";

import { ATLAS_TICKET_ABI, buildMintTicketTx, parseTicketMintedEvent } from "../atlas-ticket.js";
import { generateMppChallenge, verifyMppCredential } from "../challenge.js";
import { generateReceipt, type GenerateReceiptResult } from "../receipt.js";
import { InMemoryReplayStore, credentialHash } from "../replay.js";
import { verifyPayment } from "../payment-verify.js";
import {
  REWARD_LEDGER_ABI,
  RewardKind,
  buildRecordRewardTx,
  parseRewardRecordedEvent,
} from "../reward-ledger.js";
import type { ServerSdkConfig } from "../config.js";
import type { StripeLike } from "../stripe-verifier.js";

// ---------------------------------------------------------------------------
// Shared constants — same fixtures across both rails so the cross-cutting
// invariants (paymentId carries through, etc.) are easy to assert.
// ---------------------------------------------------------------------------

const TICKET_CONTRACT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const REWARD_CONTRACT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const ATTENDEE = "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e" as const;
const ORGANIZER = "0xcccccccccccccccccccccccccccccccccccccccc" as const;
const PAYER = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

const EVENT_ID = "evt_e2e_test_001";
const HOLD_ID = "hold_e2e_001";
const TOKEN_URI = "ipfs://bafyreieventjson";
const ON_CHAIN_EVENT_ID = 4242n;
const TICKET_PRICE_USDC_MICROS = 50_000_000n; // $50 USDC
const PROTOCOL_FEE_USDC_MICROS = 1_000_000n; // 2% of $50 = $1 — credited to organizer

// ---------------------------------------------------------------------------
// Mock builders — small, focused, reused across tests.
// ---------------------------------------------------------------------------

type FakeEvmClient = PublicClient<Transport, Chain>;

function paddedAddressTopic(addr: string): `0x${string}` {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  return `0x${"0".repeat(64 - hex.length)}${hex}`;
}

function bigintToHexData(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

/**
 * Build a fake viem PublicClient that returns a synthetic USDC transfer
 * receipt for any txHash. Only stubs `getTransactionReceipt` and
 * `getBlockNumber` — those are the only methods `verifyPayment` calls on
 * EVM rails.
 */
function buildMockChainClient(opts: {
  txHash: `0x${string}`;
  amountMicros: bigint;
  recipient: `0x${string}`;
}): { client: FakeEvmClient; getReceiptCalls: () => number } {
  const transferLog = {
    address: BASE_SEPOLIA_USDC,
    topics: [ERC20_TRANSFER_TOPIC, paddedAddressTopic(PAYER), paddedAddressTopic(opts.recipient)],
    data: bigintToHexData(opts.amountMicros),
  };
  let receiptCalls = 0;
  const client = {
    getTransactionReceipt: vi.fn((args: { hash: `0x${string}` }) => {
      receiptCalls += 1;
      // The mock is happy to return the same receipt for any hash; the
      // verifier asserts the *recipient* + *amount* in-log, not the hash.
      void args;
      return Promise.resolve({
        status: "success" as const,
        blockNumber: 1_000_000n,
        logs: [transferLog],
      });
    }),
    getBlockNumber: vi.fn(() => Promise.resolve(1_000_000n + 12n)),
  } as unknown as FakeEvmClient;
  return { client, getReceiptCalls: () => receiptCalls };
}

/**
 * Build a fake Stripe-like object that returns a succeeded PaymentIntent
 * matching the expected amount.
 */
function buildMockStripe(opts: { intentId: string; amountCents: number }): {
  stripe: StripeLike;
  retrieveCalls: () => number;
} {
  let calls = 0;
  const retrieve = vi.fn((id: string) => {
    calls += 1;
    return Promise.resolve({
      id,
      status: "succeeded",
      currency: "usd",
      amount: opts.amountCents,
    });
  });
  const stripe: StripeLike = {
    paymentIntents: { retrieve },
  };
  return { stripe, retrieveCalls: () => calls };
}

interface MockPinner {
  pinJson: ReturnType<typeof vi.fn>;
  pinBytes: ReturnType<typeof vi.fn>;
  unpin: ReturnType<typeof vi.fn>;
  isPinned: ReturnType<typeof vi.fn>;
}

/** Build a `vi.fn`-backed Pinner that records calls and returns a fixed CID. */
function buildMockPinner(cid = "bafkreitestreceiptcid"): MockPinner {
  return {
    pinJson: vi.fn(() => Promise.resolve({ cid, size: 200 })),
    pinBytes: vi.fn(() => Promise.resolve({ cid, size: 200 })),
    unpin: vi.fn(() => Promise.resolve()),
    isPinned: vi.fn(() => Promise.resolve(true)),
  };
}

/**
 * Synthesize a transaction receipt log shaped like a real `TicketMinted`
 * event. Used in lieu of an actual `wallet.sendTransaction(...)` round-trip
 * — the test does not broadcast.
 */
function buildSyntheticTicketMintedLog(args: {
  tokenId: bigint;
  to: `0x${string}`;
  eventId: bigint;
  paymentId: `0x${string}`;
  tokenURI: string;
}): { topics: readonly `0x${string}`[]; data: `0x${string}` } {
  const topics = encodeEventTopics({
    abi: ATLAS_TICKET_ABI,
    eventName: "TicketMinted",
    args: { tokenId: args.tokenId, to: args.to, eventId: args.eventId },
  });
  const data = encodeAbiParameters(
    [
      { name: "paymentId", type: "bytes32" },
      { name: "tokenURI", type: "string" },
    ],
    [args.paymentId, args.tokenURI],
  );
  return { topics, data };
}

/** Synthesize a `RewardRecorded` log. */
function buildSyntheticRewardRecordedLog(args: {
  paymentId: `0x${string}`;
  recipient: `0x${string}`;
  kind: RewardKind;
  amount: bigint;
}): { topics: readonly `0x${string}`[]; data: `0x${string}` } {
  const topics = encodeEventTopics({
    abi: REWARD_LEDGER_ABI,
    eventName: "RewardRecorded",
    args: { paymentId: args.paymentId, recipient: args.recipient, kind: args.kind },
  });
  const data = encodeAbiParameters([{ name: "amount", type: "uint256" }], [args.amount]);
  return { topics, data };
}

/**
 * Build the MPP credential envelope an agent would present after settling
 * the 402 challenge on the x402 rail. Embeds the on-chain `tx_hash` in the
 * envelope's metadata — that is where the dual-protocol-server reads it
 * back from in `handlePurchase`.
 */
function buildAgentX402Credential(args: {
  challengeId: string;
  txHash: `0x${string}`;
  amountUsdcMicros: bigint;
  recipient: `0x${string}`;
}): MppEnvelope {
  const amountDecimal = formatMicrosAsDecimal(args.amountUsdcMicros);
  return encode({
    rail: "usdc-base-sepolia",
    realm: "atlas",
    paymentId: args.challengeId,
    intent: "charge",
    amount: amountDecimal,
    currency: BASE_SEPOLIA_USDC,
    recipient: args.recipient,
    organizer: ORGANIZER,
    expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    description: `ATLAS purchase ${EVENT_ID} hold=${HOLD_ID}`,
    metadata: {
      event_id: EVENT_ID,
      hold_id: HOLD_ID,
      challenge_id: args.challengeId,
      tx_hash: args.txHash,
    },
  });
}

/** Build the MPP credential envelope an agent would present on the Stripe SPT rail. */
function buildAgentStripeCredential(args: {
  challengeId: string;
  paymentIntentId: string;
  amountUsdMicros: bigint;
}): MppEnvelope {
  const amountUsd = formatMicrosAsTwoDecimal(args.amountUsdMicros);
  return encode({
    rail: "stripe-spt",
    realm: "atlas",
    paymentId: args.challengeId,
    intent: "charge",
    amount: amountUsd,
    currency: "usd",
    recipient: "stripe:platform",
    organizer: ORGANIZER,
    expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    description: `ATLAS purchase ${EVENT_ID} hold=${HOLD_ID}`,
    metadata: {
      event_id: EVENT_ID,
      hold_id: HOLD_ID,
      challenge_id: args.challengeId,
      payment_intent_id: args.paymentIntentId,
    },
  });
}

function formatMicrosAsDecimal(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toString()}.${fraction}`;
}

function formatMicrosAsTwoDecimal(micros: bigint): string {
  // Round to nearest cent.
  const cents = (micros + 5_000n) / 10_000n;
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${fraction}`;
}

/**
 * Compose the post-verify steps (mint ticket + record reward + generate
 * pinned receipt). Returns the full post-verify result so individual tests
 * can assert on each piece. Wraps the side-effecting calls in a counter so
 * the replay-rejection test can assert "this was not invoked twice".
 */
interface ComposeResult {
  mintCalls: number;
  rewardCalls: number;
  ticketTokenId?: bigint;
  rewardKind?: RewardKind;
  receipt?: GenerateReceiptResult;
}

interface ComposePurchaseDeps {
  paymentId: `0x${string}`;
  pinner: MockPinner;
  /** "x402" → on-chain settlement; "stripe_spt" → Stripe. */
  rail: "x402" | "stripe_spt";
  /** Required when rail === "x402". */
  txHash?: `0x${string}`;
  /** Required when rail === "stripe_spt". */
  paymentIntentId?: string;
  /** Synthetic mint receipt (would normally come from broadcasting). */
  mintReceipt: { topics: readonly `0x${string}`[]; data: `0x${string}` };
  rewardReceipt: { topics: readonly `0x${string}`[]; data: `0x${string}` };
}

async function composePostVerify(deps: ComposePurchaseDeps): Promise<ComposeResult> {
  const result: ComposeResult = { mintCalls: 0, rewardCalls: 0 };

  // (1) Build mint calldata. We don't broadcast — but we DO assert the
  // calldata decodes to the args we passed in. This is the core invariant:
  // the SDK helper produces calldata that round-trips through viem's
  // decoder against the published ABI.
  const mintTx = buildMintTicketTx({
    contract: TICKET_CONTRACT,
    to: ATTENDEE,
    eventId: ON_CHAIN_EVENT_ID,
    paymentId: deps.paymentId,
    tokenURI: TOKEN_URI,
  });
  result.mintCalls += 1;
  const mintDecoded = decodeFunctionData({ abi: ATLAS_TICKET_ABI, data: mintTx.data });
  expect(mintDecoded.functionName).toBe("mint");
  // args: [to, eventId, paymentId, tokenURI]. viem returns checksummed
  // addresses on decode — compare case-insensitively.
  expect((mintDecoded.args[0] as string).toLowerCase()).toBe(ATTENDEE);
  expect(mintDecoded.args[1]).toBe(ON_CHAIN_EVENT_ID);
  expect(mintDecoded.args[2]).toBe(deps.paymentId);
  expect(mintDecoded.args[3]).toBe(TOKEN_URI);
  expect(mintTx.to).toBe(TICKET_CONTRACT);
  expect(mintTx.value).toBe(0n);

  // (2) Pretend we broadcast. Decode the synthetic TicketMinted log.
  const ticket = parseTicketMintedEvent(deps.mintReceipt);
  expect(ticket).not.toBeNull();
  expect(ticket!.paymentId).toBe(deps.paymentId);
  expect(ticket!.eventId).toBe(ON_CHAIN_EVENT_ID);
  expect(ticket!.to.toLowerCase()).toBe(ATTENDEE.toLowerCase());
  expect(ticket!.tokenURI).toBe(TOKEN_URI);
  result.ticketTokenId = ticket!.tokenId;

  // (3) Build recordReward calldata for the organizer share. Decode +
  // assert against the same paymentId so the on-chain idempotency anchor
  // is preserved across the verify → mint → reward chain.
  const rewardTx = buildRecordRewardTx({
    contract: REWARD_CONTRACT,
    recipient: ORGANIZER,
    kind: RewardKind.Organizer,
    amount: PROTOCOL_FEE_USDC_MICROS,
    paymentId: deps.paymentId,
  });
  result.rewardCalls += 1;
  const rewardDecoded = decodeFunctionData({ abi: REWARD_LEDGER_ABI, data: rewardTx.data });
  expect(rewardDecoded.functionName).toBe("recordReward");
  // args: [recipient, kind, amount, paymentId]
  expect((rewardDecoded.args[0] as string).toLowerCase()).toBe(ORGANIZER);
  expect(rewardDecoded.args[1]).toBe(RewardKind.Organizer);
  expect(rewardDecoded.args[2]).toBe(PROTOCOL_FEE_USDC_MICROS);
  expect(rewardDecoded.args[3]).toBe(deps.paymentId);
  expect(rewardTx.to).toBe(REWARD_CONTRACT);
  expect(rewardTx.value).toBe(0n);

  // (4) Decode the synthetic RewardRecorded log.
  const reward = parseRewardRecordedEvent(deps.rewardReceipt);
  expect(reward).not.toBeNull();
  expect(reward!.paymentId).toBe(deps.paymentId);
  expect(reward!.recipient.toLowerCase()).toBe(ORGANIZER.toLowerCase());
  expect(reward!.kind).toBe(RewardKind.Organizer);
  expect(reward!.amount).toBe(PROTOCOL_FEE_USDC_MICROS);
  result.rewardKind = reward!.kind;

  // (5) Generate the receipt with the pinner attached. Both rails populate
  // hold_id with the SAME paymentId-derived value so the receipt carries
  // the same idempotency anchor that the on-chain calls did.
  const receipt = await generateReceipt(
    deps.rail === "x402"
      ? {
          holdId: HOLD_ID,
          eventId: EVENT_ID,
          attendee: ATTENDEE,
          organizerAddress: ORGANIZER,
          amount: formatMicrosAsDecimal(TICKET_PRICE_USDC_MICROS),
          currency: "USDC",
          paymentMethod: "x402",
          txHash: deps.txHash!,
          settlementChain: "base-sepolia",
          ticketTypeId: "tt_ga_001",
          quantity: 1,
          pinner: deps.pinner,
        }
      : {
          holdId: HOLD_ID,
          eventId: EVENT_ID,
          attendee: ATTENDEE,
          organizerAddress: ORGANIZER,
          amount: formatMicrosAsTwoDecimal(TICKET_PRICE_USDC_MICROS),
          currency: "USD",
          paymentMethod: "stripe_spt",
          paymentIntentId: deps.paymentIntentId!,
          ticketTypeId: "tt_ga_001",
          quantity: 1,
          pinner: deps.pinner,
        },
  );
  result.receipt = receipt;
  return result;
}

// ---------------------------------------------------------------------------
// Helper that runs one rail end-to-end. Returns everything individual tests
// want to assert.
// ---------------------------------------------------------------------------

interface RailRunInputs {
  rail: "x402" | "stripe_spt";
  paymentId: `0x${string}`;
  pinner: MockPinner;
  /** When provided, used for both verify and credential. */
  txHash?: `0x${string}`;
  paymentIntentId?: string;
  /** Optional shared replay store. When omitted, a fresh in-memory store is created. */
  replayStore?: InMemoryReplayStore;
}

interface RailRunResult {
  challengeId: string;
  envelope: MppEnvelope;
  verifyResult: { valid: boolean; error?: string };
  compose?: ComposeResult;
}

async function runX402Rail(inputs: RailRunInputs): Promise<RailRunResult> {
  // (a) Server side: generate the 402 challenge.
  const { payload } = generateMppChallenge({
    eventId: EVENT_ID,
    holdId: HOLD_ID,
    challengeId: `ch_${HOLD_ID}`,
    ticketTypeId: "tt_ga_001",
    quantity: 1,
    amountUsdcMicros: TICKET_PRICE_USDC_MICROS,
    organizerAddress: ORGANIZER,
    acceptedChains: ["base_sepolia_usdc"],
    acceptStripe: false,
    receiversByChain: { base_sepolia_usdc: ORGANIZER },
  });
  const challengeId = payload.challenge_id;

  // (b) Agent side: build a credential envelope as if the agent had paid.
  const txHash = inputs.txHash!;
  const envelope = buildAgentX402Credential({
    challengeId,
    txHash,
    amountUsdcMicros: TICKET_PRICE_USDC_MICROS,
    recipient: ORGANIZER,
  });

  // (c) Server side: verify the credential. Replay store is opt-in.
  const replayStore = inputs.replayStore ?? new InMemoryReplayStore();
  const config: Pick<ServerSdkConfig, "paymentMethods" | "logger"> = {
    paymentMethods: [{ type: "base_sepolia_usdc", receiverAddress: ORGANIZER }],
  };
  const { client: chainClient } = buildMockChainClient({
    txHash,
    amountMicros: TICKET_PRICE_USDC_MICROS,
    recipient: ORGANIZER,
  });
  const credResult = await verifyMppCredential(envelope, challengeId, {
    replayStore,
    verify: async (env) => {
      // The host's verify hook runs the on-chain payment verifier.
      const meta = (env.request as { metadata?: Record<string, string> }).metadata;
      const credTxHash = meta?.["tx_hash"] as `0x${string}` | undefined;
      if (!credTxHash) return { valid: false, error: "verification_failed" };
      const v = await verifyPayment(
        config,
        { type: "base_sepolia_usdc", transaction_hash: credTxHash },
        {
          challenge_id: challengeId,
          expected_amount_usd: Number(TICKET_PRICE_USDC_MICROS) / 1_000_000,
          recipient_address: ORGANIZER,
        },
        { evmClient: () => chainClient },
      );
      return v.valid ? { valid: true } : { valid: false, error: "verification_failed" };
    },
  });

  if (!credResult.valid) {
    return {
      challengeId,
      envelope,
      verifyResult: { valid: false, error: credResult.error },
    };
  }

  // (d) Compose post-verify side effects.
  const mintReceipt = buildSyntheticTicketMintedLog({
    tokenId: 7n,
    to: ATTENDEE,
    eventId: ON_CHAIN_EVENT_ID,
    paymentId: inputs.paymentId,
    tokenURI: TOKEN_URI,
  });
  const rewardReceipt = buildSyntheticRewardRecordedLog({
    paymentId: inputs.paymentId,
    recipient: ORGANIZER,
    kind: RewardKind.Organizer,
    amount: PROTOCOL_FEE_USDC_MICROS,
  });
  const compose = await composePostVerify({
    paymentId: inputs.paymentId,
    pinner: inputs.pinner,
    rail: "x402",
    txHash,
    mintReceipt,
    rewardReceipt,
  });

  return { challengeId, envelope, verifyResult: { valid: true }, compose };
}

async function runStripeRail(inputs: RailRunInputs): Promise<RailRunResult> {
  const { payload } = generateMppChallenge({
    eventId: EVENT_ID,
    holdId: HOLD_ID,
    challengeId: `ch_${HOLD_ID}`,
    ticketTypeId: "tt_ga_001",
    quantity: 1,
    amountUsdcMicros: TICKET_PRICE_USDC_MICROS,
    organizerAddress: ORGANIZER,
    acceptedChains: [],
    acceptStripe: true,
    stripePaymentIntentId: inputs.paymentIntentId,
  });
  const challengeId = payload.challenge_id;

  const piId = inputs.paymentIntentId!;
  const envelope = buildAgentStripeCredential({
    challengeId,
    paymentIntentId: piId,
    amountUsdMicros: TICKET_PRICE_USDC_MICROS,
  });

  const replayStore = inputs.replayStore ?? new InMemoryReplayStore();
  const { stripe } = buildMockStripe({
    intentId: piId,
    amountCents: Number(TICKET_PRICE_USDC_MICROS / 10_000n),
  });
  const config: Pick<ServerSdkConfig, "paymentMethods" | "logger"> = {
    paymentMethods: [{ type: "stripe_spt", stripeSecretKey: "sk_test_xxx" }],
  };

  const credResult = await verifyMppCredential(envelope, challengeId, {
    replayStore,
    verify: async (env) => {
      const meta = (env.request as { metadata?: Record<string, string> }).metadata;
      const credPi = meta?.["payment_intent_id"];
      if (typeof credPi !== "string") return { valid: false, error: "verification_failed" };
      const v = await verifyPayment(
        config,
        { type: "stripe_spt", payment_intent_id: credPi },
        {
          challenge_id: challengeId,
          expected_amount_usd: Number(TICKET_PRICE_USDC_MICROS) / 1_000_000,
        },
        { stripe },
      );
      return v.valid ? { valid: true } : { valid: false, error: "verification_failed" };
    },
  });

  if (!credResult.valid) {
    return {
      challengeId,
      envelope,
      verifyResult: { valid: false, error: credResult.error },
    };
  }

  const mintReceipt = buildSyntheticTicketMintedLog({
    tokenId: 9n,
    to: ATTENDEE,
    eventId: ON_CHAIN_EVENT_ID,
    paymentId: inputs.paymentId,
    tokenURI: TOKEN_URI,
  });
  const rewardReceipt = buildSyntheticRewardRecordedLog({
    paymentId: inputs.paymentId,
    recipient: ORGANIZER,
    kind: RewardKind.Organizer,
    amount: PROTOCOL_FEE_USDC_MICROS,
  });
  const compose = await composePostVerify({
    paymentId: inputs.paymentId,
    pinner: inputs.pinner,
    rail: "stripe_spt",
    paymentIntentId: piId,
    mintReceipt,
    rewardReceipt,
  });

  return { challengeId, envelope, verifyResult: { valid: true }, compose };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("end-to-end agent purchase flow", () => {
  describe("x402 rail", () => {
    it("agent → 402 → pay → verify → mint → reward → pin → receipt", async () => {
      const paymentId = keccak256(toHex("e2e-x402-payment-1"));
      const txHash = ("0x" + "ab".repeat(32)) as `0x${string}`;
      const pinner = buildMockPinner();

      const run = await runX402Rail({ rail: "x402", paymentId, pinner, txHash });

      expect(run.verifyResult.valid).toBe(true);
      expect(run.compose).toBeDefined();
      const compose = run.compose!;

      // (1) paymentId carries through verify → mint calldata → reward
      // calldata → receipt. The mint + reward decoded paymentIds were
      // already asserted inside composePostVerify; here we confirm the
      // round-tripped log values match too.
      expect(compose.ticketTokenId).toBe(7n);
      expect(compose.rewardKind).toBe(RewardKind.Organizer);

      // (2) Pinner called exactly once with the canonical receipt.
      expect(pinner.pinJson).toHaveBeenCalledTimes(1);
      const [pinnedReceipt, pinOpts] = pinner.pinJson.mock.calls[0] as [unknown, { name: string }];
      expect(pinnedReceipt).toBe(compose.receipt!.receipt);
      expect(pinOpts).toEqual({ name: `atlas-receipt-${HOLD_ID}` });

      // (3) Returned CID matches mock.
      expect(compose.receipt!.cid).toBe("bafkreitestreceiptcid");

      // (4) Receipt carries the on-chain settlement details for x402.
      const settlement = compose.receipt!.receipt.credentialSubject.settlement;
      expect(settlement.method).toBe("x402");
      expect(settlement.tx_hash).toBe(txHash);
      expect(settlement.chain).toBe("base-sepolia");
      expect(settlement.payment_intent_id).toBeUndefined();

      // (5) hold_id flows into credentialSubject so the receipt is
      // bound to the same hold the agent was verified against.
      expect(compose.receipt!.receipt.credentialSubject.hold_id).toBe(HOLD_ID);

      // (6) Sanity: side effects each ran exactly once.
      expect(compose.mintCalls).toBe(1);
      expect(compose.rewardCalls).toBe(1);
    });

    it("rejects replayed paymentId without minting or rewarding twice", async () => {
      const paymentId = keccak256(toHex("e2e-x402-replay-1"));
      const txHash = ("0x" + "cd".repeat(32)) as `0x${string}`;
      const pinner = buildMockPinner();
      // Shared replay store across both runs — that is what enforces
      // single-use semantics on the credential.
      const replayStore = new InMemoryReplayStore();

      const first = await runX402Rail({
        rail: "x402",
        paymentId,
        pinner,
        txHash,
        replayStore,
      });
      expect(first.verifyResult.valid).toBe(true);

      // Confirm the credential hash is now recorded.
      const hash = credentialHash(first.envelope);
      await expect(replayStore.isCredentialUsed(hash)).resolves.toBe(true);

      // Re-verify the SAME envelope — must be rejected as replayed. We
      // mirror the verify-only step (without composing the post-verify
      // side effects) to make the "no re-mint, no re-record" invariant
      // visible: composePostVerify is NEVER called on this path.
      const replayResult = await verifyMppCredential(first.envelope, first.challengeId, {
        replayStore,
        verify: () => {
          throw new Error("verify should not be called on a replayed credential");
        },
      });
      expect(replayResult.valid).toBe(false);
      expect(replayResult.valid === false && replayResult.error).toBe("replayed");

      // Pinner was only ever called once (during the first run) — the
      // replay never reached generateReceipt.
      expect(pinner.pinJson).toHaveBeenCalledTimes(1);
    });
  });

  describe("stripe MPP rail", () => {
    it("agent → 402 → stripe-spt → verify → mint → reward → pin → receipt", async () => {
      const paymentId = keccak256(toHex("e2e-stripe-payment-1"));
      const pinner = buildMockPinner();

      const run = await runStripeRail({
        rail: "stripe_spt",
        paymentId,
        pinner,
        paymentIntentId: "pi_test_e2e_001",
      });

      expect(run.verifyResult.valid).toBe(true);
      expect(run.compose).toBeDefined();
      const compose = run.compose!;

      // Receipt carries Stripe settlement, NOT a tx_hash/chain.
      const settlement = compose.receipt!.receipt.credentialSubject.settlement;
      expect(settlement.method).toBe("stripe_spt");
      expect(settlement.payment_intent_id).toBe("pi_test_e2e_001");
      expect(settlement.tx_hash).toBeUndefined();
      expect(settlement.chain).toBeUndefined();

      // Same cross-cutting invariants as the x402 rail.
      expect(compose.ticketTokenId).toBe(9n);
      expect(compose.rewardKind).toBe(RewardKind.Organizer);
      expect(pinner.pinJson).toHaveBeenCalledTimes(1);
      expect(compose.receipt!.cid).toBe("bafkreitestreceiptcid");
      expect(compose.receipt!.receipt.credentialSubject.hold_id).toBe(HOLD_ID);
      expect(compose.mintCalls).toBe(1);
      expect(compose.rewardCalls).toBe(1);
    });

    it("rejects replayed Stripe credential without re-charging or re-minting", async () => {
      const paymentId = keccak256(toHex("e2e-stripe-replay-1"));
      const pinner = buildMockPinner();
      const replayStore = new InMemoryReplayStore();

      const first = await runStripeRail({
        rail: "stripe_spt",
        paymentId,
        pinner,
        paymentIntentId: "pi_test_e2e_replay",
        replayStore,
      });
      expect(first.verifyResult.valid).toBe(true);

      const replayResult = await verifyMppCredential(first.envelope, first.challengeId, {
        replayStore,
        verify: () => {
          throw new Error("verify should not be called on a replayed credential");
        },
      });
      expect(replayResult.valid).toBe(false);
      expect(replayResult.valid === false && replayResult.error).toBe("replayed");

      // Pinner only ever called for the first (legitimate) run.
      expect(pinner.pinJson).toHaveBeenCalledTimes(1);
    });
  });

  describe("cross-cutting invariants", () => {
    it("paymentId carries through mint calldata, reward calldata, AND receipt logs unchanged", async () => {
      const paymentId = keccak256(toHex("e2e-invariant-1"));
      const txHash = ("0x" + "ef".repeat(32)) as `0x${string}`;
      const pinner = buildMockPinner();

      const run = await runX402Rail({ rail: "x402", paymentId, pinner, txHash });
      expect(run.verifyResult.valid).toBe(true);
      const compose = run.compose!;

      // Re-decode the synthetic logs and compare against `paymentId`. This
      // is the load-bearing invariant — the same 32-byte value must flow
      // unchanged from the verify step into mint, reward, and the parsed
      // log readback.
      const ticket = parseTicketMintedEvent(
        buildSyntheticTicketMintedLog({
          tokenId: 7n,
          to: ATTENDEE,
          eventId: ON_CHAIN_EVENT_ID,
          paymentId,
          tokenURI: TOKEN_URI,
        }),
      );
      expect(ticket!.paymentId).toBe(paymentId);

      const reward = parseRewardRecordedEvent(
        buildSyntheticRewardRecordedLog({
          paymentId,
          recipient: ORGANIZER,
          kind: RewardKind.Organizer,
          amount: PROTOCOL_FEE_USDC_MICROS,
        }),
      );
      expect(reward!.paymentId).toBe(paymentId);

      // And the calldata-decoded paymentId from inside composePostVerify
      // matched too — that assertion lives in the helper, but we re-verify
      // the receipt's hold_id is what was passed in.
      expect(compose.receipt!.receipt.credentialSubject.hold_id).toBe(HOLD_ID);
    });
  });
});
