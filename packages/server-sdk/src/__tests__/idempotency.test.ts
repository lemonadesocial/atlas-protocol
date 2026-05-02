import { describe, expect, it, vi } from "vitest";

import { InMemoryIdempotencyStore, withIdempotency } from "../idempotency.js";

describe("InMemoryIdempotencyStore", () => {
  it("returns undefined for unknown keys", async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.get("missing")).toBeUndefined();
  });

  it("stores and returns a result within the TTL", async () => {
    let nowMs = 1_000;
    const store = new InMemoryIdempotencyStore({ now: () => nowMs });
    await store.set("k", { foo: "bar" }, 60);
    expect(await store.get("k")).toEqual({ foo: "bar" });
    nowMs += 30_000; // halfway through TTL
    expect(await store.get("k")).toEqual({ foo: "bar" });
  });

  it("evicts entries past the TTL", async () => {
    let nowMs = 1_000;
    const store = new InMemoryIdempotencyStore({ now: () => nowMs });
    await store.set("k", "value", 1);
    nowMs += 2_000;
    expect(await store.get("k")).toBeUndefined();
  });

  it("rejects non-positive ttls", () => {
    const store = new InMemoryIdempotencyStore();
    expect(() => store.set("k", "v", 0)).toThrow(/ttlSeconds/);
    expect(() => store.set("k", "v", -1)).toThrow(/ttlSeconds/);
  });
});

describe("withIdempotency", () => {
  it("runs fn on first call and caches the result", async () => {
    const store = new InMemoryIdempotencyStore();
    const fn = vi.fn(() => Promise.resolve({ holdId: "hold_1" }));

    const first = await withIdempotency(store, "key-a", 60, fn);
    expect(first).toEqual({ holdId: "hold_1" });
    expect(fn).toHaveBeenCalledTimes(1);

    const second = await withIdempotency(store, "key-a", 60, fn);
    expect(second).toEqual({ holdId: "hold_1" });
    // fn was NOT invoked the second time — the cached value was returned.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("treats different keys independently", async () => {
    const store = new InMemoryIdempotencyStore();
    const fn = vi.fn((k: string) => Promise.resolve({ key: k }));

    const a = await withIdempotency(store, "key-a", 60, () => fn("a"));
    const b = await withIdempotency(store, "key-b", 60, () => fn("b"));
    expect(a).toEqual({ key: "a" });
    expect(b).toEqual({ key: "b" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache thrown errors — the next call re-runs fn", async () => {
    const store = new InMemoryIdempotencyStore();
    let attempt = 0;
    const fn = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.reject(new Error("transient"));
      }
      return Promise.resolve({ ok: true, attempt });
    });

    await expect(withIdempotency(store, "key-c", 60, fn)).rejects.toThrow("transient");
    expect(await store.get("key-c")).toBeUndefined();

    const second = await withIdempotency(store, "key-c", 60, fn);
    expect(second).toEqual({ ok: true, attempt: 2 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-runs fn after the TTL expires", async () => {
    let nowMs = 0;
    const store = new InMemoryIdempotencyStore({ now: () => nowMs });
    const fn = vi.fn(() => Promise.resolve({ ts: nowMs }));

    const first = await withIdempotency(store, "key-d", 1, fn);
    expect(first).toEqual({ ts: 0 });

    nowMs += 2_000; // past TTL
    const second = await withIdempotency(store, "key-d", 1, fn);
    expect(second).toEqual({ ts: 2_000 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
