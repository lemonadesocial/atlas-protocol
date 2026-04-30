# @atlasprotocol/example-langchain-agent

Run a LangChain agent that books events through ATLAS Protocol.

This example wires [`@atlasprotocol/agent-tools`](../../packages/agent-tools) into a tool-calling LangChain `AgentExecutor`. The agent receives a natural-language user prompt and walks the canonical ATLAS flow with no custom protocol code:

1. `atlas_search` — discover events across federated registries
2. `atlas_compare_tickets` — fan-out fetch detail for 2-5 events in parallel
3. `atlas_purchase` — start a purchase; surfaces an x402 payment challenge for paid events
4. `atlas_get_receipt` — poll a hold's status

Multi-model: OpenAI by default, Anthropic via a single env var toggle.

> Marked `private: true` in `package.json` — this package is shipped as a learning resource, not a published artifact.

## Prerequisites

- Node.js 22+
- `pnpm` 9.15.0 (the repo's pinned package manager)
- ATLAS Protocol agent credentials (`ATLAS_AGENT_ID`, optionally `ATLAS_API_KEY`)
- An OpenAI API key, or an Anthropic API key — your choice of provider

## Install

From the monorepo root:

```bash
pnpm install
```

## Configure

Copy `.env.example` to `.env` (or export the variables in your shell) and fill in the values:

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLAS_REGISTRY_URL` | yes | Base URL of an ATLAS Registry (federated event search) |
| `ATLAS_BACKEND_URL` | yes | Base URL of the ATLAS Backend (purchases, holds, receipts) |
| `ATLAS_AGENT_ID` | yes | Stable identifier for this agent — sent as `Atlas-Agent-Id` |
| `ATLAS_API_KEY` | no | Pre-shared bearer token, if your registry / backend require one |
| `ATLAS_USER_AUTH_HEADER` | no | End-user `Authorization` header forwarded on `atlas_purchase` and `atlas_get_receipt` |
| `LLM_PROVIDER` | no | `openai` (default) or `anthropic` |
| `LLM_MODEL` | no | Override the per-provider default model |
| `OPENAI_API_KEY` | when `LLM_PROVIDER=openai` | Your OpenAI API key |
| `ANTHROPIC_API_KEY` | when `LLM_PROVIDER=anthropic` | Your Anthropic API key |

## Run

```bash
pnpm --filter @atlasprotocol/example-langchain-agent dev "find me jazz events in NYC next Friday under \$50"
```

Or pass the prompt via stdin:

```bash
pnpm --filter @atlasprotocol/example-langchain-agent dev
Prompt> find me jazz events in NYC next Friday under $50
```

## Expected output

The CLI prints a structured trace, one block per tool call, then the final natural-language answer:

```
[atlas-agent] provider=openai registry=https://... backend=https://...
[atlas-agent] prompt: find me jazz events in NYC next Friday under $50

[atlas-agent] tool call -> atlas_search
  input: {"query":"jazz","city":"New York","start_after":"...","start_before":"..."}
  output: { "items": [ ... ], "total": 4, "sources": ["lemonade","ticketmaster"] }

[atlas-agent] tool call -> atlas_compare_tickets
  input: {"event_ids":["evt_1","evt_2","evt_3"]}
  output: { "events": [ ... ] }

[atlas-agent] final answer:
Three jazz events fit your criteria. The closest match is "Smalls Jazz Club"
on Friday at 9pm, $30 GA — want me to grab one ticket?
```

## x402 payment challenges

`atlas_purchase` returns one of three shapes:

- `status: "completed"` — free-ticket flow, the redirect URL completes the booking
- `status: "pending_payment"` — the upstream API answered with HTTP 402 and a `checkout_url`
- a raw passthrough payload otherwise

**This example deliberately stops at the `pending_payment` step.** Signing a payment authorization is the operator/wallet's responsibility, not the agent's — the CLI surfaces the `checkout_url` and `expires_at` so your wallet UI can complete the purchase out-of-band. To extend the example into a fully-automated flow, plug your wallet signer at the call site that consumes `intermediateSteps`.

## Customize

- **Switch LLM:** flip `LLM_PROVIDER` between `openai` and `anthropic`. Both share the same `createAtlasAgent` factory.
- **Custom system prompt:** pass `systemPrompt` to `createAtlasAgent`. The default lives in `src/agent.ts` as `DEFAULT_SYSTEM_PROMPT`.
- **More tools:** the `tools` array passed to `AgentExecutor` is a plain LangChain `DynamicStructuredTool[]`. Concatenate your own tools alongside the four ATLAS tools.
- **Different model:** set `LLM_MODEL`, or pass `llm.model` to `createAtlasAgent` directly.

## Test

```bash
pnpm --filter @atlasprotocol/example-langchain-agent test
```

The suite hits no network — it verifies the factory wires up the four tools, that the env-var validator enumerates every missing required var, and that `isPaymentChallenge` recognizes the `pending_payment` envelope shape.

## Related

- [`@atlasprotocol/agent-tools`](../../packages/agent-tools) — the LangChain bindings + MCP server this example depends on.
- [LangChain JS docs](https://js.langchain.com) — for tool-calling agents and `AgentExecutor` details.

## License

MIT
