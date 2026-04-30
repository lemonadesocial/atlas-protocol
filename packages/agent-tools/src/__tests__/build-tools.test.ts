import { afterEach, describe, expect, it } from "vitest";

import { buildAtlasLangChainTools } from "../langchain/build-tools.js";
import type { AtlasToolsConfig } from "../config.js";

const config: AtlasToolsConfig = {
  registryUrl: "https://registry.test",
  backendUrl: "https://backend.test",
  agentId: "agent:test",
};

const originalFetch = globalThis.fetch;

function urlToString(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown },
): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const result = handler(urlToString(url), init);
    return Promise.resolve({
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: () => Promise.resolve(result.body),
      text: () => Promise.resolve(JSON.stringify(result.body)),
      headers: new Headers(),
    } as Response);
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("buildAtlasLangChainTools", () => {
  it("returns the four protocol tools in canonical order", () => {
    const tools = buildAtlasLangChainTools({ config });
    expect(tools.map((t) => t.name)).toEqual([
      "atlas_search",
      "atlas_compare_tickets",
      "atlas_purchase",
      "atlas_get_receipt",
    ]);
  });

  it("atlas_search invokes the registry and returns JSON-stringified data", async () => {
    mockFetch((url) => {
      expect(url).toContain("/atlas/v1/search");
      expect(url).toContain("q=ambient");
      return {
        status: 200,
        body: {
          items: [
            {
              id: "evt_1",
              title: "Ambient Night",
              start: "2026-04-01T22:00:00Z",
              source: "lemonade",
            },
          ],
          cursor: null,
          total: 1,
          sources: ["lemonade"],
        },
      };
    });

    const tools = buildAtlasLangChainTools({ config });
    const search = tools.find((t) => t.name === "atlas_search");
    expect(search).toBeDefined();

    const result: unknown = await search!.invoke({ query: "ambient" });
    const parsed = JSON.parse(result as string) as {
      items: Array<{ id: string }>;
      total: number;
    };
    expect(parsed.items[0]?.id).toBe("evt_1");
    expect(parsed.total).toBe(1);
  });

  it("atlas_purchase requires an auth header", async () => {
    const tools = buildAtlasLangChainTools({ config });
    const purchase = tools.find((t) => t.name === "atlas_purchase")!;

    await expect(
      purchase.invoke({ event_id: "evt_1", ticket_type_id: "tt_1", quantity: 1 }),
    ).rejects.toThrow(/Authentication required/);
  });

  it("atlas_purchase returns redirect for free events", async () => {
    mockFetch((url) => {
      if (url.includes("/purchase")) {
        return {
          status: 200,
          body: {
            type: "free_ticket_redirect",
            message: "ok",
            redirect_url: "https://example.test/free",
          },
        };
      }
      return { status: 404, body: {} };
    });

    const tools = buildAtlasLangChainTools({
      config,
      getAuthHeader: () => "Bearer user_token",
    });
    const purchase = tools.find((t) => t.name === "atlas_purchase")!;

    const result: unknown = await purchase.invoke({
      event_id: "evt_free",
      ticket_type_id: "tt_free",
      quantity: 1,
    });
    const parsed = JSON.parse(result as string) as { status: string; redirect_url: string };
    expect(parsed.status).toBe("completed");
    expect(parsed.redirect_url).toContain("example.test");
  });

  it("threads caller state through onResult hook", async () => {
    mockFetch(() => ({
      status: 200,
      body: { items: [], cursor: null, total: 0, sources: [] },
    }));

    interface MyState {
      lastTool: string | null;
    }
    const state: MyState = { lastTool: null };

    const tools = buildAtlasLangChainTools<MyState>({
      config,
      state,
      onResult: (s, evt) => {
        s.lastTool = evt.tool;
      },
    });
    const search = tools.find((t) => t.name === "atlas_search")!;
    await search.invoke({ query: "x" });
    expect(state.lastTool).toBe("atlas_search");
  });
});
