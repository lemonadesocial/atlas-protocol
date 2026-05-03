/**
 * W3C Verifiable Credential receipt issued after a successful ATLAS purchase.
 *
 * Schema reference: `01-whitepaper/docs/02-SCHEMAS.md` §5 (AtlasCredential) and
 * `01-whitepaper/docs/01-PROTOCOL-SPEC.md` §4 (Receipt Format). Both name the
 * VC `type` value `AtlasTicketReceipt`. This module produces an unsigned
 * credential — signing is left to the host (an ES256 JWS proof block can be
 * attached after issuance).
 *
 * The credential shape itself (`AtlasReceipt` and friends) is defined in
 * `@atlasprotocol/types`; this module re-exports those shapes for back-compat
 * and provides the runtime builder + JSON-LD context constants.
 */

import type {
  AtlasReceipt,
  AtlasReceiptCredentialSubject,
  AtlasReceiptSettlement,
  Pinner,
  ReceiptPaymentMethod,
} from "@atlasprotocol/types";

export type {
  AtlasReceipt,
  AtlasReceiptCredentialSubject,
  AtlasReceiptProof,
  AtlasReceiptSettlement,
  ReceiptPaymentMethod,
} from "@atlasprotocol/types";

/** W3C VC v1 JSON-LD context. Stable, registered, public. */
export const W3C_VC_V1_CONTEXT = "https://www.w3.org/2018/credentials/v1" as const;

/**
 * ATLAS-namespaced JSON-LD context. Mirrors the URL used in the canonical
 * schema docs (`01-whitepaper/docs/02-SCHEMAS.md` §5 example). Hosts SHOULD
 * publish a JSON-LD context document at this URL; the SDK does not enforce
 * resolvability.
 */
export const ATLAS_CREDENTIALS_V1_CONTEXT = "https://atlas.events/credentials/v1" as const;

/** Stable VC `type` array for ATLAS ticket receipts. */
export const ATLAS_RECEIPT_TYPES = [
  "VerifiableCredential",
  "AtlasTicketReceipt",
] as const satisfies readonly [string, string];

export interface GenerateReceiptOpts {
  /** Hold id this receipt redeems. Echoed into `credentialSubject` for audit. */
  holdId: string;
  /** ATLAS event id the receipt is bound to. */
  eventId: string;
  /** Holder identifier — wallet address or DID URI. */
  attendee: string;
  /** Settlement rail used. Drives which settlement field is populated. */
  paymentMethod: ReceiptPaymentMethod;
  /**
   * Total amount settled. Decimal string (e.g. "25.00" for fiat, "25.000000"
   * for USDC micro-precision) — caller decides precision.
   */
  amount: string;
  /** ISO 4217 (fiat) or token symbol (e.g. "USDC"). */
  currency: string;
  /**
   * On-chain tx hash. Required when `paymentMethod === "x402"`. MUST be
   * undefined for `stripe_spt` flows.
   */
  txHash?: string;
  /**
   * Stripe PaymentIntent id. Required when `paymentMethod === "stripe_spt"`.
   * MUST be undefined for `x402` flows.
   */
  paymentIntentId?: string;
  /**
   * Issuer DID — typically `did:web:<organizer-domain>`. Embedded as the VC
   * `issuer`. Also reused as the on-chain payee identifier.
   */
  organizerAddress: string;
  /**
   * Settlement chain identifier (e.g. "base", "arbitrum"). Required for
   * `x402` flows; ignored for Stripe.
   */
  settlementChain?: string;
  /**
   * ISO-8601 issuance timestamp. Defaults to `new Date().toISOString()` when
   * omitted.
   */
  issuedAt?: string;
  /**
   * Optional ticket type id, surfaced in `credentialSubject.ticket_type` when
   * provided. Matches `ticket_type_id` in the listing.
   */
  ticketTypeId?: string;
  /** Optional quantity, surfaced in `credentialSubject.quantity`. */
  quantity?: number;
  /** Optional credential URI (e.g. `urn:atlas:receipt:rec_abc123`). */
  credentialId?: string;
  /**
   * Optional pinner. When provided, the receipt is canonicalized and pinned
   * to IPFS in the same call; the returned CID is included in the result.
   * Use any `@atlasprotocol/ipfs` `Pinner` (Pinata, Web3.Storage, Filebase,
   * or self-hosted Kubo) — its `Pinner` interface comes from
   * `@atlasprotocol/types`, which both packages share.
   */
  pinner?: Pinner;
}

