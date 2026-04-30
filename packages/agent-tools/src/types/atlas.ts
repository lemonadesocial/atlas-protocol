/**
 * Wire-format response shapes for the ATLAS Protocol HTTP surface.
 *
 * These mirror the canonical schemas in `specs/02-SCHEMAS.md`. Keep this file
 * in sync with the spec — it is the public type surface for any agent runtime
 * speaking ATLAS via this package.
 */

export interface AtlasSearchResult {
  items: Array<{
    id: string;
    title: string;
    start: string;
    end?: string;
    location?: string;
    source: string;
    ticket_types?: Array<{
      id: string;
      title: string;
      price: number;
      currency: string;
      available: boolean;
    }>;
  }>;
  cursor: string | null;
  total: number;
  sources: string[];
  /** Set when the registry returned degraded results (e.g. upstream timeout). */
  degraded?: boolean;
}

export interface AtlasEventDetail {
  id: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  description?: string;
  ticket_types: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    available: boolean;
    quantity_remaining?: number;
  }>;
}

/**
 * 402 challenge payload — issued by the backend when payment is required to
 * complete a purchase. Per the ATLAS / x402 contract, agents do NOT sign
 * payments inside this package; they surface the challenge upstream.
 */
export interface AtlasChallengeResponse {
  "atlas:challenge": {
    challenge_id: string;
    ticket_hold_id: string;
    hold_expires_at: string;
    hold_ttl_seconds: number;
    price_valid_until: string;
    pricing: {
      quantity: number;
      unit_price: number;
      base_price: number;
      fees_total: number;
      total_price: number;
      currency: string;
    };
    payment_methods: Array<{ type: string; label: string; recipient_address?: string }>;
  };
}

export interface AtlasFreeTicketResponse {
  type: "free_ticket_redirect";
  message: string;
  redirect_url: string;
}

export type AtlasPurchaseResponse = AtlasChallengeResponse | AtlasFreeTicketResponse;

export interface AtlasCheckoutResponse {
  checkout_url: string;
  expires_at: string;
}

export interface AtlasReceiptResponse {
  hold_id: string;
  status: "pending" | "completed" | "expired";
  event_id: string;
  event_title: string;
  ticket_type_title: string;
  quantity: number;
  total_amount?: number;
  currency?: string;
  completed_at?: string;
}
