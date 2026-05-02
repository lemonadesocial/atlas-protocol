import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHAIN_SPECS } from "../chain-specs.js";
import {
  __resetDeploymentsCacheForTests,
  getDeploymentsRegistry,
  getFeeRouterAddress,
  getFeeRouterImplementation,
  listDeployedChains,
  listKnownChains,
} from "../deployments.js";

const REPO_ROOT_PATH = fileURLToPath(new URL("../../../../deployments.json", import.meta.url));

describe("deployments", () => {
  beforeEach(() => {
    __resetDeploymentsCacheForTests();
  });

  afterEach(() => {
    __resetDeploymentsCacheForTests();
  });

  it("getFeeRouterAddress returns undefined for chains with null proxy", () => {
    expect(getFeeRouterAddress("base_usdc")).toBeUndefined();
    expect(getFeeRouterAddress("base_sepolia_usdc")).toBeUndefined();
    expect(getFeeRouterAddress("optimism_sepolia_usdc")).toBeUndefined();
  });

  it("getFeeRouterAddress returns undefined for unknown chain slugs", () => {
    expect(getFeeRouterAddress("not_a_real_chain")).toBeUndefined();
  });

  it("getFeeRouterImplementation returns undefined initially", () => {
    expect(getFeeRouterImplementation()).toBeUndefined();
  });

  it("getDeploymentsRegistry exposes the deployer salt", () => {
    const registry = getDeploymentsRegistry();
    expect(registry.feeRouter.implementation.deployer_salt).toBe("atlas-protocol/FeeRouter v0.1.0");
    expect(registry.schema_version).toBe("1.0");
  });

  it("listDeployedChains is empty initially (all proxies null)", () => {
    expect(listDeployedChains()).toEqual([]);
  });

  it("listKnownChains returns all 16 chain slugs declared in deployments.json", () => {
    const known = listKnownChains();
    expect(known).toHaveLength(16);
    expect(known).toContain("base_usdc");
    expect(known).toContain("base_sepolia_usdc");
    expect(known).toContain("optimism_usdc");
    expect(known).toContain("optimism_sepolia_usdc");
    expect(known).toContain("arbitrum_usdc");
    expect(known).toContain("arbitrum_sepolia_usdc");
    expect(known).toContain("polygon_usdc");
    expect(known).toContain("polygon_amoy_usdc");
    expect(known).toContain("zksync_usdc");
    expect(known).toContain("zksync_sepolia_usdc");
    expect(known).toContain("worldchain_usdc");
    expect(known).toContain("worldchain_sepolia_usdc");
    expect(known).toContain("megaeth_usdm");
    expect(known).toContain("megaeth_testnet_usdc");
    expect(known).toContain("tempo_usdc");
    expect(known).toContain("tempo_testnet_usdc");
  });

  it("parity: deployments.json proxies keys match Object.keys(CHAIN_SPECS) exactly", () => {
    const knownChains = new Set(listKnownChains());
    const specChains = new Set(Object.keys(CHAIN_SPECS));

    expect(knownChains.size).toBe(specChains.size);

    const inDeploymentsButNotSpecs = [...knownChains].filter((s) => !specChains.has(s));
    const inSpecsButNotDeployments = [...specChains].filter((s) => !knownChains.has(s));

    expect(inDeploymentsButNotSpecs).toEqual([]);
    expect(inSpecsButNotDeployments).toEqual([]);
  });

  describe("with patched deployments.json on disk", () => {
    let backupPath: string;

    beforeEach(() => {
      // Snapshot the on-disk file so we can restore it after the test.
      backupPath = join(
        tmpdir(),
        `atlas-deployments-backup-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
      );
      copyFileSync(REPO_ROOT_PATH, backupPath);
    });

    afterEach(() => {
      // Restore the original on-disk file.
      copyFileSync(backupPath, REPO_ROOT_PATH);
      __resetDeploymentsCacheForTests();
    });

    it("getFeeRouterAddress returns the patched proxy after re-reading the file", () => {
      const original = JSON.parse(readFileSync(REPO_ROOT_PATH, "utf8")) as {
        feeRouter: { proxies: Record<string, string | null> };
      };
      const patched = {
        ...original,
        feeRouter: {
          ...original.feeRouter,
          proxies: {
            ...original.feeRouter.proxies,
            base_sepolia_usdc: "0x1111111111111111111111111111111111111111",
          },
        },
      };
      writeFileSync(REPO_ROOT_PATH, JSON.stringify(patched, null, 2) + "\n", "utf8");

      __resetDeploymentsCacheForTests();

      expect(getFeeRouterAddress("base_sepolia_usdc")).toBe(
        "0x1111111111111111111111111111111111111111",
      );
      expect(listDeployedChains()).toEqual(["base_sepolia_usdc"]);
    });

    it("getFeeRouterImplementation returns the patched address after re-reading", () => {
      const original = JSON.parse(readFileSync(REPO_ROOT_PATH, "utf8")) as {
        feeRouter: { implementation: { create2_address: string | null; deployer_salt: string } };
      };
      const patched = {
        ...original,
        feeRouter: {
          ...original.feeRouter,
          implementation: {
            ...original.feeRouter.implementation,
            create2_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          },
        },
      };
      writeFileSync(REPO_ROOT_PATH, JSON.stringify(patched, null, 2) + "\n", "utf8");

      __resetDeploymentsCacheForTests();

      expect(getFeeRouterImplementation()).toBe("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    });
  });
});