/** Return value of {@link generateReceipt}. */
export interface GenerateReceiptResult {
  receipt: AtlasReceipt;
  /** CID of the pinned receipt JSON. Present iff a pinner was supplied. */
  cid?: string;
}

/**
 * Build a canonical W3C VC ATLAS ticket receipt. Returned credential is
 * unsigned; host applications attach an ES256 JWS proof block before
 * publishing.
 *
 * When `opts.pinner` is supplied, the receipt is canonicalized and pinned to
 * IPFS in the same call; the resulting CID is returned alongside the receipt.
 * Otherwise only the receipt is returned (`cid` is `undefined`).
 *
 * Validates that the rail-specific settlement field is present:
 *  - `paymentMethod === "x402"` requires `txHash` (and `settlementChain`).
 *  - `paymentMethod === "stripe_spt"` requires `paymentIntentId`.
 */
export async function generateReceipt(opts: GenerateReceiptOpts): Promise<GenerateReceiptResult> {
  if (opts.paymentMethod === "x402") {
    if (!opts.txHash) {
      throw new Error('generateReceipt: txHash is required when paymentMethod === "x402"');
    }
    if (!opts.settlementChain) {
      throw new Error('generateReceipt: settlementChain is required when paymentMethod === "x402"');
    }
  } else if (opts.paymentMethod === "stripe_spt") {
    if (!opts.paymentIntentId) {
      throw new Error(
        'generateReceipt: paymentIntentId is required when paymentMethod === "stripe_spt"',
      );
    }
  } else {
    // Exhaustiveness guard: makes future rail additions a typecheck error.
    const exhaustive: never = opts.paymentMethod;
    throw new Error(`generateReceipt: unknown paymentMethod: ${String(exhaustive)}`);
  }

  if (!opts.amount) {
    throw new Error("generateReceipt: amount is required");
  }
  if (!opts.currency) {
    throw new Error("generateReceipt: currency is required");
  }
  if (!opts.attendee) {
    throw new Error("generateReceipt: attendee is required");
  }
  if (!opts.organizerAddress) {
    throw new Error("generateReceipt: organizerAddress is required");
  }
  if (!opts.eventId) {
    throw new Error("generateReceipt: eventId is required");
  }
  if (!opts.holdId) {
    throw new Error("generateReceipt: holdId is required");
  }

  const issuanceDate = opts.issuedAt ?? new Date().toISOString();

  const settlement: AtlasReceiptSettlement = {
    amount: opts.amount,
    currency: opts.currency,
    method: opts.paymentMethod,
    ...(opts.paymentMethod === "x402" && {
      tx_hash: opts.txHash,
      chain: opts.settlementChain,
    }),
    ...(opts.paymentMethod === "stripe_spt" && {
      payment_intent_id: opts.paymentIntentId,
    }),
  };

  const credentialSubject: AtlasReceiptCredentialSubject = {
    id: opts.attendee,
    event_id: opts.eventId,
    hold_id: opts.holdId,
    settlement,
    ...(opts.ticketTypeId !== undefined && { ticket_type: opts.ticketTypeId }),
    ...(opts.quantity !== undefined && { quantity: opts.quantity }),
  };

  const receipt: AtlasReceipt = {
    "@context": [W3C_VC_V1_CONTEXT, ATLAS_CREDENTIALS_V1_CONTEXT],
    type: ATLAS_RECEIPT_TYPES,
    issuer: opts.organizerAddress,
    issuanceDate,
    credentialSubject,
    ...(opts.credentialId !== undefined && { id: opts.credentialId }),
  };

  if (opts.pinner) {
    const { cid } = await opts.pinner.pinJson(receipt, {
      name: `atlas-receipt-${opts.holdId}`,
    });
    return { receipt, cid };
  }

  return { receipt };
}
