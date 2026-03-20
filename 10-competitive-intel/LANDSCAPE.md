# Atlas Protocol -- Competitive Landscape

> Last updated: 2026-03-19
> Status: Living document -- update quarterly or on major market shifts

---

## 1. Event Ticketing Market Overview

### Market Size

The global online event ticketing market is valued at approximately **$85 billion in 2025**, projected to reach $105 billion by 2031 at a 3.55% CAGR (Mordor Intelligence). Other estimates place the 2025 figure at $53 billion (Research and Markets), reflecting different methodological scopes -- the higher figure includes secondary/resale markets and adjacent services.

### Key Structural Facts

- **Mobile transactions** account for 58.95% of total ticket purchases
- **Music concerts and festivals** command 36.73% of revenue
- **North America** holds 38.76% market share; **Asia Pacific** is the fastest-growing region at 3.99% CAGR
- The market is fragmented at the mid-tier (thousands of platforms) but consolidated at the top (Live Nation/Ticketmaster dominates large venues)

### Macro Trends Relevant to Atlas

1. **API-first infrastructure** is replacing "black box" ticketing -- organizers demand data ownership and flexibility
2. **AI agents** are entering the purchase flow -- Mastercard enabled the first agentic commerce transaction at VOX Cinemas (UAE, Nov 2025)
3. **Bending Spoons consolidation** -- the Italian PE firm now owns both Meetup and Eventbrite, signaling a roll-up strategy for mid-market platforms
4. **Antitrust pressure** on Live Nation/Ticketmaster is creating openings for alternative infrastructure
5. **Open payment protocols** (x402, MPP, ACP) are standardizing how agents pay -- but nobody has standardized what they discover and book

---

## 2. Platform-by-Platform Analysis

### 2.1 Eventbrite

| Dimension | Detail |
|-----------|--------|
| **Revenue** | $325M (2024); guided $290-296M for 2025 (down ~10% YoY after eliminating organizer fees) |
| **Scale** | 93 million unique buyers, 180+ countries |
| **Pricing** | 3.7% + $1.79 per ticket + 2.9% processing. Free events are free to list. Optional Eventbrite Pro ($15-100/mo) for marketing tools |
| **API** | REST API available at eventbrite.com/platform/api. No dedicated developer program or marketplace. API is functional but not a strategic priority |
| **IPO to Acquisition** | IPO'd at $1.76B in 2018. Acquired by Bending Spoons for $500M in Dec 2025 (~72% below IPO valuation). Deal closed March 10, 2026 |
| **Ownership** | Bending Spoons (also owns Meetup, Evernote, Vimeo, WeTransfer, AOL). Known for aggressive cost-cutting and monetization of acquired brands |

**Strengths:**
- Massive existing organizer base and buyer network
- Brand recognition in the self-service mid-market
- Functional API that thousands of integrations already use

**Weaknesses:**
- Revenue declining; strategic direction unclear under new PE ownership
- Bending Spoons track record is extractive (Evernote layoffs, feature paywalling)
- API is a maintenance-mode afterthought, not a growth vector
- No agent-native capabilities, no protocol thinking
- Platform lock-in: organizers cannot easily port their audience data

**Atlas Opportunity:** Eventbrite organizers are anxious about Bending Spoons ownership. An Atlas adapter that wraps Eventbrite's API gives organizers a hedge -- their events become discoverable across all Atlas-connected platforms, reducing single-platform dependency.

---

### 2.2 Lu.ma

| Dimension | Detail |
|-----------|--------|
| **Funding** | $3M raised (Venrock, Maven Ventures, 2020). Likely raised additional undisclosed rounds given growth |
| **Growth** | 5x user growth in 2024. Dominant in AI/tech/crypto event communities |
| **Pricing** | Free tier available. Luma Plus subscription required for API access and advanced features |
| **API** | GraphQL-style API at docs.luma.com. Requires Luma Plus subscription. Responsive developer support (48-hour turnaround on feature requests) |
| **Focus** | Tech community events, meetups, conferences. Strong in SF/NYC AI scene |

