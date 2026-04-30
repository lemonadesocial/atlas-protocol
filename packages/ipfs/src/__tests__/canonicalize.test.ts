import { describe, expect, it } from 'vitest';

import { canonicalize } from '../canonicalize.js';

const decoder = new TextDecoder();
const decode = (b: Uint8Array): string => decoder.decode(b);

describe('canonicalize', () => {
  it('produces UTF-8 bytes with no BOM', () => {
    const bytes = canonicalize({ a: 1 });
    expect(bytes).toBeInstanceOf(Uint8Array);
    // No BOM byte at the start
    expect(bytes[0]).not.toBe(0xef);
    expect(decode(bytes)).toBe('{"a":1}');
  });

  it('sorts object keys lexicographically', () => {
    const a = canonicalize({ z: 1, a: 2, m: 3 });
    const b = canonicalize({ a: 2, m: 3, z: 1 });
    expect(decode(a)).toBe('{"a":2,"m":3,"z":1}');
    expect(a).toEqual(b);
  });

  it('produces identical bytes for reordered keys at every nesting level', () => {
    const inputA = {
      outer: { z: { c: 1, a: 2 }, a: { y: 3, x: 4 } },
      list: [{ b: 1, a: 2 }, { d: 4, c: 3 }],
    };
    const inputB = {
      list: [{ a: 2, b: 1 }, { c: 3, d: 4 }],
      outer: { a: { x: 4, y: 3 }, z: { a: 2, c: 1 } },
    };
    expect(decode(canonicalize(inputA))).toBe(decode(canonicalize(inputB)));
  });

  it('preserves array order (arrays are not sorted)', () => {
    const ordered = canonicalize([3, 1, 2]);
    expect(decode(ordered)).toBe('[3,1,2]');
  });

  it('serializes nested arrays equivalently when contents are equal', () => {
    const a = canonicalize([[1, 2], [3, 4]]);
    const b = canonicalize([[1, 2], [3, 4]]);
    expect(a).toEqual(b);
  });

  it('preserves null', () => {
    expect(decode(canonicalize({ a: null }))).toBe('{"a":null}');
  });

  it('omits undefined fields inside objects (JCS-style)', () => {
    expect(decode(canonicalize({ a: 1, b: undefined, c: 3 }))).toBe('{"a":1,"c":3}');
  });

  it('throws on undefined inside arrays', () => {
    expect(() => canonicalize([1, undefined, 2])).toThrow(TypeError);
  });

  it('throws on NaN', () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow(TypeError);
  });

  it('throws on Infinity', () => {
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalize({ a: Number.NEGATIVE_INFINITY })).toThrow(TypeError);
  });

  it('throws on BigInt', () => {
    expect(() => canonicalize({ a: 1n })).toThrow(TypeError);
  });

  it('throws on Map and Set', () => {
    expect(() => canonicalize({ a: new Map() })).toThrow(TypeError);
    expect(() => canonicalize({ a: new Set([1, 2]) })).toThrow(TypeError);
  });

  it('omits symbol/function-valued object fields', () => {
    const sym = Symbol('x');
    const obj = { a: 1, b: sym, c: () => 0, d: 4 };
    expect(decode(canonicalize(obj))).toBe('{"a":1,"d":4}');
  });

  it('throws on cyclic structures', () => {
    const o: { self?: unknown } = {};
    o.self = o;
    expect(() => canonicalize(o)).toThrow(TypeError);
  });

  it('serializes Date as ISO-8601 UTC string', () => {
    const d = new Date(Date.UTC(2026, 3, 30, 12, 34, 56, 789));
    expect(decode(canonicalize({ when: d }))).toBe('{"when":"2026-04-30T12:34:56.789Z"}');
  });

  it('normalizes -0 to 0', () => {
    expect(decode(canonicalize({ a: -0 }))).toBe('{"a":0}');
  });

  it('escapes strings the same way JSON.stringify does', () => {
    expect(decode(canonicalize({ a: 'hello "world"\n' }))).toBe(
      '{"a":"hello \\"world\\"\\n"}',
    );
  });

  it('round-trips an AtlasEvent fixture deterministically', () => {
    const eventA = {
      '@context': { '@vocab': 'https://schema.org/', atlas: 'https://atlas.dev/vocab#' },
      '@type': 'Event',
      '@id': 'https://example.com/events/abc',
      name: 'Atlas Launch Party',
      description: 'Launch.',
      startDate: '2026-05-01T18:00:00.000Z',
      location: {
        '@type': 'Place',
        name: 'Venue',
        address: { '@type': 'PostalAddress', streetAddress: '1 Main', addressCountry: 'US' },
      },
      organizer: { '@type': 'Organization', name: 'Atlas' },
      eventStatus: 'EventScheduled',
      eventAttendanceMode: 'OfflineEventAttendanceMode',
      'atlas:id': 'atlas-1',
      'atlas:source_platform': 'lemonade',
      'atlas:source_event_id': 'src-1',
      'atlas:organizer_id': 'org-1',
      'atlas:organizer_verified': true,
      'atlas:categories': ['music', 'tech'],
      'atlas:tags': ['launch', 'party'],
      'atlas:availability': 'available',
      'atlas:price_range': { min_price: 10, max_price: 50, currency: 'USD', includes_fees: true },
      'atlas:ticket_types_count': 2,
      'atlas:purchase_endpoint': 'https://example.com/purchase',
      'atlas:currency': 'USD',
      'atlas:accepts_payment_methods': ['tempo_usdc', 'base_usdc'],
      'atlas:last_synced': '2026-04-30T00:00:00.000Z',
      'atlas:created_at': '2026-04-01T00:00:00.000Z',
      'atlas:updated_at': '2026-04-30T00:00:00.000Z',
    };
    const eventB = {
      eventStatus: 'EventScheduled',
      organizer: { name: 'Atlas', '@type': 'Organization' },
      location: {
        address: { addressCountry: 'US', '@type': 'PostalAddress', streetAddress: '1 Main' },
        name: 'Venue',
        '@type': 'Place',
      },
      'atlas:tags': ['launch', 'party'],
      'atlas:price_range': { currency: 'USD', includes_fees: true, max_price: 50, min_price: 10 },
      'atlas:availability': 'available',
      'atlas:source_platform': 'lemonade',
      'atlas:source_event_id': 'src-1',
      'atlas:organizer_verified': true,
      'atlas:organizer_id': 'org-1',
      'atlas:categories': ['music', 'tech'],
      'atlas:id': 'atlas-1',
      'atlas:ticket_types_count': 2,
      'atlas:purchase_endpoint': 'https://example.com/purchase',
      'atlas:currency': 'USD',
      'atlas:accepts_payment_methods': ['tempo_usdc', 'base_usdc'],
      'atlas:last_synced': '2026-04-30T00:00:00.000Z',
      'atlas:created_at': '2026-04-01T00:00:00.000Z',
      'atlas:updated_at': '2026-04-30T00:00:00.000Z',
      eventAttendanceMode: 'OfflineEventAttendanceMode',
      name: 'Atlas Launch Party',
      description: 'Launch.',
      startDate: '2026-05-01T18:00:00.000Z',
      '@id': 'https://example.com/events/abc',
      '@type': 'Event',
      '@context': { atlas: 'https://atlas.dev/vocab#', '@vocab': 'https://schema.org/' },
    };
    expect(canonicalize(eventA)).toEqual(canonicalize(eventB));
  });

  it('handles deep nesting', () => {
    const deep: Record<string, unknown> = { v: 1 };
    let cursor = deep;
    for (let i = 0; i < 100; i++) {
      const next: Record<string, unknown> = { v: i };
      cursor['child'] = next;
      cursor = next;
    }
    const a = canonicalize(deep);
    const b = canonicalize(deep);
    expect(a).toEqual(b);
  });
});
