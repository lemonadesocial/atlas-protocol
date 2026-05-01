/**
 * Payment challenge issued by an ATLAS server in response to a purchase intent.
 * The buyer completes settlement (on-chain or off-chain), then submits a
 * payment proof matching this challenge.
 */
export interface AtlasPurchaseChallenge {
  challenge_id: string;
  event_id: string;
  ticket_type_id: string;
  quantity: number;
  expected_amount_usd: number;
  currency: string;
  payment_methods: AtlasPaymentMethod[];
  expires_at: string;
}

export interface AtlasPaymentMethod {
  type: AtlasPaymentMethodType;
  recipient_address?: string;
  chain_id?: number;
  contract_address?: string;
  decimals?: number;
  metadata?: Record<string, unknown>;
}

export type AtlasPaymentMethodType =
  | "tempo_usdc"
  | "base_usdc"
  | "base_sepolia_usdc"
  | "arbitrum_usdc"
  | "polygon_usdc"
  | "optimism_usdc"
  | "zksync_usdc"
  | "worldchain_usdc"
  | "megaeth_usdm"
  | "solana_usdc"
  | "stripe_spt";

/**
 * Proof a buyer submits after completing payment off-band.
 */
export interface AtlasPaymentProof {
  type: AtlasPaymentMethodType;
  transaction_hash?: string;
  payment_intent_id?: string;
  metadata?: Record<string, unknown>;
}

export interface AtlasPaymentVerifyParams {
  expected_amount_usd: number;
  challenge_id: string;
  recipient_address?: string;
}

export interface AtlasPaymentVerifyResult {
  valid: boolean;
  verified_amount_usd?: number;
  error?: string;
}