**Strengths:**
- Best-in-class UX for event creation and RSVPs
- Deep penetration in AI/tech community (the exact community building agents)
- Clean, modern API with active maintenance
- Network effects within tech communities

**Weaknesses:**
- Narrow demographic focus (tech/crypto/AI). Weak in music, nightlife, sports, corporate
- Small team, limited funding runway compared to incumbents
- API gated behind paid subscription -- not truly open
- No protocol ambitions; it is a product, not infrastructure

**Atlas Opportunity:** Lu.ma events are high-signal for AI agent use cases. An Atlas adapter for Lu.ma would immediately populate the registry with the most agent-relevant events. Lu.ma's community could become early Atlas evangelists.

---

### 2.3 Meetup

| Dimension | Detail |
|-----------|--------|
| **Ownership** | Bending Spoons (acquired Jan 2024) |
| **API Status** | GraphQL API available (updated Feb 2025 with full schema introspection). Legacy REST API v2 deprecated. **API access restricted to Pro customers** |
| **Scale** | Historically 50M+ members, 300K+ groups. Current numbers under Bending Spoons unclear |
| **Pricing** | Organizer subscription model; Pro tier required for API access |

**Strengths:**
- Massive historical community base (professional meetups, tech groups)
- Recurring event patterns (weekly/monthly groups) create predictable data
- GraphQL API is modern and introspectable

**Weaknesses:**
- Community trust eroded under Bending Spoons (pricing increases, feature removal)
- API locked behind Pro paywall -- kills grassroots developer adoption
- Now shares ownership with Eventbrite, creating conflict-of-interest risk for API consumers
- Organizer exodus to Lu.ma, Eventbrite, and standalone tools

**Atlas Opportunity:** Meetup's recurring community events are high-value for agent discovery. An adapter can scrape/integrate public Meetup data even without Pro API access, similar to how Plaid originally reverse-engineered bank connections.

---

### 2.4 Dice (now Fever/Dice)

| Dimension | Detail |
|-----------|--------|
| **Funding** | $238M total raised. $400M valuation (2021). Acquired by Fever in June 2025 |
| **Scale** | Millions of fans, 55,000 artists, 10,000+ venues across ~30 cities |
| **Revenue** | $28.5M (2022) |
| **API** | GraphQL Ticket Holders API for partners. No public developer program |
| **Focus** | Music, nightlife, live events. Strong in London, NYC, LA, Berlin |

**Strengths:**
- Deep artist and venue relationships in music/nightlife vertical
- Fan-first UX (no-fee ticketing model, prices include fees)
- Now combined with Fever's "secret experiences" inventory

**Weaknesses:**
- API is partner-only, not open
- Post-acquisition integration with Fever may distract from API development
- Limited outside music/nightlife vertical

**Atlas Opportunity:** Dice/Fever's music and nightlife inventory fills a gap that Eventbrite and Lu.ma cannot. Adapter integration brings high-demand entertainment events into Atlas.

---

### 2.5 Resident Advisor (RA)

| Dimension | Detail |
|-----------|--------|
| **Focus** | Electronic music, club culture. Global authority in the scene |
| **Ticketing** | RA Pro for clubs, promoters, festivals. Building new core ticketing platform with BR-DGE payments infrastructure (3-year deal, 2025) |
| **API** | No official public API. Third-party scrapers exist on Apify. RA Pro supports Events API for TikTok Pixel integration |
| **Scale** | Niche but authoritative. The definitive source for electronic music events globally |

**Strengths:**
- Unmatched credibility in electronic music community
- Investing in modern ticketing infrastructure (BR-DGE partnership)
- Deep venue and artist data

**Weaknesses:**
- No developer ecosystem, no public API
- Niche focus limits total addressable market
- Slow to modernize historically

**Atlas Opportunity:** RA's data is extremely high-signal for nightlife discovery. Even a read-only adapter positions Atlas as the only cross-platform source that includes RA events alongside mainstream platforms.

---

### 2.6 Ticketmaster / Live Nation

