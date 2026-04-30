import { describe, expect, it } from "vitest";

import { createWellKnownHandler, generateManifest, generateSpaceManifest } from "../manifest.js";
import type { ServerSdkConfig } from "../config.js";

function makeConfig(overrides: Partial<ServerSdkConfig> = {}): ServerSdkConfig {
  return {
    platform: {
      name: "Lemonade",
      url: "https://lemonade.social",
      logoUrl: "https://lemonade.social/assets/logo.png",
      contactEmail: "atlas-tech@lemonade.social",
    },
    domain: "atlas.lemonade.social",
    feeSchedule: {
      protocolFeePercent: 2,
      platformFeePercent: 3.5,
      paymentProcessingNote: "Tempo USDC: <$0.001 per tx.",
    },
    paymentMethods: [
      { type: "tempo_usdc", receiverAddress: "0x000000000000000000000000000000000000dead" },
      { type: "base_usdc", receiverAddress: "0x000000000000000000000000000000000000beef" },
      { type: "stripe_spt", stripeSecretKey: "sk_test_xxx" },
    ],
    signingKeys: [
      {
        kid: "key-2026-04",
        kty: "EC",
        crv: "P-256",
        x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
        y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
        alg: "ES256",
        use: "sig",
      },
    ],
    rateLimits: { searchPerMinute: 100, purchasePerMinute: 10 },
    ...overrides,
  };
}

describe("generateManifest", () => {
  it("returns the canonical .well-known/atlas.json shape", () => {
    const manifest = generateManifest(makeConfig());

    expect(manifest["@context"]).toBe("https://atlas-protocol.org/v1");
    expect(manifest.atlas_version).toBe("1.0");
    expect(manifest.platform.name).toBe("Lemonade");
    expect(manifest.platform.url).toBe("https://lemonade.social");
    expect(manifest.platform.logo).toBe("https://lemonade.social/assets/logo.png");
    expect(manifest.platform.contact_email).toBe("atlas-tech@lemonade.social");
  });

  it("includes default capabilities (discovery, purchase, holds)", () => {
    const manifest = generateManifest(makeConfig());

    expect(manifest.capabilities.discovery).toBe(true);
    expect(manifest.capabilities.purchase).toBe(true);
    expect(manifest.capabilities.holds).toBe(true);
    expect(manifest.capabilities.refund).toBe(false);
  });

  it("builds endpoints from the configured domain", () => {
    const manifest = generateManifest(makeConfig());

    expect(manifest.endpoints.events).toBe("https://atlas.lemonade.social/atlas/v1/events");
    expect(manifest.endpoints.search).toBe("https://atlas.lemonade.social/atlas/v1/search");
    expect(manifest.endpoints.purchase).toContain("{event_id}");
  });

  it("honours an explicit baseUrl override", () => {
    const manifest = generateManifest(makeConfig(), { baseUrl: "https://custom.example.com" });

    expect(manifest.endpoints.events).toBe("https://custom.example.com/atlas/v1/events");
  });

  it("emits the configured payment methods", () => {
    const manifest = generateManifest(makeConfig());

    expect(manifest.payment_methods).toEqual(["tempo_usdc", "base_usdc", "stripe_spt"]);
  });

  it("emits the configured fee schedule", () => {
    const manifest = generateManifest(makeConfig());

    expect(manifest.fee_schedule.protocol_fee_percent).toBe(2);
    expect(manifest.fee_schedule.platform_fee_percent).toBe(3.5);
  });

  it("emits the configured signing keys verbatim", () => {
    const manifest = generateManifest(makeConfig());

    expect(manifest.signing_keys).toHaveLength(1);
    expect(manifest.signing_keys[0]?.kid).toBe("key-2026-04");
  });

  it("emits the configured rate limits", () => {
    const manifest = generateManifest(makeConfig());

    expect(manifest.rate_limits.search_per_minute).toBe(100);
    expect(manifest.rate_limits.purchase_per_minute).toBe(10);
  });

  it("strips a trailing slash from the domain", () => {
    const manifest = generateManifest(makeConfig({ domain: "atlas.lemonade.social/" }));

    expect(manifest.endpoints.events).toBe("https://atlas.lemonade.social/atlas/v1/events");
  });

  it("preserves an explicit https scheme on the domain", () => {
    const manifest = generateManifest(makeConfig({ domain: "https://atlas.lemonade.social" }));

    expect(manifest.endpoints.events).toBe("https://atlas.lemonade.social/atlas/v1/events");
  });
});

describe("generateSpaceManifest", () => {
  it("scopes the search endpoint to the given space", () => {
    const manifest = generateSpaceManifest(makeConfig(), { spaceId: "abc123" });

    expect(manifest.endpoints.search).toBe(
      "https://atlas.lemonade.social/atlas/v1/spaces/abc123/search",
    );
    // Other endpoints stay global
    expect(manifest.endpoints.events).toBe("https://atlas.lemonade.social/atlas/v1/events");
  });
});

describe("createWellKnownHandler", () => {
  it("writes a JSON body with cache + cors headers", () => {
    const handler = createWellKnownHandler(makeConfig());

    const headers = new Map<string, string>();
    let body = "";
    let statusCode = 0;
    const res = {
      get statusCode() {
        return statusCode;
      },
      set statusCode(value: number) {
        statusCode = value;
      },
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
      end(payload: string) {
        body = payload;
      },
    } as unknown as Parameters<typeof handler>[1];

    handler({} as Parameters<typeof handler>[0], res);

    expect(statusCode).toBe(200);
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(headers.get("cache-control")).toBe("public, max-age=3600");

    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed["@context"]).toBe("https://atlas-protocol.org/v1");
  });
});
