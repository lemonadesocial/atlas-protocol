import { describe, expect, it } from 'vitest';

import { generateReceiptCid, type AtlasReceipt } from '../receipt-cid.js';

function makeReceipt(overrides: Partial<AtlasReceipt> = {}): AtlasReceipt {
  const base: AtlasReceipt = {
    purchase_id: 'purchase-123',
    event_id: 'event-abc',
    ticket_type_id: 'tt-1',
    buyer: '0x000000000000000000000000000000000000beef',
    organizer: '0x000000000000000000000000000000000000dead',
    amount: '25.00',
    currency: 'USD',
    rail: 'tempo_usdc',
    paid_at: '2026-04-30T12:00:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('generateReceiptCid', () => {
  it('is deterministic across invocations', async () => {
    const r = makeReceipt();
    const a = await generateReceiptCid(r);
    const b = await generateReceiptCid(r);
    expect(a).toBe(b);
  });

  it('is invariant to key insertion order', async () => {
    const r = makeReceipt();
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(r).reverse()) {
      reordered[key] = r[key];
    }
    const a = await generateReceiptCid(r);
    const b = await generateReceiptCid(reordered as unknown as AtlasReceipt);
    expect(a).toBe(b);
  });

  it('changes when fields differ', async () => {
    const a = await generateReceiptCid(makeReceipt());
    const b = await generateReceiptCid(makeReceipt({ amount: '26.00' }));
    expect(a).not.toBe(b);
  });

  it('omits undefined optional fields (so absent vs explicit-undefined match)', async () => {
    const a = await generateReceiptCid(makeReceipt());
    const b = await generateReceiptCid(makeReceipt({ x402_proof: undefined }));
    expect(a).toBe(b);
  });

  it('includes x402_proof when present', async () => {
    const a = await generateReceiptCid(makeReceipt());
    const b = await generateReceiptCid(makeReceipt({ x402_proof: 'proof-xyz' }));
    expect(a).not.toBe(b);
  });
});