| Dimension | Detail |
|-----------|--------|
| **Revenue** | $25.2B (Live Nation, 2025), up 9% YoY. Operating profit $1.3B (+50%) |
| **Scale** | 159 million fans attended 55,000 concerts (2025). 80%+ of US major venue primary ticketing. 265 exclusive venue arrangements. Stakes in 460 venues. 400+ managed artists |
| **Developer Program** | Ticketmaster Developer Portal: Discovery API, Commerce API, Publish API, Presence API, Partner API. Free API key on signup |
| **Antitrust** | DOJ lawsuit filed 2024. Trial began March 2, 2026. Settlement reached: $280M damages, must allow multi-vendor ticketing. 30+ states rejecting settlement as insufficient |

**Strengths:**
- Overwhelming market dominance in large-venue/arena events
- Most mature developer program in the industry (multiple APIs, SDKs, widgets)
- Discovery Feed provides bulk event data access
- Deep pockets and venue lock-in make displacement nearly impossible

**Weaknesses:**
- Antitrust scrutiny creating regulatory risk and forced openness
- Consumer brand is toxic (fees, bot issues, Taylor Swift debacle)
- APIs are discovery/read-focused; purchasing still requires Ticketmaster checkout
- No interest in being an open protocol -- they ARE the walled garden
- Zero agent-native capabilities

**Atlas Opportunity:** Ticketmaster's Discovery API already provides read access to their event data. Atlas can wrap this as a first-class adapter, giving agents access to arena/stadium events. The antitrust settlement requiring multi-vendor ticketing could eventually force deeper integration.

---

### 2.7 Partiful

| Dimension | Detail |
|-----------|--------|
| **Funding** | $27.3M total. $20M Series A1 (2022). Backed by a16z, GV |
| **Growth** | 2M new users in 2025. 500K MAU in Q1 2025 (400% YoY growth). Google Play Best App 2024. TIME 100 Most Influential Companies 2025 |
| **Pricing** | Completely free. No paid tiers. No ads |
| **API** | No public API |
| **Focus** | Social/casual events (dinner parties, house parties, birthday parties). Gen Z demographic (90% of users younger than competitors) |

**Strengths:**
- Explosive organic growth through viral social mechanics
- Beloved brand among Gen Z
- Apple copied them (built a native events feature), validating the market

**Weaknesses:**
- No monetization model yet (free, no ads)
- No API, no developer ecosystem
- Casual/social events may not generate ticketing revenue
- Privacy concerns surfaced (GPS data in photos, Oct 2025)

**Atlas Opportunity:** Partiful's social events represent a massive volume of untapped "dark matter" events not on any ticketing platform. If Partiful ever opens an API or Atlas builds a social-event adapter, it unlocks casual gathering discovery for agents.

---

### 2.8 Other Notable Players

| Platform | Focus | Notes |
|----------|-------|-------|
| **Shotgun** | Nightlife, electronic music | 30K+ events, 3K+ organizers, 49 countries. Offices in Paris, Lisbon, Sao Paulo, US. 560% payment volume growth on Stripe Connect. Has developer API with token auth |
| **vivenu** | Enterprise/white-label ticketing | API-first, headless architecture. 700+ organizers. REST API, SDKs. Closest to Atlas philosophy but is a product, not a protocol |
| **Fever** | "Secret" experiences, entertainment | Acquired Dice (June 2025). Operating in 100+ cities. Discovery-focused |
| **Ticket Fairy** | Festivals, open data advocate | Supports open data feeds and developer APIs for festival data |
| **Humanitix** | Nonprofit/charity events | Growing in the impact space, fees go to charity |

---

## 3. Adjacent Protocols and Standards

### 3.1 x402 (Coinbase)

| Dimension | Detail |
|-----------|--------|
| **Launch** | May 2025 |
| **Scale** | 100M+ payments processed in first 6 months. $24M+ in value |
| **V2** | Standardizes cross-chain and cross-rail payment formats |
| **Governance** | x402 Foundation co-launched with Cloudflare (Sep 2025). Open standard |
| **Supported Chains** | Base, Solana (production). Solana flipped Base in volume by late 2025 |
| **Stripe Integration** | Feb 2026: Stripe began using x402 for USDC payments on Base |

