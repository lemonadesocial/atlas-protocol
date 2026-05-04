/**
 * Integration test for `createAtlasManagedClient`.
 *
 * The unit test in `atlas-managed.test.ts` exercises each method in isolation
 * and covers all branches of the error hierarchy. This file complements that
 * by walking the **client ↔ registry endpoint contract** — same mocked-fetch
 * approach, but framed as a single happy-path "lifecycle" plus the failure
 * modes that platforms actually have to surface to their callers.
 *
 * What this test pins down:
 *   - URL shape (`/atlas/v1/...` for each of the four endpoints)
 *   - HTTP method (POST for all four)
 *   - Body field names (snake_case at the wire boundary)
 *   - Bigint → decimal-string serialisation for amounts
 *   - Response shape passes through verbatim
 *   - 4xx (with parsed `error.code`) → `AtlasManagedRequestError`
 *   - 5xx → `AtlasManagedServerError`
 *   - fetch rejection → `AtlasManagedNetworkError`
 */

import { describe, expect, it, vi } from "vitest";
import type { AtlasReceipt } from "@atlasprotocol/types";

import {
  AtlasManagedNetworkError,
  AtlasManagedRequestError,
  AtlasManagedServerError,
  createAtlasManagedClient,
} from "../clients/atlas-managed.js";

const BASE_URL = "https://registry.example.org";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function makeReceipt(): AtlasReceipt {
  return {
    "@context": ["https://www.w3.org/2018/credentials/v1", "https://atlas.events/credentials/v1"],
    type: ["VerifiableCredential", "AtlasTicketReceipt"],
    issuer: "did:web:bjc.events",
    issuanceDate: "2026-04-14T21:05:30Z",
    credentialSubject: {
      id: "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
      event_id: "evt_abc123",
      hold_id: "hold_xyz789",
      settlement: {
        method: "x402",
        amount: "25.000000",
        currency: "USDC",
        tx_hash: "0x" + "a".repeat(64),
        chain: "base",
      },
    },
  };
}

/**
 * A scripted fetch mock: the queue returns one `Response` per call, in order.
 * Throws if the queue is exhausted (catches "client made an unexpected
 * extra request" regressions).
 */
