import { describe, expect, it, vi } from "vitest";
import type { AtlasReceipt } from "@atlasprotocol/types";

import {
  AtlasManagedNetworkError,
  AtlasManagedServerError,
  createAtlasManagedClient,
} from "../clients/atlas-managed.js";

const BASE_URL = "https://registry.example.org";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/** Build a fetch mock that returns the given Response. Avoids `async` so the
 *  ESLint `require-await` rule stays happy — the test surface is purely
 *  synchronous resolution. */
function fetchReturning(response: Response): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve(response));
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

describe("createAtlasManagedClient — pinReceipt", () => {
  it("POSTs to /atlas/v1/receipts/pin with the receipt body and returns the parsed response", async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        urn: "urn:atlas:receipt:rec_abc",
        cid: "bafkreireceipt",
        pinned_at: "2026-04-14T21:05:31Z",
      }),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const receipt = makeReceipt();
    const out = await client.pinReceipt(receipt);

    expect(out).toEqual({
      urn: "urn:atlas:receipt:rec_abc",
      cid: "bafkreireceipt",
      pinned_at: "2026-04-14T21:05:31Z",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/atlas/v1/receipts/pin`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["Atlas-SDK-Version"]).toBeDefined();
    expect(JSON.parse(init.body as string)).toEqual({ receipt });
  });
});

describe("createAtlasManagedClient — verifyReceipt", () => {
  it("POSTs the full receipt when given an AtlasReceipt", async () => {
    const fetchMock = fetchReturning(
      jsonResponse({ valid: true, signature_verified: true, hash_match: true }),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });
    const receipt = makeReceipt();

    const out = await client.verifyReceipt(receipt);

    expect(out).toEqual({ valid: true, signature_verified: true, hash_match: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/atlas/v1/receipts/verify`);
    expect(JSON.parse(init.body as string)).toEqual({ receipt });
  });

  it("POSTs a lookup tuple when given { urn, cid }", async () => {
    const fetchMock = fetchReturning(
      jsonResponse({ valid: true, signature_verified: true, hash_match: true }),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await client.verifyReceipt({ urn: "urn:atlas:receipt:rec_1", cid: "bafkreireceipt" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      urn: "urn:atlas:receipt:rec_1",
      cid: "bafkreireceipt",
    });
  });
});

describe("createAtlasManagedClient — settle", () => {
  it("serializes bigint amounts to strings and POSTs the snake_cased body", async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        paymentId: "0xabcd",
        chain: "base",
        txHash: "0xdeadbeef",
        status: "submitted",
        explorerUrl: null,
      }),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const out = await client.settle({
      platformDomain: "atlas.bjc.events",
      chain: "base",
      organizer: "0x" + "1".repeat(40),
      totalAmount: 50_000_000n,
      paymentId: "0x" + "2".repeat(64),
      platformFees: [
        { recipient: "0x" + "3".repeat(40), amount: 1_000_000n },
        { recipient: "0x" + "4".repeat(40), amount: "500000" },
      ],
    });

    expect(out.status).toBe("submitted");
    expect(out.paymentId).toBe("0xabcd");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/atlas/v1/settlements/settle`);
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent["total_amount"]).toBe("50000000");
    expect(sent["platform_fees"]).toEqual([
      { recipient: "0x" + "3".repeat(40), amount: "1000000" },
      { recipient: "0x" + "4".repeat(40), amount: "500000" },
    ]);
    expect(sent["payment_id"]).toBe("0x" + "2".repeat(64));
    expect(sent["platform_domain"]).toBe("atlas.bjc.events");
    expect(sent["chain"]).toBe("base");
    expect(sent["organizer"]).toBe("0x" + "1".repeat(40));
  });
});

describe("createAtlasManagedClient — recordRewards", () => {
  it("serializes recipients (bigint → string) and POSTs", async () => {
    const fetchMock = fetchReturning(
      jsonResponse({
        paymentId: "0xabcd",
        chain: "base",
        txHashes: ["0xtx1"],
        status: "submitted",
      }),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const out = await client.recordRewards({
      platformDomain: "atlas.bjc.events",
      paymentId: "0x" + "2".repeat(64),
      recipients: [
        { recipient: "0x" + "5".repeat(40), kind: "organizer", amount: 600_000n },
        { recipient: "0x" + "6".repeat(40), kind: "attendee", amount: "200000" },
        { recipient: "0x" + "7".repeat(40), kind: "referral", amount: 100_000n },
      ],
    });

    expect(out.txHashes).toEqual(["0xtx1"]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/atlas/v1/rewards/record`);
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent["payment_id"]).toBe("0x" + "2".repeat(64));
    expect(sent["recipients"]).toEqual([
      { recipient: "0x" + "5".repeat(40), kind: "organizer", amount: "600000" },
      { recipient: "0x" + "6".repeat(40), kind: "attendee", amount: "200000" },
      { recipient: "0x" + "7".repeat(40), kind: "referral", amount: "100000" },
    ]);
  });
});

