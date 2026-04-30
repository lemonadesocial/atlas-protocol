/**
 * Common pinning service abstraction. Concrete implementations exist for
 * Pinata, Web3.Storage, Filebase and a self-hosted Kubo daemon.
 */
export interface Pinner {
  pin(content: Uint8Array, opts?: PinOptions): Promise<PinResult>;
  unpin(cid: string): Promise<void>;
  isPinned(cid: string): Promise<boolean>;
}

export interface PinOptions {
  name?: string;
  metadata?: Record<string, string>;
}

export interface PinResult {
  cid: string;
  size: number;
}

export type FetchLike = typeof fetch;
