/**
 * ATLAS Event JSON-LD shape — schema.org/Event extended with the
 * `atlas:` vocabulary for cross-platform discovery and purchase.
 */
export interface AtlasEventLocation {
  '@type': string;
  name?: string;
  url?: string;
  address?: {
    '@type': 'PostalAddress';
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string | undefined;
    postalCode?: string | undefined;
    addressCountry?: string;
  };
  geo?: {
    '@type': 'GeoCoordinates';
    latitude: number;
    longitude: number;
  };
}

export interface AtlasEventOrganizer {
  '@type': 'Organization';
  name: string;
  url?: string;
}

export type AtlasEventAvailability =
  | 'available'
  | 'few_remaining'
  | 'sold_out'
  | 'cancelled'
  | 'not_on_sale';

export type AtlasEventStatus =
  | 'EventScheduled'
  | 'EventCancelled'
  | 'EventEnded'
  | 'EventPostponed'
  | 'EventRescheduled';

export interface AtlasPriceRange {
  min_price: number;
  max_price: number;
  currency: string;
  includes_fees: boolean;
}

export interface AtlasEvent {
  '@context': { '@vocab': string; atlas: string };
  '@type': 'Event';
  '@id': string;
  name: string;
  description: string;
  startDate: string;
  endDate?: string | undefined;
  location: AtlasEventLocation;
  organizer: AtlasEventOrganizer;
  image?: string | undefined;
  url?: string | undefined;
  eventStatus: AtlasEventStatus;
  eventAttendanceMode:
    | 'OnlineEventAttendanceMode'
    | 'OfflineEventAttendanceMode'
    | 'MixedEventAttendanceMode';
  'atlas:id': string;
  'atlas:source_platform': string;
  'atlas:source_event_id': string;
  'atlas:organizer_id': string;
  'atlas:organizer_verified': boolean;
  'atlas:categories': string[];
  'atlas:tags': string[];
  'atlas:availability': AtlasEventAvailability;
  'atlas:price_range': AtlasPriceRange;
  'atlas:ticket_types_count': number;
  'atlas:purchase_endpoint': string;
  'atlas:currency': string;
  'atlas:accepts_payment_methods': string[];
  'atlas:last_synced': string;
  'atlas:created_at': string;
  'atlas:updated_at': string;
  [key: string]: unknown;
}
