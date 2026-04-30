import { randomUUID } from "node:crypto";

/**
 * Local row shape backing the in-memory mock store. Holds both the rendering
 * fields and the inputs needed by `toAtlasEvent` from @atlasprotocol/server-sdk.
 */
export interface StoredEvent {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  city: string;
  country: string;
  ticketPriceUsd: number;
  maxAttendees: number;
  ticketTypeId: string;
  ticketTypeTitle: string;
  spaceId: string;
  spaceTitle: string;
  spaceSlug: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  start: string;
  end: string;
  city: string;
  country?: string;
  ticketPriceUsd: number;
  maxAttendees: number;
}

const DEFAULT_SPACE_ID = "demo-space";
const DEFAULT_SPACE_TITLE = "Demo Organizer Space";
const DEFAULT_SPACE_SLUG = "demo-space";

const events = new Map<string, StoredEvent>();

function buildSeedEvent(input: CreateEventInput): StoredEvent {
  const id = randomUUID();
  const now = new Date().toISOString();

  return {
    id,
    title: input.title,
    description: input.description ?? "",
    start: input.start,
    end: input.end,
    city: input.city,
    country: input.country ?? "US",
    ticketPriceUsd: input.ticketPriceUsd,
    maxAttendees: input.maxAttendees,
    ticketTypeId: `${id}-general`,
    ticketTypeTitle: "General admission",
    spaceId: DEFAULT_SPACE_ID,
    spaceTitle: DEFAULT_SPACE_TITLE,
    spaceSlug: DEFAULT_SPACE_SLUG,
    createdAt: now,
    updatedAt: now,
  };
}

function seed(): void {
  if (events.size > 0) return;

  const seedInputs: CreateEventInput[] = [
    {
      title: "Open Source Mixer",
      description: "Casual networking for OSS maintainers and contributors.",
      start: "2026-06-12T18:00:00.000Z",
      end: "2026-06-12T21:00:00.000Z",
      city: "Brooklyn",
      country: "US",
      ticketPriceUsd: 0,
      maxAttendees: 120,
    },
    {
      title: "Agent Commerce Workshop",
      description: "Hands-on session building agent flows on top of ATLAS.",
      start: "2026-07-08T15:00:00.000Z",
      end: "2026-07-08T19:00:00.000Z",
      city: "Berlin",
      country: "DE",
      ticketPriceUsd: 49,
      maxAttendees: 60,
    },
    {
      title: "Protocol Office Hours",
      description: "Weekly drop-in for operators integrating the ATLAS manifest.",
      start: "2026-05-21T17:00:00.000Z",
      end: "2026-05-21T18:00:00.000Z",
      city: "Remote",
      country: "US",
      ticketPriceUsd: 0,
      maxAttendees: 250,
    },
  ];

  for (const input of seedInputs) {
    const stored = buildSeedEvent(input);
    events.set(stored.id, stored);
  }
}

seed();

export function createEvent(input: CreateEventInput): Promise<StoredEvent> {
  const stored = buildSeedEvent(input);
  events.set(stored.id, stored);

  return Promise.resolve(stored);
}

export function listEvents(): Promise<StoredEvent[]> {
  return Promise.resolve(
    Array.from(events.values()).sort((a, b) => a.start.localeCompare(b.start)),
  );
}

export function getEvent(id: string): Promise<StoredEvent | null> {
  return Promise.resolve(events.get(id) ?? null);
}
