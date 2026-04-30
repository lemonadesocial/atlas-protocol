import { redirect } from "next/navigation";
import { z } from "zod";

import { createEvent } from "../../../lib/event-store";

const formSchema = z.object({
  title: z.string().min(1).max(200),
  start: z.string().min(1),
  end: z.string().min(1),
  city: z.string().min(1).max(120),
  country: z.string().min(2).max(2).optional(),
  ticketPriceUsd: z.coerce.number().min(0).max(100_000),
  maxAttendees: z.coerce.number().int().min(1).max(1_000_000),
  description: z.string().max(2_000).optional(),
});

async function createEventAction(formData: FormData): Promise<void> {
  "use server";

  const parsed = formSchema.parse({
    title: formData.get("title"),
    start: formData.get("start"),
    end: formData.get("end"),
    city: formData.get("city"),
    country: formData.get("country") ?? undefined,
    ticketPriceUsd: formData.get("ticketPriceUsd"),
    maxAttendees: formData.get("maxAttendees"),
    description: formData.get("description") ?? undefined,
  });

  const event = await createEvent({
    title: parsed.title,
    ...(parsed.description !== undefined && { description: parsed.description }),
    start: new Date(parsed.start).toISOString(),
    end: new Date(parsed.end).toISOString(),
    city: parsed.city,
    ...(parsed.country !== undefined && { country: parsed.country }),
    ticketPriceUsd: parsed.ticketPriceUsd,
    maxAttendees: parsed.maxAttendees,
  });

  redirect(`/events/${event.id}`);
}

const fieldStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.35rem",
};

const inputStyle = {
  padding: "0.5rem 0.65rem",
  border: "1px solid #d4d4d4",
  borderRadius: "6px",
  fontSize: "0.95rem",
  font: "inherit",
};

export default function NewEventPage() {
  return (
    <section>
      <h1 style={{ marginTop: 0 }}>Create event</h1>
      <form action={createEventAction} style={{ display: "grid", gap: "1rem", maxWidth: "520px" }}>
        <label style={fieldStyle}>
          <span>Title</span>
          <input name="title" required maxLength={200} style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Description</span>
          <textarea name="description" rows={3} style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Start</span>
          <input type="datetime-local" name="start" required style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>End</span>
          <input type="datetime-local" name="end" required style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Location (city)</span>
          <input name="city" required maxLength={120} style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Country (ISO-3166 alpha-2, optional)</span>
          <input name="country" minLength={2} maxLength={2} style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Ticket price (USD)</span>
          <input
            type="number"
            name="ticketPriceUsd"
            min={0}
            step="0.01"
            defaultValue={0}
            required
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span>Max attendees</span>
          <input
            type="number"
            name="maxAttendees"
            min={1}
            step={1}
            defaultValue={100}
            required
            style={inputStyle}
          />
        </label>

        <button
          type="submit"
          style={{
            background: "#111",
            color: "#fff",
            padding: "0.6rem 1rem",
            borderRadius: "6px",
            border: "none",
            fontWeight: 600,
            cursor: "pointer",
            justifySelf: "start",
          }}
        >
          Create event
        </button>
      </form>
    </section>
  );
}
