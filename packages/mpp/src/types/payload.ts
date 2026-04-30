/**
 * Payload-level types for the MPP envelope.
 *
 * The canonical MPP wire structure carries a method-specific request object
 * inside the challenge envelope (https://mpp.dev/protocol/challenges,
 * accessed 2026-04-30). For the @atlas/mpp surface we expose:
 *
 *   - `MppPayload` — the developer-facing payload that an organizer uses
 *     to describe what they are charging for. `encode()` lifts this into
 *     a wire-shaped `MppEnvelope`; `decode()` is the inverse.
 *
 *   - `MppLineItem` — convenience type for itemized payloads.
 *
 * Where the canonical spec does not pin a field (organizer identity,
 * line-item shape, free-form metadata), the field is flagged with
 * `MPP-GAP-XXX` and documented in SPEC-NOTES.md.
 */

/**
 * A single charged item.
 *
 * MPP-GAP-002 — the canonical spec leaves "items" outside the core
 * challenge `request` object (each method defines its own request schema;
 * tempo and stripe both use a flat amount/currency shape). We surface a
 * generic itemized shape here that round-trips through the envelope's
 * metadata-style request payload. Documented in SPEC-NOTES.md §Gaps.
 */
export interface MppLineItem {
  /** Stable identifier for the line item (e.g. SKU, ticket type id). */
  id: string;
  /** Human-readable description. */
  description?: string;
  /** Item-level quantity. Defaults to 1 if omitted. */
  quantity?: number;
  /**
   * Item-level price as a decimal string in the payload `currency` units
   * (e.g. "12.50"). String to avoid float precision loss — matches how
   * mppx encodes amounts before `parseUnits` conversion.
   */
  unitAmount: string;
}

/**
 * Developer-facing payload, packaged into an `MppEnvelope` by `encode()`.
 *
 * Maps onto the canonical MPP challenge as follows:
 *   - `rail`            -> challenge `method`
 *   - `intent`          -> challenge `intent` (defaults to "charge")
 *   - `realm`           -> challenge `realm`
 *   - `paymentId`       -> challenge `id`           (caller-supplied)
 *   - `amount`/`currency`/`recipient` -> challenge `request`
 *   - `description`     -> challenge `description`
 *   - `expires`         -> challenge `expires`
 *   - `items`/`metadata`/`organizer` -> nested into challenge `request`
 *     under reserved keys (see SPEC-NOTES.md §Gaps for the binding).
 */
export interface MppPayload {
  /** Payment rail (canonical method identifier). */
  rail: string;
  /**
   * Method intent. Canonical values per mpp.dev: "charge", "session".
   * Defaults to "charge" if omitted at encode time.
   */
  intent?: string;
  /** Server realm — typically the API hostname. */
  realm: string;
  /** Stable payment id (becomes the challenge `id`). */
  paymentId: string;
  /** Payment amount as a decimal string in `currency` units (e.g. "10.00"). */
  amount: string;
  /**
   * Currency code or token contract address.
   *
   * For fiat / stripe-spt: ISO-4217 code (e.g. "usd").
   * For on-chain USDC rails: the ERC-20 token contract on the rail's chain.
   */
  currency: string;
  /**
   * Recipient address. For on-chain rails: receiver wallet. For stripe-spt:
   * an organizer-side merchant identifier. Optional because some intents
   * (e.g. "session") do not pin a recipient at challenge time.
   */
  recipient?: string;
  /** Free-form merchant identifier echoed in the challenge `request`. */
  organizer?: string;
  /** Human-readable description shown to the paying agent. */
  description?: string;
  /** ISO-8601 expiry. */
  expires?: string;
  /** Optional itemization. */
  items?: readonly MppLineItem[];
  /** Free-form merchant metadata, round-tripped intact. */
  metadata?: Readonly<Record<string, string>>;
  /**
   * Optional time-to-live in seconds. Mirrored into the protected JWS header
   * when signing. Independent of `expires` (which is the absolute deadline).
   */
  ttl?: number;
}
