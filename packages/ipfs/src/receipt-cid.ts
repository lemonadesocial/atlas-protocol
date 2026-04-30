import { canonicalize } from './canonicalize.js';
import { generateCid } from './cid.js';

/**
 * Minimal ATLAS purchase receipt shape used for CID generation. The full receipt
 * type will be standardized in a future release of @atlas/server-sdk; this is an
 * interim definition local to @atlas/ipfs.
 */
export interface AtlasReceipt {
  purchase_id: string;
  event_id: string;
  ticket_type_id: string;
  buyer: string;
  organizer: string;
  amount: string;
  currency: string;
  rail: string;
  paid_at: string;
  x402_proof?: string | undefined;
  [key: string]: unknown;
}

/**
 * Compute the deterministic content-addressed identifier (CIDv1, raw, sha256)
 * for an AtlasReceipt.
 */
export async function generateReceiptCid(receipt: AtlasReceipt): Promise<string> {
  const bytes = canonicalize(receipt);
  return generateCid(bytes);
}
