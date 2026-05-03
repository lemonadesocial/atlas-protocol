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
  buildClaimToTx,
  buildClaimTx,
  buildFundTx,
  buildRecordRewardTx,
  buildReverseRewardsTx,
  getRewardLedgerContractAddress,
  parseClaimedEvent,
  parseFundedEvent,
  parseRewardRecordedEvent,
  parseRewardsReversedEvent,
  REWARD_LEDGER_ABI,
  RewardKind,
} from "../reward-ledger.js";

const CONTRACT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const DESTINATION = "0x3333333333333333333333333333333333333333" as const;
const PAYMENT_ID = keccak256(toHex("payment-1"));
const AMOUNT = 100_000_000n; // 100 USDC at 6 decimals

describe("RewardKind enum stability", () => {
  it("matches the on-chain RewardKind ordering exactly", () => {
    // These values are part of the public ABI — reordering breaks every
    // indexer that decodes RewardRecorded.kind by integer value. Pin them
    // here so an accidental reorder fails the build.
    expect(RewardKind.Organizer).toBe(0);
    expect(RewardKind.Attendee).toBe(1);
    expect(RewardKind.Referral).toBe(2);
  });
});

describe("buildRecordRewardTx", () => {
  it.each([
    { label: "Organizer", kind: RewardKind.Organizer },
    { label: "Attendee", kind: RewardKind.Attendee },
    { label: "Referral", kind: RewardKind.Referral },
  ])("encodes a known input to the expected calldata for kind=$label", ({ kind }) => {
    const tx = buildRecordRewardTx({
      contract: CONTRACT,
      recipient: RECIPIENT,
      kind,
      amount: AMOUNT,
      paymentId: PAYMENT_ID,
    });

    // Recompute against the same ABI subset to guard against accidental ABI
    // drift. The kind argument is a uint8, so we cast through Number to
    // satisfy viem's encoder.
    const expected = encodeFunctionData({
      abi: REWARD_LEDGER_ABI,
      functionName: "recordReward",
      args: [RECIPIENT, kind, AMOUNT, PAYMENT_ID],
    });

    expect(tx.data).toBe(expected);
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBe(0n);
  });
});

describe("buildClaimTx", () => {
  it("encodes claim() to the expected calldata", () => {
    const tx = buildClaimTx({ contract: CONTRACT });
    const expected = encodeFunctionData({
      abi: REWARD_LEDGER_ABI,
      functionName: "claim",
      args: [],
    });
    expect(tx.data).toBe(expected);
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBe(0n);
  });
});

describe("buildClaimToTx", () => {
  it("encodes claimTo(destination) to the expected calldata", () => {
    const tx = buildClaimToTx({ contract: CONTRACT, destination: DESTINATION });
    const expected = encodeFunctionData({
      abi: REWARD_LEDGER_ABI,
      functionName: "claimTo",
      args: [DESTINATION],
    });
    expect(tx.data).toBe(expected);
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBe(0n);
  });
});

describe("buildFundTx", () => {
  it("encodes fund(amount) to the expected calldata", () => {
    const tx = buildFundTx({ contract: CONTRACT, amount: AMOUNT });
    const expected = encodeFunctionData({
      abi: REWARD_LEDGER_ABI,
      functionName: "fund",
      args: [AMOUNT],
    });
    expect(tx.data).toBe(expected);
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBe(0n);
  });
});

describe("buildReverseRewardsTx", () => {
  it("encodes reverseRewards(paymentId) to the expected calldata", () => {
    const tx = buildReverseRewardsTx({ contract: CONTRACT, paymentId: PAYMENT_ID });
    const expected = encodeFunctionData({
      abi: REWARD_LEDGER_ABI,
      functionName: "reverseRewards",
      args: [PAYMENT_ID],
    });
    expect(tx.data).toBe(expected);
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBe(0n);
  });

  it("calldata round-trips through decodeFunctionData", () => {
    const tx = buildReverseRewardsTx({ contract: CONTRACT, paymentId: PAYMENT_ID });
    const decoded = decodeFunctionData({ abi: REWARD_LEDGER_ABI, data: tx.data });
    expect(decoded.functionName).toBe("reverseRewards");
    expect(decoded.args).toEqual([PAYMENT_ID]);
  });
});

