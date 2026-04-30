import { describe, expect, it } from 'vitest';

import {
  eventbriteEventToAtlas,
  eventbriteTicketClassToAtlas,
} from '../mappers.js';
import type { EventbriteEvent, EventbriteTicketClass } from '../api.js';

const FIXTURE_EVENT: EventbriteEvent = {
  id: '1234567890',
  name: { text: 'Brooklyn Jazz Night', html: '<p>Brooklyn Jazz Night</p>' },
  description: { text: 'A live jazz showcase.', html: '<p>A live jazz showcase.</p>' },
  url: 'https://www.eventbrite.com/e/brooklyn-jazz-night-1234567890',
  start: { utc: '2026-06-01T23:00:00Z', timezone: 'America/New_York' },
  end: { utc: '2026-06-02T02:00:00Z', timezone: 'America/New_York' },
  created: '2026-04-01T10:00:00Z',
  changed: '2026-04-15T10:00:00Z',
  status: 'live',
  currency: 'USD',
  online_event: false,
  organization_id: 'org-99',
  logo: { url: 'https://img.evbuc.com/logo.jpg' },
  organizer: { id: 'org-1', name: 'Jazz Society', url: 'https://jazzsociety.example' },
  venue: {
    id: 'venue-7',
    name: 'The Blue Note',
    latitude: '40.7308',
    longitude: '-74.0008',
    address: {
      address_1: '131 W 3rd St',
      city: 'New York',
      region: 'NY',
      postal_code: '10012',
      country: 'US',
      latitude: '40.7308',
      longitude: '-74.0008',
    },
  },
};

const FIXTURE_ONLINE_EVENT: EventbriteEvent = {
  ...FIXTURE_EVENT,
  id: '99',
  online_event: true,
  venue: null,
};

const FIXTURE_CANCELLED_EVENT: EventbriteEvent = {
  ...FIXTURE_EVENT,
  id: '77',
  status: 'canceled',
};

const FIXTURE_TICKET: EventbriteTicketClass = {
  id: 'tc-1',
  name: 'General Admission',
  description: 'Standing room.',
  free: false,
  donation: false,
  cost: { display: '$25.00', currency: 'USD', value: 2500, major_value: '25.00' },
  fee: { display: '$2.50', currency: 'USD', value: 250, major_value: '2.50' },
  tax: { display: '$0.00', currency: 'USD', value: 0, major_value: '0.00' },
  quantity_total: 100,
  quantity_sold: 60,
  minimum_quantity: 1,
  maximum_quantity: 8,
  sales_start: '2026-04-01T00:00:00Z',
  sales_end: '2026-06-01T22:00:00Z',
  hidden: false,
  on_sale_status: 'AVAILABLE',
};

describe('eventbriteEventToAtlas', () => {
  it('maps a complete in-person live event to ATLAS', () => {
    const atlas = eventbriteEventToAtlas(FIXTURE_EVENT, {
      baseUrl: 'https://atlas.example.com',
      acceptedPaymentMethods: ['stripe_spt', 'base_usdc'],
      ticketTypesCount: 3,
    });

    expect(atlas['@type']).toBe('Event');
    expect(atlas['@id']).toBe('atlas:eventbrite:1234567890');
    expect(atlas.name).toBe('Brooklyn Jazz Night');
    expect(atlas.description).toBe('A live jazz showcase.');
    expect(atlas.startDate).toBe('2026-06-01T23:00:00Z');
    expect(atlas.endDate).toBe('2026-06-02T02:00:00Z');
    expect(atlas.eventStatus).toBe('EventScheduled');
    expect(atlas.eventAttendanceMode).toBe('OfflineEventAttendanceMode');
    expect(atlas.image).toBe('https://img.evbuc.com/logo.jpg');
    expect(atlas.url).toBe('https://www.eventbrite.com/e/brooklyn-jazz-night-1234567890');
    expect(atlas.organizer).toEqual({
      '@type': 'Organization',
      name: 'Jazz Society',
      url: 'https://jazzsociety.example',
    });
    expect(atlas.location['@type']).toBe('Place');
    expect(atlas.location.name).toBe('The Blue Note');
    expect(atlas.location.address?.streetAddress).toBe('131 W 3rd St');
    expect(atlas.location.address?.addressLocality).toBe('New York');
    expect(atlas.location.address?.addressCountry).toBe('US');
    expect(atlas.location.geo?.latitude).toBe(40.7308);
    expect(atlas.location.geo?.longitude).toBe(-74.0008);
    expect(atlas['atlas:source_platform']).toBe('eventbrite');
    expect(atlas['atlas:source_event_id']).toBe('1234567890');
    expect(atlas['atlas:organizer_id']).toBe('org-1');
    expect(atlas['atlas:availability']).toBe('available');
    expect(atlas['atlas:currency']).toBe('USD');
    expect(atlas['atlas:accepts_payment_methods']).toEqual(['stripe_spt', 'base_usdc']);
    expect(atlas['atlas:ticket_types_count']).toBe(3);
    expect(atlas['atlas:purchase_endpoint']).toBe(
      'https://atlas.example.com/events/1234567890/purchase',
    );
    expect(atlas['atlas:created_at']).toBe('2026-04-01T10:00:00Z');
    expect(atlas['atlas:updated_at']).toBe('2026-04-15T10:00:00Z');
  });

  it('maps an online event to OnlineEventAttendanceMode and VirtualLocation', () => {
    const atlas = eventbriteEventToAtlas(FIXTURE_ONLINE_EVENT, {
      baseUrl: 'https://atlas.example.com/',
    });
    expect(atlas.eventAttendanceMode).toBe('OnlineEventAttendanceMode');
    expect(atlas.location['@type']).toBe('VirtualLocation');
    expect(atlas.location.url).toBe(FIXTURE_ONLINE_EVENT.url);
    expect(atlas['atlas:purchase_endpoint']).toBe(
      'https://atlas.example.com/events/99/purchase',
    );
  });

  it('maps a canceled event to EventCancelled and atlas:availability cancelled', () => {
    const atlas = eventbriteEventToAtlas(FIXTURE_CANCELLED_EVENT, {
      baseUrl: 'https://atlas.example.com',
    });
    expect(atlas.eventStatus).toBe('EventCancelled');
    expect(atlas['atlas:availability']).toBe('cancelled');
  });

  it('falls back to defaults for missing optional fields', () => {
    const minimal: EventbriteEvent = { id: 'min-1', start: { utc: '2026-07-01T00:00:00Z' } };
    const atlas = eventbriteEventToAtlas(minimal, { baseUrl: 'https://atlas.example.com' });
    expect(atlas.name).toBe('');
    expect(atlas.description).toBe('');
    expect(atlas.eventStatus).toBe('EventScheduled');
    expect(atlas.eventAttendanceMode).toBe('OfflineEventAttendanceMode');
    expect(atlas['atlas:currency']).toBe('USD');
    expect(atlas['atlas:accepts_payment_methods']).toEqual([]);
    expect(atlas['atlas:ticket_types_count']).toBe(0);
    expect(atlas.organizer).toEqual({ '@type': 'Organization', name: 'Unknown' });
    expect(atlas.endDate).toBeUndefined();
    expect(atlas.image).toBeUndefined();
    expect(atlas.url).toBeUndefined();
  });
});

