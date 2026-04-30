export interface AtlasFee {
  name: string;
  type: "percentage" | "fixed";
  rate?: number;
  amount: number;
  description: string;
}

export interface AtlasPricing {
  base_price: number;
  currency: string;
  fees: AtlasFee[];
  total_price: number;
  fees_total: number;
  tax_included: boolean;
  tax_amount: number | null;
}

export type AtlasTicketAvailabilityStatus =
  | "available"
  | "few_remaining"
  | "sold_out"
  | "not_on_sale"
  | "hidden";

export interface AtlasTicketAvailability {
  status: AtlasTicketAvailabilityStatus;
  total_quantity: number | null;
  remaining_quantity: number | null;
  max_per_order: number;
  min_per_order: number;
  sale_start: string | null;
  sale_end: string | null;
  on_sale: boolean;
}

export interface AtlasTicketRestrictions {
  age_minimum: number | null;
  age_maximum: number | null;
  requires_approval: boolean;
  requires_invitation_code: boolean;
  geographic_restrictions: string[];
  requires_identity_verification: boolean;
  transferable: boolean;
  resellable: boolean;
  custom_restrictions: string[];
}

export interface AtlasCancellationPolicy {
  refundable: boolean;
  refund_type: string;
  refund_deadline: string | null;
  partial_refund_schedule: unknown | null;
  cancellation_fee: number;
  policy_text: string;
  organizer_cancellation_refund: string;
}

export interface AtlasTicketType {
  "atlas:ticket_type_id": string;
  "atlas:source_ticket_type_id": string;
  name: string;
  description?: string | undefined;
  "atlas:event_id": string;
  "atlas:pricing": AtlasPricing;
  "atlas:availability": AtlasTicketAvailability;
  "atlas:restrictions": AtlasTicketRestrictions;
  "atlas:cancellation_policy": AtlasCancellationPolicy;
  "atlas:accepted_payment_methods": string[];
  "atlas:metadata": Record<string, unknown>;
}
