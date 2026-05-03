import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHAIN_SPECS } from "../chain-specs.js";
import {
  __resetDeploymentsCacheForTests,
  getAtlasTicketAddress,
  getAtlasTicketImplementation,
  getDeploymentsRegistry,
  getFeeRouterAddress,
  getFeeRouterImplementation,
  getRewardLedgerAddress,
  getRewardLedgerImplementation,
  listDeployedChains,
  listDeployedChainsByContract,
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

  it("listDeployedChainsByContract returns empty arrays for every family initially", () => {
    expect(listDeployedChainsByContract()).toEqual({
      feeRouter: [],
      atlasTicket: [],
      rewardLedger: [],
    });
  });

  it("listKnownChains exactly matches Object.keys(CHAIN_SPECS) (the universe)", () => {
    const known = new Set(listKnownChains());
    const specs = new Set(Object.keys(CHAIN_SPECS));
    expect(known).toEqual(specs);
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

  // feeRouter and atlasTicket are EVM-portable: their proxies map mirrors every chain in
  // CHAIN_SPECS. rewardLedger v1 is canonical-chain only (Base + Base Sepolia) — multi-chain
  // RewardLedger is Phase 7+ per the progressive-decentralization spec.
  describe.each([
    { contract: "feeRouter" as const, expectedSalt: "atlas-protocol/FeeRouter v0.1.0" },
    { contract: "atlasTicket" as const, expectedSalt: "atlas-protocol/AtlasTicket v0.1.0" },
  ])("$contract.proxies parity with CHAIN_SPECS", ({ contract, expectedSalt }) => {
    it(`${contract}.proxies keys match Object.keys(CHAIN_SPECS) exactly`, () => {
      const proxies = getDeploymentsRegistry()[contract].proxies;
      const declaredChains = new Set(Object.keys(proxies));
      const specChains = new Set(Object.keys(CHAIN_SPECS));

      expect(declaredChains.size).toBe(specChains.size);

      const inDeploymentsButNotSpecs = [...declaredChains].filter((s) => !specChains.has(s));
      const inSpecsButNotDeployments = [...specChains].filter((s) => !declaredChains.has(s));

      expect(inDeploymentsButNotSpecs).toEqual([]);
      expect(inSpecsButNotDeployments).toEqual([]);
    });

    it(`${contract}.implementation.deployer_salt is the version-pinned literal`, () => {
      const impl = getDeploymentsRegistry()[contract].implementation;
      expect(impl.deployer_salt).toBe(expectedSalt);
    });
  });

  describe("rewardLedger.proxies — canonical-chain only (v1)", () => {
    it("rewardLedger.proxies has exactly two slots: base_usdc and base_sepolia_usdc", () => {
      const proxies = getDeploymentsRegistry().rewardLedger.proxies;
      const keys = Object.keys(proxies).sort();
      expect(keys).toEqual(["base_sepolia_usdc", "base_usdc"]);
    });

    it("rewardLedger.implementation.deployer_salt is the version-pinned literal", () => {
      const impl = getDeploymentsRegistry().rewardLedger.implementation;
      expect(impl.deployer_salt).toBe("atlas-protocol/RewardLedger v0.1.0");
    });
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

    it("listDeployedChainsByContract reports per-family deployments after patching all three", () => {
      const original = JSON.parse(readFileSync(REPO_ROOT_PATH, "utf8")) as {
        feeRouter: { proxies: Record<string, string | null> };
        atlasTicket: { proxies: Record<string, string | null> };
        rewardLedger: { proxies: Record<string, string | null> };
      };
      const patched = {
        ...original,
        feeRouter: {
          ...original.feeRouter,
          proxies: {
            ...original.feeRouter.proxies,
            base_usdc: "0x1111111111111111111111111111111111111111",
            optimism_usdc: "0x2222222222222222222222222222222222222222",
          },
        },
        atlasTicket: {
          ...original.atlasTicket,
          proxies: {
            ...original.atlasTicket.proxies,
            base_usdc: "0x3333333333333333333333333333333333333333",
          },
        },
        rewardLedger: {
          ...original.rewardLedger,
          proxies: {
            ...original.rewardLedger.proxies,
            base_sepolia_usdc: "0x4444444444444444444444444444444444444444",
          },
        },
      };
      writeFileSync(REPO_ROOT_PATH, JSON.stringify(patched, null, 2) + "\n", "utf8");

      __resetDeploymentsCacheForTests();

      const deployed = listDeployedChainsByContract();
      expect(new Set(deployed.feeRouter)).toEqual(new Set(["base_usdc", "optimism_usdc"]));
      expect(deployed.atlasTicket).toEqual(["base_usdc"]);
      expect(deployed.rewardLedger).toEqual(["base_sepolia_usdc"]);
    });
  });

  describe("atlasTicket", () => {
    it("getAtlasTicketAddress returns undefined for chains with null proxy", () => {
      expect(getAtlasTicketAddress("base_usdc")).toBeUndefined();
      expect(getAtlasTicketAddress("base_sepolia_usdc")).toBeUndefined();
      expect(getAtlasTicketAddress("optimism_sepolia_usdc")).toBeUndefined();
    });

    it("getAtlasTicketAddress returns undefined for unknown chain slugs", () => {
      expect(getAtlasTicketAddress("not_a_real_chain")).toBeUndefined();
    });

    it("getAtlasTicketImplementation returns undefined initially", () => {
      expect(getAtlasTicketImplementation()).toBeUndefined();
    });

    it("getDeploymentsRegistry exposes the AtlasTicket deployer salt", () => {
      const registry = getDeploymentsRegistry();
      expect(registry.atlasTicket.implementation.deployer_salt).toBe(
        "atlas-protocol/AtlasTicket v0.1.0",
      );
    });

    describe("with patched deployments.json on disk", () => {
      let backupPath: string;

      beforeEach(() => {
        backupPath = join(
          tmpdir(),
          `atlas-deployments-backup-ticket-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
        );
        copyFileSync(REPO_ROOT_PATH, backupPath);
      });

      afterEach(() => {
        copyFileSync(backupPath, REPO_ROOT_PATH);
        __resetDeploymentsCacheForTests();
      });

      it("getAtlasTicketAddress returns the patched proxy after re-reading the file", () => {
        const original = JSON.parse(readFileSync(REPO_ROOT_PATH, "utf8")) as {
          atlasTicket: { proxies: Record<string, string | null> };
        };
        const patched = {
          ...original,
          atlasTicket: {
            ...original.atlasTicket,
            proxies: {
              ...original.atlasTicket.proxies,
              optimism_sepolia_usdc: "0x2222222222222222222222222222222222222222",
            },
          },
        };
        writeFileSync(REPO_ROOT_PATH, JSON.stringify(patched, null, 2) + "\n", "utf8");

        __resetDeploymentsCacheForTests();

        expect(getAtlasTicketAddress("optimism_sepolia_usdc")).toBe(
          "0x2222222222222222222222222222222222222222",
        );
      });

      it("getAtlasTicketImplementation returns the patched address after re-reading", () => {
        const original = JSON.parse(readFileSync(REPO_ROOT_PATH, "utf8")) as {
          atlasTicket: {
            implementation: { create2_address: string | null; deployer_salt: string };
          };
        };
        const patched = {
          ...original,
          atlasTicket: {
            ...original.atlasTicket,
            implementation: {
              ...original.atlasTicket.implementation,
              create2_address: "0xfeedfacefeedfacefeedfacefeedfacefeedface",
            },
          },
        };
        writeFileSync(REPO_ROOT_PATH, JSON.stringify(patched, null, 2) + "\n", "utf8");

        __resetDeploymentsCacheForTests();

        expect(getAtlasTicketImplementation()).toBe("0xfeedfacefeedfacefeedfacefeedfacefeedface");
      });
    });
  });

  describe("rewardLedger", () => {
    it("getRewardLedgerAddress returns undefined for the canonical chains with null proxy", () => {
      expect(getRewardLedgerAddress("base_usdc")).toBeUndefined();
      expect(getRewardLedgerAddress("base_sepolia_usdc")).toBeUndefined();
    });

    it("getRewardLedgerAddress returns undefined for non-canonical chain slugs", () => {
      // RewardLedger v1 ships canonical-chain only (Base + Base Sepolia). Slugs that
      // appear in CHAIN_SPECS but are not in rewardLedger.proxies must read undefined,
      // not throw.
      expect(getRewardLedgerAddress("optimism_sepolia_usdc")).toBeUndefined();
      expect(getRewardLedgerAddress("arbitrum_usdc")).toBeUndefined();
      expect(getRewardLedgerAddress("polygon_usdc")).toBeUndefined();
    });

    it("getRewardLedgerAddress returns undefined for unknown chain slugs", () => {
      expect(getRewardLedgerAddress("not_a_real_chain")).toBeUndefined();
    });

    it("getRewardLedgerImplementation returns undefined initially", () => {
      expect(getRewardLedgerImplementation()).toBeUndefined();
    });

    it("getDeploymentsRegistry exposes the RewardLedger deployer salt", () => {
      const registry = getDeploymentsRegistry();
      expect(registry.rewardLedger.implementation.deployer_salt).toBe(
        "atlas-protocol/RewardLedger v0.1.0",
      );
    });

    describe("with patched deployments.json on disk", () => {
      let backupPath: string;

      beforeEach(() => {
        backupPath = join(
          tmpdir(),
          `atlas-deployments-backup-reward-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
        );
        copyFileSync(REPO_ROOT_PATH, backupPath);
      });

      afterEach(() => {
        copyFileSync(backupPath, REPO_ROOT_PATH);
        __resetDeploymentsCacheForTests();
      });

      it("getRewardLedgerAddress returns the patched proxy after re-reading the file", () => {
        const original = JSON.parse(readFileSync(REPO_ROOT_PATH, "utf8")) as {
          rewardLedger: { proxies: Record<string, string | null> };
        };
        const patched = {
          ...original,
          rewardLedger: {
            ...original.rewardLedger,
            proxies: {
              ...original.rewardLedger.proxies,
              base_sepolia_usdc: "0x3333333333333333333333333333333333333333",
            },
          },
        };
        writeFileSync(REPO_ROOT_PATH, JSON.stringify(patched, null, 2) + "\n", "utf8");

        __resetDeploymentsCacheForTests();

        expect(getRewardLedgerAddress("base_sepolia_usdc")).toBe(
          "0x3333333333333333333333333333333333333333",
        );
      });

      it("getRewardLedgerImplementation returns the patched address after re-reading", () => {
        const original = JSON.parse(readFileSync(REPO_ROOT_PATH, "utf8")) as {
          rewardLedger: {
            implementation: { create2_address: string | null; deployer_salt: string };
          };
        };
        const patched = {
          ...original,
          rewardLedger: {
            ...original.rewardLedger,
            implementation: {
              ...original.rewardLedger.implementation,
              create2_address: "0xbeefcafebeefcafebeefcafebeefcafebeefcafe",
            },
          },
        };
        writeFileSync(REPO_ROOT_PATH, JSON.stringify(patched, null, 2) + "\n", "utf8");

        __resetDeploymentsCacheForTests();

        expect(getRewardLedgerImplementation()).toBe("0xbeefcafebeefcafebeefcafebeefcafebeefcafe");
      });
    });
  });
});