describe('eventbriteTicketClassToAtlas', () => {
  it('maps a paid ticket class with sales metadata', () => {
    const ticket = eventbriteTicketClassToAtlas(FIXTURE_TICKET, FIXTURE_EVENT.id, {
      acceptedPaymentMethods: ['stripe_spt'],
    });

    expect(ticket['atlas:ticket_type_id']).toBe('atlas:eventbrite:1234567890:tc-1');
    expect(ticket['atlas:source_ticket_type_id']).toBe('tc-1');
    expect(ticket.name).toBe('General Admission');
    expect(ticket.description).toBe('Standing room.');
    expect(ticket['atlas:event_id']).toBe('atlas:eventbrite:1234567890');
    expect(ticket['atlas:pricing'].base_price).toBe(2500);
    expect(ticket['atlas:pricing'].fees_total).toBe(250);
    expect(ticket['atlas:pricing'].total_price).toBe(2750);
    expect(ticket['atlas:pricing'].currency).toBe('USD');
    expect(ticket['atlas:pricing'].fees).toHaveLength(1);
    expect(ticket['atlas:pricing'].fees[0]?.amount).toBe(250);
    expect(ticket['atlas:availability'].status).toBe('available');
    expect(ticket['atlas:availability'].total_quantity).toBe(100);
    expect(ticket['atlas:availability'].remaining_quantity).toBe(40);
    expect(ticket['atlas:availability'].max_per_order).toBe(8);
    expect(ticket['atlas:availability'].min_per_order).toBe(1);
    expect(ticket['atlas:availability'].on_sale).toBe(true);
    expect(ticket['atlas:accepted_payment_methods']).toEqual(['stripe_spt']);
    expect(ticket['atlas:metadata']).toEqual({
      free: false,
      donation: false,
      hidden: false,
      on_sale_status: 'AVAILABLE',
    });
  });

  it('maps a sold-out ticket class to status sold_out', () => {
    const sold: EventbriteTicketClass = {
      ...FIXTURE_TICKET,
      id: 'tc-2',
      quantity_sold: 100,
      on_sale_status: 'SOLD_OUT',
    };
    const ticket = eventbriteTicketClassToAtlas(sold, FIXTURE_EVENT.id);
    expect(ticket['atlas:availability'].status).toBe('sold_out');
    expect(ticket['atlas:availability'].remaining_quantity).toBe(0);
    expect(ticket['atlas:availability'].on_sale).toBe(false);
  });

  it('maps a hidden ticket class to status hidden', () => {
    const hidden: EventbriteTicketClass = { ...FIXTURE_TICKET, id: 'tc-3', hidden: true };
    const ticket = eventbriteTicketClassToAtlas(hidden, FIXTURE_EVENT.id);
    expect(ticket['atlas:availability'].status).toBe('hidden');
  });

  it('maps a free ticket class with no fee to zero pricing', () => {
    const free: EventbriteTicketClass = {
      id: 'tc-free',
      name: 'Free Pass',
      free: true,
      cost: null,
      fee: null,
      tax: null,
    };
    const ticket = eventbriteTicketClassToAtlas(free, FIXTURE_EVENT.id);
    expect(ticket['atlas:pricing'].base_price).toBe(0);
    expect(ticket['atlas:pricing'].total_price).toBe(0);
    expect(ticket['atlas:pricing'].fees).toHaveLength(0);
    expect(ticket['atlas:pricing'].currency).toBe('USD');
    expect(ticket['atlas:metadata']).toMatchObject({ free: true });
  });

  it('flags few_remaining when 1-5 seats left', () => {
    const lowStock: EventbriteTicketClass = {
      ...FIXTURE_TICKET,
      id: 'tc-low',
      quantity_total: 100,
      quantity_sold: 97,
    };
    const ticket = eventbriteTicketClassToAtlas(lowStock, FIXTURE_EVENT.id);
    expect(ticket['atlas:availability'].status).toBe('few_remaining');
    expect(ticket['atlas:availability'].remaining_quantity).toBe(3);
  });
});
