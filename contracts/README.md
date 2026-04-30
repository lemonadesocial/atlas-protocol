# ATLAS Contracts

Solidity contracts for the ATLAS Protocol, built with [Foundry](https://book.getfoundry.sh/).

This directory will house the on-chain components defined in [`specs/04-SMART-CONTRACTS-SPEC.md`](../specs/04-SMART-CONTRACTS-SPEC.md):

- **`FeeRouter`** — splits the 2% protocol fee across organizer rewards, referrer rewards, and the protocol treasury, and forwards USDC settlement to the merchant of record.
- **`RegistryPointer`** — on-chain pointer that lets clients resolve the canonical registry endpoint for a given namespace, enabling progressive decentralization of registry hosting.
- **`AtlasTicket`** — ERC-721 ticket NFT minted on settlement; carries event metadata CID, ticket-type CID, and proof-of-purchase that downstream contracts (rewards, gating) can verify.

Additional contracts (`RewardLedger`, `PromotionSettlement`) follow the same spec and will land here as the implementation rolls out.

## Layout

```
contracts/
├── foundry.toml      # Foundry config (solc 0.8.27, via_ir, optimizer 200 runs)
├── src/              # Contract sources
└── test/             # Forge tests
```

## Common commands

```bash
forge build
forge test
forge fmt
forge snapshot
```

External libraries (e.g. OpenZeppelin) install into `lib/` via `forge install`.
