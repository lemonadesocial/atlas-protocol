import { describe, expect, it } from "vitest";

import { CHAIN_SPECS, DEFAULT_ACCEPTED_CHAINS } from "../chain-specs.js";

/**
 * USDC contract addresses verified against Circle's official "USDC contract
 * addresses" + "USDC on test networks" pages
 * (https://developers.circle.com/stablecoins/usdc-contract-addresses,
 * https://developers.circle.com/stablecoins/docs/usdc-on-test-networks,
 * accessed 2026-05-02). MegaETH stablecoin is USDM (chain-native), Tempo is
 * a placeholder pending mainnet release. Experimental testnets (zkSync
 * Sepolia, World Chain Sepolia, MegaETH testnet, Tempo testnet) ship with
 * placeholder addresses pending Circle / chain-team publication.
 */
const VERIFIED = {
  base_usdc: { chainId: 8453, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  base_sepolia_usdc: { chainId: 84532, token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" },
  optimism_usdc: { chainId: 10, token: "0x0b2c639c533813f4aa9d7837caf62653d097ff85" },
  optimism_sepolia_usdc: {
    chainId: 11155420,
    token: "0x5fd84259d66cd46123540766be93dfe6d43130d7",
  },
  arbitrum_usdc: { chainId: 42161, token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  arbitrum_sepolia_usdc: {
    chainId: 421614,
    token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
  },
  polygon_usdc: { chainId: 137, token: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
  polygon_amoy_usdc: { chainId: 80002, token: "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582" },
  zksync_usdc: { chainId: 324, token: "0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4" },
  worldchain_usdc: { chainId: 480, token: "0x79a02482a880bce3f13e09da970dc34db4cd24d1" },
  megaeth_usdm: { chainId: 4326, token: "0xfafddbb3fc7688494971a79cc65dca3ef82079e7" },
} as const;

const EXPERIMENTAL_PLACEHOLDER = {
  zksync_sepolia_usdc: { chainId: 300 },
  worldchain_sepolia_usdc: { chainId: 4801 },
  megaeth_testnet_usdc: { chainId: 6342 },
  tempo_testnet_usdc: { chainId: 4218 },
} as const;

const PLACEHOLDER_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("CHAIN_SPECS", () => {
  for (const [key, expected] of Object.entries(VERIFIED)) {
    it(`${key} has the canonical chain id and stablecoin contract`, () => {
      const spec = CHAIN_SPECS[key as keyof typeof CHAIN_SPECS];
      expect(spec.chain.id).toBe(expected.chainId);
      expect(spec.usdcAddress.toLowerCase()).toBe(expected.token);
      expect(spec.defaultRpcUrl).toMatch(/^https?:\/\//);
      expect(spec.defaultConfirmations).toBeGreaterThan(0);
    });
  }

  for (const [key, expected] of Object.entries(EXPERIMENTAL_PLACEHOLDER)) {
    it(`${key} is registered with chain id ${expected.chainId} and a placeholder USDC`, () => {
      const spec = CHAIN_SPECS[key as keyof typeof CHAIN_SPECS];
      expect(spec.chain.id).toBe(expected.chainId);
      expect(spec.usdcAddress.toLowerCase()).toBe(PLACEHOLDER_ADDRESS);
      expect(spec.experimental).toBe(true);
      expect(spec.notes).toBeDefined();
      expect(spec.defaultRpcUrl).toMatch(/^https?:\/\//);
      expect(spec.defaultConfirmations).toBe(1);
    });
  }

  it("flags Tempo + MegaETH (mainnet) as experimental", () => {
    expect(CHAIN_SPECS.tempo_usdc.experimental).toBe(true);
    expect(CHAIN_SPECS.megaeth_usdm.experimental).toBe(true);
  });

  it("flags every testnet whose USDC is unverified as experimental", () => {
    expect(CHAIN_SPECS.zksync_sepolia_usdc.experimental).toBe(true);
    expect(CHAIN_SPECS.worldchain_sepolia_usdc.experimental).toBe(true);
    expect(CHAIN_SPECS.megaeth_testnet_usdc.experimental).toBe(true);
    expect(CHAIN_SPECS.tempo_testnet_usdc.experimental).toBe(true);
  });

  it("does NOT flag verified Circle testnets as experimental", () => {
    expect(CHAIN_SPECS.base_sepolia_usdc.experimental).toBeUndefined();
    expect(CHAIN_SPECS.optimism_sepolia_usdc.experimental).toBeUndefined();
    expect(CHAIN_SPECS.arbitrum_sepolia_usdc.experimental).toBeUndefined();
    expect(CHAIN_SPECS.polygon_amoy_usdc.experimental).toBeUndefined();
  });

  it("uses defaultConfirmations === 1 on every testnet", () => {
    expect(CHAIN_SPECS.base_sepolia_usdc.defaultConfirmations).toBe(1);
    expect(CHAIN_SPECS.optimism_sepolia_usdc.defaultConfirmations).toBe(1);
    expect(CHAIN_SPECS.arbitrum_sepolia_usdc.defaultConfirmations).toBe(1);
    expect(CHAIN_SPECS.polygon_amoy_usdc.defaultConfirmations).toBe(1);
    expect(CHAIN_SPECS.zksync_sepolia_usdc.defaultConfirmations).toBe(1);
    expect(CHAIN_SPECS.worldchain_sepolia_usdc.defaultConfirmations).toBe(1);
    expect(CHAIN_SPECS.megaeth_testnet_usdc.defaultConfirmations).toBe(1);
    expect(CHAIN_SPECS.tempo_testnet_usdc.defaultConfirmations).toBe(1);
  });

  it("DEFAULT_ACCEPTED_CHAINS excludes experimental chains", () => {
    expect(DEFAULT_ACCEPTED_CHAINS).not.toContain("tempo_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).not.toContain("tempo_testnet_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).not.toContain("megaeth_usdm");
    expect(DEFAULT_ACCEPTED_CHAINS).not.toContain("megaeth_testnet_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).not.toContain("zksync_sepolia_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).not.toContain("worldchain_sepolia_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("base_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("base_sepolia_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("optimism_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("optimism_sepolia_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("arbitrum_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("arbitrum_sepolia_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("polygon_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("polygon_amoy_usdc");
    expect(DEFAULT_ACCEPTED_CHAINS).toContain("worldchain_usdc");
  });
});
