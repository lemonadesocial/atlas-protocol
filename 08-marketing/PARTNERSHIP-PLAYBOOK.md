# Atlas Protocol — Partnership Playbook

> Don't ask platforms to integrate. Let organizers make it inevitable.

---

## Strategic Framework

### The Bottom-Up Playbook

Traditional platform partnerships fail because you're asking an incumbent to help a potential competitor. Atlas inverts the dynamic:

```
Phase 1: Build adapters that use platform APIs via organizer OAuth
    ↓
Phase 2: Organizers connect their own accounts (no platform cooperation needed)
    ↓
Phase 3: Platform sees Atlas traffic in their API logs
    ↓
Phase 4: Approach platform: "Your organizers are already here. Want control?"
    ↓
Phase 5: Platform integrates officially (better data, revenue share, co-marketing)
```

**Why this works:** Organizers OWN their accounts. They have the right to authorize third-party access via OAuth. Platforms cannot block this without breaking their own API terms of service and alienating their power users.

**Why platforms eventually cooperate:**
1. They see Atlas-originated traffic growing in their analytics
2. Their organizers are asking about Atlas
3. Official integration gives them control over how their events appear
4. Revenue share on agent-driven sales is free money
5. Refusing looks anti-organizer ("Why are you blocking your users from getting more exposure?")

### The Adapter Strategy

For each platform, Atlas builds an **adapter** — a module that translates between the platform's API and the Atlas protocol schema. The adapter:

- Authenticates via the organizer's OAuth token (not a platform partnership)
- Reads event data (title, date, location, tickets, pricing)
- Normalizes to Atlas schema
- Handles booking/ticketing API calls when an agent wants to purchase
- Respects platform rate limits and ToS

**Critical: Adapters must be read-heavy, write-light.** Discovery (reads) is low-risk. Booking (writes) is where platforms may push back. Start with discovery-only adapters and add transactional capability once the platform relationship is established.

### Partnership Progression

```
Stage 0: Adapter built (no platform involvement)
Stage 1: Organizers connecting (platform sees traffic)
Stage 2: Informal contact (share data, build relationship)
Stage 3: Discovery partnership (platform blesses read access)
Stage 4: Transactional partnership (platform enables booking via Atlas)
Stage 5: Full integration (native SDK, co-marketing, rev share)
```

Each stage reduces platform risk and increases their incentive to go deeper.

---

## Per-Platform Playbooks

---

### Lu.ma

**Profile**
- Focus: AI/tech community events, startup meetups, demo days
- Size: ~50K active events/year (estimated), growing fast
- Team: Small (<30 people), San Francisco based
- Audience: Developers, founders, VCs, AI researchers
- Pricing: Free for basic events, payment processing on ticketed events
- Vibe: Clean, modern, "anti-Eventbrite"

**API Status**
- No official public API as of early 2026
- Calendar feed (ICS) available per organizer — can be parsed for event data
- Web scraping possible but fragile and against ToS
- GraphQL endpoint exists internally — may be partially accessible

**Decision Makers**
- Small founding team makes all partnership decisions
- Likely reachable through mutual connections in SF tech community
- Active on Twitter — engage there before formal outreach

**Why Lu.ma Would Partner**
- Their audience (AI/tech) is the exact audience that will use AI agents to discover events
- Being "Atlas-compatible" is a feature their users would expect
- Small team = they'd rather Atlas handle agent distribution than build it themselves
- Atlas brings them events from other platforms (cross-pollination)

**Why Lu.ma Might Resist**
- No public API means they've chosen to keep their ecosystem closed
- May see Atlas as commoditizing their curation/discovery advantage
- May worry about event data leaving their platform

