import { describe, expect, it } from 'vitest';

import {
  MPP_PROTOCOL_VERSION,
  canonicalize,
  decode,
  deserialize,
  encode,
  serialize,
} from '../envelope.js';
import type { MppPayload } from '../types/payload.js';

const FULL_PAYLOAD: MppPayload = {
  rail: 'usdc-base',
  intent: 'charge',
  realm: 'api.example.com',
  paymentId: 'pay_qB3wErTyU7iOpAsD9fGhJk',
  amount: '12.50',
  currency: 'usd',
  recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
  organizer: 'org_lemonade',
  description: 'Ticket: Lemonade x ATLAS Launch',
  expires: '2026-04-30T18:00:00.000Z',
  ttl: 300,
  items: [
    { id: 'tix-ga', description: 'General Admission', quantity: 1, unitAmount: '10.00' },
    { id: 'tix-fee', unitAmount: '2.50' },
  ],
  metadata: { event_id: 'evt_42', source: 'web' },
};

describe('encode + decode', () => {
  it('round-trips a full payload deeply equal', () => {
    const envelope = encode(FULL_PAYLOAD);
    const back = decode(envelope);
    expect(back).toEqual(FULL_PAYLOAD);
  });

  it('round-trips a minimal payload (no optionals)', () => {
    const minimal: MppPayload = {
      rail: 'stripe-spt',
      realm: 'api.example.com',
      paymentId: 'pay_min',
      amount: '0.01',
      currency: 'usd',
    };
    const envelope = encode(minimal);
    const back = decode(envelope);
    // intent defaults to "charge" on encode and is then surfaced on decode.
    expect(back).toEqual({ ...minimal, intent: 'charge' });
  });

  it('round-trips empty metadata and items arrays correctly', () => {
    const p: MppPayload = {
      rail: 'usdc-base',
      realm: 'api.example.com',
      paymentId: 'pay_empty',
      amount: '1.00',
      currency: 'usd',
      items: [],
      metadata: {},
    };
    const envelope = encode(p);
    const back = decode(envelope);
    expect(back).toEqual({ ...p, intent: 'charge' });
  });

  it('encodes the protected header version', () => {
    const envelope = encode(FULL_PAYLOAD);
    expect(envelope.header.mpp_ver).toBe(MPP_PROTOCOL_VERSION);
    expect(envelope.header.id).toBe(FULL_PAYLOAD.paymentId);
    expect(envelope.header.method).toBe(FULL_PAYLOAD.rail);
    expect(envelope.header.intent).toBe('charge');
  });

  it('places amount + currency + recipient on the request', () => {
    const envelope = encode(FULL_PAYLOAD);
    expect(envelope.request['amount']).toBe(FULL_PAYLOAD.amount);
    expect(envelope.request['currency']).toBe(FULL_PAYLOAD.currency);
    expect(envelope.request['recipient']).toBe(FULL_PAYLOAD.recipient);
  });

  it('rejects missing required fields', () => {
    expect(() =>
      encode({ ...FULL_PAYLOAD, rail: '' } as unknown as MppPayload),
    ).toThrow(/rail is required/);
    expect(() =>
      encode({ ...FULL_PAYLOAD, paymentId: '' } as unknown as MppPayload),
    ).toThrow(/paymentId is required/);
    expect(() =>
      encode({ ...FULL_PAYLOAD, amount: '' } as unknown as MppPayload),
    ).toThrow(/amount is required/);
  });

  it('rejects rail strings that violate the MPP method identifier pattern', () => {
    expect(() => encode({ ...FULL_PAYLOAD, rail: 'NOT_LOWERCASE' })).toThrow(
      /not a valid MPP method identifier/,
    );
    expect(() => encode({ ...FULL_PAYLOAD, rail: '1startswithdigit' })).toThrow(
      /not a valid MPP method identifier/,
    );
  });

  it('decode rejects malformed envelopes', () => {
    expect(() =>
      decode({
        header: undefined as unknown as Parameters<typeof decode>[0]['header'],
        request: {} as Parameters<typeof decode>[0]['request'],
      }),
    ).toThrow(/header is required/);
    expect(() =>
      decode({ header: { mpp_ver: '1.0', id: 'x', realm: 'x', method: 'x', intent: 'charge' }, request: { amount: 1 as unknown as string, currency: 'usd' } }),
    ).toThrow(/request.amount must be a string/);
  });
});

describe('serialize + deserialize', () => {
  it('round-trips through the base64url-JCS wire form', () => {
    const envelope = encode(FULL_PAYLOAD);
    const wire = serialize(envelope);
    expect(typeof wire).toBe('string');
    expect(wire).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = deserialize(wire);
    expect(back).toEqual(envelope);
  });

  it('canonical serialization is deterministic regardless of key order', () => {
    const envelope = encode(FULL_PAYLOAD);
    const reordered = {
      request: envelope.request,
      header: envelope.header,
    } as typeof envelope;
    expect(canonicalize(envelope)).toBe(canonicalize(reordered));
  });

  it('deserialize rejects values that do not look like an envelope', () => {
    const wire = Buffer.from(JSON.stringify({ foo: 1 }), 'utf8').toString(
      'base64url',
    );
    expect(() => deserialize(wire)).toThrow(/not an MPP envelope/);
  });
});
