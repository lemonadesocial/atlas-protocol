/**
 * ATLAS-managed services client.
 *
 * Operator-side helper for platforms that opt into letting the ATLAS registry
 * deployment do IPFS receipt pinning, on-chain settlement, and reward
 * recording on their behalf — instead of running their own pinner, hot wallet,
 * and RPC. Wraps the four endpoints exposed by the registry's `/atlas/v1/*`
 * routes:
 *
 *   POST /atlas/v1/receipts/pin
 *   POST /atlas/v1/receipts/verify
 *   POST /atlas/v1/settlements/settle
 *   POST /atlas/v1/rewards/record
 *
 * Platforms that prefer sovereignty can still reach the contracts directly
 * via the `buildSettleTx` / `buildRecordRewardTx` helpers — this client is a
 * convenience layer, not a replacement.
 */

import type { AtlasReceipt } from "../receipt.js";

/** Hard-coded SDK version — release-please bumps this in lockstep with package.json. */
const SDK_VERSION = "0.6.1";

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Public config + interface
// ---------------------------------------------------------------------------

export interface AtlasManagedClientConfig {
  /** Base URL of the atlas-registry deployment, e.g. `https://registry.atlas-protocol.org`. */
  baseUrl: string;
  /**
   * Bearer token forwarded as `Authorization: Bearer <token>`. Optional — omit
   * for unauthenticated registry deployments (e.g. local dev).
   */
  platformAuthToken?: string;
  /** Override `globalThis.fetch` (mainly for tests). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Defaults to 30_000. */
  timeoutMs?: number;
}

export interface AtlasManagedClient {
  pinReceipt(receipt: AtlasReceipt): Promise<PinReceiptResponse>;
  verifyReceipt(input: AtlasReceipt | { urn: string; cid: string }): Promise<VerifyReceiptResponse>;
  settle(opts: SettleArgs): Promise<SettleResponse>;
  recordRewards(opts: RecordRewardsArgs): Promise<RecordRewardsResponse>;
}

// ---------------------------------------------------------------------------
// Request + response types
// ---------------------------------------------------------------------------

export interface PinReceiptResponse {
  urn: string;
  cid: string;
  pinned_at: string;
}

export interface VerifyReceiptResponse {
  valid: boolean;
  signature_verified: boolean;
  hash_match: boolean;
  errors?: string[];
}

export interface SettleArgs {
  platformDomain: string;
  chain: string;
  organizer: string;
  totalAmount: string | bigint;
  paymentId: string;
  platformFees: ReadonlyArray<{ recipient: string; amount: string | bigint }>;
}

export interface SettleResponse {
  paymentId: string;
  chain: string;
  txHash: string | null;
  status: "submitted" | "confirmed" | "failed";
  explorerUrl: string | null;
}

export interface RecordRewardsArgs {
  platformDomain: string;
  paymentId: string;
  recipients: ReadonlyArray<{
    recipient: string;
    kind: "organizer" | "attendee" | "referral";
    amount: string | bigint;
  }>;
}

export interface RecordRewardsResponse {
  paymentId: string;
  chain: string;
  txHashes: string[];
  status: "submitted" | "confirmed" | "failed" | "partial_failure";
  explorerUrls?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Error hierarchy
// ---------------------------------------------------------------------------

export class AtlasManagedError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AtlasManagedError";
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/** Thrown for HTTP 4xx responses — request was rejected by the registry. */
export class AtlasManagedRequestError extends AtlasManagedError {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(status, code, message, details);
    this.name = "AtlasManagedRequestError";
  }
}

/** Thrown for HTTP 5xx responses — registry-side failure. */
export class AtlasManagedServerError extends AtlasManagedError {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(status, code, message, details);
    this.name = "AtlasManagedServerError";
  }
}

