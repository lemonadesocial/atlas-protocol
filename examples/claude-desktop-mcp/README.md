# Example — Claude Desktop MCP server

Connect Claude Desktop to ATLAS Protocol with an MCP server. This example wraps `@atlasprotocol/agent-tools` in a tiny stdio MCP server so Claude Desktop can search federated events, compare ticket prices, complete HTTP 402 purchases, and check receipts — all from natural-language prompts.

## Prerequisites

- Node.js 22 or newer
- An ATLAS agent ID and API key (issued by the ATLAS registry you point at)
- Claude Desktop installed locally

## Install (monorepo dev)

From the repo root:

```bash
pnpm install
pnpm --filter @atlasprotocol/example-claude-desktop-mcp build
```

This produces `dist/server.js`, the executable bin entry referenced by the Claude Desktop config snippet below.

## Configuration

The server reads four environment variables. Set them in the `env` block of your Claude Desktop MCP server config (next section).

| Name                 | Required | Description                                                                | Example                                  |
| -------------------- | -------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| `ATLAS_REGISTRY_URL` | yes      | Base URL of the ATLAS Registry used for federated event search.            | `https://atlas-registry.lemonade.social` |
| `ATLAS_BACKEND_URL`  | yes      | Base URL of the ATLAS Backend used for purchases, holds, and receipts.     | `https://lemonade.social`                |
| `ATLAS_AGENT_ID`     | yes      | Stable agent identifier — sent as the `Atlas-Agent-Id` header.             | `agent:claude-desktop:alice`             |
| `ATLAS_API_KEY`      | no       | Pre-shared API key. When present, sent as a Bearer token on every request. | `sk_live_abc123…`                        |

A copy is provided in `.env.example`.

## Claude Desktop setup

Open Claude Desktop's MCP server settings (Settings → Developer → Edit Config) and add:

```json
{
  "mcpServers": {
    "atlas-protocol": {
      "command": "node",
      "args": ["/absolute/path/to/atlas-protocol/examples/claude-desktop-mcp/dist/server.js"],
      "env": {
        "ATLAS_REGISTRY_URL": "https://atlas-registry.lemonade.social",
        "ATLAS_BACKEND_URL": "https://lemonade.social",
        "ATLAS_AGENT_ID": "...",
        "ATLAS_API_KEY": "..."
      }
    }
  }
}
```

Replace the `args[0]` path with the absolute path to the built `dist/server.js` on your machine. Restart Claude Desktop after saving.

## Verification

1. Open Claude Desktop. The MCP indicator (bottom-left of the input box) should show that `atlas-protocol` is connected.
2. Click the indicator and confirm all four tools are listed:
   - `atlas_search`
   - `atlas_compare_tickets`
   - `atlas_purchase`
   - `atlas_get_receipt`
3. Ask the assistant a question that should trigger `atlas_search` (see prompts below).

If the server fails to start, the bin entry writes a multi-line error to stderr describing what's missing — surface that from Claude Desktop's MCP log to debug.

## Example prompts to try

- "Find me tech meetups in San Francisco next weekend."
- "Compare ticket prices between events `evt_123` and `evt_456`."
- "Buy two general-admission tickets to event `evt_123`."
- "What's the status of my hold `hold_789`?"

## Further reading

- [`@atlasprotocol/agent-tools` README](../../packages/agent-tools/README.md) — full tool, resource, and prompt reference.