**Relationship to Atlas:**
- x402 solves the **payment** layer -- how agents pay for things via HTTP 402 responses
- Atlas solves the **discovery and booking** layer -- what agents find and how they reserve
- **Complementary, not competitive.** Atlas can use x402 as one settlement option alongside MPP and traditional Stripe
- **Limitation:** x402 is crypto-native (USDC). Many event organizers want fiat settlement. Atlas must support both

**Risk:** If x402 adds event-specific schemas (venue, ticket type, seat), it could creep into Atlas territory. Current scope is generic HTTP-level payments with no domain awareness.

---

### 3.2 MPP -- Machine Payments Protocol (Stripe/Tempo)

| Dimension | Detail |
|-----------|--------|
| **Launch** | Announced Sep 2025. Testnet Dec 2025. **Mainnet March 18, 2026** (yesterday) |
| **Authors** | Co-authored by Tempo and Stripe |
| **Key Innovation** | "Sessions" primitive: agents authorize a spending limit upfront, stream micropayments without per-transaction on-chain cost |
| **Partners** | Visa (card-based MPP), Stripe (cards, wallets), Lightspark (Bitcoin/Lightning). 100+ integrated service providers including Anthropic, OpenAI, Shopify |

**Relationship to Atlas:**
- MPP is the **payment rail** Atlas is designed to use for agent transactions
- Atlas + MPP = agents discover events via Atlas, pay via MPP sessions
- **Deeply complementary.** Tempo is the settlement layer; Atlas is the application-layer protocol for events
- MPP's session model is ideal for event ticketing: authorize a budget, let the agent find and book within it

**Risk:** If MPP builds a "services directory" that includes events, it could subsume some Atlas registry functionality. Current scope is pure payments infrastructure with no domain-specific discovery.

---

### 3.3 MCP -- Model Context Protocol (Anthropic)

| Dimension | Detail |
|-----------|--------|
| **Launch** | Nov 2024 |
| **Adoption** | 10,000+ active public MCP servers. Adopted by ChatGPT, Cursor, Gemini, Copilot, VS Code. 97M+ monthly SDK downloads |
| **Governance** | Donated to Agentic AI Foundation (AAIF) under Linux Foundation, Dec 2025 |
| **Support** | OpenAI, Google DeepMind, Microsoft all on steering committee |

**Relationship to Atlas:**
- MCP defines **how AI models discover and invoke tools**
- Atlas event operations (search, book, check-in) can be exposed as **MCP tools**
- This means any MCP-compatible agent (Claude, ChatGPT, Gemini) can natively interact with Atlas
- **Atlas-as-MCP-server** is a primary distribution strategy

**Risk:** If someone builds a popular "events MCP server" that hardcodes to a single platform (e.g., Eventbrite MCP), it could capture the integration point before Atlas. Speed matters here.

---

### 3.4 A2A -- Agent2Agent Protocol (Google)

| Dimension | Detail |
|-----------|--------|
| **Launch** | April 2025 |
| **Adoption** | 150+ organizations including Atlassian, Salesforce, SAP, PayPal |
| **Version** | v0.3 released. gRPC support, security cards, extended Python SDK |
| **Governance** | Linux Foundation open-source project |

**Relationship to Atlas:**
- A2A enables **agent-to-agent communication** -- a booking agent talking to a venue agent
- Atlas provides the **shared vocabulary and registry** those agents communicate about
- A2A + Atlas = a booking agent (A2A client) discovers events via Atlas, negotiates with a venue agent (A2A server) using Atlas schemas
- **Complementary.** A2A is transport/coordination; Atlas is domain semantics

**Risk:** If A2A develops domain-specific schemas for events, it could compete with Atlas's event vocabulary. Current scope is generic agent interop.

---

### 3.5 ACP -- Agentic Commerce Protocol (OpenAI/Stripe)

