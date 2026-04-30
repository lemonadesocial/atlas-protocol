#!/usr/bin/env node
/**
 * ATLAS Protocol MCP server for Claude Desktop.
 *
 * Exposes the four ATLAS protocol tools, resources, and prompts from
 * `@atlasprotocol/agent-tools` over an stdio transport so a desktop MCP
 * host can speak ATLAS end-to-end.
 */

import {
  registerAtlasMcpPrompts,
  registerAtlasMcpResources,
  registerAtlasMcpTools,
  type AtlasToolsConfig,
} from "@atlasprotocol/agent-tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const SERVER_NAME = "atlas-protocol";
const SERVER_VERSION = "0.1.0";

/**
 * Build an {@link AtlasToolsConfig} from environment variables.
 *
 * Throws an `Error` whose message lists every missing required variable
 * so callers (and tests) can surface a clear failure.
 */
export function buildAtlasConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AtlasToolsConfig {
  const registryUrl = env["ATLAS_REGISTRY_URL"];
  const backendUrl = env["ATLAS_BACKEND_URL"];
  const agentId = env["ATLAS_AGENT_ID"];
  const apiKey = env["ATLAS_API_KEY"];

  const missing: string[] = [];
  if (!registryUrl) missing.push("ATLAS_REGISTRY_URL");
  if (!backendUrl) missing.push("ATLAS_BACKEND_URL");
  if (!agentId) missing.push("ATLAS_AGENT_ID");

  if (missing.length > 0) {
    throw new Error(
      [
        "Missing required environment variable(s):",
        ...missing.map((name) => `  - ${name}`),
        "",
        "Set these in the `env` block of your Claude Desktop MCP server config",
        "(see this example's README for a copy-pasteable snippet).",
      ].join("\n"),
    );
  }

  const config: AtlasToolsConfig = {
    registryUrl: registryUrl as string,
    backendUrl: backendUrl as string,
    agentId: agentId as string,
  };
  if (apiKey) config.apiKey = apiKey;
  return config;
}

/** Entry point. Wires up the MCP server and connects stdio transport. */
export async function main(): Promise<void> {
  const config = buildAtlasConfigFromEnv();

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerAtlasMcpTools(server, config);
  registerAtlasMcpResources(server, { config });
  registerAtlasMcpPrompts(server, config);

  const transport = new StdioServerTransport();

  const shutdown = (signal: NodeJS.Signals): void => {
    void (async () => {
      try {
        await server.close();
      } catch (error) {
        console.error(`[atlas-mcp] error during shutdown (${signal}):`, error);
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);

  console.error(
    `[atlas-mcp] connected, registry=${config.registryUrl}, backend=${config.backendUrl}, agent=${config.agentId}`,
  );
}

// Only run when executed directly (not when imported by a test).
const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[atlas-mcp] fatal: ${message}`);
    process.exit(1);
  });
}
