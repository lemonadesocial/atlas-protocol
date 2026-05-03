import type { AtlasEvent } from "@atlasprotocol/types";

import { canonicalize } from "./canonicalize.js";
import { generateCid } from "./cid.js";

/**
 * Compute the deterministic content-addressed identifier (CIDv1, raw, sha256)
 * for an AtlasEvent. Two events with identical logical contents — regardless of
 * key insertion order — produce the same CID.
 *
 * The event is canonicalized before hashing; see `canonicalize` for the exact
 * serialization rules that determine "logical equivalence" here.
 */
export async function generateEventCid(event: AtlasEvent): Promise<string> {
  const bytes = canonicalize(event);
  return generateCid(bytes);
}