function scriptedFetch(responses: ReadonlyArray<Response>): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  return vi.fn(() => {
    const next = queue.shift();
    if (!next) {
      throw new Error("scriptedFetch: out of scripted responses");
    }
    return Promise.resolve(next);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle: pin → verify(receipt) → verify(urn,cid) → settle → recordRewards
// ---------------------------------------------------------------------------

describe("AtlasManagedClient — happy lifecycle", () => {
  it("walks the full pin → verify(receipt) → verify(lookup) → settle → recordRewards flow", async () => {
    const RECEIPT_URN = "urn:atlas:receipt:rec_lifecycle";
    const RECEIPT_CID = "bafkreilifecyclereceipt";
    const PAYMENT_ID = "0x" + "f".repeat(64);

    const fetchMock = scriptedFetch([
      // 1. pinReceipt
      jsonResponse({
        urn: RECEIPT_URN,
        cid: RECEIPT_CID,
        pinned_at: "2026-04-14T21:05:31Z",
      }),
      // 2. verifyReceipt({ receipt })
      jsonResponse({ valid: true, signature_verified: true, hash_match: true }),
      // 3. verifyReceipt({ urn, cid })
      jsonResponse({ valid: true, signature_verified: true, hash_match: true }),
      // 4. settle
      jsonResponse({
        paymentId: PAYMENT_ID,
        chain: "base",
        txHash: "0xdeadbeef",
        status: "confirmed",
        explorerUrl: `https://basescan.org/tx/0xdeadbeef`,
      }),
      // 5. recordRewards
      jsonResponse({
        paymentId: PAYMENT_ID,
        chain: "base",
        txHashes: ["0xrewardtx1"],
        status: "confirmed",
        explorerUrls: ["https://basescan.org/tx/0xrewardtx1"],
      }),
    ]);

    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });
    const receipt = makeReceipt();

    // --- 1. Pin ---------------------------------------------------------
    const pinned = await client.pinReceipt(receipt);
    expect(pinned).toEqual({
      urn: RECEIPT_URN,
      cid: RECEIPT_CID,
      pinned_at: "2026-04-14T21:05:31Z",
    });
    {
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/atlas/v1/receipts/pin`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ receipt });
    }

    // --- 2. Verify (full receipt) --------------------------------------
    const verifyByReceipt = await client.verifyReceipt(receipt);
    expect(verifyByReceipt).toEqual({
      valid: true,
      signature_verified: true,
      hash_match: true,
    });
    {
      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/atlas/v1/receipts/verify`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ receipt });
    }

    // --- 3. Verify (urn, cid lookup) -----------------------------------
    const verifyByLookup = await client.verifyReceipt({
      urn: RECEIPT_URN,
      cid: RECEIPT_CID,
    });
    expect(verifyByLookup).toEqual({
      valid: true,
      signature_verified: true,
      hash_match: true,
    });
    {
      const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/atlas/v1/receipts/verify`);
      expect(JSON.parse(init.body as string)).toEqual({
        urn: RECEIPT_URN,
        cid: RECEIPT_CID,
      });
    }

    // --- 4. Settle ------------------------------------------------------
    const settled = await client.settle({
      platformDomain: "atlas.bjc.events",
      chain: "base",
      organizer: "0x" + "1".repeat(40),
      totalAmount: 50_000_000n, // 50 USDC, 6 decimals
      paymentId: PAYMENT_ID,
      platformFees: [
        { recipient: "0x" + "3".repeat(40), amount: 1_000_000n },
        { recipient: "0x" + "4".repeat(40), amount: "500000" },
      ],
    });
    expect(settled).toEqual({
      paymentId: PAYMENT_ID,
      chain: "base",
      txHash: "0xdeadbeef",
      status: "confirmed",
      explorerUrl: "https://basescan.org/tx/0xdeadbeef",
    });
    {
      const [url, init] = fetchMock.mock.calls[3] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/atlas/v1/settlements/settle`);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      // Snake-case body keys at the wire boundary.
      expect(body).toEqual({
        platform_domain: "atlas.bjc.events",
        chain: "base",
        organizer: "0x" + "1".repeat(40),
        total_amount: "50000000", // bigint → decimal string
        payment_id: PAYMENT_ID,
        platform_fees: [
          { recipient: "0x" + "3".repeat(40), amount: "1000000" },
          { recipient: "0x" + "4".repeat(40), amount: "500000" },
        ],
      });
    }

    // --- 5. Record rewards ---------------------------------------------
    const recorded = await client.recordRewards({
      platformDomain: "atlas.bjc.events",
      paymentId: PAYMENT_ID,
      recipients: [
        { recipient: "0x" + "5".repeat(40), kind: "organizer", amount: 600_000n },
        { recipient: "0x" + "6".repeat(40), kind: "attendee", amount: "200000" },
        { recipient: "0x" + "7".repeat(40), kind: "referral", amount: 100_000n },
      ],
    });
    expect(recorded).toEqual({
      paymentId: PAYMENT_ID,
      chain: "base",
      txHashes: ["0xrewardtx1"],
      status: "confirmed",
      explorerUrls: ["https://basescan.org/tx/0xrewardtx1"],
    });
    {
      const [url, init] = fetchMock.mock.calls[4] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/atlas/v1/rewards/record`);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).toEqual({
        platform_domain: "atlas.bjc.events",
        payment_id: PAYMENT_ID,
        recipients: [
          { recipient: "0x" + "5".repeat(40), kind: "organizer", amount: "600000" },
          { recipient: "0x" + "6".repeat(40), kind: "attendee", amount: "200000" },
          { recipient: "0x" + "7".repeat(40), kind: "referral", amount: "100000" },
        ],
      });
    }

    // Sanity: exactly five fetches, in the order above.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// Failure modes — one per error class, mapped to the methods most likely to
// surface them in production.
// ---------------------------------------------------------------------------

describe("AtlasManagedClient — endpoint failure modes", () => {
  it("pinReceipt → 422 RECEIPT_INVALID surfaces as AtlasManagedRequestError", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "RECEIPT_INVALID",
              message: "Receipt signature did not verify against issuer manifest",
              details: { issuer: "did:web:bjc.events" },
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const promise = client.pinReceipt(makeReceipt());
    await expect(promise).rejects.toBeInstanceOf(AtlasManagedRequestError);
    await expect(promise).rejects.toMatchObject({
      name: "AtlasManagedRequestError",
      status: 422,
      code: "RECEIPT_INVALID",
      message: "Receipt signature did not verify against issuer manifest",
      details: { issuer: "did:web:bjc.events" },
    });
  });

  it("settle → 503 surfaces as AtlasManagedServerError", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "RPC_UNAVAILABLE",
              message: "Base RPC pool returned no healthy endpoints",
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const promise = client.settle({
      platformDomain: "atlas.bjc.events",
      chain: "base",
      organizer: "0x" + "1".repeat(40),
      totalAmount: "25000000",
      paymentId: "0x" + "2".repeat(64),
      platformFees: [],
    });

    await expect(promise).rejects.toBeInstanceOf(AtlasManagedServerError);
    await expect(promise).rejects.toMatchObject({
      status: 503,
      code: "RPC_UNAVAILABLE",
      message: "Base RPC pool returned no healthy endpoints",
    });
  });

  it("recordRewards → fetch rejection surfaces as AtlasManagedNetworkError", async () => {
    const fetchMock = vi.fn(
      (): Promise<Response> => Promise.reject(new TypeError("connection reset by peer")),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const promise = client.recordRewards({
      platformDomain: "atlas.bjc.events",
      paymentId: "0x" + "2".repeat(64),
      recipients: [{ recipient: "0x" + "5".repeat(40), kind: "organizer", amount: 600_000n }],
    });

    await expect(promise).rejects.toBeInstanceOf(AtlasManagedNetworkError);
    await expect(promise).rejects.toMatchObject({
      status: 0,
      code: "network_error",
      message: "connection reset by peer",
    });
  });
});