describe("createAtlasManagedClient — error handling", () => {
  it("4xx → AtlasManagedRequestError with parsed code + message", async () => {
    const fetchMock = fetchReturning(
      new Response(
        JSON.stringify({
          error: {
            code: "validation_failed",
            message: "totalAmount must be a string of digits",
            details: { field: "total_amount" },
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await expect(
      client.settle({
        platformDomain: "atlas.bjc.events",
        chain: "base",
        organizer: "0x" + "1".repeat(40),
        totalAmount: "0",
        paymentId: "0x" + "2".repeat(64),
        platformFees: [],
      }),
    ).rejects.toMatchObject({
      name: "AtlasManagedRequestError",
      status: 400,
      code: "validation_failed",
      message: "totalAmount must be a string of digits",
      details: { field: "total_amount" },
    });
  });

  it("5xx → AtlasManagedServerError", async () => {
    const fetchMock = fetchReturning(
      new Response(
        JSON.stringify({
          error: { code: "internal_error", message: "RPC unavailable" },
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const promise = client.pinReceipt(makeReceipt());
    await expect(promise).rejects.toBeInstanceOf(AtlasManagedServerError);
    await expect(promise).rejects.toMatchObject({
      status: 503,
      code: "internal_error",
      message: "RPC unavailable",
    });
  });

  it("falls back to HTTP status text when the error body is not JSON", async () => {
    const fetchMock = fetchReturning(
      new Response("Bad Gateway", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await expect(client.pinReceipt(makeReceipt())).rejects.toMatchObject({
      name: "AtlasManagedServerError",
      status: 502,
      code: "http_502",
    });
  });

  it("network error → AtlasManagedNetworkError", async () => {
    const fetchMock = vi.fn((): Promise<Response> => Promise.reject(new TypeError("fetch failed")));
    const client = createAtlasManagedClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
    });

    const promise = client.pinReceipt(makeReceipt());
    await expect(promise).rejects.toBeInstanceOf(AtlasManagedNetworkError);
    await expect(promise).rejects.toMatchObject({
      status: 0,
      code: "network_error",
    });
  });

  it("timeout → AtlasManagedNetworkError with code request_timeout", async () => {
    // Mock fetch that never resolves until the AbortController fires.
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted.");
              err.name = "AbortError";
              reject(err);
            });
          }
        }),
    );
    const client = createAtlasManagedClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
      timeoutMs: 25,
    });

    const promise = client.pinReceipt(makeReceipt());
    await expect(promise).rejects.toMatchObject({
      name: "AtlasManagedNetworkError",
      code: "request_timeout",
    });
  });
});

describe("createAtlasManagedClient — Authorization header", () => {
  it("attaches Authorization: Bearer <token> when platformAuthToken is set", async () => {
    const fetchMock = fetchReturning(jsonResponse({ urn: "u", cid: "c", pinned_at: "t" }));
    const client = createAtlasManagedClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
      platformAuthToken: "tkn_abc123",
    });

    await client.pinReceipt(makeReceipt());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tkn_abc123");
  });

  it("omits Authorization when platformAuthToken is not set", async () => {
    const fetchMock = fetchReturning(jsonResponse({ urn: "u", cid: "c", pinned_at: "t" }));
    const client = createAtlasManagedClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await client.pinReceipt(makeReceipt());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });
});

describe("createAtlasManagedClient — base URL handling", () => {
  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = fetchReturning(jsonResponse({ urn: "u", cid: "c", pinned_at: "t" }));
    const client = createAtlasManagedClient({
      baseUrl: `${BASE_URL}/`,
      fetch: fetchMock,
    });

    await client.pinReceipt(makeReceipt());
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/atlas/v1/receipts/pin`);
  });
});
