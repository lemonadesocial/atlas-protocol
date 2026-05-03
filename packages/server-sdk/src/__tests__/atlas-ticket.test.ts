import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  pad,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  ATLAS_TICKET_ABI,
  buildMintTicketTx,
  getAtlasTicketContractAddress,
  parseTicketMintedEvent,
} from "../atlas-ticket.js";

const CONTRACT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const PAYMENT_ID = keccak256(toHex("payment-1"));
const URI = "ipfs://QmTicketOne";
const EVENT_ID = 42n;

describe("buildMintTicketTx", () => {
  it("encodes a known input to the expected calldata", () => {
    const tx = buildMintTicketTx({
      contract: CONTRACT,
      to: RECIPIENT,
      eventId: EVENT_ID,
      paymentId: PAYMENT_ID,
      tokenURI: URI,
    });

    // Compute the expected calldata against the same ABI subset to guard
    // against accidental ABI drift.
    const expected = encodeFunctionData({
      abi: ATLAS_TICKET_ABI,
      functionName: "mint",
      args: [RECIPIENT, EVENT_ID, PAYMENT_ID, URI],
    });

    expect(tx.data).toBe(expected);
  });

  it("returns value = 0n and to = contract", () => {
    const tx = buildMintTicketTx({
      contract: CONTRACT,
      to: RECIPIENT,
      eventId: EVENT_ID,
      paymentId: PAYMENT_ID,
      tokenURI: URI,
    });

    expect(tx.value).toBe(0n);
    expect(tx.to).toBe(CONTRACT);
  });
});

describe("parseTicketMintedEvent", () => {
  it("decodes a synthetic log", () => {
    const tokenId = 7n;

    const topics = encodeEventTopics({
      abi: ATLAS_TICKET_ABI,
      eventName: "TicketMinted",
      args: { tokenId, to: RECIPIENT, eventId: EVENT_ID },
    });

    const data = encodeAbiParameters(
      [
        { name: "paymentId", type: "bytes32" },
        { name: "tokenURI", type: "string" },
      ],
      [PAYMENT_ID, URI],
    );

    const decoded = parseTicketMintedEvent({ topics, data });
    expect(decoded).not.toBeNull();
    expect(decoded!.tokenId).toBe(tokenId);
    expect(decoded!.to.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(decoded!.eventId).toBe(EVENT_ID);
    expect(decoded!.paymentId).toBe(PAYMENT_ID);
    expect(decoded!.tokenURI).toBe(URI);
  });

  it("returns null for unrelated logs", () => {
    // A Transfer-shaped log: topic[0] is the ERC-20 Transfer signature, not
    // TicketMinted. parseTicketMintedEvent must reject it cleanly.
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
    const fromTopic = pad(RECIPIENT, { size: 32 });
    const toTopic = pad(CONTRACT, { size: 32 });

    const decoded = parseTicketMintedEvent({
      topics: [transferTopic, fromTopic, toTopic],
      data: "0x",
    });
    expect(decoded).toBeNull();
  });

  it("returns null for logs with no topics", () => {
    expect(parseTicketMintedEvent({ topics: [], data: "0x" })).toBeNull();
  });
});

describe("getAtlasTicketContractAddress", () => {
  it("returns undefined for chains with null proxy", () => {
    expect(getAtlasTicketContractAddress("base_usdc")).toBeUndefined();
    expect(getAtlasTicketContractAddress("optimism_sepolia_usdc")).toBeUndefined();
  });

  it("returns undefined for unknown chain slugs", () => {
    expect(getAtlasTicketContractAddress("not_a_real_chain")).toBeUndefined();
  });
});
