# Agent Integrations

> How to integrate Atlas event discovery and ticketing into every major AI agent framework.

Agents are the demand side of Atlas. Every agent integration is another channel driving ticket sales to organizers across all connected platforms. This document covers integration patterns for MCP (Claude), OpenAI, Google Gemini, LangChain, LlamaIndex, CrewAI, and custom agents.

---

## Table of Contents

1. [MCP (Model Context Protocol) — Claude](#mcp-model-context-protocol--claude)
2. [OpenAI (GPT Actions / Plugins)](#openai-gpt-actions--plugins)
3. [Google (Gemini Extensions)](#google-gemini-extensions)
4. [LangChain](#langchain)
5. [LlamaIndex](#llamaindex)
6. [CrewAI](#crewai)
7. [Custom Agents (Direct HTTP)](#custom-agents-direct-http)
8. [Agent Identity](#agent-identity)
9. [Agent Rewards and Analytics](#agent-rewards-and-analytics)

---

## MCP (Model Context Protocol) — Claude

Atlas exposes a full MCP server that Claude can use as tools. This is the deepest integration — Claude gets typed tools, resources, and prompts for event discovery and ticketing.

### MCP Server Registration

Register Atlas on the Anthropic MCP registry or run the server locally:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "npx",
      "args": ["@atlas/mcp-server"],
      "env": {
        "ATLAS_REGISTRY_URL": "https://registry.atlas.events",
        "ATLAS_API_KEY": "your-api-key",
        "TEMPO_PRIVATE_KEY": "your-tempo-key"
      }
    }
  }
}
```

### MCP Tools

#### `search_events`

Search for events across all Atlas sources.

```typescript
{
  name: 'search_events',
  description: 'Search for events across all platforms connected to Atlas. Supports keyword, location, date, category, and price filters.',
  inputSchema: z.object({
    q: z.string().optional().describe('Keyword search (title, description, tags)'),
    lat: z.number().optional().describe('Latitude for location search'),
    lng: z.number().optional().describe('Longitude for location search'),
    radius_km: z.number().optional().default(25).describe('Search radius in km'),
    start_after: z.string().optional().describe('ISO 8601 — only events starting after this'),
    start_before: z.string().optional().describe('ISO 8601 — only events starting before this'),
    category: z.enum([
      'music', 'tech', 'arts', 'sports', 'food',
      'business', 'health', 'education', 'community',
      'nightlife', 'film', 'gaming', 'other'
    ]).optional(),
    price_min: z.number().optional().describe('Minimum price in USD'),
    price_max: z.number().optional().describe('Maximum price in USD'),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'date_asc', 'date_desc', 'distance']).optional().default('relevance'),
    limit: z.number().optional().default(10).describe('Number of results (max 50)'),
    cursor: z.string().optional().describe('Pagination cursor from previous search'),
  }),
}
```

#### `list_tickets`

Get available ticket types and pricing for an event.

```typescript
{
  name: 'list_tickets',
  description: 'List all available ticket types for an event with current pricing and availability.',
  inputSchema: z.object({
    event_id: z.string().describe('Atlas event ID from search results'),
  }),
}
```

#### `purchase_ticket`

Buy tickets for an event. Handles the full 402 payment flow automatically.

```typescript
{
  name: 'purchase_ticket',
  description: 'Purchase tickets for an event. Requires attendee info. Payment is handled via the configured payment method (USDC on Tempo by default).',
  inputSchema: z.object({
    event_id: z.string().describe('Atlas event ID'),
    ticket_type_id: z.string().describe('Ticket type ID from list_tickets'),
    quantity: z.number().min(1).describe('Number of tickets'),
    attendees: z.array(z.object({
      name: z.string().describe('Attendee full name'),
      email: z.string().email().describe('Attendee email for ticket delivery'),
    })).describe('One attendee per ticket'),
  }),
}
```

#### `verify_ticket`

Verify the authenticity and validity of a ticket credential.

```typescript
{
  name: 'verify_ticket',
  description: 'Verify a ticket Verifiable Credential. Returns validity status, event details, and attendee info.',
  inputSchema: z.object({
    credential_jwt: z.string().describe('JWT-encoded ticket Verifiable Credential'),
  }),
}
```

### MCP Resources

```
atlas://events/search?q=techno&lat=52.52&lng=13.4
atlas://events/{event_id}
atlas://events/{event_id}/tickets
atlas://pricing/{event_id}/{ticket_type_id}?quantity=2
```

### MCP Prompts

```typescript
{
  name: 'find_events_near_me',
  description: 'Find events near a location',
  arguments: [
    { name: 'location', description: 'City or coordinates', required: true },
    { name: 'interests', description: 'What kind of events', required: false },
  ],
}

{
  name: 'buy_tickets',
  description: 'Buy tickets for an event',
  arguments: [
    { name: 'event', description: 'Event name or ID', required: true },
    { name: 'attendees', description: 'Who is attending', required: true },
  ],
}

{
  name: 'compare_ticket_prices',
  description: 'Compare ticket prices across events',
  arguments: [
    { name: 'events', description: 'Events to compare', required: true },
  ],
}
```

### Full Example: Claude Plans a Night Out

```
User: "I want to go out in Berlin this Saturday. Find me some techno events
       and buy 2 tickets to the best one under 30 euros."

Claude uses search_events:
  → { q: "techno", lat: 52.52, lng: 13.4, radius_km: 15,
      start_after: "2026-03-21T18:00:00+01:00",
      start_before: "2026-03-22T06:00:00+01:00",
      price_max: 30, sort: "relevance" }

  ← 4 events found:
    1. "Berghain Saturday" — sold out
    2. "Tresor: Pulse" — EUR 18, 42 remaining
    3. "Sisyphos Garden Opening" — EUR 22, limited
    4. "about blank: Techno Ritual" — EUR 15, available

Claude uses list_tickets for "Tresor: Pulse":
  ← [{ id: "tt_abc", name: "General Admission", price: { amount: 18, currency: "EUR" }, available: 42 }]

Claude uses purchase_ticket:
  → { event_id: "ev_tresor_pulse", ticket_type_id: "tt_abc", quantity: 2,
      attendees: [{ name: "User", email: "user@email.com" },
                  { name: "User's Friend", email: "friend@email.com" }] }

  ← { purchase_id: "pur_xxx", credentials: [...], payment: { amount: 36, currency: "EUR" } }

Claude: "Done! I got 2 tickets to Tresor: Pulse this Saturday at 23:00.
         EUR 36 total (EUR 18 each). Tickets sent to your emails.
         Here are your QR codes for entry: ..."
```

---

## OpenAI (GPT Actions / Plugins)

Atlas works as an OpenAI plugin via its OpenAPI specification.

### OpenAPI Spec

Atlas publishes an OpenAPI 3.1 spec at:

```
https://registry.atlas.events/.well-known/openapi.json
```

### Plugin Manifest (`ai-plugin.json`)

```json
{
  "schema_version": "v1",
  "name_for_human": "Atlas Events",
  "name_for_model": "atlas_events",
  "description_for_human": "Search and buy tickets for events worldwide.",
  "description_for_model": "Search for events by keyword, location, date, category, and price. List available ticket types. Purchase tickets with automatic payment handling. Events come from all major platforms (Eventbrite, Luma, Meetup, etc.) plus independent organizers.",
  "auth": {
    "type": "service_http",
    "authorization_type": "bearer",
    "verification_tokens": {
      "openai": "your-verification-token"
    }
  },
  "api": {
    "type": "openapi",
    "url": "https://registry.atlas.events/.well-known/openapi.json"
  },
  "logo_url": "https://registry.atlas.events/logo.png",
  "contact_email": "agents@atlas.events",
  "legal_info_url": "https://atlas.events/legal"
}
```

### GPT Actions Configuration

```yaml
openapi: 3.1.0
info:
  title: Atlas Events API
  version: 1.0.0
servers:
  - url: https://registry.atlas.events/v1

paths:
  /events/search:
    get:
      operationId: searchEvents
      summary: Search for events across all Atlas sources
      parameters:
        - name: q
          in: query
          schema: { type: string }
          description: Keyword search
        - name: lat
          in: query
          schema: { type: number }
        - name: lng
          in: query
          schema: { type: number }
        - name: radius_km
          in: query
          schema: { type: number, default: 25 }
        - name: start_after
          in: query
          schema: { type: string, format: date-time }
        - name: start_before
          in: query
          schema: { type: string, format: date-time }
        - name: category
          in: query
          schema: { type: string, enum: [music, tech, arts, sports, food, business, nightlife] }
        - name: price_max
          in: query
          schema: { type: number }
        - name: sort
          in: query
          schema: { type: string, enum: [relevance, price_asc, date_asc, distance] }
        - name: limit
          in: query
          schema: { type: integer, default: 10 }

  /events/{event_id}/tickets:
    get:
      operationId: listTickets
      summary: List available ticket types for an event
      parameters:
        - name: event_id
          in: path
          required: true
          schema: { type: string }

  /events/{event_id}/purchase:
    post:
      operationId: purchaseTicket
      summary: Purchase tickets for an event
      parameters:
        - name: event_id
          in: path
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [ticket_type_id, quantity, attendees]
              properties:
                ticket_type_id: { type: string }
                quantity: { type: integer, minimum: 1 }
                attendees:
                  type: array
                  items:
                    type: object
                    required: [name, email]
                    properties:
                      name: { type: string }
                      email: { type: string, format: email }
```

### Full Example: ChatGPT Searching and Buying Tickets

```
User: "Find jazz events in NYC this weekend under $50"

ChatGPT calls searchEvents:
  GET /v1/events/search?q=jazz&lat=40.7128&lng=-74.006&radius_km=20
      &start_after=2026-03-21&start_before=2026-03-23&price_max=50

  Response: { items: [
    { id: "ev_blue_note", title: "Blue Note: Late Night Jazz", price: { display: "$35.00" }, ... },
    { id: "ev_smalls", title: "Smalls Jazz Club: Jam Session", price: { display: "$20.00" }, ... },
  ]}

ChatGPT calls listTickets:
  GET /v1/events/ev_blue_note/tickets

  Response: [
    { id: "tt_gen", name: "General Admission", price: { amount: 35, display: "$35.00" }, available: 18 },
    { id: "tt_vip", name: "VIP Table", price: { amount: 75, display: "$75.00" }, available: 3 },
  ]

User: "Book 2 general admission for the Blue Note show"

ChatGPT calls purchaseTicket:
  POST /v1/events/ev_blue_note/purchase
  { ticket_type_id: "tt_gen", quantity: 2,
    attendees: [{ name: "User", email: "user@email.com" },
                { name: "Guest", email: "guest@email.com" }] }

  Response: { purchase_id: "pur_xxx", payment: { amount: 70, display: "$70.00" }, ... }

ChatGPT: "Booked! 2 tickets to Blue Note: Late Night Jazz — $70 total.
          Confirmation sent to both emails."
```

### Authentication

OpenAI agents authenticate with Atlas via:

- **API Key (Bearer token):** For server-side GPT Actions
- **MPP Credential:** For agents that handle their own payments — the 402 flow works through OpenAI's action proxy

---

## Google (Gemini Extensions)

Atlas integrates as a Gemini Extension using Google's extension framework.

### Extension Declaration

```json
{
  "name": "atlas_events",
  "display_name": "Atlas Events",
  "description": "Search and buy event tickets worldwide across all platforms.",
  "api_spec": {
    "openapi_spec_url": "https://registry.atlas.events/.well-known/openapi.json"
  },
  "auth": {
    "type": "API_KEY",
    "api_key_config": {
      "header_name": "Authorization",
      "header_value_prefix": "Bearer "
    }
  },
  "operations": [
    {
      "operation_id": "searchEvents",
      "description": "Search for events by keyword, location, date, category, and price across all Atlas-connected platforms."
    },
    {
      "operation_id": "listTickets",
      "description": "List available ticket types and pricing for a specific event."
    },
    {
      "operation_id": "purchaseTicket",
      "description": "Purchase tickets for an event with automatic payment handling."
    }
  ]
}
```

Gemini uses the same OpenAPI spec as OpenAI. The search/list/purchase flow is identical — only the extension registration differs.

---

## LangChain

Atlas provides first-class LangChain tools that plug into any LangChain agent.

### Installation

```bash
npm install @atlas/langchain
```

### Tools

```typescript
import { AtlasSearchTool, AtlasListTicketsTool, AtlasPurchaseTool } from '@atlas/langchain'
import { TempoPaymentHandler } from '@atlas/client'
import { ChatOpenAI } from '@langchain/openai'
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents'
import { ChatPromptTemplate } from '@langchain/core/prompts'

// Configure Atlas tools
const atlasConfig = {
  registryUrl: 'https://registry.atlas.events',
  apiKey: process.env.ATLAS_API_KEY,
  paymentHandler: new TempoPaymentHandler({
    privateKey: process.env.TEMPO_PRIVATE_KEY!,
  }),
}

const tools = [
  new AtlasSearchTool(atlasConfig),
  new AtlasListTicketsTool(atlasConfig),
  new AtlasPurchaseTool(atlasConfig),
]

// Build agent
const llm = new ChatOpenAI({ model: 'gpt-4o' })

const prompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a helpful event planning assistant. Use the Atlas tools to find and book events.'],
  ['human', '{input}'],
  ['placeholder', '{agent_scratchpad}'],
])

const agent = createToolCallingAgent({ llm, tools, prompt })
const executor = new AgentExecutor({ agent, tools, verbose: true })

// Run
const result = await executor.invoke({
  input: 'Find techno events in Berlin this Saturday and buy 2 tickets to the cheapest one under 25 euros',
})

console.log(result.output)
```

### Tool Definitions

#### `AtlasSearchTool`

```typescript
class AtlasSearchTool extends StructuredTool {
  name = 'atlas_search_events'
  description = 'Search for events across all platforms. Supports keyword, location (lat/lng + radius), date range, category, and price filters.'

  schema = z.object({
    q: z.string().optional().describe('Keyword search'),
    lat: z.number().optional().describe('Latitude'),
    lng: z.number().optional().describe('Longitude'),
    radius_km: z.number().optional().describe('Radius in km'),
    start_after: z.string().optional().describe('ISO 8601 start date'),
    start_before: z.string().optional().describe('ISO 8601 end date'),
    category: z.string().optional().describe('Event category'),
    price_max: z.number().optional().describe('Max price in USD'),
    sort: z.string().optional().describe('Sort: relevance, price_asc, date_asc, distance'),
    limit: z.number().optional().describe('Results per page'),
  })
}
```

#### `AtlasListTicketsTool`

```typescript
class AtlasListTicketsTool extends StructuredTool {
  name = 'atlas_list_tickets'
  description = 'List available ticket types and pricing for an event.'

  schema = z.object({
    event_id: z.string().describe('Atlas event ID'),
  })
}
```

#### `AtlasPurchaseTool`

```typescript
class AtlasPurchaseTool extends StructuredTool {
  name = 'atlas_purchase_ticket'
  description = 'Purchase tickets for an event. Handles payment automatically.'

  schema = z.object({
    event_id: z.string().describe('Atlas event ID'),
    ticket_type_id: z.string().describe('Ticket type ID'),
    quantity: z.number().describe('Number of tickets'),
    attendees: z.array(z.object({
      name: z.string(),
      email: z.string(),
    })).describe('Attendee details (one per ticket)'),
  })
}
```

### Example: LangChain Agent with Atlas + Calendar + Email

```typescript
import { AtlasSearchTool, AtlasListTicketsTool, AtlasPurchaseTool } from '@atlas/langchain'
import { GoogleCalendarCreateTool } from '@langchain/community/tools/google_calendar'
import { SendEmailTool } from './tools/email'

const tools = [
  new AtlasSearchTool(atlasConfig),
  new AtlasListTicketsTool(atlasConfig),
  new AtlasPurchaseTool(atlasConfig),
  new GoogleCalendarCreateTool(calendarConfig),
  new SendEmailTool(emailConfig),
]

const executor = new AgentExecutor({ agent, tools })

await executor.invoke({
  input: `Find a jazz concert in NYC this Friday, buy 2 tickets,
          add it to my Google Calendar, and email the tickets to alice@example.com`,
})

// Agent flow:
// 1. atlas_search_events → finds concerts
// 2. atlas_list_tickets → gets pricing
// 3. atlas_purchase_ticket → buys tickets, gets credentials
// 4. google_calendar_create → adds event to calendar
// 5. send_email → forwards ticket credentials to alice
```

---

## LlamaIndex

Atlas integrates as LlamaIndex tools and can be combined with LlamaIndex query engines for event data retrieval.

### Installation

```bash
npm install @atlas/llamaindex
```

### Tools

```typescript
import { AtlasToolSpec } from '@atlas/llamaindex'
import { OpenAIAgent } from 'llamaindex'

const atlasTools = new AtlasToolSpec({
  registryUrl: 'https://registry.atlas.events',
  apiKey: process.env.ATLAS_API_KEY,
  paymentHandler: tempoHandler,
})

const agent = new OpenAIAgent({
  tools: atlasTools.toToolList(),
  verbose: true,
})

const response = await agent.chat(
  'Find music festivals in Europe this summer under $200'
)
```

### Query Engine Integration

Use Atlas event data as a LlamaIndex data source for RAG-style queries:

```typescript
import { AtlasReader } from '@atlas/llamaindex'
import { VectorStoreIndex } from 'llamaindex'

// Load events as documents
const reader = new AtlasReader({ registryUrl: 'https://registry.atlas.events' })
const documents = await reader.loadData({
  q: 'music festival',
  start_after: '2026-06-01',
  start_before: '2026-09-01',
  limit: 100,
})

// Build vector index for semantic search over event descriptions
const index = await VectorStoreIndex.fromDocuments(documents)
const queryEngine = index.asQueryEngine()

const response = await queryEngine.query(
  'Which festivals have the best electronic music lineups?'
)
```

---

## CrewAI

Atlas tools enable multi-agent event planning workflows where specialized agents collaborate.

### Installation

```bash
pip install atlas-crewai
```

### Example: Event Planning Crew

```python
from crewai import Agent, Task, Crew
from atlas_crewai import AtlasSearchTool, AtlasListTicketsTool, AtlasPurchaseTool

# Tools
search_tool = AtlasSearchTool(
    registry_url="https://registry.atlas.events",
    api_key="your-api-key",
)
list_tool = AtlasListTicketsTool(registry_url="https://registry.atlas.events")
purchase_tool = AtlasPurchaseTool(
    registry_url="https://registry.atlas.events",
    tempo_private_key="your-key",
)

# Agents
researcher = Agent(
    role="Event Researcher",
    goal="Find the best events matching the group's interests and constraints",
    tools=[search_tool, list_tool],
    backstory="You are an expert at discovering events across platforms. You consider "
              "location, timing, price, and group preferences to find perfect matches.",
)

budget_manager = Agent(
    role="Budget Manager",
    goal="Ensure total spend stays within budget and find the best value",
    tools=[list_tool],
    backstory="You analyze ticket pricing, compare options, and calculate total costs "
              "including transport and food estimates.",
)

booker = Agent(
    role="Ticket Booker",
    goal="Purchase the approved tickets and confirm delivery",
    tools=[purchase_tool],
    backstory="You handle the actual ticket purchases, verify confirmations, "
              "and ensure all attendees receive their credentials.",
)

# Tasks
find_events = Task(
    description="""Find techno and house music events in Berlin for a group of 4 people
    this Saturday night. Budget is 100 EUR total. List top 3 options with pricing.""",
    expected_output="Top 3 events with names, times, prices, and availability",
    agent=researcher,
)

evaluate_budget = Task(
    description="""Review the researcher's top 3 events. Calculate total cost for 4 tickets
    each. Recommend the best value option within the 100 EUR budget.""",
    expected_output="Recommended event with cost breakdown for 4 people",
    agent=budget_manager,
)

book_tickets = Task(
    description="""Purchase 4 tickets to the budget manager's recommended event.
    Attendees: Alice, Bob, Carol, Dave (emails: alice@, bob@, carol@, dave@example.com).""",
    expected_output="Purchase confirmation with ticket credentials for all 4 attendees",
    agent=booker,
)

# Crew
crew = Crew(
    agents=[researcher, budget_manager, booker],
    tasks=[find_events, evaluate_budget, book_tickets],
    verbose=True,
)

result = crew.kickoff()
print(result)
```

---

## Custom Agents (Direct HTTP)

No SDK required. Any HTTP client can interact with Atlas directly.

### Step-by-Step Flow

#### 1. Discover the Registry

```bash
curl https://registry.atlas.events/v1/status
```

```json
{
  "version": "1.0.0",
  "platforms": 47,
  "events_indexed": 284103,
  "payment_methods": ["tempo_usdc", "stripe_card", "stripe_wallet", "lightning"]
}
```

#### 2. Search Events

```bash
curl "https://registry.atlas.events/v1/events/search?q=techno&lat=52.52&lng=13.4&radius_km=25&limit=5" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "X-Atlas-Agent-Id: agent:my-custom-bot"
```

```json
{
  "items": [
    {
      "id": "ev_tresor_pulse",
      "title": "Tresor: Pulse",
      "start": "2026-03-21T23:00:00+01:00",
      "location": { "name": "Tresor Berlin", "lat": 52.5095, "lng": 13.4206 },
      "price": { "amount": 18, "currency": "EUR", "display": "EUR 18.00" },
      "availability": "available",
      "source": { "platform": "lemonade", "url": "https://lemonade.social/e/tresor-pulse" },
      "payment_methods": ["tempo_usdc", "stripe_card"]
    }
  ],
  "cursor": "c_abc123",
  "total": 12
}
```

#### 3. List Ticket Types

```bash
curl "https://registry.atlas.events/v1/events/ev_tresor_pulse/tickets" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

```json
[
  {
    "id": "tt_general",
    "name": "General Admission",
    "price": { "amount": 18, "currency": "EUR", "display": "EUR 18.00" },
    "available": 42,
    "limit_per_order": 6,
    "on_sale": true
  },
  {
    "id": "tt_vip",
    "name": "VIP Backstage",
    "price": { "amount": 55, "currency": "EUR", "display": "EUR 55.00" },
    "available": 5,
    "limit_per_order": 2,
    "on_sale": true
  }
]
```

#### 4. Purchase (with 402 flow)

**First request — gets 402 challenge:**

```bash
curl -X POST "https://registry.atlas.events/v1/events/ev_tresor_pulse/purchase" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_type_id": "tt_general",
    "quantity": 2,
    "attendees": [
      { "name": "Alice", "email": "alice@example.com" },
      { "name": "Bob", "email": "bob@example.com" }
    ]
  }'
```

**Response: 402 Payment Required**

```
HTTP/1.1 402 Payment Required
X-Payment-Amount: 36.00
X-Payment-Currency: EUR
X-Payment-Amount-USDC: 38.52
X-Payment-Recipient: 0x1a2b3c4d5e6f...
X-Payment-Nonce: n_abc123
X-Payment-Expires: 2026-03-19T12:05:00Z
X-Payment-Methods: tempo_usdc,stripe_card
```

**Agent completes payment (e.g., USDC transfer on Tempo), then retries with proof:**

```bash
curl -X POST "https://registry.atlas.events/v1/events/ev_tresor_pulse/purchase" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Payment-Credential: eyJtZXRob2QiOiJ0ZW1wb191c2RjIiwicHJvb2YiOiIweGFiYy4uLiJ9" \
  -d '{
    "ticket_type_id": "tt_general",
    "quantity": 2,
    "attendees": [
      { "name": "Alice", "email": "alice@example.com" },
      { "name": "Bob", "email": "bob@example.com" }
    ]
  }'
```

**Response: 200 OK**

```json
{
  "purchase_id": "pur_xyz789",
  "credentials": [
    {
      "jwt": "eyJhbGciOiJFZDI1NTE5...",
      "decoded": {
        "attendee": { "name": "Alice", "email": "alice@example.com" },
        "event_id": "ev_tresor_pulse",
        "event_title": "Tresor: Pulse",
        "ticket_type": "General Admission",
        "valid_from": "2026-03-21T23:00:00+01:00",
        "valid_until": "2026-03-22T12:00:00+01:00"
      },
      "ticketUrl": "https://lemonade.social/tickets/pur_xyz789_0",
      "qrData": "atlas:ticket:pur_xyz789:0:sig_abc"
    },
    {
      "jwt": "eyJhbGciOiJFZDI1NTE5...",
      "decoded": {
        "attendee": { "name": "Bob", "email": "bob@example.com" },
        "event_id": "ev_tresor_pulse",
        "event_title": "Tresor: Pulse",
        "ticket_type": "General Admission",
        "valid_from": "2026-03-21T23:00:00+01:00",
        "valid_until": "2026-03-22T12:00:00+01:00"
      },
      "ticketUrl": "https://lemonade.social/tickets/pur_xyz789_1",
      "qrData": "atlas:ticket:pur_xyz789:1:sig_def"
    }
  ],
  "payment": {
    "method": "tempo_usdc",
    "amount": 38.52,
    "currency": "USDC",
    "transaction_id": "0xabc123..."
  },
  "purchased_at": "2026-03-19T11:42:18Z"
}
```

#### 5. Verify a Ticket

```bash
curl -X POST "https://registry.atlas.events/v1/tickets/verify" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "credential_jwt": "eyJhbGciOiJFZDI1NTE5..." }'
```

```json
{
  "valid": true,
  "event": { "id": "ev_tresor_pulse", "title": "Tresor: Pulse" },
  "attendee": { "name": "Alice", "email": "alice@example.com" },
  "ticket_type": "General Admission",
  "status": "active",
  "checked_in": false
}
```

---

## Agent Identity

### Attribution Header

Every agent request should include the `X-Atlas-Agent-Id` header:

```
X-Atlas-Agent-Id: agent:my-travel-bot
```

Format: `agent:{identifier}` where identifier is a URL-safe string registered via the Atlas developer portal.

### Registration

Register your agent at `https://atlas.events/developers`:

1. Create a developer account
2. Register your agent (name, description, website)
3. Get an `agent_id` and API key
4. Include `X-Atlas-Agent-Id` in all requests

### Agent Reputation System (Future)

Atlas tracks agent behavior metrics (not exposed to other agents — used internally for rate limit decisions):

| Metric | Description |
|--------|-------------|
| Purchase completion rate | How often a started purchase flow results in a completed purchase |
| Dispute rate | Percentage of purchases that result in refund requests |
| Search-to-purchase ratio | How efficiently the agent converts searches to sales |
| Response time | How quickly the agent completes payment after receiving a 402 challenge |

High-reputation agents receive priority API access and higher rate limits.

---

## Agent Rewards and Analytics

### What Agents Earn

Agents do not earn commissions or tokens directly. Atlas is infrastructure, not an affiliate program. There is no agent token.

### What Agent Developers Get

Agent developers who register on the Atlas developer portal get:

- **Analytics dashboard:** See how your agent drives ticket sales (search volume, conversion rate, revenue driven)
- **Volume-based perks:**

| Monthly Tickets Driven | Perk |
|------------------------|------|
| 0 - 100 | Standard rate limits (60 req/min) |
| 100 - 1,000 | Priority API access (120 req/min) |
| 1,000 - 10,000 | Dedicated support + 300 req/min |
| 10,000+ | Custom rate limits, early API access, co-marketing |

- **Organizer visibility:** Organizers can see which agents drive the most sales, creating organic partnerships
- **Early access:** Beta APIs, new payment methods, and protocol features

### Why Build an Agent on Atlas

The value for agent developers is not direct revenue — it is the ability to offer their users real-world event discovery and ticketing that works across all platforms. An agent that can find AND buy tickets is dramatically more useful than one that just links to Eventbrite.