describe("parseRewardRecordedEvent", () => {
  it("decodes a synthetic log including the enum kind", () => {
    const topics = encodeEventTopics({
      abi: REWARD_LEDGER_ABI,
      eventName: "RewardRecorded",
      args: { paymentId: PAYMENT_ID, recipient: RECIPIENT, kind: RewardKind.Attendee },
    });

    const data = encodeAbiParameters([{ name: "amount", type: "uint256" }], [AMOUNT]);

    const decoded = parseRewardRecordedEvent({ topics, data });
    expect(decoded).not.toBeNull();
    expect(decoded!.paymentId).toBe(PAYMENT_ID);
    expect(decoded!.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(decoded!.kind).toBe(RewardKind.Attendee);
    expect(decoded!.amount).toBe(AMOUNT);
  });

  it("returns null for unrelated logs", () => {
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
    const fromTopic = pad(RECIPIENT, { size: 32 });
    const toTopic = pad(CONTRACT, { size: 32 });
    expect(
      parseRewardRecordedEvent({ topics: [transferTopic, fromTopic, toTopic], data: "0x" }),
    ).toBeNull();
  });

  it("returns null for logs with no topics", () => {
    expect(parseRewardRecordedEvent({ topics: [], data: "0x" })).toBeNull();
  });
});

describe("parseClaimedEvent", () => {
  it("decodes a synthetic log", () => {
    const topics = encodeEventTopics({
      abi: REWARD_LEDGER_ABI,
      eventName: "Claimed",
      args: { claimer: RECIPIENT, destination: DESTINATION },
    });
    const data = encodeAbiParameters([{ name: "amount", type: "uint256" }], [AMOUNT]);

    const decoded = parseClaimedEvent({ topics, data });
    expect(decoded).not.toBeNull();
    expect(decoded!.claimer.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(decoded!.destination.toLowerCase()).toBe(DESTINATION.toLowerCase());
    expect(decoded!.amount).toBe(AMOUNT);
  });

  it("returns null for unrelated logs", () => {
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
    expect(
      parseClaimedEvent({
        topics: [transferTopic, pad(RECIPIENT, { size: 32 }), pad(DESTINATION, { size: 32 })],
        data: "0x",
      }),
    ).toBeNull();
  });
});

describe("parseFundedEvent", () => {
  it("decodes a synthetic log", () => {
    const topics = encodeEventTopics({
      abi: REWARD_LEDGER_ABI,
      eventName: "Funded",
      args: { from: RECIPIENT },
    });
    const data = encodeAbiParameters([{ name: "amount", type: "uint256" }], [AMOUNT]);

    const decoded = parseFundedEvent({ topics, data });
    expect(decoded).not.toBeNull();
    expect(decoded!.from.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(decoded!.amount).toBe(AMOUNT);
  });

  it("returns null for unrelated logs", () => {
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
    expect(
      parseFundedEvent({
        topics: [transferTopic, pad(RECIPIENT, { size: 32 })],
        data: "0x",
      }),
    ).toBeNull();
  });
});

describe("parseRewardsReversedEvent", () => {
  it("decodes a synthetic log including the totalReversed amount", () => {
    const topics = encodeEventTopics({
      abi: REWARD_LEDGER_ABI,
      eventName: "RewardsReversed",
      args: { paymentId: PAYMENT_ID },
    });
    const data = encodeAbiParameters([{ name: "totalReversed", type: "uint256" }], [AMOUNT]);

    const decoded = parseRewardsReversedEvent({ topics, data });
    expect(decoded).not.toBeNull();
    expect(decoded!.paymentId).toBe(PAYMENT_ID);
    expect(decoded!.totalReversed).toBe(AMOUNT);
  });

  it("returns null for unrelated logs", () => {
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
    expect(
      parseRewardsReversedEvent({
        topics: [transferTopic, pad(RECIPIENT, { size: 32 })],
        data: "0x",
      }),
    ).toBeNull();
  });

  it("returns null for logs with no topics", () => {
    expect(parseRewardsReversedEvent({ topics: [], data: "0x" })).toBeNull();
  });
});

describe("getRewardLedgerContractAddress", () => {
  it("returns undefined for chains with null proxy", () => {
    expect(getRewardLedgerContractAddress("base_usdc")).toBeUndefined();
    expect(getRewardLedgerContractAddress("optimism_sepolia_usdc")).toBeUndefined();
  });

  it("returns undefined for unknown chain slugs", () => {
    expect(getRewardLedgerContractAddress("not_a_real_chain")).toBeUndefined();
  });
});
