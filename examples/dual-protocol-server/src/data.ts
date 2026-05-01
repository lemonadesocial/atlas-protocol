/**
 * In-memory event store + idempotent hold map. Stands in for whatever
 * persistent database a real event platform would use — Postgres / MySQL /
 * Mongo / etc. The protocol does NOT prescribe storage; the platform IS
 * the source of truth for its own events.
 */

import { randomUUID } from "node:crypto";

export interface DemoTicketType {
  id: string;
  title: string;
  description?: string;
  /** Face-value price in USD micros (6 decimals — 12_500_000 = $12.50). */
  priceUsdMicros: bigint;
  available: number;
}

export interface DemoEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  location: string;
  city: string;
  description: string;
  organizer_id: string;
  /** Categories used by /atlas/v1/search. */
  categories: string[];
  ticketTypes: DemoTicketType[];
}

/** Hardcoded event store — three events across three cities. */
export const DEMO_EVENTS: DemoEvent[] = [
  {
    id: "evt_jazz_brooklyn_001",
    title: "Late Night Jazz at Nublu",
    start: "2026-06-15T21:00:00-04:00",
    end: "2026-06-16T01:00:00-04:00",
    location: "Nublu, 151 Avenue C, New York, NY 10009",
    city: "Brooklyn",
    description: "An intimate jazz night at one of NYC's longest-running music venues.",
    organizer_id: "org_bjc_2026",
    categories: ["music", "jazz", "nightlife"],
    ticketTypes: [
      {
        id: "tt_ga_001",
        title: "General Admission",
        description: "Standard entry. Doors open at 9 PM.",
        priceUsdMicros: 25_000_000n,
        available: 47,
      },
    ],
  },
  {
    id: "evt_techno_berlin_002",
    title: "Berghain Klubnacht",
    start: "2026-07-04T23:00:00+02:00",
    end: "2026-07-06T12:00:00+02:00",
    location: "Berghain, Am Wriezener Bahnhof, 10243 Berlin",
    city: "Berlin",
    description: "All-night techno across two floors. Strict door, no cameras.",
    organizer_id: "org_bgh_2026",
    categories: ["music", "techno", "club"],
    ticketTypes: [
      {
        id: "tt_ga_002",
        title: "General Admission",
        priceUsdMicros: 30_000_000n,
        available: 200,
      },
    ],
  },
  {
    id: "evt_speaker_tokyo_003",
    title: "Founders & Builders Tokyo",
    start: "2026-08-22T18:30:00+09:00",
    end: "2026-08-22T22:00:00+09:00",
    location: "Roppongi Hills, Tokyo",
    city: "Tokyo",
    description: "Curated talks from APAC AI founders + open networking.",
    organizer_id: "org_fbt_2026",
    categories: ["talks", "tech", "networking"],
    ticketTypes: [
      {
        id: "tt_ga_003",
        title: "Standard",
        priceUsdMicros: 50_000_000n,
        available: 80,
      },
      {
        id: "tt_vip_003",
        title: "VIP (front-row + dinner)",
        priceUsdMicros: 200_000_000n,
        available: 12,
      },
    ],
  },
];

export function findEvent(id: string): DemoEvent | undefined {
  return DEMO_EVENTS.find((e) => e.id === id);
}

export function findTicketType(event: DemoEvent, ticketTypeId: string): DemoTicketType | undefined {
  return event.ticketTypes.find((t) => t.id === ticketTypeId);
}

/**
 * In-memory hold store. Each hold maps to one event/ticket-type/quantity and
 * has an expiry. A hold's `challengeId` doubles as the MPP envelope's
 * `paymentId` so we can correlate retries.
 */
export interface DemoHold {
  holdId: string;
  challengeId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  amountUsdMicros: bigint;
  expiresAt: string;
  /** Set after the buyer presents a credential the verifier accepts. */
  settledAt?: string;
  settledRail?: "x402" | "stripe-mpp";
  settledTxHash?: string;
  settledPaymentIntentId?: string;
}

const holds = new Map<string, DemoHold>();
const idempotencyByKey = new Map<string, string>(); // idempotency-key -> holdId

export function lookupOrCreateHold(args: {
  idempotencyKey?: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  amountUsdMicros: bigint;
}): DemoHold {
  if (args.idempotencyKey) {
    const existingId = idempotencyByKey.get(args.idempotencyKey);
    if (existingId) {
      const existing = holds.get(existingId);
      if (existing) return existing;
    }
  }

  const holdId = `hold_${randomUUID().slice(0, 8)}`;
  const challengeId = `ch_${holdId}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const hold: DemoHold = {
    holdId,
    challengeId,
    eventId: args.eventId,
    ticketTypeId: args.ticketTypeId,
    quantity: args.quantity,
    amountUsdMicros: args.amountUsdMicros,
    expiresAt,
  };
  holds.set(holdId, hold);
  if (args.idempotencyKey) idempotencyByKey.set(args.idempotencyKey, holdId);
  return hold;
}

export function getHold(holdId: string): DemoHold | undefined {
  return holds.get(holdId);
}

export function markSettled(
  holdId: string,
  rail: "x402" | "stripe-mpp",
  ref: { txHash?: string; paymentIntentId?: string },
): DemoHold | undefined {
  const hold = holds.get(holdId);
  if (!hold) return undefined;
  hold.settledAt = new Date().toISOString();
  hold.settledRail = rail;
  if (ref.txHash) hold.settledTxHash = ref.txHash;
  if (ref.paymentIntentId) hold.settledPaymentIntentId = ref.paymentIntentId;
  return hold;
}
