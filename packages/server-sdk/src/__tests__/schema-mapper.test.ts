import { describe, expect, it } from "vitest";

import {
  centsToDollars,
  toAtlasEvent,
  toAtlasTicketType,
  toHumanAmount,
  type AtlasInputEvent,
  type AtlasInputSpace,
  type AtlasInputTicketType,
  type MapEventOptions,
  type MapTicketTypeOptions,
} from "../schema-mapper.js";

const EVENT_OPTIONS: MapEventOptions = {
  sourcePlatform: "lemonade",
  platformUrl: "https://app.lemonade.social",
  baseUrl: "https://api.example.com",
  acceptedPaymentMethods: ["tempo_usdc", "base_usdc", "stripe_spt"],
};

const TICKET_OPTIONS: MapTicketTypeOptions = {
  platformFeePercent: 3.5,
  acceptedPaymentMethods: ["tempo_usdc", "base_usdc", "stripe_spt"],
};

let counter = 0;
function uniqueId(): string {
  counter += 1;
  return `id-${counter.toString().padStart(8, "0")}`;
}

function makeEvent(overrides: Partial<AtlasInputEvent> = {}): AtlasInputEvent {
  return {
    id: uniqueId(),
    title: "Test Event",
    slug: "test-event",
    description: "<p>HTML desc</p>",
    description_plain_text: "Plain desc",
    start: new Date("2026-06-01T18:00:00Z"),
    end: new Date("2026-06-01T22:00:00Z"),
    state: "active",
    cover: "https://cdn.example.com/cover.jpg",
    virtual: false,
    address: {
      street_1: "123 Main St",
      city: "Miami",
      region: "FL",
      postal: "33101",
      country: "US",
    },
    location: { type: "Point", coordinates: [-80.19, 25.76] },
    currency: "USD",
    updated_at: new Date("2026-05-20T12:00:00Z"),
    ...overrides,
  };
}

function makeSpace(overrides: Partial<AtlasInputSpace> = {}): AtlasInputSpace {
  return {
    id: uniqueId(),
    title: "Test Org",
    slug: "test-org",
    ...overrides,
  };
}

function makeTicket(overrides: Partial<AtlasInputTicketType> = {}): AtlasInputTicketType {
  return {
    id: uniqueId(),
    title: "General Admission",
    active: true,
    private: false,
    prices: [{ default: true, currency: "USD", cost: "5000" }],
    ticket_limit: 100,
    ticket_count: 10,
    ...overrides,
  };
}

describe("centsToDollars", () => {
  it("converts cents string to dollars", () => {
    expect(centsToDollars("5000")).toBe(50);
  });

  it("handles zero", () => {
    expect(centsToDollars("0")).toBe(0);
  });

  it("handles fractional values", () => {
    expect(centsToDollars("199")).toBe(1.99);
  });

  it("returns 0 for invalid input", () => {
    expect(centsToDollars("not-a-number")).toBe(0);
  });
});

describe("toHumanAmount", () => {
  it("handles fiat (USD) cents", () => {
    expect(toHumanAmount("5000", "USD")).toBe(50);
  });

  it("handles JPY (0 decimals)", () => {
    expect(toHumanAmount("5000", "JPY")).toBe(5000);
  });

  it("handles USDC (6 decimals)", () => {
    expect(toHumanAmount("5000000", "USDC")).toBe(5);
  });

  it("returns 0 for empty/invalid input", () => {
    expect(toHumanAmount("", "USD")).toBe(0);
    expect(toHumanAmount("xx", "USD")).toBe(0);
  });
});

