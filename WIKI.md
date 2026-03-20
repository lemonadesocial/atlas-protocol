# Atlas Protocol

**The open infrastructure for agent-driven event discovery, ticketing, and settlement.**

## What is Atlas?

Atlas is a three-layer protocol that enables AI agents to discover, compare, and purchase event tickets across any source — individual organizers, existing platforms, or new platforms built on Atlas. It extends MPP (Machine Payment Protocol by Stripe + Tempo) with event-specific schemas, federated discovery, and USDC-based rewards.

## The Three-Layer Model

```
Layer 3: ORGANIZERS (B2C — bottom-up, viral)
         Connect platform accounts, list events, sell tickets directly
         ↕
Layer 2: PLATFORMS (B2B — existing + new)
         Existing: Integrate SDK, become Atlas-compliant
         New: Build on Atlas as infrastructure — skip payments, discovery, agent access
         ↕
Layer 1: ATLAS PROTOCOL (core infrastructure)
         Discovery, listing, ticketing, settlement, rewards
         ↕
Layer 0: PAYMENT RAILS (MPP + Tempo + Stripe)
         USDC/pathUSD (<$0.001 fees) + Stripe SPTs (cards, wallets)
```

## Three Growth Engines

| Approach | Who | How they join | Growth type |
|---|---|---|---|
| **B2C (bottom-up)** | Individual organizers | OAuth their Eventbrite/Lu.ma/Meetup accounts, or use Atlas Direct Ticketing | Viral — organizer invites organizer |
| **B2B (top-down)** | Existing platforms | Integrate @atlas/sdk, become Atlas-compliant | Credibility — logos and volume |
| **B2B-new (ecosystem)** | New platforms built ON Atlas | Use Atlas as ticketing/discovery/payment infrastructure from day one | Ecosystem — anyone can build a niche event platform |

## Flywheel

```
B2C organizers join (free, earns USDC rewards)
  → Atlas has event inventory
  → Agents find better results on Atlas
  → Agents drive ticket sales to organizers
  → Existing platforms notice the traffic loss
  → B2B platforms integrate officially
  → New niche platforms launch ON Atlas
  → More inventory → more agents → more organizers...
```

## Payments & Rewards (Phase 0)

- **All payments in USDC** on Tempo (<$0.001 fees) + Stripe SPTs (cards, wallets)
- **No custom token** — USDC only until adoption justifies tokenomics
- **Protocol fee:** 2% on transactions through Atlas
- **Organizer reward:** USDC cashback per ticket sold via Atlas
- **Attendee reward:** USDC cashback on purchases via Atlas
- **Referral reward:** USDC bonus for organizer-invites-organizer

## Future Token Phases (adoption-triggered)

| Phase | Trigger | What changes |
|---|---|---|
| 0 (now) | Launch | USDC only, Lemonade governs |
| 1 | $100K monthly GMV | LMC wrapper with fee discounts (optional) |
| 2 | $1M+ GMV, 25+ platforms | $LEMON governance token |
| 3 | $10M+ GMV, 100+ platforms | Dual-token, independent foundation |

## Built by Lemonade

Lemonade builds the reference implementation and operates the Atlas Registry. Atlas is positioned as platform-neutral — "Lemonade is a founding contributor" not "Atlas is a Lemonade product."

### Why Lemonade?
- MCP server with event tools (search, buy, price calculation)
- Stripe connected accounts + multi-chain crypto payments
- x402 payment middleware already in lemonade-ai
- Eventbrite import pipeline (already bridges platforms)
- Full ticketing infrastructure (ticket types, pricing, holds, refunds, check-in)

## Repo Structure

```
atlas-protocol/
├── WIKI.md                      ← You are here
├── 01-whitepaper/               # Vision, protocol spec, formal specification
├── 02-protocol-core/            # Discovery, listing, purchase, settlement schemas
├── 03-organizer-layer/          # B2C: OAuth connectors, Direct Ticketing, onboarding
├── 04-platform-layer/           # B2B: SDK for existing platforms, integration guide
├── 05-platform-builder/         # B2B-new: Build new platforms on Atlas infrastructure
├── 06-agent-layer/              # Client SDK, MCP tools, LangChain/OpenAI integrations
├── 07-economics/                # Fee structure, USDC rewards, phased tokenomics
├── 08-marketing/                # GTM for organizers, platforms, and builders
├── 09-governance/               # Charter, roadmap, decision-making
└── 10-competitive-intel/        # Landscape, moat analysis, defensibility
```

## Related Repos

- **lemonade-mpp/** — MPP integration PRDs for Lemonade (Atlas depends on PRDs #2, #7, #10)
- **lemonade-backend/** — Reference implementation target
- **lemonade-ai/** — MCP server + x402 infrastructure
- **web-new/** — Frontend for Atlas-powered experiences
