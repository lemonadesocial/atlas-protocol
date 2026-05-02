import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOLD_TTL_SECONDS,
  InMemoryHoldStore,
  MIN_HOLD_TTL_SECONDS,
  createHold,
} from "../hold.js";

const BASE = {
  eventId: "evt_1",
  ticketTypeId: "tt_1",
  quantity: 2,
  attendee: "0xattendee",
  organizerAddress: "0xorg",
  totalAmountUsdMicros: 25_000_000n,
};

describe("createHold", () => {
  it("returns a pending hold with a generated id and protocol-default TTL", () => {
    const before = Date.now();
    const hold = createHold(BASE);
    expect(hold.id).toMatch(/^hold_/);
    expect(hold.status).toBe("pending");
    expect(hold.eventId).toBe("evt_1");
    expect(hold.totalAmountUsdMicros).toBe("25000000");
    const ttlMs = new Date(hold.not_after).getTime() - new Date(hold.created_at).getTime();
    expect(ttlMs).toBe(DEFAULT_HOLD_TTL_SECONDS * 1000);
    expect(new Date(hold.created_at).getTime()).toBeGreaterThanOrEqual(before - 1);
  });

  it("respects an injected `now` and ttlSeconds", () => {
    const now = new Date("2026-04-14T20:00:00Z");
    const hold = createHold({ ...BASE, now, ttlSeconds: 600 });
    expect(hold.created_at).toBe("2026-04-14T20:00:00.000Z");
    expect(hold.not_after).toBe("2026-04-14T20:10:00.000Z");
  });

  it("rejects ttl below the protocol minimum", () => {
    expect(() => createHold({ ...BASE, ttlSeconds: MIN_HOLD_TTL_SECONDS - 1 })).toThrow(
      /ttlSeconds must be >= 300/,
    );
  });

  it("rejects non-positive quantities and amounts", () => {
    expect(() => createHold({ ...BASE, quantity: 0 })).toThrow(/quantity/);
    expect(() => createHold({ ...BASE, totalAmountUsdMicros: 0n })).toThrow(/totalAmountUsdMicros/);
  });

  it("accepts string totalAmountUsdMicros (JSON-friendly)", () => {
    const hold = createHold({ ...BASE, totalAmountUsdMicros: "12345678" });
    expect(hold.totalAmountUsdMicros).toBe("12345678");
  });
});

describe("InMemoryHoldStore.create + get", () => {
  it("stores and retrieves a hold", async () => {
    const store = new InMemoryHoldStore();
    const hold = createHold(BASE);
    await store.create(hold);
    const fetched = await store.get(hold.id);
    expect(fetched).toEqual(hold);
  });

  it("returns undefined for unknown ids", async () => {
    const store = new InMemoryHoldStore();
    expect(await store.get("hold_missing")).toBeUndefined();
  });

  it("rejects duplicate creates", async () => {
    const store = new InMemoryHoldStore();
    const hold = createHold(BASE);
    await store.create(hold);
    await expect(store.create(hold)).rejects.toThrow(/duplicate/);
  });
});

describe("InMemoryHoldStore.consume", () => {
  it('returns "consumed" the first time, "already_consumed" on retry', async () => {
    const store = new InMemoryHoldStore();
    const hold = createHold({ ...BASE, idempotencyKey: "idem-1" });
    await store.create(hold);

    const first = await store.consume(hold.id, "idem-1");
    expect(first.status).toBe("consumed");

    const second = await store.consume(hold.id, "idem-1");
    expect(second.status).toBe("already_consumed");
  });

  it('returns "expired" when not_after has passed', async () => {
    let nowMs = new Date("2026-04-14T21:00:00Z").getTime();
    const store = new InMemoryHoldStore(() => new Date(nowMs));
    const hold = createHold({
      ...BASE,
      now: new Date(nowMs),
      ttlSeconds: 300,
    });
    await store.create(hold);

    // Advance past not_after.
    nowMs += 301 * 1000;
    const result = await store.consume(hold.id);
    expect(result.status).toBe("expired");

    // Subsequent consumes still report expired.
    const again = await store.consume(hold.id);
    expect(again.status).toBe("expired");
  });

  it('returns "not_found" for unknown ids', async () => {
    const store = new InMemoryHoldStore();
    const result = await store.consume("hold_missing");
    expect(result).toEqual({ status: "not_found" });
  });

  it("captures the supplied idempotencyKey on first consume", async () => {
    const store = new InMemoryHoldStore();
    const hold = createHold(BASE); // no idempotencyKey at creation
    await store.create(hold);

    const first = await store.consume(hold.id, "agent-key-42");
    expect(first.status).toBe("consumed");
    if (first.status === "consumed") {
      expect(first.hold.idempotencyKey).toBe("agent-key-42");
    }
  });
});

describe("InMemoryHoldStore.expireOlderThan", () => {
  it("transitions only pending holds older than the cutoff and returns the count", async () => {
    const store = new InMemoryHoldStore();

    const oldA = createHold({
      ...BASE,
      now: new Date("2026-01-01T00:00:00Z"),
      ttlSeconds: 300,
    });
    const oldB = createHold({
      ...BASE,
      now: new Date("2026-01-01T00:01:00Z"),
      ttlSeconds: 300,
    });
    const fresh = createHold({
      ...BASE,
      now: new Date("2030-01-01T00:00:00Z"),
      ttlSeconds: 300,
    });

    await store.create(oldA);
    await store.create(oldB);
    await store.create(fresh);

    // Already-consumed holds must not be re-counted.
    await store.consume(oldB.id, oldB.idempotencyKey);

    const count = await store.expireOlderThan(new Date("2026-04-01T00:00:00Z"));
    expect(count).toBe(1); // only oldA was still pending and past not_after
    expect((await store.get(oldA.id))?.status).toBe("expired");
    expect((await store.get(fresh.id))?.status).toBe("pending");
  });

  it("returns 0 when nothing is eligible", async () => {
    const store = new InMemoryHoldStore();
    const hold = createHold(BASE);
    await store.create(hold);
    expect(await store.expireOlderThan(new Date("1990-01-01T00:00:00Z"))).toBe(0);
  });
});
