#!/usr/bin/env node
/**
 * CLI entry for the ATLAS LangChain agent example.
 *
 * Reads connection / identity / LLM config from the environment, parses an
 * optional prompt from `process.argv[2]` (or stdin when omitted), and runs
 * the agent with intermediate tool-call tracing printed to stdout.
 *
 * x402 payment challenges are surfaced verbatim — the example explicitly
 * stops short of signing a payment authorization. Wallet integration is
 * the operator's responsibility, not the agent's.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { AtlasToolsConfig } from "@atlasprotocol/agent-tools";

import { createAtlasAgent, type LlmProvider } from "./agent.js";

interface CliConfig {
  atlasConfig: AtlasToolsConfig;
  llm: {
    provider: LlmProvider;
    apiKey: string;
    model: string | undefined;
  };
  authHeader: string | undefined;
}

/**
 * Build the CLI config from `env`. Throws an `Error` whose message lists
 * every missing variable so callers can surface a clear failure.
 */
export function buildCliConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const missing: string[] = [];

  const registryUrl = env["ATLAS_REGISTRY_URL"];
  const backendUrl = env["ATLAS_BACKEND_URL"];
  const agentId = env["ATLAS_AGENT_ID"];
  if (!registryUrl) missing.push("ATLAS_REGISTRY_URL");
  if (!backendUrl) missing.push("ATLAS_BACKEND_URL");
  if (!agentId) missing.push("ATLAS_AGENT_ID");

  const providerRaw = (env["LLM_PROVIDER"] ?? "openai").toLowerCase();
  if (providerRaw !== "openai" && providerRaw !== "anthropic") {
    throw new Error(`Unsupported LLM_PROVIDER "${providerRaw}". Use "openai" or "anthropic".`);
  }
  const provider: LlmProvider = providerRaw;

  const apiKeyVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = env[apiKeyVar];
  if (!apiKey) missing.push(apiKeyVar);

  if (missing.length > 0) {
    throw new Error(
      [
        "Missing required environment variable(s):",
        ...missing.map((name) => `  - ${name}`),
        "",
        "See .env.example for the full list.",
      ].join("\n"),
    );
  }

  const atlasConfig: AtlasToolsConfig = {
    registryUrl: registryUrl as string,
    backendUrl: backendUrl as string,
    agentId: agentId as string,
  };
  const apiKeyEnv = env["ATLAS_API_KEY"];
  if (apiKeyEnv) atlasConfig.apiKey = apiKeyEnv;

  return {
    atlasConfig,
    llm: {
      provider,
      apiKey: apiKey as string,
      model: env["LLM_MODEL"],
    },
    authHeader: env["ATLAS_USER_AUTH_HEADER"],
  };
}

/** Read a single line from stdin. Returns `""` on EOF. */
async function readLineFromStdin(promptText: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(promptText);
  } finally {
    rl.close();
  }
}

/** Pretty-print a tool result (parsed JSON when possible). */
function formatToolResult(raw: unknown): string {
  if (typeof raw !== "string") return JSON.stringify(raw, null, 2);
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Detects an x402 payment challenge in a tool-call result.
 *
 * The `atlas_purchase` tool returns a JSON-stringified object with
 * `status: "pending_payment"` and `checkout_url` when the upstream API
 * answered with HTTP 402.
 */
export function isPaymentChallenge(rawResult: unknown): rawResult is string {
  if (typeof rawResult !== "string") return false;
  try {
    const parsed = JSON.parse(rawResult) as { status?: unknown };
    return parsed.status === "pending_payment";
  } catch {
    return false;
  }
}

interface IntermediateStep {
  action: { tool: string; toolInput: unknown };
  observation: unknown;
}

/** Entry point. Wires up the agent, runs it, and prints the trace. */
export async function main(): Promise<void> {
  const cli = buildCliConfigFromEnv();

  const argPrompt = process.argv[2];
  let userPrompt: string;
  if (typeof argPrompt === "string" && argPrompt.length > 0) {
    userPrompt = argPrompt;
  } else {
    userPrompt = (await readLineFromStdin("Prompt> ")).trim();
    if (userPrompt.length === 0) {
      console.error("[atlas-agent] no prompt provided. Pass one as argv[2] or via stdin.");
      process.exit(1);
    }
  }

  const executor = createAtlasAgent({
    atlasConfig: cli.atlasConfig,
    llm: {
      provider: cli.llm.provider,
      apiKey: cli.llm.apiKey,
      ...(cli.llm.model !== undefined ? { model: cli.llm.model } : {}),
    },
    getAuthHeader: () => cli.authHeader,
  });

  console.log(
    `[atlas-agent] provider=${cli.llm.provider} registry=${cli.atlasConfig.registryUrl} backend=${cli.atlasConfig.backendUrl}`,
  );
  console.log(`[atlas-agent] prompt: ${userPrompt}`);

  const result = await executor.invoke({ input: userPrompt });

  const steps = (result["intermediateSteps"] as IntermediateStep[] | undefined) ?? [];
  for (const step of steps) {
    const toolName = step.action.tool;
    console.log(`\n[atlas-agent] tool call -> ${toolName}`);
    console.log(`  input: ${JSON.stringify(step.action.toolInput)}`);
    console.log(`  output: ${formatToolResult(step.observation)}`);

    if (toolName === "atlas_purchase" && isPaymentChallenge(step.observation)) {
      console.log(
        "\n[atlas-agent] x402 payment challenge surfaced. " +
          "This example stops here — signing the payment authorization is the wallet's job.",
      );
      console.log(
        "[atlas-agent] forward the checkout_url above to your wallet UI to complete the purchase.",
      );
    }
  }

  const final: unknown = result["output"];
  console.log("\n[atlas-agent] final answer:");
  console.log(typeof final === "string" ? final : JSON.stringify(final, null, 2));
}

// Only run when executed directly (not when imported by a test).
const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[atlas-agent] fatal: ${message}`);
    process.exit(1);
  });
}
