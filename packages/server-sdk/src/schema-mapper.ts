import { createHash } from 'node:crypto';

import type {
  AtlasEvent,
  AtlasEventAvailability,
  AtlasEventLocation,
  AtlasEventStatus,
  AtlasFee,
  AtlasTicketAvailabilityStatus,
  AtlasTicketType,
} from './types/index.js';

/**
 * Source-platform event shape accepted by the mapper. Field names mirror
 * the Lemonade event model but are deliberately generic so other platforms
 * can adapt their own data into this shape.
 */
export interface AtlasInputEvent {
  /** Unique stable ID — opaque string. Hex-string ObjectIds work as-is. */
  id: string;
  title: string;
  slug?: string;
  description?: string;
  description_plain_text?: string;
  start: Date | string;
  end?: Date | string;
  state?: string;
  cover?: string;
  virtual?: boolean;
  virtual_url?: string;
  address?: AtlasInputAddress;
  location?: { type: 'Point'; coordinates: [number, number] };
  currency?: string;
  updated_at?: Date | string;
  /** Optional creation timestamp; falls back to updated_at when omitted. */
  created_at?: Date | string;
}

export interface AtlasInputAddress {
  street_1?: string;
  city?: string;
  region?: string;
  postal?: string;
  country?: string;
}

export interface AtlasInputSpace {
  id: string;
  title?: string;
  slug?: string;
}

export interface AtlasInputTicketTypePrice {
  default?: boolean;
  /** ISO-4217 fiat code or ticker (USD, USDC, ETH, ...). */
  currency: string;
  /** Smallest-unit integer string (cents for USD, micro-USDC, wei, ...). */
  cost: string;
}

export interface AtlasInputTicketType {
  id: string;
  title: string;
  description?: string;
  active: boolean;
  default?: boolean;
  private?: boolean;
  prices?: AtlasInputTicketTypePrice[];
  ticket_limit?: number;
  ticket_limit_per?: number;
  ticket_count?: number;
  approval_required?: boolean;
}

export interface MapEventOptions {
  /** Source platform name embedded in `atlas:source_platform`. */
  sourcePlatform: string;
  /** Public web URL for the platform (used to build `organizer.url`). */
  platformUrl: string;
  /** API base URL where the purchase endpoint lives. */
  baseUrl: string;
  /** Payment methods to advertise on each event. */
  acceptedPaymentMethods: string[];
}

export interface MapTicketTypeOptions {
  /** Platform fee percent (3.5 for 3.5%). */
  platformFeePercent: number;
  /** Protocol fee percent. Defaults to 2%. */
  protocolFeePercent?: number;
  /** Per-tx processing fee in dollars. Defaults to $0.001 (Tempo USDC). */
  paymentProcessingFee?: number;
  /** Payment methods to advertise on this ticket. */
  acceptedPaymentMethods: string[];
}

const DEFAULT_PROTOCOL_FEE = 2;
const DEFAULT_PROCESSING_FEE = 0.001;

/**
 * Build an ATLAS-compliant Event JSON-LD object from a source-platform event.
 */
export function toAtlasEvent(
  event: AtlasInputEvent,
  space: AtlasInputSpace,
  ticketTypes: AtlasInputTicketType[],
  options: MapEventOptions,
): AtlasEvent {
  const atlasId = generateDeterministicUuid(event.id);
  const organizerId = generateDeterministicUuid(space.id);
  const currency = event.currency ?? 'USD';

  const visibleTickets = ticketTypes.filter((tt) => tt.active && !tt.private);
  const prices = visibleTickets
    .flatMap((tt) => tt.prices ?? [])
    .map((p) => toHumanAmount(p.cost, p.currency));

  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const availability = computeEventAvailability(event, ticketTypes);
  const location = event.virtual ? mapVirtualLocation(event) : mapPhysicalLocation(event);
  const eventStatus = mapEventStatus(event.state);
  const startDate = toIsoString(event.start);
  const endDate = event.end !== undefined ? toIsoString(event.end) : undefined;
  const platformUrlBase = trimTrailingSlash(options.platformUrl);
  const updatedAt = event.updated_at
    ? toIsoString(event.updated_at)
    : new Date().toISOString();
  const createdAt = event.created_at ? toIsoString(event.created_at) : updatedAt;

  return {
    '@context': {
      '@vocab': 'https://schema.org/',
      atlas: 'https://atlas-protocol.org/v1/vocab#',
    },
    '@type': 'Event',
    '@id': `atlas:${options.sourcePlatform}:${event.id}`,
    name: event.title,
    description: event.description_plain_text ?? event.description ?? '',
    startDate,
    ...(endDate !== undefined && { endDate }),
    location,
    organizer: {
      '@type': 'Organization',
      name: space.title ?? space.slug ?? 'Unknown',
      url: `${platformUrlBase}/space/${space.slug ?? space.id}`,
    },
    ...(event.cover !== undefined && { image: event.cover }),
    url: `${platformUrlBase}/event/${event.slug ?? event.id}`,
    eventStatus,
    eventAttendanceMode: event.virtual
      ? 'OnlineEventAttendanceMode'
      : 'OfflineEventAttendanceMode',
    'atlas:id': atlasId,
    'atlas:source_platform': options.sourcePlatform,
    'atlas:source_event_id': event.id,
    'atlas:organizer_id': organizerId,
    'atlas:organizer_verified': true,
    'atlas:categories': [],
    'atlas:tags': [],
    'atlas:availability': availability,
    'atlas:price_range': {
      min_price: minPrice,
      max_price: maxPrice,
      currency,
      includes_fees: false,
    },
    'atlas:ticket_types_count': visibleTickets.length,
    'atlas:purchase_endpoint': `${trimTrailingSlash(options.baseUrl)}/atlas/v1/events/${event.id}/purchase`,
    'atlas:currency': currency,
    'atlas:accepts_payment_methods': options.acceptedPaymentMethods,
    'atlas:last_synced': new Date().toISOString(),
    'atlas:created_at': createdAt,
    'atlas:updated_at': updatedAt,
  };
}

