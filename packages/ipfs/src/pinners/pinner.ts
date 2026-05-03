/**
 * Common pinning service abstraction.
 *
 * Two methods, deliberately split:
 *
 *  - pinJson(obj, opts?) — canonicalizes the object (sorted keys, no
 *    whitespace) before pinning, so semantically-equivalent inputs always
 *    produce IDENTICAL CIDs. This eliminates an entire class of integrity
 *    verification footguns where caller-side serialization differences
 *    would silently fork CIDs.
 *
 *  - pinBytes(content, opts?) — pins arbitrary bytes verbatim. Use this
 *    for binary blobs (images, etc.) or for JSON you have already
 *    canonicalized yourself.
 *
 * Implementations MUST canonicalize inside pinJson. Callers MUST NOT
 * pre-stringify and pass through pinBytes when they have a JSON object —
 * the type signature exists to make the right choice obvious.
 *
 * Concrete implementations exist for Pinata, Web3.Storage, Filebase and a
 * self-hosted Kubo daemon.
 */
export interface Pinner {
  pinJson(obj: unknown, opts?: PinOptions): Promise<PinResult>;
  pinBytes(content: Uint8Array, opts?: PinOptions): Promise<PinResult>;
  /**
   * `cid` is the same string form returned by `PinResult.cid` and used
   * throughout the package (e.g. `cid.ts`, `receipt-cid.ts`). There is no
   * opaque `CID` value type — everything is the human-readable string.
   */
  unpin(cid: string): Promise<void>;
  isPinned(cid: string): Promise<boolean>;
}

export interface PinOptions {
  /** Filename / display name forwarded to the pinning service. */
  name?: string;
  /** Provider-specific metadata key/value pairs. */
  metadata?: Record<string, string>;
}

export interface PinResult {
  /** The IPFS CID returned by the pinning service. */
  cid: string;
  /** Pinned size in bytes (best-effort; falls back to input length). */
  size: number;
}

export type FetchLike = typeof fetch;
