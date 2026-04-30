import { describe, expect, it, vi } from "vitest";

import {
  AuthExpiredError,
  RateLimitError,
  type AuthContext,
} from "@atlasprotocol/connector-framework";

import { EventbriteConnector } from "../index.js";
import type { EventbriteEvent, EventbriteTicketClass } from "../api.js";

const OAUTH: AuthContext = { type: "oauth2", accessToken: "token-abc" };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function errorResponse(status: number, body: string, headers?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain", ...(headers ?? {}) },
  });
}

const SAMPLE_EVENT: EventbriteEvent = {
  id: "ev-1",
  name: { text: "Sample" },
  description: { text: "desc" },
  start: { utc: "2026-06-01T00:00:00Z" },
  end: { utc: "2026-06-01T02:00:00Z" },
  status: "live",
  currency: "USD",
  online_event: false,
  organizer: { id: "org-1", name: "Org One" },
  venue: { name: "Place", latitude: "1", longitude: "2", address: { city: "NYC" } },
};

const SAMPLE_TICKET: EventbriteTicketClass = {
  id: "tc-1",
  name: "GA",
  cost: { value: 1000, currency: "USD" },
  fee: { value: 100, currency: "USD" },
  quantity_total: 50,
  quantity_sold: 10,
  on_sale_status: "AVAILABLE",
};

describe("EventbriteConnector", () => {
  it("search() returns AtlasEvent[] and forwards filters to the API", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/v3/users/me/events/");
      expect(u.searchParams.get("name_filter")).toBe("jazz");
      expect(u.searchParams.get("start_date.range_start")).toBeTruthy();
      expect(u.searchParams.get("page_size")).toBe("25");
      return jsonResponse({ events: [SAMPLE_EVENT, { ...SAMPLE_EVENT, id: "ev-2" }] });
    });

    const connector = new EventbriteConnector({
      baseUrl: "https://atlas.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const events = await connector.search(
      {
        query: "jazz",
        startDate: new Date("2026-06-01T00:00:00Z"),
        limit: 25,
      },
      OAUTH,
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.["@id"]).toBe("atlas:eventbrite:ev-1");
    expect(events[1]?.["@id"]).toBe("atlas:eventbrite:ev-2");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("getEvent() returns an AtlasEvent on 200", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/v3/events/ev-1/");
      return jsonResponse(SAMPLE_EVENT);
    });

    const connector = new EventbriteConnector({
      baseUrl: "https://atlas.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await connector.getEvent("ev-1", OAUTH);
    expect(result).not.toBeNull();
    expect(result?.["atlas:source_event_id"]).toBe("ev-1");
  });

  it("getEvent() returns null on 404 instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(404, JSON.stringify({ error: "NOT_FOUND" })));
    const connector = new EventbriteConnector({
      baseUrl: "https://atlas.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await connector.getEvent("missing", OAUTH);
    expect(result).toBeNull();
  });

  it("throws AuthExpiredError on 401", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(401, "unauthorized"));
    const connector = new EventbriteConnector({
      baseUrl: "https://atlas.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(connector.getEvent("ev-1", OAUTH)).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it("throws RateLimitError with retryAfterSeconds on 429", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(429, "too many", { "retry-after": "37" }));
    const connector = new EventbriteConnector({
      baseUrl: "https://atlas.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    try {
      await connector.search({}, OAUTH);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterSeconds).toBe(37);
    }
  });

  it("listTicketTypes() returns AtlasTicketType[]", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/v3/events/ev-1/ticket_classes/");
      return jsonResponse({ ticket_classes: [SAMPLE_TICKET, { ...SAMPLE_TICKET, id: "tc-2" }] });
    });

    const connector = new EventbriteConnector({
      baseUrl: "https://atlas.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const tickets = await connector.listTicketTypes("ev-1", OAUTH);
    expect(tickets).toHaveLength(2);
    expect(tickets[0]?.["atlas:ticket_type_id"]).toBe("atlas:eventbrite:ev-1:tc-1");
    expect(tickets[1]?.["atlas:ticket_type_id"]).toBe("atlas:eventbrite:ev-1:tc-2");
    expect(tickets[0]?.["atlas:pricing"].base_price).toBe(1000);
    expect(tickets[0]?.["atlas:availability"].status).toBe("available");
  });

  it("rejects non-oauth2 auth contexts", async () => {
    const connector = new EventbriteConnector({
      baseUrl: "https://atlas.example.com",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(connector.search({}, { type: "apikey", apiKey: "k" })).rejects.toBeInstanceOf(
      AuthExpiredError,
    );
  });

  it("exposes correct id, name, authMethod and capabilities", () => {
    const connector = new EventbriteConnector({ baseUrl: "https://atlas.example.com" });
    expect(connector.id).toBe("eventbrite");
    expect(connector.name).toBe("Eventbrite");
    expect(connector.authMethod).toBe("oauth2");
    expect(connector.capabilities).toEqual({
      search: true,
      getEvent: true,
      listTicketTypes: true,
      realtime: false,
    });
  });
});