/**
 * Build an ATLAS-compliant TicketType from a source-platform ticket type.
 */
export function toAtlasTicketType(
  ticketType: AtlasInputTicketType,
  event: AtlasInputEvent,
  options: MapTicketTypeOptions,
): AtlasTicketType {
  const atlasTicketTypeId = generateDeterministicUuid(ticketType.id);
  const atlasEventId = generateDeterministicUuid(event.id);

  const price = ticketType.prices?.find((p) => p.default) ?? ticketType.prices?.[0];
  const priceCurrency = price?.currency ?? event.currency ?? 'USD';
  const basePriceDollars = price ? toHumanAmount(price.cost, priceCurrency) : 0;

  const protocolFeePercent = options.protocolFeePercent ?? DEFAULT_PROTOCOL_FEE;
  const processingFee = options.paymentProcessingFee ?? DEFAULT_PROCESSING_FEE;

  const protocolFee = roundTo6(basePriceDollars * (protocolFeePercent / 100));
  const platformFee = roundTo6(basePriceDollars * (options.platformFeePercent / 100));

  const fees: AtlasFee[] = basePriceDollars > 0
    ? [
        {
          name: 'atlas_protocol_fee',
          type: 'percentage',
          rate: protocolFeePercent,
          amount: protocolFee,
          description: `Atlas Protocol fee (${protocolFeePercent}%)`,
        },
        {
          name: 'platform_fee',
          type: 'percentage',
          rate: options.platformFeePercent,
          amount: platformFee,
          description: `Platform fee (${options.platformFeePercent}%)`,
        },
        {
          name: 'payment_processing',
          type: 'fixed',
          amount: processingFee,
          description: 'Payment processing fee',
        },
      ]
    : [];

  const feesTotal = fees.reduce((sum, f) => sum + f.amount, 0);
  const totalPrice = roundTo6(basePriceDollars + feesTotal);

  const limit = ticketType.ticket_limit ?? null;
  const sold = ticketType.ticket_count ?? 0;
  const remaining = limit !== null ? limit - sold : null;
  const remainingRatio = limit !== null && limit > 0 ? (remaining ?? 0) / limit : 1;

  let status: AtlasTicketAvailabilityStatus = 'available';
  if (!ticketType.active) status = 'not_on_sale';
  else if (ticketType.private) status = 'hidden';
  else if (remaining !== null && remaining <= 0) status = 'sold_out';
  else if (remainingRatio < 0.1) status = 'few_remaining';

  return {
    'atlas:ticket_type_id': atlasTicketTypeId,
    'atlas:source_ticket_type_id': ticketType.id,
    name: ticketType.title,
    ...(ticketType.description !== undefined && { description: ticketType.description }),
    'atlas:event_id': atlasEventId,
    'atlas:pricing': {
      base_price: basePriceDollars,
      currency: priceCurrency,
      fees,
      total_price: totalPrice,
      fees_total: roundTo6(feesTotal),
      tax_included: false,
      tax_amount: null,
    },
    'atlas:availability': {
      status,
      total_quantity: limit,
      remaining_quantity: remaining,
      max_per_order: ticketType.ticket_limit_per ?? 10,
      min_per_order: 1,
      sale_start: null,
      sale_end: event.end !== undefined ? toIsoString(event.end) : null,
      on_sale: status === 'available' || status === 'few_remaining',
    },
    'atlas:restrictions': {
      age_minimum: null,
      age_maximum: null,
      requires_approval: ticketType.approval_required ?? false,
      requires_invitation_code: ticketType.private ?? false,
      geographic_restrictions: [],
      requires_identity_verification: false,
      transferable: true,
      resellable: false,
      custom_restrictions: [],
    },
    'atlas:cancellation_policy': {
      refundable: false,
      refund_type: 'none',
      refund_deadline: null,
      partial_refund_schedule: null,
      cancellation_fee: 0,
      policy_text: 'Refund policy is determined by the event organizer.',
      organizer_cancellation_refund: 'manual_review',
    },
    'atlas:accepted_payment_methods': basePriceDollars > 0 ? options.acceptedPaymentMethods : [],
    'atlas:metadata': {},
  };
}

