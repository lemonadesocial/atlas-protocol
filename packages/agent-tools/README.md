# @atlasprotocol/agent-tools

Agent-side ATLAS Protocol tooling. Drop these helpers into any LangChain agent
or Model Context Protocol server and your runtime can discover events, fetch
ticket types, drive the HTTP 402 purchase flow, and read receipts against any
ATLAS Registry — without writing a line of protocol glue. The package is
runtime-agnostic, has no implicit `process.env` reads, and pushes payment
signing back to the caller's wallet layer where it belongs.

## Install

```bash
pnpm add @atlasprotocol/agent-tools
# Pick the runtimes you actually use:
pnpm add @langchain/core            # for LangChain bindings
pnpm add @modelcontextprotocol/sdk  # for MCP server bindings
pnpm add zod                        # always required (peer dep)
```

`@langchain/core` and `@modelcontextprotocol/sdk` are **optional peer
dependencies** — install only the ones your agent uses.

## Quickstart — LangChain

```ts
import { buildAtlasLangChainTools } from '@atlasprotocol/agent-tools';

const atlasTools = buildAtlasLangChainTools({
  config: {
    registryUrl: 'https://registry.example.com',
    backendUrl: 'https://api.example.com',
    agentId: 'agent:my-app',
  },
  getAuthHeader: () => `Bearer ${currentUserToken}`,
});

const agent = createReactAgent({ model, tools: atlasTools });
```

## Quickstart — MCP

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAtlasMcpTools,
  registerAtlasMcpResources,
  registerAtlasMcpPrompts,
} from '@atlasprotocol/agent-tools';

const server = new McpServer({ name: 'atlas', version: '0.1.0' });
const config = { registryUrl: '…', backendUrl: '…', agentId: 'agent:my-app' };

registerAtlasMcpTools(server, config);
registerAtlasMcpResources(server, { config });
registerAtlasMcpPrompts(server, config);
```

## Configuration

`AtlasToolsConfig`:

| Field         | Type     | Required | Description                                                                 |
| ------------- | -------- | -------- | --------------------------------------------------------------------------- |
| `registryUrl` | `string` | yes      | Base URL of an ATLAS Registry (federated event search).                     |
| `backendUrl`  | `string` | yes      | Base URL of the ATLAS Backend (purchases, holds, receipts).                 |
| `agentId`     | `string` | yes      | Stable identifier for this agent (sent as `Atlas-Agent-Id`).                |
| `apiKey`      | `string` | no       | Pre-shared API key. If set, sent as `Authorization: Bearer <apiKey>`.       |
| `apiVersion`  | `string` | no       | Override the `Atlas-Version` header. Defaults to `"1.0"`.                   |
| `logger`      | `Logger` | no       | Optional `{debug, info, warn, error}`. Compatible with pino, winston, etc.  |

End-user authentication (e.g. session tokens) is passed through the
`getAuthHeader` callback in LangChain mode, or read from the MCP request's
`authorization` header in MCP mode. The package never stores user credentials.

## Tools

The four canonical ATLAS Protocol tools are exposed identically across both
runtimes:

| Tool                    | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `atlas_search`          | Federated search across registries.                        |
| `atlas_compare_tickets` | Parallel fetch of 2–5 events for side-by-side comparison.  |
| `atlas_purchase`        | Start a purchase. Surfaces a 402 challenge for paid events.|
| `atlas_get_receipt`     | Poll a hold's purchase receipt by `hold_id`.               |

## Payment handling (x402)

When the backend returns HTTP 402 with an `atlas:challenge` payload, the
package surfaces the challenge to the caller — it does NOT sign payments. That
deliberately keeps the package free of any wallet, network, or chain
dependency. Plug your own wallet / x402 client into the `atlas_purchase` flow
when handling a `pending_payment` result.

## See also

- Protocol spec: [`../../specs/01-PROTOCOL-SPEC.md`](../../specs/01-PROTOCOL-SPEC.md)
- Wire schemas: [`../../specs/02-SCHEMAS.md`](../../specs/02-SCHEMAS.md)
- Agent ecosystem: [`../../specs/08-AGENT-ECOSYSTEM-SPEC.md`](../../specs/08-AGENT-ECOSYSTEM-SPEC.md)
