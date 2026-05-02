/**
 * Envelope encode / decode for the Machine Payments Protocol.
 *
 * Canonical spec: https://mpp.dev/protocol (accessed 2026-04-30).
 *
 * `encode()` lifts a developer-facing `MppPayload` into a wire-shape
 * `MppEnvelope` whose layout matches the canonical Challenge object
 * (https://mpp.dev/protocol/challenges). `decode()` is the inverse —
 * round-tripping through `encode()` then `decode()` MUST return a value
 * deeply equal to the input (asserted by `__tests__/envelope.test.ts`).
 *
 * Wire serialization (base64url-JCS string suitable for the Authorization
 * or WWW-Authenticate header) is handled by `serialize()` /
 * `deserialize()` further down.
 */

import type { MppEnvelope, MppHeader, MppRequest } from "./types/envelope.js";
import type { MppLineItem, MppPayload } from "./types/payload.js";
import { isValidMethodIdentifier } from "./rails.js";

/**
 * Current MPP protocol version this implementation targets.
 *
 * MPP-GAP-001 — the canonical spec at mpp.dev does not currently expose
 * a numeric protocol version (only a `mpp.dev@<git-sha>` build label).
 * We pin "1.0" as the protected-header `mpp_ver` per the task brief.
 */
export const MPP_PROTOCOL_VERSION = "1.0";

/** Reserved keys that `encode()` writes into the request payload. */
const RESERVED_REQUEST_KEYS = {
  amount: "amount",
  currency: "currency",
  recipient: "recipient",
  organizer: "organizer",
  items: "items",
  metadata: "metadata",
} as const;

/**
 * Lift a developer-facing `MppPayload` into a wire-shape `MppEnvelope`.
 */
export function encode(payload: MppPayload): MppEnvelope {
  if (!payload.rail) throw new Error("encode: payload.rail is required");
  if (!isValidMethodIdentifier(payload.rail))
    throw new Error(`encode: payload.rail "${payload.rail}" is not a valid MPP method identifier`);
  if (!payload.realm) throw new Error("encode: payload.realm is required");
  if (!payload.paymentId) throw new Error("encode: payload.paymentId is required");
  if (!payload.amount) throw new Error("encode: payload.amount is required");
  if (!payload.currency) throw new Error("encode: payload.currency is required");

  const header: MppHeader = {
    mpp_ver: MPP_PROTOCOL_VERSION,
    id: payload.paymentId,
    realm: payload.realm,
    method: payload.rail,
    intent: payload.intent ?? "charge",
    ...(payload.expires !== undefined && { expires: payload.expires }),
    ...(payload.description !== undefined && {
      description: payload.description,
    }),
    ...(payload.ttl !== undefined && { ttl: payload.ttl }),
  };

  const request: MppRequest = {
    [RESERVED_REQUEST_KEYS.amount]: payload.amount,
    [RESERVED_REQUEST_KEYS.currency]: payload.currency,
    ...(payload.recipient !== undefined && {
      [RESERVED_REQUEST_KEYS.recipient]: payload.recipient,
    }),
    ...(payload.organizer !== undefined && {
      [RESERVED_REQUEST_KEYS.organizer]: payload.organizer,
    }),
    ...(payload.items !== undefined && {
      [RESERVED_REQUEST_KEYS.items]: payload.items.map(normalizeLineItem),
    }),
    ...(payload.metadata !== undefined && {
      [RESERVED_REQUEST_KEYS.metadata]: { ...payload.metadata },
    }),
  };

  const envelope: MppEnvelope = { header, request };
  return envelope;
}

/**
 * Inverse of `encode()`. Pulls the developer-facing payload back out of a
 * wire-shape envelope.
 */
