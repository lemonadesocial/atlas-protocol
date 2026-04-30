import Link from "next/link";
import { notFound } from "next/navigation";

import {
  toAtlasEvent,
  type AtlasInputEvent,
  type AtlasInputSpace,
  type AtlasInputTicketType,
  type MapEventOptions,
} from "@atlasprotocol/server-sdk";

import { getAtlasConfig } from "../../../lib/atlas-config";
import { getEvent } from "../../../lib/event-store";

interface EventPageProps {
  params: Promise<{ id: string }>;
}

export default async function EventDetailPage({ params }: EventPageProps) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  const config = getAtlasConfig();

  const inputEvent: AtlasInputEvent = {
    id: event.id,
    title: event.title,
    description: event.description,
    start: event.start,
    end: event.end,
    address: { city: event.city, country: event.country },
    currency: "USD",
    created_at: event.createdAt,
    updated_at: event.updatedAt,
  };

  const space: AtlasInputSpace = {
    id: event.spaceId,
    title: event.spaceTitle,
    slug: event.spaceSlug,
  };

  const ticketTypes: AtlasInputTicketType[] = [
    {
      id: event.ticketTypeId,
      title: event.ticketTypeTitle,
      active: true,
      default: true,
      ticket_limit: event.maxAttendees,
      ticket_count: 0,
      prices: [
        {
          default: true,
          currency: "USD",
          cost: String(Math.round(event.ticketPriceUsd * 100)),
        },
      ],
    },
  ];

  const options: MapEventOptions = {
    sourcePlatform: config.platform.name,
    platformUrl: config.platform.url,
    baseUrl: config.platform.url,
    acceptedPaymentMethods: config.paymentMethods.map((method) => method.type),
  };

  const atlasEvent = toAtlasEvent(inputEvent, space, ticketTypes, options);

  return (
    <section>
      <Link href="/" style={{ color: "#0a4cff", textDecoration: "none", fontSize: "0.9rem" }}>
        &larr; All events
      </Link>
      <h1 style={{ marginTop: "0.75rem" }}>{event.title}</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        {new Date(event.start).toLocaleString()} &mdash; {new Date(event.end).toLocaleString()}
      </p>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "0.35rem 1rem" }}>
        <dt style={{ fontWeight: 600 }}>Location</dt>
        <dd style={{ margin: 0 }}>
          {event.city}, {event.country}
        </dd>
        <dt style={{ fontWeight: 600 }}>Ticket price</dt>
        <dd style={{ margin: 0 }}>${event.ticketPriceUsd.toFixed(2)} USD</dd>
        <dt style={{ fontWeight: 600 }}>Capacity</dt>
        <dd style={{ margin: 0 }}>{event.maxAttendees}</dd>
        {event.description ? (
          <>
            <dt style={{ fontWeight: 600 }}>Description</dt>
            <dd style={{ margin: 0 }}>{event.description}</dd>
          </>
        ) : null}
      </dl>

      <h2 style={{ marginTop: "2rem" }}>ATLAS canonical event</h2>
      <p style={{ color: "#555", marginTop: 0 }}>
        Output of <code>toAtlasEvent</code> from <code>@atlasprotocol/server-sdk</code>.
      </p>
      <pre
        style={{
          background: "#0b1021",
          color: "#e6e8ef",
          padding: "1rem",
          borderRadius: "8px",
          overflowX: "auto",
          fontSize: "0.85rem",
        }}
      >
        {JSON.stringify(atlasEvent, null, 2)}
      </pre>
    </section>
  );
}
