/**
 * Idempotency primitives — caches the result of an expensive handler keyed by
 * an `Idempotency-Key` header (or any caller-chosen key) so that retried
 * requests return the original outcome rather than re-running side effects.
 *
 * Pairs naturally with the hold lifecycle in `hold.ts`: a `POST` to a purchase
 * endpoint that creates a hold and issues a 402 challenge can be wrapped in
 * `withIdempotency` so a duplicate request from a flaky agent returns the same
 * challenge instead of opening a second hold.
 *
 * Behaviour:
 *  - successful results are cached for `ttlSeconds`,
 *  - thrown errors are NOT cached — the next call re-runs `fn`,
 *  - entries are evicted lazily on access after TTL expires.
 *
 * Production hosts should back the `IdempotencyStore` interface with a shared
 * TTL store (e.g. Redis with `SET ... NX EX <ttl>`) so retries are safe across
 * replicas. The bundled `InMemoryIdempotencyStore` is intended for tests,
 * examples, and single-process deployments.
 */

export interface IdempotencyStore {
  /**
   * Return the previously-cached result for `key`, or `undefined` if no live
   * entry exists. Implementations MUST treat expired entries as missing.
   */
  get(key: string): Promise<unknown>;
  /**
   * Persist `result` under `key` for `ttlSeconds` seconds. Subsequent `get`s
   * within the window return the same value.
   */
  set(key: string, result: unknown, ttlSeconds: number): Promise<void>;
}

interface IdempotencyEntry {
  /** Cached handler result. May be any JSON-serializable value. */
  result: unknown;
  /** Wallclock instant after which the entry is treated as missing (ms epoch). */
  expiresAt: number;
}

export interface InMemoryIdempotencyStoreOptions {
  /** Override clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Process-local idempotency store. Suitable for tests, examples, and
 * single-process deployments. Evicts expired entries lazily on read/write.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private readonly now: () => number;

  constructor(opts: InMemoryIdempotencyStoreOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  get(key: string): Promise<unknown> {
    this.evictExpired();
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.result);
  }

  set(key: string, result: unknown, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      throw new Error("InMemoryIdempotencyStore.set: ttlSeconds must be > 0");
    }
    this.evictExpired();
    this.entries.set(key, {
      result,
      expiresAt: this.now() + ttlSeconds * 1000,
    });
    return Promise.resolve();
  }

  /** Remove every expired entry. O(n); only called on writes/reads. */
  private evictExpired(): void {
    const cutoff = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= cutoff) {
        this.entries.delete(key);
      }
    }
  }
}

/**
 * Run `fn` at most once per `(store, key)` within `ttlSeconds`. The first call
 * caches its successful result; subsequent calls within the TTL return the
 * cached value without re-invoking `fn`.
 *
 * Errors are deliberately NOT cached — a failed handler MUST be retryable
 * (e.g. transient network errors, 5xx upstream). Callers that want negative
 * caching should handle it explicitly.
 */
export async function withIdempotency<T>(
  store: IdempotencyStore,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const cached = await store.get(key);
  if (cached !== undefined) {
    return cached as T;
  }
  const result = await fn();
  await store.set(key, result, ttlSeconds);
  return result;
}
