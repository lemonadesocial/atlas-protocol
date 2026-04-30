import { describe, expect, it } from "vitest";

import { generateManifest } from "@atlasprotocol/server-sdk";

import { getAtlasConfig } from "../lib/atlas-config.js";

describe("ATLAS manifest", () => {
  it("includes all required top-level fields", () => {
    const manifest = generateManifest(getAtlasConfig());

    expect(manifest.atlas_version).toBe("1.0");
    expect(typeof manifest.platform.name).toBe("string");
    expect(manifest.platform.name.length).toBeGreaterThan(0);

    expect(typeof manifest.endpoints.events).toBe("string");
    expect(typeof manifest.endpoints.search).toBe("string");
    expect(typeof manifest.endpoints.purchase).toBe("string");
    expect(typeof manifest.endpoints.receipt_verify).toBe("string");

    expect(Array.isArray(manifest.payment_methods)).toBe(true);

    expect(typeof manifest.fee_schedule.protocol_fee_percent).toBe("number");
    expect(typeof manifest.fee_schedule.platform_fee_percent).toBe("number");

    expect(Array.isArray(manifest.signing_keys)).toBe(true);
  });
});