**Integration Path**
1. **Month 1:** Build adapter using ICS calendar feeds + web scraping fallback for connected organizers. Discovery only.
2. **Month 1-2:** Recruit 30+ Lu.ma organizers to connect to Atlas. Specifically target prominent AI/tech meetup organizers.
3. **Month 2:** Reach out informally — DM founders on Twitter. Frame: "X of your organizers are on Atlas. We'd love to make this official so you have control."
4. **Month 2-3:** Offer to build them an official adapter that respects their data preferences. Zero engineering effort on their side.
5. **Month 3-4:** If receptive, propose Tier 2 (Transactional) integration with revenue share.
6. **Month 4-6:** Co-marketing: "Lu.ma events are now discoverable by AI agents via Atlas."

**Risks**
- Lu.ma may build their own agent API, cutting out Atlas
- Mitigation: Move fast. Be live before they build it. Make Atlas the standard they adopt rather than compete with.
- Lu.ma may send a cease-and-desist for scraping
- Mitigation: Only use data from organizers who explicitly authorized access. Document consent chain clearly.

**Timeline:** First contact Month 2, Tier 1 Month 3, Tier 2 Month 5.

---

### Eventbrite

**Profile**
- Focus: General-purpose events, conferences, festivals, classes, workshops
- Size: Largest pure-play event platform. ~4M events/year. Public company (NYSE: EB).
- Team: ~1,000 employees
- Audience: Broad — everything from yoga classes to music festivals
- Pricing: 6.95% + $0.99 per ticket (organizer absorbs or passes to attendee)
- Revenue: ~$330M/year

**API Status**
- Mature REST API with good documentation
- OAuth 2.0 for organizer authorization
- Endpoints: events, venues, tickets, orders, attendees
- Rate limits: 1,000 requests/hour per OAuth token
- Read AND write access (can create orders via API)

**Decision Makers**
- Julia Hartz (CEO), large product and partnerships team
- Enterprise-grade decision process — 3-6 month sales cycle minimum
- Developer ecosystem team exists but is not a priority

**Why Eventbrite Will Resist**
- Atlas directly threatens their business model. They charge 6.95% + $0.99. Atlas charges 2%. If agents can buy Eventbrite tickets through Atlas at 2%, why would anyone use Eventbrite's checkout?
- They'll see organizer OAuth connections as a trojan horse
- Legal team will scrutinize ToS implications
- Public company = risk-averse, quarterly earnings pressure

**Adapter Strategy (Build Without Cooperation)**
1. **Month 1:** Build adapter using Eventbrite's public API + organizer OAuth. This is fully within their API ToS — organizers authorize access to their own data.
2. **Month 1-3:** Focus on discovery only. Do NOT process transactions through Eventbrite API initially. Display events with "Book on Eventbrite" deep link.
3. **Month 3-6:** Accumulate organizer connections. Target Eventbrite's most active organizers (100+ events/year).
4. **Month 6:** When 500+ Eventbrite organizers are on Atlas, publish data: "X% of Eventbrite's top organizers are discoverable on Atlas."

**When to Approach Officially**
- NOT before Month 6. Premature outreach gives them time to block Atlas (API ToS changes, rate limit reductions).
- Approach when: (a) 500+ organizers connected, (b) measurable agent traffic to their events, (c) at least 2 other platforms have partnered officially.
- At that point, blocking Atlas means blocking their own organizers, which is PR-terrible for a public company.

**How to Frame It**
- "Atlas is driving incremental ticket sales for your organizers at zero cost to Eventbrite."
- "Official integration means you control the experience and earn revenue share."
- "Your competitors are already on Atlas. Your organizers are asking why Eventbrite isn't."
- NEVER frame as: "Atlas is cheaper than Eventbrite" or "Atlas replaces Eventbrite."

**Eventbrite-Specific Objection Handling**
- "This violates our API ToS" → "Organizers authorized access to their own accounts. We respect all rate limits and data policies. Happy to review with your legal team."
- "You're undercutting our pricing" → "Atlas adds agent distribution ON TOP of your existing sales. It's incremental revenue, not cannibalization. Your 6.95% applies to direct sales as before."
- "We'll build our own agent API" → "Great — Atlas can be the standard you implement, saving you the design work. We'd love Eventbrite's input on the schema."

