/**
 * ATLAS-managed services demo.
 *
 * Shows how a platform server uses `createAtlasManagedClient` to delegate
 * IPFS receipt pinning, on-chain settlement, and reward recording to a
 * registry deployment — instead of running its own pinner, hot wallet, and
 * RPC. This is an opt-in alternative to the in-line on-chain integration in
 * `index.ts`. The two paths are mutually exclusive: a platform picks one and
 * stays with it for the lifetime of a settlement.
 *
 * Environment variables:
 *   - ATLAS_REGISTRY_URL:   base URL of the atlas-registry deployment.
 *   - ATLAS_PLATFORM_TOKEN: bearer token issued to this platform.
 *
 * Run from the example root:
 *   ATLAS_REGISTRY_URL=https://registry.atlas-protocol.org \
 *   ATLAS_PLATFORM_TOKEN=tkn_xxx \
 *   pnpm tsx src/atlas-managed-demo.ts
 */

import { createAtlasManagedClient, generateReceipt } from "@atlasprotocol/server-sdk";

const REGISTRY_URL = process.env["ATLAS_REGISTRY_URL"];
const PLATFORM_TOKEN = process.env["ATLAS_PLATFORM_TOKEN"];

async function main(): Promise<void> {
  if (!REGISTRY_URL) {
    throw new Error("ATLAS_REGISTRY_URL is required.");
  }

  const client = createAtlasManagedClient({
    baseUrl: REGISTRY_URL,
    ...(PLATFORM_TOKEN ? { platformAuthToken: PLATFORM_TOKEN } : {}),
  });

  // 1. The platform has just verified an x402 settlement off-band. Build the
  //    canonical W3C VC receipt.
  const { receipt } = await generateReceipt({
    holdId: "hold_demo_001",
    eventId: "evt_jazz_brooklyn_001",
    attendee: "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
    organizerAddress: "did:web:bjc.events",
    paymentMethod: "x402",
    txHash: `0x${"a".repeat(64)}`,
    settlementChain: "base",
    amount: "25.000000",
    currency: "USDC",
    ticketTypeId: "tt_ga_001",
    quantity: 1,
  });

  // 2. Ask the registry to pin the receipt to IPFS.
  const pinned = await client.pinReceipt(receipt);
  console.log("pinned:", pinned);

  // 3. Ask the registry to verify the pinned receipt.
  const verified = await client.verifyReceipt({ urn: pinned.urn, cid: pinned.cid });
  console.log("verified:", verified);

  // 4. Ask the registry to settle on-chain on the platform's behalf.
  const settled = await client.settle({
    platformDomain: "atlas.bjc.events",
    chain: "base",
    organizer: "0x000000000000000000000000000000000000bEEf",
    totalAmount: 25_000_000n, // 25 USDC at 6 decimals
    paymentId: `0x${"2".repeat(64)}`,
    platformFees: [],
  });
  console.log("settled:", settled);

  // 5. Ask the registry to record the organizer reward.
  const rewards = await client.recordRewards({
    platformDomain: "atlas.bjc.events",
    paymentId: `0x${"2".repeat(64)}`,
    recipients: [
      {
        recipient: "0x000000000000000000000000000000000000bEEf",
        kind: "organizer",
        amount: 600_000n, // 0.60 USDC at 6 decimals
      },
    ],
  });
  console.log("rewards:", rewards);
}

// Run only when invoked directly (no top-level side effects on import).
const isDirectRun =
  typeof process !== "undefined" && process.argv[1]?.endsWith("atlas-managed-demo.ts") === true;
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
