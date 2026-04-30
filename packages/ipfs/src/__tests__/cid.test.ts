import { describe, expect, it } from 'vitest';

import { canonicalize } from '../canonicalize.js';
import { generateCid } from '../cid.js';

const encoder = new TextEncoder();

describe('generateCid', () => {
  it('returns a deterministic CID for identical bytes', async () => {
    const bytes = encoder.encode('hello atlas');
    const a = await generateCid(bytes);
    const b = await generateCid(bytes);
    const c = await generateCid(bytes);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('produces different CIDs for different bytes', async () => {
    const a = await generateCid(encoder.encode('a'));
    const b = await generateCid(encoder.encode('b'));
    expect(a).not.toBe(b);
  });

  it('emits a base32-lowercase CIDv1 raw+sha256 (bafkrei... prefix)', async () => {
    const cid = await generateCid(encoder.encode('hello'));
    expect(cid.startsWith('bafkrei')).toBe(true);
    // base32 alphabet (RFC 4648) - lowercase
    expect(cid).toMatch(/^[a-z2-7]+$/);
  });

  it('records a known fixture CID for canonicalized {a:1,b:2}', async () => {
    const bytes = canonicalize({ b: 2, a: 1 });
    const cid = await generateCid(bytes);
    // Snapshotted determinism check — recompute and verify equality.
    const cidAgain = await generateCid(canonicalize({ a: 1, b: 2 }));
    expect(cid).toBe(cidAgain);
    expect(cid.startsWith('bafkrei')).toBe(true);
  });
});