// ---------- Conversion helpers ----------

/**
 * Convert a cents string to a USD float. Useful for fiat amounts stored
 * in stripe-style integer cents.
 */
export function centsToDollars(centsStr: string): number {
  const cents = Number(centsStr);
  if (Number.isNaN(cents)) return 0;

  return roundTo6(cents / 100);
}

export function dollarsToCents(dollars: number): string {
  return String(Math.round(dollars * 100));
}

/**
 * Default decimals for known crypto/stablecoin currencies. Override by
 * passing `decimals` directly to `toHumanAmount` if your platform supports
 * additional tokens.
 */
const CRYPTO_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  ETH: 18,
  MATIC: 18,
  BNB: 18,
  AVAX: 18,
  OP: 18,
  ARB: 18,
  SOL: 9,
};

/**
 * Common ISO-4217 fiat decimals. Most fiat is 2dp; JPY/KRW/CLP are 0;
 * KWD/JOD/BHD are 3dp.
 */
const FIAT_DECIMALS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, CHF: 2, CNY: 2, HKD: 2, INR: 2,
  JPY: 0, KRW: 0, CLP: 0, ISK: 0, VND: 0,
  KWD: 3, JOD: 3, BHD: 3, OMR: 3, TND: 3,
};

function getCurrencyDecimals(currency: string): number {
  const upper = currency.toUpperCase();

  // Fiat first (matches lemonade-backend behaviour where Stripe-supported
  // fiat currencies take precedence over the crypto fallback table).
  if (upper in FIAT_DECIMALS) return FIAT_DECIMALS[upper] as number;
  if (upper in CRYPTO_DECIMALS) return CRYPTO_DECIMALS[upper] as number;

  // Default: 18 (most EVM tokens).
  return 18;
}

/**
 * Convert a smallest-unit integer string to a human-readable float for a
 * known currency. Handles fiat (cents) and crypto (wei / micro-USDC).
 */
export function toHumanAmount(costStr: string, currency: string): number {
  const raw = Number(costStr);
  if (Number.isNaN(raw) || raw === 0) return 0;

  return roundTo6(raw / Math.pow(10, getCurrencyDecimals(currency)));
}

function roundTo6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Build a deterministic UUIDv4-shaped string from any opaque ID. Used so
 * agents see stable IDs across syncs without leaking the source platform's
 * internal primary keys.
 */
export function generateDeterministicUuid(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  const h = hash.slice(0, 32).split('');
  // Set version (7th nibble of byte 6 = 4)
  h[12] = '4';
  // Set IETF variant (top 2 bits of byte 8 = 10)
  const byte8 = h[16];
  if (byte8 !== undefined) {
    h[16] = ((parseInt(byte8, 16) & 0x3) | 0x8).toString(16);
  }
  const flat = h.join('');

  return [
    flat.slice(0, 8),
    flat.slice(8, 12),
    flat.slice(12, 16),
    flat.slice(16, 20),
    flat.slice(20, 32),
  ].join('-');
}

function mapEventStatus(state?: string): AtlasEventStatus {
  switch (state) {
    case 'cancelled':
      return 'EventCancelled';
    case 'ended':
      return 'EventEnded';
    default:
      return 'EventScheduled';
  }
}

function computeEventAvailability(
  event: AtlasInputEvent,
  ticketTypes: AtlasInputTicketType[],
): AtlasEventAvailability {
  if (event.state === 'cancelled') return 'cancelled';
  const activeTypes = ticketTypes.filter((tt) => tt.active && !tt.private);
  if (activeTypes.length === 0) return 'not_on_sale';
  const hasAvailable = activeTypes.some(
    (tt) => tt.ticket_limit === undefined || (tt.ticket_count ?? 0) < tt.ticket_limit,
  );
  if (!hasAvailable) return 'sold_out';
  const totalLimit = activeTypes.reduce((sum, tt) => sum + (tt.ticket_limit ?? 0), 0);
  const totalSold = activeTypes.reduce((sum, tt) => sum + (tt.ticket_count ?? 0), 0);
  if (totalLimit > 0 && (totalLimit - totalSold) / totalLimit < 0.1) return 'few_remaining';

  return 'available';
}

function mapPhysicalLocation(event: AtlasInputEvent): AtlasEventLocation {
  const addr = event.address ?? {};
  const coords = event.location?.coordinates;

  return {
    '@type': 'Place',
    name: addr.street_1 ?? 'TBD',
    address: {
      '@type': 'PostalAddress',
      streetAddress: addr.street_1 ?? '',
      addressLocality: addr.city ?? '',
      addressRegion: addr.region,
      postalCode: addr.postal,
      addressCountry: addr.country ?? 'US',
    },
    ...(coords !== undefined && {
      geo: {
        '@type': 'GeoCoordinates',
        latitude: coords[1],
        longitude: coords[0],
      },
    }),
  };
}

function mapVirtualLocation(event: AtlasInputEvent): AtlasEventLocation {
  return {
    '@type': 'VirtualLocation',
    url: event.virtual_url ?? '',
  };
}