describe("toAtlasTicketType — fee calculation", () => {
  it("includes 2% protocol fee by default", () => {
    const tt = makeTicket({ prices: [{ default: true, currency: "USD", cost: "10000" }] });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, TICKET_OPTIONS);

    const protocolFee = result["atlas:pricing"].fees.find((f) => f.name === "atlas_protocol_fee");
    expect(protocolFee?.rate).toBe(2);
    expect(protocolFee?.amount).toBe(2);
  });

  it("includes platform fee at the configured percent", () => {
    const tt = makeTicket({ prices: [{ default: true, currency: "USD", cost: "10000" }] });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, { ...TICKET_OPTIONS, platformFeePercent: 5 });

    const platformFee = result["atlas:pricing"].fees.find((f) => f.name === "platform_fee");
    expect(platformFee?.rate).toBe(5);
    expect(platformFee?.amount).toBe(5);
  });

  it("includes the payment processing fixed fee", () => {
    const tt = makeTicket({ prices: [{ default: true, currency: "USD", cost: "10000" }] });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, TICKET_OPTIONS);

    const processing = result["atlas:pricing"].fees.find((f) => f.name === "payment_processing");
    expect(processing?.amount).toBe(0.001);
  });

  it("computes total_price as base + all fees", () => {
    const tt = makeTicket({ prices: [{ default: true, currency: "USD", cost: "10000" }] });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, TICKET_OPTIONS);

    const expected = 100 + (2 + 3.5 + 0.001);
    expect(result["atlas:pricing"].total_price).toBe(expected);
  });

  it("emits empty fees for free tickets", () => {
    const tt = makeTicket({ prices: [{ default: true, currency: "USD", cost: "0" }] });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, TICKET_OPTIONS);

    expect(result["atlas:pricing"].fees).toEqual([]);
    expect(result["atlas:pricing"].total_price).toBe(0);
  });
});

describe("toAtlasTicketType — availability", () => {
  it("marks sold_out when remaining is 0", () => {
    const tt = makeTicket({ ticket_limit: 100, ticket_count: 100 });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, TICKET_OPTIONS);

    expect(result["atlas:availability"].status).toBe("sold_out");
  });

  it("marks few_remaining when under 10% left", () => {
    const tt = makeTicket({ ticket_limit: 100, ticket_count: 95 });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, TICKET_OPTIONS);

    expect(result["atlas:availability"].status).toBe("few_remaining");
  });

  it("marks not_on_sale when inactive", () => {
    const tt = makeTicket({ active: false });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, TICKET_OPTIONS);

    expect(result["atlas:availability"].status).toBe("not_on_sale");
  });

  it("marks hidden when private", () => {
    const tt = makeTicket({ private: true });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, TICKET_OPTIONS);

    expect(result["atlas:availability"].status).toBe("hidden");
  });

  it("marks available when plenty remain", () => {
    const tt = makeTicket({ ticket_limit: 100, ticket_count: 10 });
    const event = makeEvent();
    const result = toAtlasTicketType(tt, event, TICKET_OPTIONS);

    expect(result["atlas:availability"].status).toBe("available");
  });
});

describe("toAtlasEvent — price range", () => {
  it("computes min and max from active non-private ticket types", () => {
    const tt1 = makeTicket({ prices: [{ default: true, currency: "USD", cost: "2000" }] });
    const tt2 = makeTicket({ prices: [{ default: true, currency: "USD", cost: "8000" }] });
    const event = makeEvent();
    const space = makeSpace();

    const result = toAtlasEvent(event, space, [tt1, tt2], EVENT_OPTIONS);

    expect(result["atlas:price_range"].min_price).toBe(20);
    expect(result["atlas:price_range"].max_price).toBe(80);
  });

  it("excludes private and inactive ticket types", () => {
    const visible = makeTicket({ prices: [{ default: true, currency: "USD", cost: "5000" }] });
    const privateOne = makeTicket({
      private: true,
      prices: [{ default: true, currency: "USD", cost: "1000" }],
    });
    const inactive = makeTicket({
      active: false,
      prices: [{ default: true, currency: "USD", cost: "500" }],
    });
    const event = makeEvent();
    const space = makeSpace();

    const result = toAtlasEvent(event, space, [visible, privateOne, inactive], EVENT_OPTIONS);

    expect(result["atlas:price_range"].min_price).toBe(50);
    expect(result["atlas:price_range"].max_price).toBe(50);
  });

  it("defaults min/max to 0 when no ticket types exist", () => {
    const result = toAtlasEvent(makeEvent(), makeSpace(), [], EVENT_OPTIONS);

    expect(result["atlas:price_range"].min_price).toBe(0);
    expect(result["atlas:price_range"].max_price).toBe(0);
  });
});