export function decode(envelope: MppEnvelope): MppPayload {
  const { header, request } = envelope;
  if (!header) throw new Error("decode: envelope.header is required");
  if (!request) throw new Error("decode: envelope.request is required");

  const amount = expectString(request[RESERVED_REQUEST_KEYS.amount], "request.amount");
  const currency = expectString(request[RESERVED_REQUEST_KEYS.currency], "request.currency");
  const recipient = optionalString(request[RESERVED_REQUEST_KEYS.recipient]);
  const organizer = optionalString(request[RESERVED_REQUEST_KEYS.organizer]);

  const rawItems = request[RESERVED_REQUEST_KEYS.items];
  const items = rawItems !== undefined ? readLineItems(rawItems) : undefined;

  const rawMetadata = request[RESERVED_REQUEST_KEYS.metadata];
  const metadata = rawMetadata !== undefined ? readMetadata(rawMetadata) : undefined;

  const payload: MppPayload = {
    rail: header.method,
    realm: header.realm,
    paymentId: header.id,
    amount,
    currency,
    ...(header.intent !== undefined && { intent: header.intent }),
    ...(recipient !== undefined && { recipient }),
    ...(organizer !== undefined && { organizer }),
    ...(header.description !== undefined && {
      description: header.description,
    }),
    ...(header.expires !== undefined && { expires: header.expires }),
    ...(items !== undefined && { items }),
    ...(metadata !== undefined && { metadata }),
    ...(header.ttl !== undefined && { ttl: header.ttl }),
  };

  return payload;
}

/**
 * Stable, ordered JSON serialization of the envelope. Matches the JCS
 * (RFC 8785) approach the canonical spec uses for base64url request
 * encoding — keys are sorted lexicographically at every depth.
 *
 * MPP-GAP-003 — RFC 8785 mandates JCS (sorted keys, no whitespace,
 * canonical number formatting). We implement the sorted-keys + no-whitespace
 * portion which covers our payload shape (strings/booleans/integers only;
 * no IEEE-754 edge cases). Documented in SPEC-NOTES.md §Gaps.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * Wire-encode an envelope as a base64url-JCS string suitable for the
 * Authorization or WWW-Authenticate header.
 */
export function serialize(envelope: MppEnvelope): string {
  const json = canonicalize(envelope);
  return base64UrlEncode(json);
}

/**
 * Wire-decode a base64url-JCS string back into an envelope.
 */
export function deserialize(encoded: string): MppEnvelope {
  const json = base64UrlDecode(encoded);
  const parsed = JSON.parse(json) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("header" in parsed) ||
    !("request" in parsed)
  ) {
    throw new Error("deserialize: not an MPP envelope");
  }
  return parsed as MppEnvelope;
}

// --- internal helpers -----------------------------------------------------

function normalizeLineItem(item: MppLineItem): Record<string, unknown> {
  return {
    id: item.id,
    unitAmount: item.unitAmount,
    ...(item.description !== undefined && { description: item.description }),
    ...(item.quantity !== undefined && { quantity: item.quantity }),
  };
}

function readLineItems(raw: unknown): MppLineItem[] {
  if (!Array.isArray(raw)) throw new Error("decode: request.items must be an array");
  return raw.map((entry, idx) => {
    if (typeof entry !== "object" || entry === null)
      throw new Error(`decode: request.items[${idx}] must be an object`);
    const e = entry as Record<string, unknown>;
    const id = expectString(e["id"], `request.items[${idx}].id`);
    const unitAmount = expectString(e["unitAmount"], `request.items[${idx}].unitAmount`);
    const description = optionalString(e["description"]);
    const quantity = e["quantity"];
    if (quantity !== undefined && typeof quantity !== "number")
      throw new Error(`decode: request.items[${idx}].quantity must be a number`);
    const item: MppLineItem = {
      id,
      unitAmount,
      ...(description !== undefined && { description }),
      ...(quantity !== undefined && { quantity }),
    };
    return item;
  });
}

function readMetadata(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("decode: request.metadata must be an object");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string")
      throw new Error(`decode: request.metadata.${k} must be a string (got ${typeof v})`);
    out[k] = v;
  }
  return out;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`decode: ${label} must be a string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("decode: expected string or undefined");
  return value;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    // `undefined` entries are dropped — JSON has no representation for them, and including them would break round-trip equivalence.
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeysDeep(v);
    return out;
  }
  return value;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(encoded: string): string {
  const padded = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}
