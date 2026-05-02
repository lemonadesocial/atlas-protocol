/**
 * Hold lifecycle primitives — the server-side state machine that backs an
 * ATLAS 402 challenge. The protocol guarantees:
 *
 *  - holds expire automatically (default 5 minute TTL, minimum 300s per
 *    `01-whitepaper/docs/01-PROTOCOL-SPEC.md` §3.2),
 *  - one payment per hold (`consume` is idempotent on the same idempotencyKey
 *    and rejects further redemption attempts after first success).
 *
 * The package ships an `InMemoryHoldStore` for tests / single-process
 * deployments. Production hosts should implement `HoldStore` against Redis
 * (or any store that supports atomic compare-and-set).
 */
import { randomUUID } from "node:crypto";

/** Lifecycle states a hold may occupy. */
export type HoldStatus = "pending" | "consumed" | "expired";

export interface Hold {
  /** Unique hold identifier. */
  id: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  /** Holder identifier — wallet address or DID. */
  attendee: string;
  /** Receiver address used in the 402 challenge. */
  organizerAddress: string;
  /**
   * Total due in USDC micro-units (6 decimals). String to avoid bigint
   * serialization issues when persisted to JSON stores.
   */
  totalAmountUsdMicros: string;
  /**
   * Optional idempotency key supplied by the agent on the original 402 call
   * (`Idempotency-Key` header). Used by `consume` to short-circuit retries.
   */
  idempotencyKey?: string;
  status: HoldStatus;
  /** ISO-8601 expiry. Hold MUST be treated as expired after this instant. */
  not_after: string;
  /** ISO-8601 creation time. */
  created_at: string;
}

/** Result of a `consume` attempt. */
export type ConsumeResult =
  | { status: "consumed"; hold: Hold }
  | { status: "already_consumed"; hold: Hold }
  | { status: "expired"; hold: Hold }
  | { status: "not_found" };

export interface HoldStore {
  create(hold: Hold): Promise<void>;
  get(id: string): Promise<Hold | undefined>;
  /**
   * Atomically transition pending → consumed. Returns `already_consumed` when
   * the same `idempotencyKey` retries an already-completed hold; returns
   * `expired` if the hold has passed `not_after`; returns `not_found` if no
   * such hold exists.
   */
  consume(id: string, idempotencyKey?: string): Promise<ConsumeResult>;
  /**
   * Mark every pending hold whose `not_after` is older than `timestamp` as
   * expired and return the number of holds transitioned. Idempotent.
   */
  expireOlderThan(timestamp: Date): Promise<number>;
}

/**
 * Minimum hold TTL per `01-whitepaper/docs/01-PROTOCOL-SPEC.md` §3.2 — 300
 * seconds (5 minutes). Hosts MAY exceed this; helpers reject anything below.
 */
export const MIN_HOLD_TTL_SECONDS = 300;
/** Default hold TTL (matches `generateMppChallenge` default expiry). */
export const DEFAULT_HOLD_TTL_SECONDS = 300;

