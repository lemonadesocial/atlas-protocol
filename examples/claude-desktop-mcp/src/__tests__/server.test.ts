import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAtlasConfigFromEnv } from "../server.js";

describe("buildAtlasConfigFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a populated AtlasToolsConfig when all required vars are set", () => {
    const env: NodeJS.ProcessEnv = {
      ATLAS_REGISTRY_URL: "https://registry.example",
      ATLAS_BACKEND_URL: "https://backend.example",
      ATLAS_AGENT_ID: "agent:test",
      ATLAS_API_KEY: "sk_test_123",
    };

    const config = buildAtlasConfigFromEnv(env);

    expect(config).toEqual({
      registryUrl: "https://registry.example",
      backendUrl: "https://backend.example",
      agentId: "agent:test",
      apiKey: "sk_test_123",
    });
  });

  it("omits apiKey when ATLAS_API_KEY is not set", () => {
    const env: NodeJS.ProcessEnv = {
      ATLAS_REGISTRY_URL: "https://registry.example",
      ATLAS_BACKEND_URL: "https://backend.example",
      ATLAS_AGENT_ID: "agent:test",
    };

    const config = buildAtlasConfigFromEnv(env);

    expect(config.apiKey).toBeUndefined();
    expect(config.registryUrl).toBe("https://registry.example");
  });

  it("throws a clear error listing every missing required var", () => {
    const env: NodeJS.ProcessEnv = {
      ATLAS_REGISTRY_URL: "https://registry.example",
    };

    expect(() => buildAtlasConfigFromEnv(env)).toThrowError(
      /ATLAS_BACKEND_URL[\s\S]*ATLAS_AGENT_ID/,
    );
  });
});