/** Thrown when fetch throws (network failure, abort/timeout, etc). `status` is 0. */
export class AtlasManagedNetworkError extends AtlasManagedError {
  constructor(code: string, message: string, details?: unknown) {
    super(0, code, message, details);
    this.name = "AtlasManagedNetworkError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard: lookup tuple `{ urn, cid }` vs full receipt. */
function isLookupTuple(input: AtlasReceipt | { urn: string; cid: string }): input is {
  urn: string;
  cid: string;
} {
  return (
    typeof (input as { urn?: unknown }).urn === "string" &&
    typeof (input as { cid?: unknown }).cid === "string" &&
    !("credentialSubject" in input)
  );
}

/**
 * Coerce a decimal `bigint` (or pre-stringified amount) to a string of digits.
 * The registry side validates as a string of digits, so this normalises inputs.
 */
function amountToString(amount: string | bigint): string {
  return typeof amount === "bigint" ? amount.toString(10) : amount;
}

interface RegistryErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

/**
 * Strip a trailing slash from `baseUrl` and concatenate `path`. Path is
 * expected to start with a leading slash (matches how the constants are
 * spelled below).
 */
function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}${path}`;
}

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

export function createAtlasManagedClient(config: AtlasManagedClientConfig): AtlasManagedClient {
  const fetchImpl: typeof fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(path: string, body: unknown): Promise<T> {
    const url = joinUrl(config.baseUrl, path);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Atlas-SDK-Version": SDK_VERSION,
    };
    if (config.platformAuthToken) {
      headers["Authorization"] = `Bearer ${config.platformAuthToken}`;
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const aborted = err instanceof Error && (err.name === "AbortError" || /abort/i.test(message));
      throw new AtlasManagedNetworkError(
        aborted ? "request_timeout" : "network_error",
        aborted ? `Request to ${url} aborted after ${timeoutMs}ms` : message,
        err,
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (response.ok) {
      // 2xx — parse and return the JSON body verbatim.
      return (await response.json()) as T;
    }

    // Non-2xx — try to parse the registry's error envelope. If the body is
    // not JSON or doesn't follow the envelope shape, fall back to the HTTP
    // status text.
    let parsed: RegistryErrorEnvelope | undefined;
    try {
      parsed = (await response.json()) as RegistryErrorEnvelope;
    } catch {
      parsed = undefined;
    }
    const code = parsed?.error?.code ?? `http_${response.status}`;
    const message =
      parsed?.error?.message ?? `${response.status} ${response.statusText || "request failed"}`;
    const details = parsed?.error?.details;

    if (response.status >= 500) {
      throw new AtlasManagedServerError(response.status, code, message, details);
    }
    throw new AtlasManagedRequestError(response.status, code, message, details);
  }

  return {
    async pinReceipt(receipt) {
      return request<PinReceiptResponse>("/atlas/v1/receipts/pin", { receipt });
    },

    async verifyReceipt(input) {
      const body = isLookupTuple(input) ? { urn: input.urn, cid: input.cid } : { receipt: input };
      return request<VerifyReceiptResponse>("/atlas/v1/receipts/verify", body);
    },

    async settle(opts) {
      const body = {
        platform_domain: opts.platformDomain,
        chain: opts.chain,
        organizer: opts.organizer,
        total_amount: amountToString(opts.totalAmount),
        payment_id: opts.paymentId,
        platform_fees: opts.platformFees.map((fee) => ({
          recipient: fee.recipient,
          amount: amountToString(fee.amount),
        })),
      };
      return request<SettleResponse>("/atlas/v1/settlements/settle", body);
    },

    async recordRewards(opts) {
      const body = {
        platform_domain: opts.platformDomain,
        payment_id: opts.paymentId,
        recipients: opts.recipients.map((r) => ({
          recipient: r.recipient,
          kind: r.kind,
          amount: amountToString(r.amount),
        })),
      };
      return request<RecordRewardsResponse>("/atlas/v1/rewards/record", body);
    },
  };
}
