/**
 * W3C Verifiable Credential receipt issued after a successful ATLAS purchase.
 *
 * Schema reference: `01-whitepaper/docs/02-SCHEMAS.md` §5 (AtlasCredential) and
 * `01-whitepaper/docs/01-PROTOCOL-SPEC.md` §4 (Receipt Format). Both name the
 * VC `type` value `AtlasTicketReceipt`.
 *
 * These types are pure data shapes. The corresponding builder
 * (`generateReceipt`) and the W3C VC URL constants live in
 * `@atlasprotocol/server-sdk` alongside the runtime payment verifiers that
 * consume them.
 */

/** Receipt rail discriminator — picks which settlement field is populated. */
export type ReceiptPaymentMethod = "x402" | "stripe_spt";

/** Settlement details embedded in `credentialSubject`. */
export interface AtlasReceiptSettlement {
  /** Always present for x402; omitted for Stripe. */
  tx_hash?: string;
  /** Always present for x402; omitted for Stripe. */
  chain?: string;
  /** Always present for Stripe; omitted for x402. */
  payment_intent_id?: string;
  /** Echoed amount (decimal string). */
  amount: string;
  /** Echoed currency. */
  currency: string;
  /** Settlement rail. */
  method: ReceiptPaymentMethod;
}

export interface AtlasReceiptCredentialSubject {
  /** Holder identifier (wallet, DID, or other URI). */
  id: string;
  event_id: string;
  hold_id: string;
  ticket_type?: string;
  quantity?: number;
  settlement: AtlasReceiptSettlement;
}

/**
 * The W3C VC representation of an ATLAS ticket receipt. The `proof` field is
 * intentionally optional — `generateReceipt` returns an unsigned credential
 * that the host signs separately (ES256 over the credential body).
 */
export interface AtlasReceipt {
  "@context": readonly string[];
  type: readonly string[];
  /** Optional credential URI (e.g. `urn:atlas:receipt:rec_abc123`). */
  id?: string;
  issuer: string;
  issuanceDate: string;
  credentialSubject: AtlasReceiptCredentialSubject;
  /**
   * Reserved for the ES256 JWS proof block. Left undefined by
   * `generateReceipt` — the host application attaches it after signing.
   */
  proof?: AtlasReceiptProof;
}

export interface AtlasReceiptProof {
  type: string;
  created: string;
  verificationMethod: string;
  proofPurpose: string;
  jws: string;
}