export interface CreateHoldOpts {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  attendee: string;
  organizerAddress: string;
  totalAmountUsdMicros: bigint | string;
  idempotencyKey?: string;
  /** Override hold id; defaults to `hold_<uuidv4>` when omitted. */
  id?: string;
  /** TTL in seconds. Defaults to `DEFAULT_HOLD_TTL_SECONDS`. */
  ttlSeconds?: number;
  /** Override creation time (test injection). Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Build a `Hold` record with validated inputs and a generated id.
 *
 * Throws when `quantity <= 0`, `totalAmountUsdMicros <= 0`, or `ttlSeconds <
 * MIN_HOLD_TTL_SECONDS`. The returned hold is not yet persisted — call
 * `store.create(hold)` to save it.
 */
export function createHold(opts: CreateHoldOpts): Hold {
  if (!opts.eventId) throw new Error("createHold: eventId is required");
  if (!opts.ticketTypeId) throw new Error("createHold: ticketTypeId is required");
  if (!opts.attendee) throw new Error("createHold: attendee is required");
  if (!opts.organizerAddress) throw new Error("createHold: organizerAddress is required");
  if (opts.quantity <= 0) {
    throw new Error("createHold: quantity must be > 0");
  }
  const totalMicros =
    typeof opts.totalAmountUsdMicros === "bigint"
      ? opts.totalAmountUsdMicros
      : BigInt(opts.totalAmountUsdMicros);
  if (totalMicros <= 0n) {
    throw new Error("createHold: totalAmountUsdMicros must be > 0");
  }
  const ttl = opts.ttlSeconds ?? DEFAULT_HOLD_TTL_SECONDS;
  if (ttl < MIN_HOLD_TTL_SECONDS) {
    throw new Error(`createHold: ttlSeconds must be >= ${MIN_HOLD_TTL_SECONDS}`);
  }

  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const id = opts.id ?? `hold_${randomUUID()}`;

  return {
    id,
    eventId: opts.eventId,
    ticketTypeId: opts.ticketTypeId,
    quantity: opts.quantity,
    attendee: opts.attendee,
    organizerAddress: opts.organizerAddress,
    totalAmountUsdMicros: totalMicros.toString(),
    ...(opts.idempotencyKey !== undefined && { idempotencyKey: opts.idempotencyKey }),
    status: "pending",
    not_after: expiresAt.toISOString(),
    created_at: now.toISOString(),
  };
}

/**
 * Process-local hold store. Suitable for tests, examples, and single-process
 * deployments. Production deployments SHOULD back `HoldStore` with a shared
 * store (Redis, Postgres) so `consume` is atomic across replicas.
 */
export class InMemoryHoldStore implements HoldStore {
  private readonly holds = new Map<string, Hold>();

  /** Override clock for tests. Defaults to `Date.now`. */
  constructor(private readonly clock: () => Date = () => new Date()) {}

  create(hold: Hold): Promise<void> {
    if (this.holds.has(hold.id)) {
      return Promise.reject(new Error(`InMemoryHoldStore.create: duplicate hold id ${hold.id}`));
    }
    this.holds.set(hold.id, { ...hold });
    return Promise.resolve();
  }

  get(id: string): Promise<Hold | undefined> {
    const hold = this.holds.get(id);
    return Promise.resolve(hold ? { ...hold } : undefined);
  }

  consume(id: string, idempotencyKey?: string): Promise<ConsumeResult> {
    const hold = this.holds.get(id);
    if (!hold) return Promise.resolve({ status: "not_found" });

    if (hold.status === "consumed") {
      // Idempotency: same key returns the original outcome; differing key is
      // still treated as already_consumed (the hold is single-use regardless).
      if (
        idempotencyKey !== undefined &&
        hold.idempotencyKey !== undefined &&
        idempotencyKey !== hold.idempotencyKey
      ) {
        return Promise.resolve({ status: "already_consumed", hold: { ...hold } });
      }
      return Promise.resolve({ status: "already_consumed", hold: { ...hold } });
    }

    const now = this.clock();
    if (now >= new Date(hold.not_after)) {
      if (hold.status !== "expired") {
        hold.status = "expired";
        this.holds.set(id, hold);
      }
      return Promise.resolve({ status: "expired", hold: { ...hold } });
    }

    hold.status = "consumed";
    if (idempotencyKey !== undefined && hold.idempotencyKey === undefined) {
      hold.idempotencyKey = idempotencyKey;
    }
    this.holds.set(id, hold);
    return Promise.resolve({ status: "consumed", hold: { ...hold } });
  }

  expireOlderThan(timestamp: Date): Promise<number> {
    let count = 0;
    for (const hold of this.holds.values()) {
      if (hold.status === "pending" && new Date(hold.not_after) < timestamp) {
        hold.status = "expired";
        this.holds.set(hold.id, hold);
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}
