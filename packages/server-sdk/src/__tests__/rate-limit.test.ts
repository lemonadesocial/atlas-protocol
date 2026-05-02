import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter, createRateLimitMiddleware, type RateLimiter } from "../rate-limit.js";

describe("InMemoryRateLimiter", () => {
  it("allows up to capacity calls in a single burst", async () => {
    const limiter = new InMemoryRateLimiter({
      capacity: 3,
      refillRatePerSecond: 1,
      now: () => 1_000,
    });

    const a = await limiter.consume("agent-1");
    const b = await limiter.consume("agent-1");
    const c = await limiter.consume("agent-1");

    expect(a).toEqual({ allowed: true });
    expect(b).toEqual({ allowed: true });
    expect(c).toEqual({ allowed: true });
  });

  it("blocks the (capacity+1)th call with retryAfterMs > 0", async () => {
    const limiter = new InMemoryRateLimiter({
      capacity: 2,
      refillRatePerSecond: 1,
      now: () => 1_000,
    });

    await limiter.consume("agent-1");
    await limiter.consume("agent-1");
    const blocked = await limiter.consume("agent-1");

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    // Refill rate is 1/s -> need ~1s to recover the next token.
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(1_000);
  });

  it("treats different identifiers as independent buckets", async () => {
    const limiter = new InMemoryRateLimiter({
      capacity: 1,
      refillRatePerSecond: 1,
      now: () => 0,
    });

    expect((await limiter.consume("a")).allowed).toBe(true);
    expect((await limiter.consume("b")).allowed).toBe(true);
    expect((await limiter.consume("a")).allowed).toBe(false);
  });

  it("refills tokens linearly with elapsed time", async () => {
    let nowMs = 0;
    const limiter = new InMemoryRateLimiter({
      capacity: 5,
      refillRatePerSecond: 2, // 2 tokens per second
      now: () => nowMs,
    });

    for (let i = 0; i < 5; i++) await limiter.consume("agent-1");
    expect((await limiter.consume("agent-1")).allowed).toBe(false);

    // Advance 1.5s -> 3 tokens refilled, capped by capacity=5.
    nowMs += 1_500;
    expect((await limiter.consume("agent-1")).allowed).toBe(true);
    expect((await limiter.consume("agent-1")).allowed).toBe(true);
    expect((await limiter.consume("agent-1")).allowed).toBe(true);
    expect((await limiter.consume("agent-1")).allowed).toBe(false);
  });

  it("rejects invalid options", () => {
    expect(() => new InMemoryRateLimiter({ capacity: 0, refillRatePerSecond: 1 })).toThrow(
      /capacity/,
    );
    expect(() => new InMemoryRateLimiter({ capacity: 1, refillRatePerSecond: 0 })).toThrow(
      /refillRatePerSecond/,
    );
  });

  it("rejects non-positive cost", () => {
    const limiter = new InMemoryRateLimiter({ capacity: 1, refillRatePerSecond: 1 });
    expect(() => limiter.consume("a", 0)).toThrow(/cost/);
  });
});

describe("createRateLimitMiddleware", () => {
  it("lets requests through when allowed", async () => {
    const limiter = new InMemoryRateLimiter({
      capacity: 5,
      refillRatePerSecond: 1,
    });
    const app = new Hono();
    app.use("/test", createRateLimitMiddleware({ limiter }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 429 with Retry-After header when blocked", async () => {
    const limiter = new InMemoryRateLimiter({
      capacity: 1,
      refillRatePerSecond: 1,
    });
    const app = new Hono();
    app.use("/test", createRateLimitMiddleware({ limiter }));
    app.get("/test", (c) => c.json({ ok: true }));

    // First request consumes the only token.
    const ok = await app.request("/test", { headers: { "x-forwarded-for": "5.6.7.8" } });
    expect(ok.status).toBe(200);

    // Second is blocked.
    const blocked = await app.request("/test", { headers: { "x-forwarded-for": "5.6.7.8" } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    const body = (await blocked.json()) as { error: string; retry_after_seconds: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retry_after_seconds).toBe(retryAfter);
  });

  it("uses the supplied identify() to scope limiting", async () => {
    const calls: string[] = [];
    const limiter: RateLimiter = {
      consume: (id) => {
        calls.push(id);
        return Promise.resolve({ allowed: true });
      },
    };
    const app = new Hono();
    app.use(
      "/test",
      createRateLimitMiddleware({
        limiter,
        identify: (c) => `tenant:${c.req.header("x-tenant") ?? "default"}`,
      }),
    );
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test", { headers: { "x-tenant": "abc" } });
    await app.request("/test", { headers: { "x-tenant": "xyz" } });
    expect(calls).toEqual(["tenant:abc", "tenant:xyz"]);
  });

  it("falls back to IP when no MPP credential is present", async () => {
    const calls: string[] = [];
    const limiter: RateLimiter = {
      consume: (id) => {
        calls.push(id);
        return Promise.resolve({ allowed: true });
      },
    };
    const app = new Hono();
    app.use("/t", createRateLimitMiddleware({ limiter }));
    app.get("/t", (c) => c.json({ ok: true }));

    await app.request("/t", { headers: { "x-forwarded-for": "9.9.9.9, 1.1.1.1" } });
    expect(calls[0]).toBe("ip:9.9.9.9");
  });
});
