import Link from "next/link";

import { listEvents } from "../lib/event-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const events = await listEvents();

  return (
    <section>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ margin: 0 }}>Events</h1>
        <Link
          href="/events/new"
          style={{
            background: "#111",
            color: "#fff",
            padding: "0.55rem 0.95rem",
            borderRadius: "6px",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Create event
        </Link>
      </header>

      {events.length === 0 ? (
        <p>No events yet. Create one to get started.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
          {events.map((event) => (
            <li
              key={event.id}
              style={{
                background: "#fff",
                border: "1px solid #e5e5e5",
                borderRadius: "8px",
                padding: "1rem 1.25rem",
              }}
            >
              <Link
                href={`/events/${event.id}`}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.1rem" }}>{event.title}</h2>
                <p style={{ margin: 0, color: "#555", fontSize: "0.92rem" }}>
                  {new Date(event.start).toLocaleString()} · {event.city}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
