import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';

/**
 * Compute a CIDv1 (raw codec, sha256, base32 lowercase) for the given canonical
 * bytes. The output is stable across runs and platforms — identical input bytes
 * always yield the identical CID string.
 */
export async function generateCid(canonicalBytes: Uint8Array): Promise<string> {
  const hash = await sha256.digest(canonicalBytes);
  const cid = CID.createV1(raw.code, hash);
  return cid.toString();
}
