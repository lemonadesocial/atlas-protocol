import type { AtlasEvent, AtlasTicketType } from '@atlasprotocol/server-sdk';

import type {
  EventbriteEvent,
  EventbriteTicketClass,
} from './api.js';

const SOURCE_PLATFORM = 'eventbrite';
const ATLAS_VOCAB = 'https://schema.org/';
const ATLAS_NS = 'https://atlas-protocol.org/vocab#';

export interface MapEventOptions {
  /** Base URL of the host's ATLAS endpoint, used to build atlas:purchase_endpoint. */
  baseUrl: string;
  /** Optional override for atlas:accepts_payment_methods. */
  acceptedPaymentMethods?: string[];
  /** Pre-fetched ticket count, if available. Defaults to 0. */
  ticketTypesCount?: number;
}

export interface MapTicketTypeOptions {
  /** Optional override for atlas:accepted_payment_methods. */
  acceptedPaymentMethods?: string[];
}

/**
 * Convert an Eventbrite event into ATLAS JSON-LD. Pure function — no
 * network calls. Defaults are conservative: missing fields produce
 * empty strings or sensible neutral values rather than throwing.
 */
export function eventbriteEventToAtlas(
  eb: EventbriteEvent,
  opts: MapEventOptions,
): AtlasEvent {
  const startUtc = eb.start?.utc ?? '';
  const endUtc = eb.end?.utc;
  const name = eb.name?.text ?? '';
  const description = eb.description?.text ?? '';
  const status = mapStatus(eb.status);
  const attendanceMode = eb.online_event
    ? 'OnlineEventAttendanceMode'
    : 'OfflineEventAttendanceMode';
  const currency = eb.currency ?? 'USD';
  const organizerName = eb.organizer?.name ?? 'Unknown';
  const acceptedPaymentMethods = opts.acceptedPaymentMethods ?? [];
  const ticketTypesCount = opts.ticketTypesCount ?? 0;
  const lastSynced = new Date().toISOString();
  const createdAt = eb.created ?? lastSynced;
  const updatedAt = eb.changed ?? lastSynced;

  const atlasId = `atlas:eventbrite:${eb.id}`;
  const purchaseEndpoint = `${opts.baseUrl.replace(/\/$/, '')}/events/${encodeURIComponent(eb.id)}/purchase`;

  const event: AtlasEvent = {
    '@context': { '@vocab': ATLAS_VOCAB, atlas: ATLAS_NS },
    '@type': 'Event',
    '@id': atlasId,
    name,
    description,
    startDate: startUtc,
    location: buildLocation(eb, attendanceMode),
    organizer: {
      '@type': 'Organization',
      name: organizerName,
      ...(eb.organizer?.url ? { url: eb.organizer.url } : {}),
    },
    eventStatus: status,
    eventAttendanceMode: attendanceMode,
    'atlas:id': atlasId,
    'atlas:source_platform': SOURCE_PLATFORM,
    'atlas:source_event_id': eb.id,
    'atlas:organizer_id': eb.organizer?.id ?? eb.organization_id ?? '',
    'atlas:organizer_verified': false,
    'atlas:categories': [],
    'atlas:tags': [],
    'atlas:availability': status === 'EventCancelled' ? 'cancelled' : 'available',
    'atlas:price_range': {
      min_price: 0,
      max_price: 0,
      currency,
      includes_fees: false,
    },
    'atlas:ticket_types_count': ticketTypesCount,
    'atlas:purchase_endpoint': purchaseEndpoint,
    'atlas:currency': currency,
    'atlas:accepts_payment_methods': acceptedPaymentMethods,
    'atlas:last_synced': lastSynced,
    'atlas:created_at': createdAt,
    'atlas:updated_at': updatedAt,
  };

  if (endUtc !== undefined) event.endDate = endUtc;
  if (eb.logo?.url) event.image = eb.logo.url;
  if (eb.url) event.url = eb.url;

  return event;
}

/**
 * Convert an Eventbrite ticket class into an ATLAS ticket type. Pure
 * function — no network calls. Costs are denominated in cents in the
 * Eventbrite API's `value` field; we surface them as cents to remain
 * lossless and mark `tax_included` based on the presence of a tax cost.
 */
