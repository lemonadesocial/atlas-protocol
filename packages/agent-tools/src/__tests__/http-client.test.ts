import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAtlasHttpClient } from "../http-client.js";
import type { AtlasToolsConfig } from "../config.js";

const baseConfig: AtlasToolsConfig = {
  registryUrl: "https://registry.test",
  backendUrl: "https://backend.test",
  agentId: "agent:test",
};

describe("http-client", () => {
  describe("module exports", () => {
    it("createAtlasHttpClient returns request + registrySearch", () => {
      const client = createAtlasHttpClient(baseConfig);
      expect(typeof client.request).toBe("function");
      expect(typeof client.registrySearch).toBe("function");
    });
  });

  describe("request", () => {
    it("throws when target URL is empty", async () => {
      const client = createAtlasHttpClient({ ...baseConfig, registryUrl: "" });
      await expect(client.request({ path: "/test", target: "registry" })).rejects.toThrow(
        "not configured",
      );
    });
  });

  describe("registrySearch failure path", () => {
    it("returns empty results on failure when registry URL is empty", async () => {
      const client = createAtlasHttpClient({ ...baseConfig, registryUrl: "" });
      const result = await client.registrySearch({ q: "test" });
      expect(result.status).toBe(503);
      expect((result.data as { items: unknown[] }).items).toEqual([]);
      expect((result.data as { degraded: boolean }).degraded).toBe(true);
    });
  });
});

