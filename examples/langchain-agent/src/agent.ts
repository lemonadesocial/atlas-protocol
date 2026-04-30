/**
 * LangChain agent factory wired to the four ATLAS Protocol tools.
 *
 * Exports {@link createAtlasAgent}, which builds a tool-calling
 * `AgentExecutor` backed by an OpenAI or Anthropic chat model and the
 * canonical `atlas_search` / `atlas_compare_tickets` / `atlas_purchase` /
 * `atlas_get_receipt` LangChain tools.
 *
 * The factory is intentionally environment-agnostic — env-var parsing and
 * stdin handling live in `index.ts`. This module never reads `process.env`.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { buildAtlasLangChainTools, type AtlasToolsConfig } from "@atlasprotocol/agent-tools";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";

/** Supported LLM providers. */
export type LlmProvider = "openai" | "anthropic";

/** LLM-side configuration. */
export interface LlmOptions {
  /** Provider key — selects the underlying chat model. */
  provider: LlmProvider;
  /** Provider API key (e.g. `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`). */
  apiKey: string;
  /** Optional model override. Sensible defaults are used if omitted. */
  model?: string;
  /** Sampling temperature. Defaults to `0` for deterministic tool calls. */
  temperature?: number;
}

/** Options for {@link createAtlasAgent}. */
export interface CreateAtlasAgentOptions {
  /** ATLAS connection / identity config. */
  atlasConfig: AtlasToolsConfig;
  /** LLM provider config. */
  llm: LlmOptions;
  /**
   * Returns the end-user `Authorization` header forwarded on `atlas_purchase`
   * and `atlas_get_receipt`. Without it, those tools throw at invocation time.
   */
  getAuthHeader?: () => string | undefined;
  /** Override the default system prompt. */
  systemPrompt?: string;
  /** Forwarded to {@link AgentExecutor.fromAgentAndTools}. Defaults to `false`. */
  verbose?: boolean;
  /** Forwarded to {@link AgentExecutor}. Defaults to `true` — useful for UIs. */
  returnIntermediateSteps?: boolean;
}

/** Default per-provider model id. */
const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
};

/** Canonical system prompt — explains the four-tool flow to the model. */
export const DEFAULT_SYSTEM_PROMPT = [
  "You are an ATLAS Protocol booking agent. You help users find and purchase event tickets",
  "by calling four tools, in this order:",
  "",
  "1. `atlas_search` — translate the user's natural-language criteria (city, date window,",
  "   genre, price ceiling) into structured filters and return a list of candidate events.",
  "2. `atlas_compare_tickets` — when the user is choosing between candidates, fetch full",
  "   detail for 2-5 events in parallel and present a clear, side-by-side comparison",
  "   (price, fees, availability, venue).",
  "3. `atlas_purchase` — only after the user explicitly confirms one specific event,",
  "   ticket type, and quantity. Never call `atlas_purchase` speculatively.",
  "4. `atlas_get_receipt` — poll a hold's status using the `hold_id` returned by a prior",
  "   `atlas_purchase` call.",
  "",
  "When `atlas_purchase` returns a `pending_payment` result, surface the `checkout_url`",
  "and `expires_at` to the user verbatim — payment authorization is the user's wallet's",
  "responsibility, not yours. Do not invent payment instructions.",
  "",
  "Be concise. Quote prices with currency. Disambiguate before asking the user to choose.",
].join("\n");

/** Builds the chat model for the configured provider. */
function buildChatModel(llm: LlmOptions): BaseChatModel {
  const temperature = llm.temperature ?? 0;
  if (llm.provider === "openai") {
    return new ChatOpenAI({
      apiKey: llm.apiKey,
      model: llm.model ?? DEFAULT_MODELS.openai,
      temperature,
    });
  }
  if (llm.provider === "anthropic") {
    return new ChatAnthropic({
      apiKey: llm.apiKey,
      model: llm.model ?? DEFAULT_MODELS.anthropic,
      temperature,
    });
  }
  // Exhaustiveness guard.
  const exhaustive: never = llm.provider;
  throw new Error(`Unsupported LLM provider: ${String(exhaustive)}`);
}

/**
 * Build a tool-calling LangChain `AgentExecutor` wired to the four ATLAS
 * Protocol tools.
 */
export function createAtlasAgent(options: CreateAtlasAgentOptions): AgentExecutor {
  const tools = options.getAuthHeader
    ? buildAtlasLangChainTools({
        config: options.atlasConfig,
        getAuthHeader: options.getAuthHeader,
      })
    : buildAtlasLangChainTools({ config: options.atlasConfig });

  const llm = buildChatModel(options.llm);

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT],
    ["human", "{input}"],
    ["placeholder", "{agent_scratchpad}"],
  ]);

  const agent = createToolCallingAgent({ llm, tools, prompt });

  return new AgentExecutor({
    agent,
    tools,
    verbose: options.verbose ?? false,
    returnIntermediateSteps: options.returnIntermediateSteps ?? true,
  });
}