| Dimension | Detail |
|-----------|--------|
| **Launch** | Sep 2025 |
| **Authors** | OpenAI and Stripe (founding maintainers) |
| **Releases** | Initial (Sep 2025), fulfillment (Dec 2025), capability negotiation (Jan 2026), extensions/discounts/payment handlers (Jan 2026) |
| **Live Usage** | ChatGPT Instant Checkout: Etsy live, 1M+ Shopify merchants coming (Glossier, SKIMS, Spanx, Vuori) |
| **License** | Apache 2.0, open source |

**Relationship to Atlas:**
- ACP standardizes **how agents complete purchases** with merchants
- Atlas standardizes **how agents discover and select events**
- ACP's catalog format could theoretically include events, but it is designed for e-commerce products
- Atlas could feed into ACP: agent discovers event via Atlas, completes purchase via ACP flow
- **Mostly complementary**, with some overlap risk in the "catalog" layer

**Risk:** If ACP adds an "events" vertical with ticketing semantics (date, venue, capacity, seat selection), it directly competes with Atlas discovery. OpenAI's distribution (ChatGPT) would make ACP-events instantly dominant. **This is the highest-probability competitive threat.**

---

### 3.6 Schema.org Event

| Dimension | Detail |
|-----------|--------|
| **Status** | Mature, widely adopted for SEO. Google, Bing, and AI systems recognize Event schema |
| **Scope** | Structured data for event name, date, time, location, ticketing URL, performer |

**Limitations for Agent Use Cases:**
- **Read-only.** No booking, no availability, no payment
- **No registry.** Each website publishes its own; no central discovery mechanism
- **No cross-platform identity.** Same event on Eventbrite and Dice gets two unrelated Schema.org entries
- **Stale data.** Embedded in HTML, not real-time. Sold-out events still appear
- **No agent affordances.** No tool descriptions, no action schemas, no authentication

**Relationship to Atlas:**
- Atlas extends where Schema.org stops: real-time availability, booking actions, cross-platform dedup, agent-native tool interfaces
- Atlas schemas should be Schema.org-compatible for SEO interop but go far beyond it

---

## 4. AI Agent Ecosystem -- Who Has Event Integrations?

| Platform/Framework | Event Integration | Notes |
|--------------------|-------------------|-------|
| **ChatGPT (OpenAI)** | Instant Checkout via ACP (Etsy, Shopify). No event-specific integration | Events are a natural next vertical after e-commerce |
| **Claude (Anthropic)** | MCP tools for various services. No event-specific MCP server in top 10K | Clear gap -- Atlas MCP server would be first |
| **Gemini (Google)** | Google Events knowledge panel. No agentic booking capability | Google indexes Schema.org events but cannot complete transactions |
| **LangChain** | Tool integrations via community. Eventbrite tool exists but is basic (read-only search) | No unified event protocol tool |
| **Microsoft Copilot** | Calendar integration. No event discovery or ticketing | Natural distribution channel if Atlas ships a Copilot plugin |
| **Mastercard Agent Pay** | First agentic commerce transaction (VOX Cinemas, UAE, Nov 2025) | Proves demand for agent-driven event purchases |

**Key Insight:** No major AI agent platform has a comprehensive event discovery + booking integration. This is a gap Atlas is purpose-built to fill.

---

## 5. Plaid Analogy Analysis

### How Plaid Won

1. **Bottom-up, developer-first adoption.** Plaid's founders explicitly chose to "sell through the basement" -- target individual developers who become internal advocates. They had no enterprise sales team for years.

2. **Solved a real pain point nobody else would.** Banks had no clean APIs. Plaid reverse-engineered legacy systems, normalized data, and exposed it through a single API. "Time-to-integration went from weeks to minutes."

3. **User-authorized data access.** Plaid Link lets the end user (consumer) authorize data sharing. The bank doesn't need to cooperate. This bypassed institutional gatekeepers.

4. **Built the translation layer, not the product.** Plaid does not compete with Venmo or Acorns. It enables them. This made every fintech app a distribution partner, not a competitor.

5. **Network effects compounded.** More developers using Plaid meant more consumer accounts connected, which meant more bank coverage invested in, which attracted more developers. 150M+ connected consumers, 7K+ apps, 12K+ financial platforms by 2026.

