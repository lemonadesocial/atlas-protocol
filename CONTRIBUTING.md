# Contributing to ATLAS Protocol

Thanks for your interest in ATLAS. This repo holds the protocol specification, whitepaper, integration guides, and the TypeScript and Solidity packages that implement the protocol.

## Repo structure

```
atlas-protocol/
├── specs/         # Protocol specifications (SOURCE OF TRUTH)
├── whitepaper/    # Whitepaper + supporting research
├── guides/        # Integration + partnership guides
├── packages/      # TypeScript SDK packages (pnpm workspace)
│   ├── types/
│   ├── agent-tools/
│   └── server-sdk/
├── contracts/     # Solidity contracts (Foundry)
└── examples/      # Integration quickstarts (pnpm workspace)
```

`specs/` is the source of truth. Code in `packages/` and `contracts/` implements those specs — when the two diverge, the spec wins until a spec change is opened (see below).

## Local setup

Requirements:
- Node `>=22` (see `.nvmrc`)
- pnpm `>=9.0` (the repo pins `pnpm@9.15.0` via `packageManager`)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) for `contracts/`

```bash
nvm use            # picks up .nvmrc → Node 22
corepack enable    # makes the pinned pnpm available
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

For contracts:

```bash
cd contracts
forge build
forge test
```

## Adding a new TypeScript package

1. Create the directory under `packages/<name>/`.
2. Add a `package.json` with `"name": "@atlasprotocol/<name>"` and standard `build`/`test`/`lint`/`typecheck` scripts.
3. Add a `tsconfig.json` that extends the root config:
   ```json
   { "extends": "../../tsconfig.base.json" }
   ```
4. Workspaces are picked up automatically via `pnpm-workspace.yaml`. Run `pnpm install` from the repo root.
5. Add the package to the relevant section of the root `README.md`.

## Proposing a spec change

Specs are versioned and change deliberately:

1. Open an issue using the **Spec change** template. State the file, the proposed change, the motivation, and whether it is breaking.
2. Discuss in the issue until there is rough consensus.
3. Open a PR that updates the spec file. Reference the issue. If the change has implementation impact, follow up with PRs against `packages/` and `contracts/` in the same direction.
4. Breaking changes require a `CHANGELOG.md` entry under a new version heading.

For larger or governance-relevant changes, also see [`specs/11-GOVERNANCE-SPEC.md`](specs/11-GOVERNANCE-SPEC.md).

## Pull request conventions

- **Conventional commits** in PR titles and squash-merge commit messages:
  - `feat: …` — user-visible new functionality
  - `fix: …` — bug fix
  - `docs: …` — specs, whitepaper, guides, README, CONTRIBUTING
  - `chore: …` — tooling, CI, repo plumbing
  - `refactor: …` — behavior-preserving code change
  - `spec: …` — protocol specification change
- PR titles start with a verb (`feat: add …`, not `feat: registry pointer`).
- One concern per PR. Keep diffs reviewable.
- Fill in the PR template — type of change, testing checklist, notes for reviewers.
- CI must be green before merge: `typecheck`, `lint`, `build`, `test` (and `forge test` once contracts ship).

## Code style

- TypeScript: `strict` mode is on (see `tsconfig.base.json`). No `any` without an explanatory comment.
- Solidity: `solc 0.8.27`, `via_ir = true`, formatted with `forge fmt`.
- Comments explain *why*, not *what*. Names should carry the *what*.
