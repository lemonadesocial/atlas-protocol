# The Organizer Experience

> From signup to sold-out. The complete organizer journey on ATLAS.

---

## 1. Onboarding

An organizer goes from zero to agent-discoverable events in under two minutes. Two paths exist.

**Path A: Connect existing platforms.** Sign up, then authorize your Eventbrite, Lu.ma, Meetup, or Partiful accounts via OAuth. ATLAS imports your events automatically. Every imported event is immediately discoverable by AI agents. You change nothing about your existing setup.

**Path B: Create a Space.** Skip platform connectors. Create a Space (Section 2) and list events directly on ATLAS. Lower fees, faster settlement, full agent access from day one.

Both paths put your events in the ATLAS registry, make them agent-discoverable, and earn you USDC on every ticket sold.

### Post-Signup Sequence

1. Connect a platform account OR create a Space.
2. Set your payout wallet for USDC rewards (optional at signup, a custodial wallet is auto-created).
3. Invite other organizers for referral bonuses.

---

## 2. Space as Platform

Creating a Space on ATLAS is creating an event platform. No code required.

A Space gets its own brand, event feed, `/.well-known/atlas.json` endpoint, and agent-discoverable inventory. You control curation, community rules, and visual identity. The Space inherits full ATLAS infrastructure: ticketing, settlement, agent access, CRM, and promotion tools.

```bash
# Create a Space (= create an event platform)
lemonade space create --name "Brooklyn Jazz Collective" --domain bjc.events --type music
```

A community leader with 500 Instagram followers can launch an event platform in one terminal command. The Space competes on curation and community, not infrastructure.

---

## 3. Event Creation

Three interfaces, same result. Every event publishes to IPFS and registers in the ATLAS discovery registry.

**CLI:**

```bash
lemonade event create \
  --space bjc_abc123 \
  --title "Late Night Jazz at Nublu" \
  --date 2026-04-15T21:00 \
  --location "151 Avenue C, New York, NY 10009" \
  --ticket-type "General Admission" \
  --price 25.00 \
  --capacity 100
```

**API:** POST to the ATLAS event endpoint with a JSON body.

**AI Agent:** "Create a jazz night at Nublu, April 15, $25 GA, 100 capacity." The agent calls `lemonade event create`, publishes to IPFS, and registers with the ATLAS registry. One conversation, fully live event. The protocol does not distinguish between a human and an agent calling the CLI.

---

## 4. Organizer AI Agents

The same agent infrastructure that helps guests discover events helps organizers run them. Organizer agents use `lemonade-cli` and the ATLAS protocol as primitives. Three capabilities.

**Event creation and management.** The agent handles the full lifecycle: create events, configure ticket types, set pricing, publish listings, update details.

**Guest relationship management.** The agent tracks RSVPs, check-ins, feedback, and purchase history across events. It answers queries like "Who attended my last three events?" Guest data lives in your XMTP-linked CRM (Section 5). You own the data, not the platform.

**Marketing and distribution.** The agent targets guest segments based on CRM data and submits promotions to the ATLAS ad-network (Section 6). It reaches new guests through other agents' recommendation surfaces.

```bash
lemonade guests list --space bjc_abc123 --segment "attended_jazz_events" --format json
lemonade message send --space bjc_abc123 --segment "attended_jazz_events" --template "new_event"
lemonade promote create --event evt_xyz789 --bid-per-sale 2.00 --budget 100.00
```

---

## 5. Guest CRM on XMTP

XMTP is a decentralized messaging protocol with end-to-end encryption and self-custody keys. ATLAS uses it as the communication layer between organizers and guests.

When a guest purchases a ticket, a communication channel opens over XMTP (with guest consent). Your CRM is a local-first database combining XMTP conversations, on-chain purchase history from settlement receipts, and check-in data.

**Self-custody.** You hold the keys. No platform can revoke access to your guest list.

**Portable.** Switch platforms, keep your audience. The guest relationship belongs to you and the guest, not to a platform.

**Privacy-preserving.** Messages are encrypted end-to-end. Guests can opt out at any time.

**Agent-native.** Your AI agent reads and writes to XMTP channels for event updates, guest questions, RSVPs, and follow-ups.

CRM queries run locally against your XMTP-linked data.

