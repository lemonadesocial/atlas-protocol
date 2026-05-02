/**
 * Replay protection for ATLAS payment credentials.
 *
 * The server records a deterministic hash of every credential (MPP envelope)
 * it accepts. A second presentation of the same credential — by the same
 * agent or any other — is rejected. Hosts wire this in via the new
 * `verifyMppCredential` entrypoint in `challenge.ts`.
 *
 * Hash algorithm: SHA-256 over the canonical wire bytes of the envelope. We
 * use Node's built-in `crypto` (no external dependency) to keep the SDK
 * footprint small.
 */
import { createHash } from "node:crypto";

import { canonicalize, type MppEnvelope } from "@atlasprotocol/mpp";

export interface MarkUsedResult {
  /** True iff this is the first time the credential was marked used. */
  first: boolean;
}

export interface ReplayStore {
  markCredentialUsed(credentialHash: string): Promise<MarkUsedResult>;
  isCredentialUsed(credentialHash: string): Promise<boolean>;
}

/**
 * Compute the canonical credential hash for a given MPP envelope. Stable
 * across re-encodings: input is the JCS-canonical UTF-8 bytes of the
 * envelope, output is the lowercase hex SHA-256 digest.
 */
export function credentialHash(envelope: MppEnvelope): string {
  const canonical = canonicalize(envelope);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

interface ReplayEntry {
  /** Wallclock instant the credential was first marked used (ms epoch). */
  firstSeen: number;
}

export interface InMemoryReplayStoreOptions {
  /**
   * TTL after which entries are evicted on the next access. Defaults to 24h
   * (86_400_000 ms) to match the protocol's idempotency-key window
   * (`01-whitepaper/docs/01-PROTOCOL-SPEC.md` §3.6).
   */
  ttlMs?: number;
  /** Override clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Process-local replay store. Suitable for tests, examples, and
 * single-process deployments. Production hosts SHOULD use a shared TTL store
 * (e.g. Redis with `SET ... NX EX <ttl>`).
 */
export class InMemoryReplayStore implements ReplayStore {
  private readonly entries = new Map<string, ReplayEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: InMemoryReplayStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  markCredentialUsed(credentialHash: string): Promise<MarkUsedResult> {
    this.evictExpired();
    const existing = this.entries.get(credentialHash);
    if (existing) return Promise.resolve({ first: false });
    this.entries.set(credentialHash, { firstSeen: this.now() });
    return Promise.resolve({ first: true });
  }

  isCredentialUsed(credentialHash: string): Promise<boolean> {
    this.evictExpired();
    return Promise.resolve(this.entries.has(credentialHash));
  }

  /** Remove every entry past TTL. O(n); only called on writes/reads. */
  private evictExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [hash, entry] of this.entries) {
      if (entry.firstSeen < cutoff) {
        this.entries.delete(hash);
      }
    }
  }
}