describe("toAtlasEvent — event status mapping", () => {
  it("maps cancelled to EventCancelled", () => {
    const result = toAtlasEvent(makeEvent({ state: "cancelled" }), makeSpace(), [], EVENT_OPTIONS);
    expect(result.eventStatus).toBe("EventCancelled");
  });

  it("maps ended to EventEnded", () => {
    const result = toAtlasEvent(makeEvent({ state: "ended" }), makeSpace(), [], EVENT_OPTIONS);
    expect(result.eventStatus).toBe("EventEnded");
  });

  it("defaults to EventScheduled", () => {
    const result = toAtlasEvent(makeEvent({ state: "active" }), makeSpace(), [], EVENT_OPTIONS);
    expect(result.eventStatus).toBe("EventScheduled");
  });
});

describe("toAtlasEvent — currency", () => {
  it("uses event currency when provided", () => {
    const result = toAtlasEvent(makeEvent({ currency: "EUR" }), makeSpace(), [], EVENT_OPTIONS);
    expect(result["atlas:currency"]).toBe("EUR");
    expect(result["atlas:price_range"].currency).toBe("EUR");
  });

  it("defaults to USD when omitted", () => {
    const event = makeEvent();
    delete event.currency;
    const result = toAtlasEvent(event, makeSpace(), [], EVENT_OPTIONS);
    expect(result["atlas:currency"]).toBe("USD");
  });
});

describe("toAtlasEvent — structure", () => {
  it("produces a valid JSON-LD context", () => {
    const result = toAtlasEvent(makeEvent(), makeSpace(), [], EVENT_OPTIONS);

    expect(result["@context"]).toEqual({
      "@vocab": "https://schema.org/",
      atlas: "https://atlas-protocol.org/v1/vocab#",
    });
    expect(result["@type"]).toBe("Event");
  });

  it("sets attendance mode + location for virtual events", () => {
    const event = makeEvent({ virtual: true, virtual_url: "https://zoom.us/j/123" });
    const result = toAtlasEvent(event, makeSpace(), [], EVENT_OPTIONS);

    expect(result.eventAttendanceMode).toBe("OnlineEventAttendanceMode");
    expect(result.location["@type"]).toBe("VirtualLocation");
  });

  it("sets attendance mode + location for physical events", () => {
    const result = toAtlasEvent(makeEvent({ virtual: false }), makeSpace(), [], EVENT_OPTIONS);

    expect(result.eventAttendanceMode).toBe("OfflineEventAttendanceMode");
    expect(result.location["@type"]).toBe("Place");
  });

  it("builds purchase endpoint from baseUrl", () => {
    const event = makeEvent();
    const result = toAtlasEvent(event, makeSpace(), [], EVENT_OPTIONS);

    expect(result["atlas:purchase_endpoint"]).toBe(
      `https://api.example.com/atlas/v1/events/${event.id}/purchase`,
    );
  });

  it("emits a stable deterministic atlas:id for the same source id", () => {
    const event = makeEvent({ id: "fixed-event-id" });
    const r1 = toAtlasEvent(event, makeSpace({ id: "s1" }), [], EVENT_OPTIONS);
    const r2 = toAtlasEvent(event, makeSpace({ id: "s2" }), [], EVENT_OPTIONS);

    expect(r1["atlas:id"]).toBe(r2["atlas:id"]);
    expect(r1["atlas:id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
