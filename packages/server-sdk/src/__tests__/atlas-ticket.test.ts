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
  ATLAS_TICKET_ABI,
  EMPTY_EMAIL_HASH,
  buildBurnTicketTx,
  buildMintTicketTx,
  getAtlasTicketContractAddress,
  parseTicketBurnedEvent,
  parseTicketMintedEvent,
} from "../atlas-ticket.js";

const CONTRACT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const CUSTODIAL = "0x3333333333333333333333333333333333333333" as const;
const PAYMENT_ID = keccak256(toHex("payment-1"));
const URI = "ipfs://QmTicketOne";
const EVENT_ID = 42n;
const EMAIL_HASH = keccak256(toHex("alice@example.com"));

describe("buildMintTicketTx", () => {
  it("encodes a known input to the expected calldata (no email hash)", () => {
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
      args: [RECIPIENT, EVENT_ID, PAYMENT_ID, URI, EMPTY_EMAIL_HASH],
    });

    expect(tx.data).toBe(expected);
  });

  it("encodes a custodial mint with a non-zero email hash", () => {
    const tx = buildMintTicketTx({
      contract: CONTRACT,
      to: CUSTODIAL,
      eventId: EVENT_ID,
      paymentId: PAYMENT_ID,
      tokenURI: URI,
      emailHash: EMAIL_HASH,
    });

    const decoded = decodeFunctionData({ abi: ATLAS_TICKET_ABI, data: tx.data });
    expect(decoded.functionName).toBe("mint");
    expect(decoded.args).toEqual([CUSTODIAL, EVENT_ID, PAYMENT_ID, URI, EMAIL_HASH]);
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

describe("buildBurnTicketTx", () => {
  it("encodes burn calldata that round-trips through decodeFunctionData", () => {
    const tx = buildBurnTicketTx({
      contract: CONTRACT,
      tokenId: 7n,
      paymentId: PAYMENT_ID,
    });

    expect(tx.value).toBe(0n);
    expect(tx.to).toBe(CONTRACT);

    const decoded = decodeFunctionData({ abi: ATLAS_TICKET_ABI, data: tx.data });
    expect(decoded.functionName).toBe("burn");
    expect(decoded.args).toEqual([7n, PAYMENT_ID]);
  });

  it("matches the canonical encodeFunctionData output", () => {
    const tx = buildBurnTicketTx({
      contract: CONTRACT,
      tokenId: 99n,
      paymentId: PAYMENT_ID,
    });

    const expected = encodeFunctionData({
      abi: ATLAS_TICKET_ABI,
      functionName: "burn",
      args: [99n, PAYMENT_ID],
    });
    expect(tx.data).toBe(expected);
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
        { name: "emailHash", type: "bytes32" },
      ],
      [PAYMENT_ID, URI, EMPTY_EMAIL_HASH],
    );

    const decoded = parseTicketMintedEvent({ topics, data });
    expect(decoded).not.toBeNull();
    expect(decoded!.tokenId).toBe(tokenId);
    expect(decoded!.to.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(decoded!.eventId).toBe(EVENT_ID);
    expect(decoded!.paymentId).toBe(PAYMENT_ID);
    expect(decoded!.tokenURI).toBe(URI);
    expect(decoded!.emailHash).toBe(EMPTY_EMAIL_HASH);
  });

  it("decodes a custodial-flow log with a non-zero email hash", () => {
    const tokenId = 11n;

    const topics = encodeEventTopics({
      abi: ATLAS_TICKET_ABI,
      eventName: "TicketMinted",
      args: { tokenId, to: CUSTODIAL, eventId: EVENT_ID },
    });

    const data = encodeAbiParameters(
      [
        { name: "paymentId", type: "bytes32" },
        { name: "tokenURI", type: "string" },
        { name: "emailHash", type: "bytes32" },
      ],
      [PAYMENT_ID, URI, EMAIL_HASH],
    );

    const decoded = parseTicketMintedEvent({ topics, data });
    expect(decoded).not.toBeNull();
    expect(decoded!.emailHash).toBe(EMAIL_HASH);
    expect(decoded!.to.toLowerCase()).toBe(CUSTODIAL.toLowerCase());
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

describe("parseTicketBurnedEvent", () => {
  it("decodes a synthetic burn log", () => {
    const tokenId = 13n;

    const topics = encodeEventTopics({
      abi: ATLAS_TICKET_ABI,
      eventName: "TicketBurned",
      args: { tokenId, paymentId: PAYMENT_ID },
    });

    // TicketBurned has both fields indexed, so the data segment is empty.
    const decoded = parseTicketBurnedEvent({ topics, data: "0x" });
    expect(decoded).not.toBeNull();
    expect(decoded!.tokenId).toBe(tokenId);
    expect(decoded!.paymentId).toBe(PAYMENT_ID);
  });

  it("returns null for unrelated logs", () => {
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
    const fromTopic = pad(RECIPIENT, { size: 32 });
    const toTopic = pad(CONTRACT, { size: 32 });

    const decoded = parseTicketBurnedEvent({
      topics: [transferTopic, fromTopic, toTopic],
      data: "0x",
    });
    expect(decoded).toBeNull();
  });

  it("returns null when topic count is wrong", () => {
    // Valid TicketBurned signature but missing the paymentId topic — viem
    // should reject this cleanly.
    const burnSignature = encodeEventTopics({
      abi: ATLAS_TICKET_ABI,
      eventName: "TicketBurned",
    })[0];

    const decoded = parseTicketBurnedEvent({
      topics: [burnSignature, pad("0x07", { size: 32 })],
      data: "0x",
    });
    expect(decoded).toBeNull();
  });

  it("returns null for logs with no topics", () => {
    expect(parseTicketBurnedEvent({ topics: [], data: "0x" })).toBeNull();
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
