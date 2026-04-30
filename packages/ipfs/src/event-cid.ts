import type { AtlasEvent } from '@atlas/server-sdk';

import { canonicalize } from './canonicalize.js';
import { generateCid } from './cid.js';

/**
 * Compute the deterministic content-addressed identifier (CIDv1, raw, sha256)
 * for an AtlasEvent. Two events with identical logical contents — regardless of
 * key insertion order — produce the same CID.
 */
export async function generateEventCid(event: AtlasEvent): Promise<string> {
  const bytes = canonicalize(event);
  return generateCid(bytes);
}
