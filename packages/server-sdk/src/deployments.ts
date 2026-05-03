import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Canonical CREATE2 deployment registry for ATLAS Protocol contracts.
 *
 * Currently tracks three contract families: `feeRouter` (Stage 1 payment
 * settlement), `atlasTicket` (Stage 2 ERC-721 NFT tickets), and
 * `rewardLedger` (Stage 3 organizer / attendee / referral reward accrual
 * + claim ledger). Each family has an implementation entry (a single
 * CREATE2 address derived from a version-pinned deployer salt) plus a
 * per-chain proxy map.
 *
 * The source of truth is `deployments.json` at the repo root. This module
 * loads the JSON synchronously and exposes typed accessors.
 *
 * **Path resolution.** `deployments.json` ships with the published npm
 * package (`packages/server-sdk/package.json#files` includes a copy
 * emitted into `dist/` at build time). At runtime we try two paths in
 * order, so the same module works in three contexts:
 *
 *   1. Source / vitest:           `src/deployments.ts`  → `../../../deployments.json` (repo root)
 *   2. Compiled in monorepo:      `dist/deployments.js` → `../../../deployments.json` (repo root)
 *   3. Published npm package:     `dist/deployments.js` → `./deployments.json`        (sibling, copied at build)
 *
 * We prefer the repo-root path when running from a checkout (it is the
 * single source of truth) and fall back to the sibling copy for installed
 * consumers.
 *
 * **Caching.** The parsed registry is cached after the first successful
 * read. Tests that need to mutate the file on disk and re-read it can call
 * `__resetDeploymentsCacheForTests()` between mutations.
 */

export interface ContractImplementation {
  create2_address: string | null;
  deployer_salt: string;
}

/**
 * @deprecated Use {@link ContractImplementation}. Re-exported under the old name
 * so existing FeeRouter consumers keep compiling.
 */
export type FeeRouterImplementation = ContractImplementation;

export interface DeploymentsRegistry {
  schema_version: string;
  feeRouter: {
    implementation: ContractImplementation;
    proxies: Record<string, string | null>;
  };
  atlasTicket: {
    implementation: ContractImplementation;
    proxies: Record<string, string | null>;
  };
  rewardLedger: {
    implementation: ContractImplementation;
    proxies: Record<string, string | null>;
  };
}

const DEPLOYMENTS_FILENAME = "deployments.json";

let cachedRegistry: DeploymentsRegistry | undefined;

function loadDeployments(): DeploymentsRegistry {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Repo-root source of truth (works for src/ during vitest and for
    // dist/ when the SDK is consumed from inside the monorepo).
    resolve(moduleDir, "..", "..", "..", DEPLOYMENTS_FILENAME),
    // Sibling copy emitted by the build step into dist/. This is what
    // ships in the published npm tarball.
    resolve(moduleDir, DEPLOYMENTS_FILENAME),
  ];

  let lastError: unknown;
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      return JSON.parse(raw) as DeploymentsRegistry;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Could not locate ${DEPLOYMENTS_FILENAME}. Tried: ${candidates.join(", ")}. Last error: ${String(lastError)}`,
  );
}

function getRegistry(): DeploymentsRegistry {
  if (cachedRegistry === undefined) {
    cachedRegistry = loadDeployments();
  }
  return cachedRegistry;
}

/**
 * Returns the FeeRouter UUPS proxy address for the given chain slug, or
 * `undefined` if the chain has no recorded deployment yet.
 *
 * Chain slugs match `Object.keys(CHAIN_SPECS)` in `chain-specs.ts`
 * (snake_case, e.g. `base_usdc`, `arbitrum_sepolia_usdc`).
 */
export function getFeeRouterAddress(chainSlug: string): string | undefined {
  const proxy = getRegistry().feeRouter.proxies[chainSlug];
  return proxy ?? undefined;
}

/**
 * Returns the FeeRouter implementation contract's CREATE2 address, or
 * `undefined` if the implementation has not yet been deployed.
 *
 * The implementation is deterministic across all EVM chains (same bytecode,
 * same deployer salt). The proxies pointing at it are per-chain because
 * `initialize()` embeds chain-specific roles and stablecoin addresses.
 */
export function getFeeRouterImplementation(): string | undefined {
  return getRegistry().feeRouter.implementation.create2_address ?? undefined;
}

/**
 * Returns the AtlasTicket UUPS proxy address for the given chain slug, or
 * `undefined` if the chain has no recorded deployment yet.
 *
 * Chain slugs match `Object.keys(CHAIN_SPECS)` in `chain-specs.ts`
 * (snake_case, e.g. `base_usdc`, `arbitrum_sepolia_usdc`).
 */
export function getAtlasTicketAddress(chainSlug: string): string | undefined {
  const proxy = getRegistry().atlasTicket.proxies[chainSlug];
  return proxy ?? undefined;
}

/**
 * Returns the AtlasTicket implementation contract's CREATE2 address, or
 * `undefined` if the implementation has not yet been deployed.
 *
 * The implementation is deterministic across all EVM chains (same bytecode,
 * same deployer salt). The proxies pointing at it are per-chain because
 * `initialize()` embeds chain-specific role assignments and the (name,
 * symbol) pair.
 */
export function getAtlasTicketImplementation(): string | undefined {
  return getRegistry().atlasTicket.implementation.create2_address ?? undefined;
}

/**
 * Returns the RewardLedger UUPS proxy address for the given chain slug, or
 * `undefined` if the chain has no recorded deployment yet.
 *
 * Chain slugs match `Object.keys(CHAIN_SPECS)` in `chain-specs.ts`
 * (snake_case, e.g. `base_usdc`, `arbitrum_sepolia_usdc`).
 */
export function getRewardLedgerAddress(chainSlug: string): string | undefined {
  const proxy = getRegistry().rewardLedger.proxies[chainSlug];
  return proxy ?? undefined;
}

/**
 * Returns the RewardLedger implementation contract's CREATE2 address, or
 * `undefined` if the implementation has not yet been deployed.
 *
 * The implementation is deterministic across all EVM chains (same bytecode,
 * same deployer salt). The proxies pointing at it are per-chain because
 * `initialize()` embeds chain-specific role assignments and the chain's
 * stablecoin address.
 */
export function getRewardLedgerImplementation(): string | undefined {
  return getRegistry().rewardLedger.implementation.create2_address ?? undefined;
}

/**
 * Returns chain slugs that have a non-null FeeRouter proxy address recorded.
 */
export function listDeployedChains(): string[] {
  return Object.entries(getRegistry().feeRouter.proxies)
    .filter(([, address]) => address !== null && address !== undefined)
    .map(([slug]) => slug);
}

/**
 * Returns every chain slug declared in `deployments.json` — both deployed
 * and not-yet-deployed. Useful for "what chains does ATLAS plan to support"
 * enumeration.
 *
 * The slug list is read from `feeRouter.proxies`; the parity test guarantees
 * `atlasTicket.proxies` has the same key set.
 */
export function listKnownChains(): string[] {
  return Object.keys(getRegistry().feeRouter.proxies);
}

/**
 * Raw access to the parsed registry, for advanced consumers (tests, build
 * tooling). Treat as read-only.
 */
export function getDeploymentsRegistry(): DeploymentsRegistry {
  return getRegistry();
}

/**
 * Drops the in-memory cache so the next accessor call re-reads
 * `deployments.json` from disk. Intended for tests that need to swap the
 * registry contents at runtime.
 */
export function __resetDeploymentsCacheForTests(): void {
  cachedRegistry = undefined;
}