6. **Valuation trajectory.** IPO blocked by DOJ (Visa acquisition at $5.3B). Raised at $13.4B (2021). Adjusted to $6.1B (2025). Now at ~$430M ARR with 25%+ growth. Plaid's value survived a brutal down-market because the infrastructure was sticky.

### What Atlas Can Learn

| Plaid Lesson | Atlas Application |
|-------------|-------------------|
| Developer-first GTM | Atlas SDK, sandbox, quickstart guides -- make integration minutes, not weeks |
| User-authorized access | Organizer-first OAuth: the organizer authorizes Atlas to access their event data. Platform doesn't need to cooperate |
| Reverse-engineer legacy systems | Adapter strategy: wrap Eventbrite, Meetup, Ticketmaster APIs without their permission, just as Plaid screen-scraped banks |
| Translation layer, not product | Atlas does not sell tickets or host events. It enables platforms that do. Every platform is a distribution partner |
| Don't compete with your customers | Atlas never becomes an event platform. It stays infrastructure. This is critical for trust |

### Key Differences from Plaid

| Dimension | Plaid | Atlas |
|-----------|-------|-------|
| **Incumbent cooperation** | Banks initially hostile, eventually partnered | Event platforms may be hostile or indifferent. Some (like vivenu) share the open-API philosophy |
| **Regulatory tailwind** | Open Banking regulations forced banks to provide APIs | No equivalent regulation for events. Atlas must create demand, not rely on mandates |
| **Data sensitivity** | Financial data is regulated (PCI, SOC2, GDPR) | Event data is lower sensitivity but has fraud/scalping concerns |
| **Transaction value** | High (bank account linking enables thousands in transactions) | Lower per-transaction (event tickets $20-200 typically) |
| **Revenue model** | Per-API-call pricing | Registry fees + transaction percentage on USDC settlement |
| **Time to network effects** | 3-5 years to critical mass | Could be faster due to AI agent adoption curve, or slower if organizer onboarding is manual |

---

## 6. Market Map

```
                        EVENT-SPECIFIC
                             |
                   Atlas     |    Eventbrite API
                   vivenu    |    Ticketmaster Discovery
                             |    Dice Partner API
         OPEN ---------------+--------------- PROPRIETARY
                             |
                   x402      |    ACP (OpenAI/Stripe)
                   MPP       |    Google Events KP
                   A2A       |    Apple Events (iOS)
                   MCP       |
                             |
                       GENERAL-PURPOSE
```

**Atlas's unique position:** The only player in the top-left quadrant that is both event-specific AND open/protocol-native. vivenu shares the API-first philosophy but is a product (SaaS), not a protocol. x402/MPP/MCP are open but general-purpose. Eventbrite/Ticketmaster have event APIs but are proprietary walled gardens.

---

## 7. Summary: Atlas's Competitive Position

### What Atlas Has That Nobody Else Does

1. **Cross-platform event discovery protocol** -- no one else is building this
2. **Organizer-first authorization model** -- borrowed from Plaid, applied to events
3. **Agent-native from day one** -- MCP tools, A2A compatibility, MPP payments
4. **Adapter strategy** -- include platforms without their cooperation
5. **Open governance** -- reduces "controlled by a competitor" objection
6. **Three-sided network** -- organizers, platforms, and agents all benefit

### What Atlas Lacks (Honest Assessment)

1. **No live traffic.** Protocols without adoption are just specs
2. **No organizer base.** Must convince organizers to OAuth-connect, which requires demonstrating agent-driven value
3. **Crypto-adjacent perception.** USDC settlement may scare mainstream organizers (Stripe/MPP helps here)
4. **No regulatory mandate.** Unlike Open Banking for Plaid, no law forces event platforms to open up
5. **Small team vs. giant incumbents.** Eventbrite (Bending Spoons), Ticketmaster (Live Nation), ACP (OpenAI + Stripe) all have 100-1000x more resources
6. **Chicken-and-egg problem.** Agents need events in the registry; organizers need agents sending traffic. Classic marketplace cold-start