```bash
lemonade guests list --space bjc_abc123 --segment "attended_3plus_events" --format json
lemonade message send --space bjc_abc123 --segment "attended_jazz_events" --template "early_bird"
```

No centralized database. No third-party email service.

---

## 6. Promotion via the Ad-Network

Traditional event advertising sells attention: impressions or clicks with no guarantee of a sale. ATLAS sells outcomes. You pay only when a ticket sells.

You (or your agent) create a promotion campaign with a USDC budget and a per-sale bid.

```bash
lemonade promote create --event evt_xyz789 --bid-per-sale 2.00 --budget 100.00
```

Guest-side agents receive promoted listings alongside organic results, labeled as promoted. Agents surface promotions only when relevant to the user's query.

### $100 on ATLAS vs. $100 on Meta

| Metric | Meta/Instagram | ATLAS Ad-Network |
|--------|---------------|-----------------|
| Model | Pay-per-click | Pay-per-sale |
| $100 buys | 11-20 clicks ($5-9 CPC) | 50 ticket sales ($2 bid) |
| Conversion to sale | 2-5% of clicks | 100% (paid only on sale) |
| Revenue at $25/ticket | $10-25 | $1,250 |

When a ticket sells through a promoted listing, the bid splits: 60% to the referring agent, 30% to the protocol treasury, 10% to the registry node.

Every agent built to consume ATLAS organic listings also consumes promoted listings. The ad surface is every AI agent on the internet, not a single app.

---

## 7. Rewards

Every ticket sold through ATLAS earns you USDC cashback. The protocol returns a portion of its 2% fee to the participants who make the network valuable.

### Volume Tiers

| Monthly Ticket Sales | Cashback Rate | Effective Rate |
|---------------------|---------------|----------------|
| 1-100 tickets | 20% of protocol fee | 0.4% of GMV |
| 101-500 tickets | 25% of protocol fee | 0.5% of GMV |
| 501-2,000 tickets | 30% of protocol fee | 0.6% of GMV |
| 2,000+ tickets | 35% of protocol fee | 0.7% of GMV |

### Payout Rules

- **Frequency:** Weekly, automatic.
- **Currency:** USDC to your configured wallet.
- **Minimum:** None. Every earned cent is paid out.
- **Process:** No claim flow, no token conversion. USDC arrives automatically.

---

## 8. Dashboard

The dashboard is the organizer's home base. It aggregates data across all connected platforms and ATLAS Direct events.

**Event analytics.** All events from all sources in a unified view. Source badges, sync status, filters by platform, date, status, or title.

**CRM insights.** Guest segments, attendance patterns, repeat visitor rates, spending data. Powered by your XMTP-linked CRM.

**Promotion performance.** Active campaigns, bid spend, sales attributed to promotions, ROI per campaign.

**Revenue tracking.** Total USDC earned, per-event breakdown, payment method split (USDC vs. fiat vs. agent purchase), reward balance with full transaction history.

---

## 9. Migration Path

The migration from external platforms to ATLAS Direct is gradual and data-driven. No all-or-nothing decisions.

### Stage 1: Connect

Connect your Eventbrite, Lu.ma, or Meetup accounts. Events sync to ATLAS and become agent-discoverable. Ticket purchases still happen on the source platform. Zero risk.

### Stage 2: Observe

After 2-4 weeks, the dashboard shows agent traffic: how many agents discovered your events, how many search results included your listings, and estimated sales that completed on the source platform at higher fees.

### Stage 3: Upgrade One Event

Pick one upcoming event. Click "Upgrade to ATLAS Direct." Agent purchases now complete on ATLAS at 2% instead of 5-10%. Your platform listing stays active as a safety net. The dashboard shows a side-by-side comparison.

### Stage 4: Expand

Lower fees, faster settlement, USDC cashback. Upgrade more events. New events default to ATLAS Direct.

### Stage 5: Full ATLAS Direct

All new events created directly on ATLAS via CLI, API, or agent. Platform connections kept for historical sync or disconnected. Your choice.

ATLAS never forces migration. The economics drive organic adoption.

| | External Platform | ATLAS Direct |
|---|---|---|
| Platform fee | 5-10% | 0% |
| Protocol fee | 2% | 2% |
| Total fee | 7-12% | 2% |
| Agent purchase (402) | Not supported | Full support |
| Settlement | Weekly ACH | USDC, near-instant |
| USDC cashback | Yes | Yes |
