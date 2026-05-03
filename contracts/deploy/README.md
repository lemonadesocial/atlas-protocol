# Per-chain FeeRouter + AtlasTicket + RewardLedger deployment runbooks

One file per supported EVM chain. Each runbook documents the required env vars, the canonical stablecoin contract on that chain, the `forge script` invocations for FeeRouter, AtlasTicket, and RewardLedger, the post-deploy verification commands, and the CREATE2 address derivation.

Deployment is **EVM-portable**. The same `script/Deploy.s.sol` (FeeRouter), `script/DeployAtlasTicket.s.sol` (AtlasTicket), and `script/DeployRewardLedger.s.sol` (RewardLedger) run against every chain; only the env vars differ. See [`MULTICHAIN.md`](../MULTICHAIN.md) for the architectural rationale.

## Index

| Chain | Status | Runbook |
|-------|--------|---------|
| Base mainnet | Production | [`base.md`](./base.md) |
| Optimism (OP Mainnet) | Production | [`optimism.md`](./optimism.md) |
| Arbitrum One | Production | [`arbitrum.md`](./arbitrum.md) |
| World Chain | Production | [`worldchain.md`](./worldchain.md) |
| MegaETH | Experimental | [`megaeth.md`](./megaeth.md) |
| Tempo | Placeholder (pending public mainnet) | [`tempo.md`](./tempo.md) |

## Standard env-var set

FeeRouter takes these env vars, plus one chain-specific RPC URL:

```bash
export STABLECOIN=0x...     # ERC-20 stablecoin (USDC for Circle chains, USDM for MegaETH)
export TREASURY=0x...       # Protocol fee recipient (multisig)
export ADMIN=0x...          # DEFAULT_ADMIN_ROLE recipient (governance multisig)
export UPGRADER=0x...       # UPGRADER_ROLE recipient (multisig with timelock)
export PAUSER=0x...         # PAUSER_ROLE recipient (operations multisig)
export DEPLOYER=0x...       # Private key broadcasting the tx (or use --account / hardware wallet)
```

AtlasTicket takes a different (smaller) env-var set — no stablecoin, no treasury, plus a
distinct minter role:

```bash
export ADMIN=0x...          # DEFAULT_ADMIN_ROLE (reuse FeeRouter's value)
export MINTER=0x...         # MINTER_ROLE — operations service that mints after settlement
export PAUSER=0x...         # PAUSER_ROLE (reuse FeeRouter's value)
export UPGRADER=0x...       # UPGRADER_ROLE (reuse FeeRouter's value)
export NAME="ATLAS Ticket"  # ERC-721 collection name
export SYMBOL="ATLAS"       # ERC-721 collection symbol
```

RewardLedger takes the same `STABLECOIN` as FeeRouter (payouts settle in the chain's
stablecoin) plus role recipients, including a `RECORDER` role for the address allowed to
call `recordReward(...)` — typically the FeeRouter or the operations settlement service:

```bash
export ADMIN=0x...          # DEFAULT_ADMIN_ROLE (reuse FeeRouter's value)
export RECORDER=0x...       # RECORDER_ROLE — FeeRouter or settlement service
export PAUSER=0x...         # PAUSER_ROLE (reuse FeeRouter's value)
export UPGRADER=0x...       # UPGRADER_ROLE (reuse FeeRouter's value)
export STABLECOIN=0x...     # Same ERC-20 stablecoin as FeeRouter on this chain
```

## CREATE2 address derivation

The FeeRouter deploy script computes the proxy address with:

```text
expected = keccak256(0xff || 0x4e59b44847b379578588920cA78FbF26c0B4956C || salt || keccak256(initCode))
salt     = keccak256("atlas-protocol/FeeRouter v0.1.0")
initCode = type(ERC1967Proxy).creationCode || abi.encode(impl, initData)
initData = FeeRouter.initialize(admin, upgrader, pauser, treasury, stablecoin)
```

AtlasTicket uses an analogous derivation with a different salt and initData shape:

```text
salt     = keccak256("atlas-protocol/AtlasTicket v0.1.0")
initData = AtlasTicket.initialize(admin, minter, pauser, upgrader, name, symbol)
```

RewardLedger uses the same pattern with its own salt; like FeeRouter, `initData` embeds the
chain-specific stablecoin so the proxy address is per-chain by default:

```text
salt     = keccak256("atlas-protocol/RewardLedger v0.1.0")
initData = RewardLedger.initialize(admin, recorder, pauser, upgrader, stablecoin)
```

> **Important:** because `initData` embeds the chain-specific `(admin, upgrader, pauser, treasury, stablecoin)` tuple AND because `impl` is created with plain `CREATE` (so its address depends on the deployer's nonce on that chain), the resulting proxy address is **NOT** byte-identical across chains by default. Two ways to make it identical when needed:
>
> 1. Use the same admin/upgrader/pauser/treasury multisig addresses on every chain and bridge the deployer to the same nonce on each chain — then the impl address matches and the proxy address matches.
> 2. Treat the proxy address as per-chain output and record it in the chain's runbook + `@atlasprotocol/server-sdk` chain config.
>
> The script logs the expected address before broadcasting (`Expected addr   :`). Capture it and paste it into the runbook's "Deployed addresses" section after the deploy completes.

## Audit policy

Per `MULTICHAIN.md` §"Per-chain expansion checklist", a redeploy verification (~$10–30K with Trail of Bits or OpenZeppelin) is the default audit addendum for a new chain. Skip only when the chain has identical EVM semantics to a previously-audited deployment AND the contract source is unchanged.
