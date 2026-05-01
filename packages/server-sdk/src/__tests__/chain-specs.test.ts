import { describe, expect, it } from "vitest";

import { CHAIN_SPECS, DEFAULT_ACCEPTED_CHAINS } from "../chain-specs.js";

/**
 * USDC contract addresses verified against Circle's official "USDC contract
 * addresses" page (https://developers.circle.com/stablecoins/usdc-contract-addresses,
 * accessed 2026-05-01). MegaETH stablecoin is USDM (chain-native), Tempo is
 * a placeholder pending mainnet release.
 */
const EXPECTED = {
  base_usdc: { chainId: 8453, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  base_sepolia_usdc: { chainId: 84532, token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" },
  optimism_usdc: { chainId: 10, token: "0x0b2c639c533813f4aa9d7837caf62653d097ff85" },
  arbitrum_usdc: { chainId: 42161, token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  polygon_usdc: { chainId: 137, token: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
  zksync_usdc: { chainId: 324, token: "0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4" },
  worldchain_usdc: { chainId: 480, token: "0x79a02482a880bce3f13e09da970dc34db4cd24d1" },
  megaeth_usdm: { chainId: 4326, token: "0xfafddbb3fc7688494971a79cc65dca3ef82079e7" },
} as const;

describe("CHAIN_SPECS", () => {
  for (const [key, expected] of Object.entries(EXPECTED)) {
    it(`${key} has the canonical chain id and stablecoin contract`, () => {
      const spec = CHAIN_SPECS[key as keyof typeof CHAIN_SPECS];
      expect(spec.chain.id).toBe(expected.chainId);
      expect(spec.usdcAddress.toLowerCase()).toBe(expected.token);
      expect(spec.defaultRpcUrl).toMatch(/^https?:\/\//);
      expect(spec.defaultConfirmations).toBeGreaterThan(0);
    });
  }

  it("flags Tempo + MegaETH as experimental", () => {
    expect(CHAIN_SPECS.tempo_usdc.experimental).toBe(true);
    expect(CHAIN_SPECS.megaeth_usdm.experimental).toBe(true);
  });

  it("DEFAULT_ACCEPTED_CHAINS excludes experimental chains", () => {
    expect(DEFAULT_ACCEPTED_CHAINS).not.toContain("tempo_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).not.toContain("megaeth_usdm");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("base_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("optimism_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("arbitrum_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("worldchain_usdc");
  });
});