describe("atlas tool flows", () => {
  const originalFetch = globalThis.fetch;

  function urlToString(input: string | URL | Request): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  function mockFetch(
    handler: (url: string, init?: RequestInit) => { status: number; body: unknown },
  ): void {
    globalThis.fetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const result = handler(urlToString(url), init);
      return Promise.resolve({
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: () => Promise.resolve(result.body),
        text: () => Promise.resolve(JSON.stringify(result.body)),
        headers: new Headers(),
      } as Response);
    };
  }

  beforeEach(() => {
    // ensure each test sets its own mock
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("atlas_search", () => {
    it("passes query params and returns search results", async () => {
      const searchData = {
        items: [
          {
            id: "evt_1",
            title: "Techno Night",
            start: "2026-04-01T22:00:00Z",
            source: "lemonade",
          },
          {
            id: "evt_2",
            title: "Jazz Evening",
            start: "2026-04-02T19:00:00Z",
            source: "eventbrite",
          },
        ],
        cursor: "next_page_token",
        total: 42,
        sources: ["lemonade", "eventbrite"],
      };

      mockFetch((url) => {
        expect(url).toContain("/atlas/v1/search");
        expect(url).toContain("q=techno");
        return { status: 200, body: searchData };
      });

      const client = createAtlasHttpClient(baseConfig);
      const result = await client.registrySearch({ q: "techno", limit: 10 });
      expect(result.status).toBe(200);
      const data = result.data as typeof searchData;
      expect(data.items.length).toBe(2);
      expect(data.total).toBe(42);
      expect(data.cursor).toBe("next_page_token");
    });
  });

  describe("atlas_purchase (free ticket)", () => {
    it("returns redirect URL for free events (200 + completed)", async () => {
      mockFetch((url) => {
        if (url.includes("/purchase")) {
          return {
            status: 200,
            body: {
              hold_id: "hold_free_123",
              status: "completed",
              redirect_url: "https://example.test/e/free-event/register",
            },
          };
        }
        return { status: 404, body: { error: "not found" } };
      });

      const client = createAtlasHttpClient(baseConfig);
      const response = await client.request({
        method: "POST",
        path: "/atlas/v1/events/evt_1/purchase",
        target: "backend",
        headers: { Authorization: "Bearer test_token" },
        body: { ticket_type_id: "tt_1", quantity: 1 },
      });

      expect(response.status).toBe(200);
      const data = response.data as Record<string, unknown>;
      expect(data["status"]).toBe("completed");
      expect(String(data["redirect_url"])).toContain("free-event");
    });
  });

  describe("atlas_purchase (paid event, 402 challenge)", () => {
    it("returns 402 challenge then generates checkout URL", async () => {
      let callCount = 0;
      mockFetch((url) => {
        callCount++;
        if (url.includes("/purchase")) {
          return {
            status: 402,
            body: {
              hold_id: "hold_paid_456",
              amount: 36.0,
              currency: "EUR",
              payment_methods: ["stripe_card", "tempo_usdc"],
              expires_at: "2026-04-01T12:05:00Z",
            },
          };
        }
        if (url.includes("/holds/hold_paid_456/checkout")) {
          return {
            status: 200,
            body: {
              checkout_url: "https://checkout.example.test/pay/cs_test_xxx",
              expires_at: "2026-04-01T12:10:00Z",
            },
          };
        }
        return { status: 404, body: { error: "not found" } };
      });

      const client = createAtlasHttpClient(baseConfig);

      const purchaseResponse = await client.request({
        method: "POST",
        path: "/atlas/v1/events/evt_2/purchase",
        target: "backend",
        headers: { Authorization: "Bearer test_token" },
        body: { ticket_type_id: "tt_2", quantity: 2 },
      });
      expect(purchaseResponse.status).toBe(402);
      expect((purchaseResponse.data as Record<string, unknown>)["hold_id"]).toBe("hold_paid_456");

      const checkoutResponse = await client.request({
        method: "POST",
        path: "/atlas/v1/holds/hold_paid_456/checkout",
        target: "backend",
        headers: { Authorization: "Bearer test_token" },
      });
      expect(checkoutResponse.status).toBe(200);
      expect(String((checkoutResponse.data as Record<string, unknown>)["checkout_url"])).toContain(
        "checkout.example.test",
      );
      expect(callCount).toBe(2);
    });
  });

  describe("atlas_get_receipt", () => {
    it("returns pending status while payment is processing", async () => {
      mockFetch((url) => {
        if (url.includes("/receipts/by-hold/hold_pending")) {
          return { status: 200, body: { status: "pending" } };
        }
        return { status: 404, body: {} };
      });

      const client = createAtlasHttpClient(baseConfig);
      const response = await client.request({
        method: "GET",
        path: "/atlas/v1/receipts/by-hold/hold_pending",
        target: "backend",
        headers: { Authorization: "Bearer test_token" },
      });
      expect((response.data as Record<string, unknown>)["status"]).toBe("pending");
    });

    it("returns completed status with receipt details", async () => {
      const receipt = {
        status: "completed",
        receipt: {
          purchase_id: "pur_xyz789",
          credentials: [{ attendee_name: "Alice", event_title: "Tresor: Pulse" }],
          payment: {
            method: "tempo_usdc",
            amount: 38.52,
            currency: "USDC",
            transaction_id: "0xabc123",
          },
          purchased_at: "2026-04-01T11:42:18Z",
          reward_info: { cashback_earned: "0.10", cashback_currency: "USDC" },
        },
      };

      mockFetch((url) => {
        if (url.includes("/receipts/by-hold/hold_done")) {
          return { status: 200, body: receipt };
        }
        return { status: 404, body: {} };
      });

      const client = createAtlasHttpClient(baseConfig);
      const response = await client.request({
        method: "GET",
        path: "/atlas/v1/receipts/by-hold/hold_done",
        target: "backend",
        headers: { Authorization: "Bearer test_token" },
      });
      const data = response.data as Record<string, unknown>;
      expect(data["status"]).toBe("completed");
      expect(data["receipt"]).toBeTruthy();
      const receiptData = data["receipt"] as Record<string, unknown>;
      expect(receiptData["purchase_id"]).toBe("pur_xyz789");
      expect((receiptData["reward_info"] as Record<string, unknown>)["cashback_earned"]).toBe(
        "0.10",
      );
    });
  });

  describe("error handling", () => {
    it("throws on 4XX errors", async () => {
      mockFetch(() => ({
        status: 422,
        body: { error: { code: "INVALID_REQUEST", message: "bad input" } },
      }));

      const client = createAtlasHttpClient(baseConfig);
      await expect(
        client.request({
          method: "POST",
          path: "/atlas/v1/events/bad/purchase",
          target: "backend",
        }),
      ).rejects.toThrow(/returned 422/);
    });
  });

  describe("apiKey injection", () => {
    it("attaches Bearer token from apiKey when caller does not set Authorization", async () => {
      let seenAuth: string | null = null;
      mockFetch((_url, init) => {
        const headers = (init?.headers as Record<string, string>) ?? {};
        seenAuth = headers["Authorization"] ?? headers["authorization"] ?? null;
        return { status: 200, body: { ok: true } };
      });

      const client = createAtlasHttpClient({ ...baseConfig, apiKey: "sekret" });
      await client.request({ path: "/atlas/v1/ping", target: "registry" });
      expect(seenAuth).toBe("Bearer sekret");
    });
  });
});
