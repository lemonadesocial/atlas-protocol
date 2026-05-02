#!/usr/bin/env node
/**
 * Post-build copy of `deployments.json` from the repo root into the
 * package's `dist/` directory so it ships with the published npm tarball.
 *
 * `src/deployments.ts` reads from the repo root in dev (vitest, monorepo
 * builds) and falls back to a sibling `dist/deployments.json` for
 * installed consumers — this script produces that sibling copy.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const src = resolve(repoRoot, "deployments.json");
const distDir = resolve(here, "..", "dist");
const dest = resolve(distDir, "deployments.json");

if (!existsSync(src)) {
  console.error(`[copy-deployments] missing source: ${src}`);
  process.exit(1);
}
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}
copyFileSync(src, dest);
console.log(`[copy-deployments] copied ${src} → ${dest}`);
