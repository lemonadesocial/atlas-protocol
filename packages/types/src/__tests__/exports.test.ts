import { describe, it, expectTypeOf } from "vitest";
import type {
  AtlasEvent,
  AtlasManifest,
  AtlasReceipt,
  AtlasTicketType,
  AtlasPaymentMethodType,
  Pinner,
  PinOptions,
  PinResult,
} from "../index.js";

describe("@atlasprotocol/types", () => {
  it("exposes the expected core types", () => {
    // Compile-time only — if any of these names fail to resolve, the imports above fail.
    expectTypeOf<AtlasEvent>().toBeObject();
    expectTypeOf<AtlasManifest>().toBeObject();
    expectTypeOf<AtlasReceipt>().toBeObject();
    expectTypeOf<AtlasTicketType>().toBeObject();
    expectTypeOf<AtlasPaymentMethodType>().toBeString();
    expectTypeOf<Pinner>().toBeObject();
    expectTypeOf<PinOptions>().toBeObject();
    expectTypeOf<PinResult>().toBeObject();
  });
});
