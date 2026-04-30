import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentExecutor } from "langchain/agents";

import { createAtlasAgent, DEFAULT_SYSTEM_PROMPT } from "../agent.js";
import { buildCliConfigFromEnv, isPaymentChallenge } from "../index.js";

const ATLAS_CONFIG = {
  registryUrl: "https://registry.test",
  backendUrl: "https://backend.test",
  agentId: "agent:test",
};

describe("createAtlasAgent", () => {
  it("returns an AgentExecutor with the four ATLAS tools registered", () => {
    const executor = createAtlasAgent({
      atlasConfig: ATLAS_CONFIG,
      llm: { provider: "openai", apiKey: "sk-test" },
    });

    expect(executor).toBeInstanceOf(AgentExecutor);

    const toolNames = executor.tools.map((t) => t.name);
    expect(toolNames).toEqual([
      "atlas_search",
      "atlas_compare_tickets",
      "atlas_purchase",
      "atlas_get_receipt",
    ]);
  });

  it("supports the anthropic provider", () => {
    const executor = createAtlasAgent({
      atlasConfig: ATLAS_CONFIG,
      llm: { provider: "anthropic", apiKey: "sk-ant-test" },
    });

    expect(executor).toBeInstanceOf(AgentExecutor);
    expect(executor.tools).toHaveLength(4);
  });

  it("forwards the auth header callback into the purchase tool", async () => {
    const executor = createAtlasAgent({
      atlasConfig: ATLAS_CONFIG,
      llm: { provider: "openai", apiKey: "sk-test" },
      // Intentionally returns undefined to exercise the missing-auth branch.
      getAuthHeader: () => undefined,
    });

    const purchase = executor.tools.find((t) => t.name === "atlas_purchase");
    expect(purchase).toBeDefined();

    await expect(
      purchase!.invoke({ event_id: "evt_1", ticket_type_id: "tt_1", quantity: 1 }),
    ).rejects.toThrow(/Authentication required/i);
  });

  it("exposes a non-empty default system prompt covering the four tools", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/atlas_search/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/atlas_compare_tickets/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/atlas_purchase/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/atlas_get_receipt/);
  });
});

describe("buildCliConfigFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a populated CLI config when all required vars are set", () => {
    const env: NodeJS.ProcessEnv = {
      ATLAS_REGISTRY_URL: "https://registry.example",
      ATLAS_BACKEND_URL: "https://backend.example",
      ATLAS_AGENT_ID: "agent:test",
      ATLAS_API_KEY: "sk_test_123",
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-openai",
    };

    const cli = buildCliConfigFromEnv(env);

    expect(cli.atlasConfig).toEqual({
      registryUrl: "https://registry.example",
      backendUrl: "https://backend.example",
      agentId: "agent:test",
      apiKey: "sk_test_123",
    });
    expect(cli.llm.provider).toBe("openai");
    expect(cli.llm.apiKey).toBe("sk-openai");
  });

  it("defaults LLM_PROVIDER to openai", () => {
    const env: NodeJS.ProcessEnv = {
      ATLAS_REGISTRY_URL: "https://registry.example",
      ATLAS_BACKEND_URL: "https://backend.example",
      ATLAS_AGENT_ID: "agent:test",
      OPENAI_API_KEY: "sk-openai",
    };
    expect(buildCliConfigFromEnv(env).llm.provider).toBe("openai");
  });

  it("requires ANTHROPIC_API_KEY when LLM_PROVIDER=anthropic", () => {
    const env: NodeJS.ProcessEnv = {
      ATLAS_REGISTRY_URL: "https://registry.example",
      ATLAS_BACKEND_URL: "https://backend.example",
      ATLAS_AGENT_ID: "agent:test",
      LLM_PROVIDER: "anthropic",
    };
    expect(() => buildCliConfigFromEnv(env)).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it("rejects unsupported LLM_PROVIDER values", () => {
    const env: NodeJS.ProcessEnv = {
      ATLAS_REGISTRY_URL: "https://registry.example",
      ATLAS_BACKEND_URL: "https://backend.example",
      ATLAS_AGENT_ID: "agent:test",
      LLM_PROVIDER: "cohere",
      OPENAI_API_KEY: "sk-openai",
    };
    expect(() => buildCliConfigFromEnv(env)).toThrowError(/Unsupported LLM_PROVIDER/);
  });

  it("lists every missing required ATLAS var", () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: "sk-openai" };
    expect(() => buildCliConfigFromEnv(env)).toThrowError(
      /ATLAS_REGISTRY_URL[\s\S]*ATLAS_BACKEND_URL[\s\S]*ATLAS_AGENT_ID/,
    );
  });
});

describe("isPaymentChallenge", () => {
  it("returns true for a pending_payment JSON string", () => {
    const raw = JSON.stringify({
      status: "pending_payment",
      hold_id: "hold_1",
      checkout_url: "https://pay.example/abc",
      expires_at: "2026-05-01T00:00:00Z",
    });
    expect(isPaymentChallenge(raw)).toBe(true);
  });

  it("returns false for a completed free-ticket result", () => {
    const raw = JSON.stringify({ status: "completed", redirect_url: "https://ok" });
    expect(isPaymentChallenge(raw)).toBe(false);
  });

  it("returns false for non-string and non-JSON input", () => {
    expect(isPaymentChallenge(null)).toBe(false);
    expect(isPaymentChallenge(42)).toBe(false);
    expect(isPaymentChallenge("not json")).toBe(false);
  });
});