export function eventbriteTicketClassToAtlas(
  tc: EventbriteTicketClass,
  eventId: string,
  opts: MapTicketTypeOptions = {},
): AtlasTicketType {
  const basePrice = tc.cost?.value ?? 0;
  const feeAmount = tc.fee?.value ?? 0;
  const taxAmount = tc.tax?.value;
  const currency = tc.cost?.currency ?? tc.fee?.currency ?? 'USD';
  const acceptedPaymentMethods = opts.acceptedPaymentMethods ?? [];

  const fees = tc.fee?.value
    ? [
        {
          name: 'Eventbrite service fee',
          type: 'fixed' as const,
          amount: feeAmount,
          description: tc.fee?.display ?? '',
        },
      ]
    : [];

  const totalPrice = basePrice + feeAmount + (taxAmount ?? 0);
  const remaining =
    typeof tc.quantity_total === 'number' && typeof tc.quantity_sold === 'number'
      ? Math.max(0, tc.quantity_total - tc.quantity_sold)
      : null;
  const status = mapTicketStatus(tc, remaining);

  const ticket: AtlasTicketType = {
    'atlas:ticket_type_id': `atlas:eventbrite:${eventId}:${tc.id}`,
    'atlas:source_ticket_type_id': tc.id,
    name: tc.name,
    'atlas:event_id': `atlas:eventbrite:${eventId}`,
    'atlas:pricing': {
      base_price: basePrice,
      currency,
      fees,
      total_price: totalPrice,
      fees_total: feeAmount,
      tax_included: taxAmount !== undefined && taxAmount > 0,
      tax_amount: taxAmount ?? null,
    },
    'atlas:availability': {
      status,
      total_quantity: tc.quantity_total ?? null,
      remaining_quantity: remaining,
      max_per_order: tc.maximum_quantity ?? 10,
      min_per_order: tc.minimum_quantity ?? 1,
      sale_start: tc.sales_start ?? null,
      sale_end: tc.sales_end ?? null,
      on_sale: status === 'available' || status === 'few_remaining',
    },
    'atlas:restrictions': {
      age_minimum: null,
      age_maximum: null,
      requires_approval: false,
      requires_invitation_code: false,
      geographic_restrictions: [],
      requires_identity_verification: false,
      transferable: true,
      resellable: false,
      custom_restrictions: [],
    },
    'atlas:cancellation_policy': {
      refundable: false,
      refund_type: 'organizer_discretion',
      refund_deadline: null,
      partial_refund_schedule: null,
      cancellation_fee: 0,
      policy_text: 'Refunds subject to the organizer policy on Eventbrite.',
      organizer_cancellation_refund: 'full',
    },
    'atlas:accepted_payment_methods': acceptedPaymentMethods,
    'atlas:metadata': {
      free: tc.free ?? false,
      donation: tc.donation ?? false,
      hidden: tc.hidden ?? false,
      on_sale_status: tc.on_sale_status ?? null,
    },
  };

  if (tc.description) ticket.description = tc.description;

  return ticket;
}

function buildLocation(
  eb: EventbriteEvent,
  mode: 'OnlineEventAttendanceMode' | 'OfflineEventAttendanceMode' | 'MixedEventAttendanceMode',
): AtlasEvent['location'] {
  if (mode === 'OnlineEventAttendanceMode') {
    return {
      '@type': 'VirtualLocation',
      ...(eb.url ? { url: eb.url } : {}),
    };
  }

  const venue = eb.venue ?? null;
  const lat = parseFloatOrNull(venue?.latitude ?? venue?.address?.latitude);
  const lng = parseFloatOrNull(venue?.longitude ?? venue?.address?.longitude);
  const addr = venue?.address;

  const location: AtlasEvent['location'] = {
    '@type': 'Place',
    ...(venue?.name ? { name: venue.name } : {}),
  };

  if (addr) {
    location.address = {
      '@type': 'PostalAddress',
      ...(addr.address_1 ? { streetAddress: addr.address_1 } : {}),
      ...(addr.city ? { addressLocality: addr.city } : {}),
      ...(addr.region ? { addressRegion: addr.region } : {}),
      ...(addr.postal_code ? { postalCode: addr.postal_code } : {}),
      ...(addr.country ? { addressCountry: addr.country } : {}),
    };
  }

  if (lat !== null && lng !== null) {
    location.geo = { '@type': 'GeoCoordinates', latitude: lat, longitude: lng };
  }

  return location;
}

function parseFloatOrNull(input: string | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const n = Number.parseFloat(input);
  return Number.isFinite(n) ? n : null;
}

function mapStatus(s: EventbriteEvent['status']): AtlasEvent['eventStatus'] {
  switch (s) {
    case 'canceled':
      return 'EventCancelled';
    case 'ended':
    case 'completed':
      return 'EventEnded';
    case 'live':
    case 'started':
    case 'draft':
    default:
      return 'EventScheduled';
  }
}

function mapTicketStatus(
  tc: EventbriteTicketClass,
  remaining: number | null,
): AtlasTicketType['atlas:availability']['status'] {
  if (tc.hidden) return 'hidden';
  if (tc.on_sale_status === 'SOLD_OUT') return 'sold_out';
  if (tc.on_sale_status === 'NOT_YET_ON_SALE' || tc.on_sale_status === 'SALES_ENDED') {
    return 'not_on_sale';
  }
  if (remaining !== null && remaining <= 5 && remaining > 0) return 'few_remaining';
  if (remaining === 0) return 'sold_out';
  return 'available';
}
