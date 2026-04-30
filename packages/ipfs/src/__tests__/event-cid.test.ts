import { describe, expect, it } from "vitest";
import type { AtlasEvent } from "@atlasprotocol/server-sdk";

import { generateEventCid } from "../event-cid.js";

function makeEvent(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  const base: AtlasEvent = {
    "@context": { "@vocab": "https://schema.org/", atlas: "https://atlas.dev/vocab#" },
    "@type": "Event",
    "@id": "https://example.com/events/abc",
    name: "Atlas Launch Party",
    description: "A launch.",
    startDate: "2026-05-01T18:00:00.000Z",
    location: {
      "@type": "Place",
      name: "Venue",
    },
    organizer: { "@type": "Organization", name: "Atlas" },
    eventStatus: "EventScheduled",
    eventAttendanceMode: "OfflineEventAttendanceMode",
    "atlas:id": "atlas-1",
    "atlas:source_platform": "lemonade",
    "atlas:source_event_id": "src-1",
    "atlas:organizer_id": "org-1",
    "atlas:organizer_verified": true,
    "atlas:categories": ["music"],
    "atlas:tags": ["launch"],
    "atlas:availability": "available",
    "atlas:price_range": { min_price: 10, max_price: 50, currency: "USD", includes_fees: true },
    "atlas:ticket_types_count": 2,
    "atlas:purchase_endpoint": "https://example.com/purchase",
    "atlas:currency": "USD",
    "atlas:accepts_payment_methods": ["tempo_usdc"],
    "atlas:last_synced": "2026-04-30T00:00:00.000Z",
    "atlas:created_at": "2026-04-01T00:00:00.000Z",
    "atlas:updated_at": "2026-04-30T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}

describe("generateEventCid", () => {
  it("returns the same CID for equivalent events with reordered keys", async () => {
    const eventA = makeEvent();
    // Build an alternate object with a different key insertion order but
    // identical logical contents.
    const eventB: AtlasEvent = JSON.parse(JSON.stringify(eventA)) as AtlasEvent;
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(eventB).reverse()) {
      reordered[key] = eventB[key];
    }
    const cidA = await generateEventCid(eventA);
    const cidB = await generateEventCid(reordered as unknown as AtlasEvent);
    expect(cidA).toBe(cidB);
  });

  it("returns different CIDs for events that differ in content", async () => {
    const cidA = await generateEventCid(makeEvent());
    const cidB = await generateEventCid(makeEvent({ name: "Different name" }));
    expect(cidA).not.toBe(cidB);
  });

  it("produces a base32-lowercase bafkrei... CID", async () => {
    const cid = await generateEventCid(makeEvent());
    expect(cid.startsWith("bafkrei")).toBe(true);
  });
});
