/**
 * Token-bucket rate limiting for ATLAS server endpoints.
 *
 * The protocol's manifest already advertises per-route limits (see
 * `01-whitepaper/docs/02-SCHEMAS.md` §1, `rate_limits.purchase_per_minute`);
 * this module provides the actual enforcement primitive. The limiter is
 * framework-agnostic — `RateLimiter` is the abstract surface — with an
 * optional Hono adapter via `createRateLimitMiddleware` for hosts using the
 * reference dual-protocol-server pattern.
 *
 * Hono is intentionally left as a peer dependency so consumers that ship
 * their own HTTP framework do NOT inherit the dep.
 */

import type { Context, MiddlewareHandler } from "hono";

import { decode, deserialize } from "@atlasprotocol/mpp";

/** Outcome of a `consume` call against a `RateLimiter`. */
export interface RateLimitResult {
  /** True iff `cost` tokens were available and have been deducted. */
  allowed: boolean;
  /**
   * Milliseconds until enough tokens refill to satisfy a future `consume(cost)`
   * with the same identifier. Only populated when `allowed === false`.
   */
  retryAfterMs?: number;
}

export interface RateLimiter {
  /**
   * Attempt to deduct `cost` tokens (default 1) from the bucket associated with
   * `identifier`. Returns `{ allowed: true }` on success, or
   * `{ allowed: false, retryAfterMs }` when the bucket is empty.
   */
  consume(identifier: string, cost?: number): Promise<RateLimitResult>;
}

interface Bucket {
  /** Current token count (fractional — tokens accumulate continuously). */
  tokens: number;
  /** Wallclock instant the bucket was last refilled (ms epoch). */
  lastRefill: number;
}

export interface InMemoryRateLimiterOptions {
  /** Maximum tokens the bucket can hold. Bursts above this are dropped. */
  capacity: number;
  /** Refill rate in tokens per second. */
  refillRatePerSecond: number;
  /** Override clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Process-local token-bucket rate limiter. One bucket per identifier; buckets
 * are created lazily on first `consume`. Suitable for tests, examples, and
 * single-process deployments. Production hosts SHOULD back the `RateLimiter`
 * interface with a shared store (e.g. Redis with Lua scripting) so the rate
 * limit applies across replicas.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillRatePerSecond: number;
  private readonly now: () => number;

  constructor(opts: InMemoryRateLimiterOptions) {
    if (opts.capacity <= 0) {
      throw new Error("InMemoryRateLimiter: capacity must be > 0");
    }
    if (opts.refillRatePerSecond <= 0) {
      throw new Error("InMemoryRateLimiter: refillRatePerSecond must be > 0");
    }
    this.capacity = opts.capacity;
    this.refillRatePerSecond = opts.refillRatePerSecond;
    this.now = opts.now ?? (() => Date.now());
  }

  consume(identifier: string, cost = 1): Promise<RateLimitResult> {
    if (cost <= 0) {
      throw new Error("InMemoryRateLimiter.consume: cost must be > 0");
    }

    const now = this.now();
    let bucket = this.buckets.get(identifier);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(identifier, bucket);
    } else {
      const elapsedSec = Math.max(0, (now - bucket.lastRefill) / 1000);
      bucket.tokens = Math.min(
        this.capacity,
        bucket.tokens + elapsedSec * this.refillRatePerSecond,
      );
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return Promise.resolve({ allowed: true });
    }

    const deficit = cost - bucket.tokens;
    const retryAfterMs = Math.ceil((deficit / this.refillRatePerSecond) * 1000);
    return Promise.resolve({ allowed: false, retryAfterMs });
  }
}

/** Hono request context — kept loose so we don't pin a major version. */
type RateLimitContext = Context;

export interface CreateRateLimitMiddlewareOptions {
  /** Limiter to consume against on every request. */
  limiter: RateLimiter;
  /**
   * Override the identifier strategy. Defaults to: MPP credential `payer_id`
   * (or `recipient`) when an `Authorization: MPP …` header is present, falling
   * back to the request IP (`x-forwarded-for` or remote address).
   */
  identify?: (c: RateLimitContext) => string;
  /** Cost per request. Defaults to 1. */
  cost?: number;
}

/**
 * Build a Hono-compatible middleware that enforces `limiter` per identifier.
 * On block, responds 429 with a `Retry-After` header (seconds, ceil from
 * `retryAfterMs`).
 */
export function createRateLimitMiddleware(
  opts: CreateRateLimitMiddlewareOptions,
): MiddlewareHandler {
  const identify = opts.identify ?? defaultIdentify;
  const cost = opts.cost ?? 1;

  return async (c, next) => {
    const identifier = identify(c);
    const result = await opts.limiter.consume(identifier, cost);
    if (result.allowed) {
      await next();
      return;
    }
    const retryAfterMs = result.retryAfterMs ?? 1000;
    const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    c.header("Retry-After", String(retryAfterSec));
    c.status(429);
    return c.json({
      error: "rate_limited",
      message: "Too many requests",
      retry_after_seconds: retryAfterSec,
    });
  };
}

/**
 * Default identifier strategy: try the MPP credential payer first (so an agent
 * is rate-limited per credential identity, not per IP), then fall back to the
 * client IP. Returns `"unknown"` if neither is available — the middleware will
 * still throttle, but bursts from anonymous clients share a single bucket.
 */
function defaultIdentify(c: RateLimitContext): string {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("MPP ")) {
    const wire = auth.slice("MPP ".length).trim();
    if (wire) {
      try {
        const payload = decode(deserialize(wire));
        const payer =
          (typeof payload.metadata?.["payer_id"] === "string"
            ? payload.metadata["payer_id"]
            : undefined) ?? payload.recipient;
        if (typeof payer === "string" && payer.length > 0) {
          return `mpp:${payer}`;
        }
      } catch {
        // fall through to IP
      }
    }
  }

  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }
  const realIp = c.req.header("x-real-ip");
  if (realIp) return `ip:${realIp.trim()}`;

  // Hono's `c.env` shape varies by adapter; node-server exposes `incoming` with
  // `socket.remoteAddress`. Fall back to "unknown" if not available.
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  const remote = env?.incoming?.socket?.remoteAddress;
  if (remote) return `ip:${remote}`;

  return "unknown";
}