**Risks**
- Eventbrite changes API ToS to block third-party agent access
- Mitigation: Document all organizer consent. If Eventbrite blocks organizer-authorized access, that's a story ("Eventbrite blocks organizers from using AI agents").
- Eventbrite acquires or builds a competitor
- Mitigation: Atlas is an open protocol with many contributors. Eventbrite building their own closed version fragments the market — agents still need Atlas for everything else.

**Timeline:** Adapter Month 1, silent growth Months 2-5, approach Month 6+.

---

### Meetup

**Profile**
- Focus: Recurring community groups — tech meetups, hobby groups, professional networks
- Size: ~300K active groups, millions of events/year
- Owner: Bending Spoons (acquired 2024) — Italian private equity/app company
- Audience: Community organizers, professional networkers, hobby groups
- Pricing: Organizer subscription ($16/month basic, $32/month pro). Free for attendees.
- History: Once beloved, now frustrating to organizers due to Bending Spoons monetization push

**API Status**
- GraphQL API available (legacy REST API deprecated)
- OAuth 2.0 for organizer access
- Good event data: title, description, datetime, venue, RSVP count, attendee list
- No ticketing/payment endpoints (Meetup doesn't do paid ticketing natively — organizers use external payment)
- Rate limits: Moderate

**Bending Spoons Implications**
- Bending Spoons acquires apps and aggressively monetizes them (see: Evernote, Filmic)
- They may see Atlas as a way to monetize Meetup data without engineering investment
- Alternatively, they may see it as a threat to their organizer subscription model
- Decision-making is fast (small team, profit-focused)

**Why Meetup Would Partner**
- Bending Spoons is looking for new revenue streams from Meetup
- Agent-driven RSVPs = more activity = better metrics for organizers = lower churn
- Atlas partnership requires zero engineering from Meetup — adapter does the work
- Co-marketing: "Meetup groups are now discoverable by AI agents" is a great press story

**Why Meetup Might Resist**
- If agent discovery reduces organizer need for Meetup's native discovery → threatens subscription value
- Bending Spoons may demand excessive rev share
- May prefer to build their own agent API (but Bending Spoons typically acquires, doesn't build)

**Integration Path**
1. **Month 1:** Build adapter using GraphQL API + organizer OAuth. Discovery + RSVP capability.
2. **Month 1-3:** Target Meetup group organizers in tech hubs (SF, NYC, London, Berlin). Focus on tech and crypto meetup groups.
3. **Month 3:** Approach Bending Spoons partnerships team. Frame as free revenue: "Agent-driven RSVPs for your organizers. Revenue share on premium features."
4. **Month 4-5:** Negotiate Tier 2 integration. Bending Spoons will want aggressive rev share — be prepared to offer 30-40% of Atlas fee on Meetup transactions.
5. **Month 5-6:** Official integration announcement.

**Specific Approach for Bending Spoons**
- Lead with revenue, not technology. They care about Meetup's P&L.
- Show data: "X Meetup organizers on Atlas, Y agent-driven RSVPs/week, projected Z revenue/month for Meetup."
- Offer to handle all engineering. They should view this as free money.
- Be direct: "You want to monetize Meetup more. We add a revenue stream that costs you nothing."

**Timeline:** Adapter Month 1, organizer recruitment Months 2-3, approach Month 3, deal Month 4-5.

---

### Dice

**Profile**
- Focus: Music and nightlife events — clubs, concerts, festivals
- Size: ~100K events/year across 30+ cities
- HQ: London, strong European presence
- Audience: Clubbers, music fans, nightlife enthusiasts (18-35)
- Pricing: Service fee to attendees (varies by event, typically 10-15%)
- Differentiator: No screenshots of tickets (anti-resale), curated discovery

**API Status**
- No public API
- Mobile-first platform — most interactions via iOS/Android app
- Web presence exists but limited
- Would need web scraping or partner API access

**Decision Makers**
- Phil Hutcheon (CEO), relatively accessible in London music/tech circles
- Partnerships team focused on venue relationships
- Likely reachable through music industry connections

**Why Dice Would Partner**
- Music discovery through AI agents is a compelling narrative for their brand
- They're growth-hungry and expanding to new cities — Atlas brings incremental discovery
- Agent-driven ticket sales in a new channel at zero customer acquisition cost
- "Dice events are agent-discoverable" differentiates them from Ticketmaster

**Why Dice Might Resist**
- Anti-resale philosophy may conflict with perceived risk of agent access to tickets
- Curated experience is core to brand — aggregation feels anti-curation
- No public API suggests desire for control

**Integration Path**
1. **Month 1-2:** Build adapter using web data + any organizer/promoter OAuth if available. Discovery only.
2. **Month 2:** Recruit 20+ Dice-active promoters (nightclub owners, music event producers) to connect to Atlas.
3. **Month 2-3:** Reach out to Phil Hutcheon or partnerships team. Frame: "AI agents are the next discovery channel for nightlife. Atlas makes Dice events discoverable to every AI assistant."
4. **Month 3-4:** Address anti-resale concern directly: Atlas enforces Dice's ticket policies (no transfers, no screenshots, identity-bound). Build this into the adapter spec.
5. **Month 4-5:** Tier 2 integration with booking flow that opens Dice app/web for final purchase.

**Specific Messaging for Dice**
- "Atlas respects your anti-resale policies. Agent-purchased tickets are identity-bound, just like direct purchases."
- "Think of Atlas as a new discovery channel — like being in Spotify's algorithm, but for events."
- "Your competitors aren't on Atlas yet. First-mover advantage in agent discovery."

**Timeline:** Adapter Month 2, outreach Month 2-3, Tier 1 Month 4, Tier 2 Month 6.

---

### Resident Advisor (RA)

**Profile**
- Focus: Electronic music events, club culture
- Size: Global authority for electronic music events, ~200K events listed/year
- HQ: London
- Audience: Electronic music enthusiasts, DJs, promoters, clubs
- Pricing: Free listings for most events. Premium features for promoters/venues.
- Differentiator: Editorial authority — RA reviews, RA picks, DJ charts. Trusted tastemaker.

**API Status**
- No official public API
- Rich structured web data (event pages have consistent format: lineup, venue, time, genre tags)
- RSS feeds for some content
- Would need scraping or partnership for programmatic access

**Decision Makers**
- Small editorial/product team. Community-driven culture.
- Likely accessible through electronic music industry connections
- Brand-protective — they care about how RA events are presented

**Why RA Would Partner**
- Electronic music community is early-adopter, tech-forward
- Agent discovery of niche events is harder than mainstream — RA's data is uniquely valuable
- RA's revenue is ad/premium-based, not transactional — Atlas agent traffic doesn't cannibalize
- "RA events discoverable by AI agents" reinforces their authority

**Why RA Might Resist**
- Deeply protective of editorial brand — won't want events stripped of RA context
- May worry about data being used to build a competing music event platform
- Small team = limited bandwidth for partnerships

**Integration Path**
1. **Month 2:** Build adapter using structured web data for connected promoters. Discovery only, preserving RA attribution.
2. **Month 2-3:** Recruit electronic music promoters who list on RA. Focus on major cities: Berlin, London, Amsterdam, NYC, Ibiza.
3. **Month 3:** Approach RA editorial/partnerships contact. Frame: "Atlas preserves RA attribution. When an agent discovers a techno night, it credits RA as the source. Your brand travels with the data."
4. **Month 4:** Offer: RA controls how their events appear in Atlas schema. Custom fields for genre, lineup position, RA rating.
5. **Month 5-6:** Tier 2 with deep links to RA for ticket purchase.

**Specific Messaging for RA**
- "Atlas preserves source attribution. Every event discovered through Atlas credits RA."
- "Your data is the highest quality in electronic music. Atlas makes it accessible to AI agents while protecting your brand."
- "We want to work WITH RA's editorial standards, not around them."

**Timeline:** Adapter Month 2, outreach Month 3, Tier 1 Month 4, Tier 2 Month 6.

---

### Partiful

**Profile**
- Focus: Casual social events — birthday parties, dinners, house parties, casual hangouts
- Size: Growing fast among millennials/Gen Z. Estimated 1M+ events/year.
- Audience: 20-35 year olds, social, urban
- Pricing: Free (no monetization yet — VC-funded growth phase)
- Differentiator: Beautiful, social-first design. "Evite for the Instagram generation."

**API Status**
- No public API whatsoever
- Mobile-first with web event pages
- Very closed ecosystem — no export, no integration points
- Would require web parsing or direct partnership for any access

**Decision Makers**
- Small startup team, SF-based
- VC-backed (a]6z among investors) — growth-focused
- Likely accessible through SF startup networks

**Why Partiful Would Partner**
- They have no monetization model yet — Atlas could be one (rev share on agent-driven premium features)
- Their events are the hardest to discover externally — Atlas solves distribution
- "Your birthday party is discoverable by your friends' AI assistants" is a compelling consumer feature
- Atlas could BE Partiful's API — they don't have to build one

**Why Partiful Might Resist**
- Most Partiful events are private/invite-only — agent discovery may not apply
- They're in growth mode and don't want to think about protocol partnerships
- Privacy-sensitive events (parties, dinners) have different discovery norms than public events

**Integration Path**
1. **Month 3:** Assess feasibility. Partiful events are often private — Atlas may only be relevant for their public events and ticketed events.
2. **Month 3-4:** If Partiful launches any public event features or ticketed events, build adapter for opted-in organizers.
3. **Month 4:** Approach with a different frame than other platforms: "Atlas can be your API layer. When you're ready to open up, the protocol is ready."
4. **Month 5-6:** Offer to co-develop Partiful-specific Atlas extensions for social features (guest lists, +1s, dietary preferences).

**Specific Messaging for Partiful**
- "We know most Partiful events are private. Atlas only indexes events where the organizer explicitly opts in."
- "When you're ready to build an API, Atlas is the standard. No need to design from scratch."
- "Your users' AI assistants could handle RSVPs, suggest what to bring, coordinate rides — all through Atlas."

**Timeline:** Assessment Month 3, outreach Month 4, Tier 1 Month 6 (if applicable).

---

### Ticketmaster / Live Nation

**Profile**
- Focus: Concerts, sports, theater, large-scale entertainment
- Size: Dominant. ~500M tickets/year globally. $23B+ revenue (Live Nation).
- Audience: Mass market — everyone who goes to concerts and sports
- Pricing: Service fees of 25-35% on top of face value (notoriously high)
- Market position: Near-monopoly through exclusive venue contracts

**API Status**
- Discovery API exists (event search, venue info, pricing)
- No public booking API — purchases must go through Ticketmaster checkout
- Affiliate program exists for referral traffic
- API is read-only for third parties

**Decision Makers**
- Michael Rapino (CEO, Live Nation), massive corporate hierarchy
- Enterprise sales cycle: 6-12 months minimum
- Legal team that has fought the DOJ. They are not afraid of protocol projects.

**Why They'll Ignore Atlas (For Now)**
- Atlas is irrelevant to their scale. They move 500M tickets/year. Atlas will move thousands.
- Their moat is exclusive venue contracts, not technology. Atlas doesn't threaten this.
- They have no incentive to make tickets easier to find — scarcity drives urgency/FOMO pricing.
- Regulatory scrutiny (DOJ antitrust) means they're cautious about any new integrations.

**Long-Term Play (12+ months)**
- Build a discovery-only adapter using their public Discovery API. No organizer OAuth needed for read access.
- Include Ticketmaster events in Atlas search results with "Buy on Ticketmaster" deep links.
- Use their affiliate program for referral revenue.
- When Atlas is large enough that agents represent meaningful referral traffic, Ticketmaster's affiliate team will want a better integration.
- Frame: "Atlas drives ticket sales to Ticketmaster. Better integration = more sales."

**DO NOT:**
- Attempt to partner with Ticketmaster in the first 6 months
- Position Atlas as a Ticketmaster alternative or competitor
- Try to process Ticketmaster transactions through Atlas
- Publicly criticize their fees (they'll crush you with legal resources)

**Timeline:** Discovery adapter Month 3 (using public API). Affiliate integration Month 6. Partnership conversation Month 12+.

---

## Objection Handling

### "Why would we help agents bypass our platform?"

**Response:**

"Atlas doesn't bypass your platform — it drives more traffic to it. Here's what actually happens:

1. An AI agent searches Atlas for events matching a user's preferences.
2. Your event appears in results because your organizer connected to Atlas.
3. The agent books through Atlas, which calls YOUR API to process the transaction.
4. You earn your standard fee. Atlas adds 2% on top (paid by the buyer, not you).
5. Net result: you get a ticket sale you wouldn't have gotten otherwise.

The alternative is that agents can't find your events at all. Every event that's NOT on Atlas is invisible to AI agents. Your competitors' events ARE visible. Which scenario costs you more revenue?"

### "This exposes our pricing to competitors"

**Response:**

"Your pricing is already visible to anyone who visits your event pages. Atlas doesn't expose anything that isn't already public.

What Atlas DOES add is context: your events appear alongside events from other platforms, which means attendees can compare. But this is already happening — people already check Eventbrite AND Lu.ma AND Meetup before buying. Atlas just makes it faster.

The platforms that win in a transparent market are the ones with the best events, the best organizer tools, and the best attendee experience. If that's you, transparency is your friend.

And if you want control over how your pricing appears in Atlas results — official integration gives you that. You can set preferred display formats, add promotional messaging, and highlight value-adds that justify your pricing."

### "We have our own API"

**Response:**

"That's great — and Atlas can work WITH your API, not replace it.

Think of Atlas as a schema standard, not a competing API. Your API is how developers interact with your platform specifically. Atlas is how AI agents interact with events across ALL platforms.

By implementing the Atlas schema on top of your existing API, you get:
- Instant compatibility with every Atlas-connected agent (ChatGPT, Claude, Gemini, custom agents)
- No need to build agent-specific integrations for each AI provider
- A standard that evolves with community input, so you're not maintaining proprietary agent schemas alone

It's like implementing OAuth — you still have your own auth system, but OAuth lets you work with the broader ecosystem."

### "Our organizers haven't asked for this"

**Response:**

"They're about to. Here's the pattern we're seeing:

1. Early-adopter organizers connect to Atlas independently.
2. They see agent-driven discovery and bookings that their peers don't.
3. They talk about it — in organizer communities, on social media, in industry groups.
4. Other organizers on your platform ask: 'How do I get on Atlas?'
5. At that point, official integration from you is what organizers want.

We're already seeing this with [X number] of your organizers who connected in the past [Y weeks]. We can share anonymized data on the agent traffic they're receiving — happy to set up a call.

The organizers who are asking for this are your most active, most technically savvy power users. They're also the ones most likely to switch platforms if they feel limited. Supporting Atlas is supporting your best organizers."

### "We don't want to be aggregated by a competitor (Lemonade)"

**Response:**

"This is the most important point, and I want to be completely transparent.

Atlas Protocol is NOT a Lemonade product. It is an open protocol with independent governance. Lemonade is a founding contributor, just like how Google was a founding contributor to Kubernetes but doesn't own or control it.

Here's what makes Atlas independent:
- **Open specification:** The protocol spec is public. Anyone can implement it. No permission needed.
- **Independent governance:** The Atlas Foundation (in formation) will have multi-stakeholder governance — platforms, organizers, developers, and agents all get seats.
- **No single-vendor control:** No one entity can change the protocol unilaterally.
- **Your data stays yours:** Atlas is a schema standard, not a data warehouse. Your events live on your platform. Atlas defines how agents query them.

If you want additional safeguards, we're open to: (a) a seat on the governance board, (b) a co-development agreement where schema changes affecting your vertical require your input, (c) data usage terms that explicitly prevent any Atlas participant from scraping or aggregating your data.

The protocol exists to serve organizers and platforms — not to advantage any single company."

---

## Partnership Agreement Terms

### Standard Tier 2 (Transactional) Agreement

**What Atlas provides:**
- Agent-driven event discovery and booking to/from the platform
- Atlas adapter maintenance (at Atlas's cost)
- Anonymized analytics dashboard (agent queries, conversion rates, geographic distribution)
- Co-marketing (joint blog post, social media announcement)
- Platform seat on Atlas Advisory Board (if among first 10 partners)

**What the platform provides:**
- Stable API access for Atlas adapter (documented endpoints, reasonable rate limits)
- 30-day notice before breaking API changes
- Permission to display platform brand in Atlas agent results
- Point of contact for technical issues (response within 48 hours)

**Economic terms:**
- Atlas charges 2% fee on agent-originated transactions
- Platform receives 0.25% revenue share (12.5% of Atlas fee) on Tier 2
- Platform receives 0.50% revenue share (25% of Atlas fee) on Tier 3 (Full Integration)
- Revenue share paid monthly in USDC or USD (platform's choice)
- No minimum commitment from either side

**Term and termination:**
- 12-month initial term, auto-renewing annually
- Either party can terminate with 90-day written notice
- On termination: Atlas removes platform adapter within 30 days
- Organizers retain the right to connect individually post-termination

**Data terms:**
- Atlas does not store event data beyond 24-hour cache for performance
- No resale of platform data to third parties
- Platform can request full audit of data handling annually
- GDPR/CCPA compliant data processing agreement included

### Negotiation Flexibility

| Term | Floor | Standard | Ceiling |
|------|-------|----------|---------|
| Rev share (Tier 2) | 0.15% | 0.25% | 0.40% |
| Rev share (Tier 3) | 0.30% | 0.50% | 0.75% |
| Cache duration | 1 hour | 24 hours | 72 hours |
| Notice period | 30 days | 90 days | 180 days |
| Exclusivity | None (ever) | None | None |

**Non-negotiable:**
- Atlas will NEVER grant exclusivity to any platform
- Atlas will NEVER block organizers from connecting independently
- Atlas will NEVER share one platform's data with another platform
- Revenue share will NEVER exceed 1% (half the Atlas fee)

---

## Escalation Strategy

### How Organizer Pressure Forces Platform Integration

This is the core flywheel that converts reluctant platforms into partners.

**Stage 1: Seed (Months 1-2)**
- 10-20 organizers from Platform X connect to Atlas
- Platform doesn't notice or doesn't care
- Atlas adapter works quietly, serving agent queries

**Stage 2: Signal (Months 2-3)**
- 50+ organizers from Platform X on Atlas
- Connected organizers share results publicly: "Got 3 agent-driven bookings this week via Atlas"
- Non-connected organizers on Platform X ask: "How do I do that?"
- Platform's community team notices Atlas mentions in forums/support

**Stage 3: Pressure (Months 3-4)**
- 100+ organizers from Platform X on Atlas
- Organizers start requesting official Atlas integration from Platform X support
- Trade press covers Atlas, mentioning Platform X organizers using it
- Platform internally discusses Atlas — product team evaluates

**Stage 4: Urgency (Months 4-6)**
- 200+ organizers connected. Measurable agent traffic.
- Competing platforms announce official Atlas partnerships
- Platform X organizers post on social media: "Why doesn't [Platform X] officially support Atlas?"
- Platform realizes: integrate officially (and gain control) or watch organizers work around you

**Stage 5: Partnership (Months 5-8)**
- Platform X reaches out (or responds to our outreach positively)
- Fast-track integration using existing adapter
- Joint announcement
- Platform gains control over how their events appear in Atlas
- Revenue share starts flowing

### Tactics to Accelerate Pressure

1. **Seed the right organizers first:** Target Platform X's top 20 organizers by event volume. Their adoption carries outsize signal.
2. **Make results visible:** Dashboard screenshots, reward notifications, agent booking stats — all shareable by organizers.
3. **Create FOMO:** Weekly Twitter thread showing which platforms' events get the most agent traffic. Platforms not on Atlas see their competitors' events getting coverage.
4. **Empower organizer advocacy:** Give connected organizers a one-click way to request official Atlas support from their platform. Pre-written message they can send to platform support.
5. **Strategic press placement:** When writing about Atlas growth, always mention which platforms' organizers are connected. Platforms read their own press mentions.

---

## Realistic Pipeline by Platform Type

### Niche/Independent Platforms (Dice, RA, regional)
- **Outreach to Tier 1:** 4-6 weeks
- **Outreach to Tier 2:** 8-12 weeks
- **Total from first contact to live integration:** 3-4 months
- **Why fast:** Small teams, fast decisions, hungry for growth, see Atlas as opportunity

### Mid-Size Platforms (Lu.ma, Meetup, Partiful)
- **Outreach to Tier 1:** 6-10 weeks
- **Outreach to Tier 2:** 12-20 weeks
- **Total from first contact to live integration:** 4-6 months
- **Why moderate:** Some bureaucracy, need internal buy-in, may have competing priorities

### Enterprise Platforms (Eventbrite, Ticketmaster)
- **Outreach to Tier 1:** 12-24 weeks
- **Outreach to Tier 2:** 24-52 weeks
- **Total from first contact to live integration:** 6-12+ months
- **Why slow:** Legal review, committee decisions, quarterly planning cycles, competitive concerns

### Expected Pipeline (First 12 Months)

| Month | Tier 1 (Discovery) | Tier 2 (Transactional) | Tier 3 (Full) |
|-------|--------------------|-----------------------|----------------|
| 3 | Lu.ma, Dice | — | — |
| 4 | RA, Meetup | — | — |
| 5 | 2 regional | Lu.ma | — |
| 6 | Partiful, 2 more regional | Dice | — |
| 8 | Eventbrite (maybe) | RA, Meetup | Lu.ma |
| 10 | 5+ niche/regional | 2 regional, Partiful | Dice |
| 12 | 15+ total | Eventbrite (maybe), 5 total transactional | 2-3 full integrations |

---

## Appendix: Platform Research Template

Use this template when evaluating a new platform for the Atlas partnership pipeline.

```
## [Platform Name]

### Profile
- Focus:
- Estimated events/year:
- HQ / Geography:
- Team size:
- Audience:
- Pricing model:
- Key differentiator:

### API Assessment
- Public API: Yes / No / Partial
- Auth method:
- Available endpoints:
- Rate limits:
- Can we build a working adapter? Yes / No / With limitations

### Decision Makers
- Key contacts:
- How to reach them:
- Decision process speed: Fast / Moderate / Slow

### Strategic Assessment
- Why they'd partner (top 3 reasons):
  1.
  2.
  3.
- Why they'd resist (top 3 risks):
  1.
  2.
  3.

### Integration Path
- Adapter approach:
- Organizer recruitment target:
- Outreach timing:
- Expected tier progression:

### Timeline
- Adapter ready:
- Organizer target hit:
- First contact:
- Tier 1 target:
- Tier 2 target:
```
