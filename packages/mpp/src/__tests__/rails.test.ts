import { describe, expect, it } from "vitest";

import {
  METHOD_IDENTIFIER_PATTERN,
  SUPPORTED_RAILS,
  isSupportedRail,
  isValidMethodIdentifier,
} from "../rails.js";

describe("SUPPORTED_RAILS", () => {
  it("every entry passes isSupportedRail", () => {
    for (const rail of SUPPORTED_RAILS) {
      expect(isSupportedRail(rail)).toBe(true);
    }
  });

  it("every entry conforms to the canonical method identifier pattern", () => {
    for (const rail of SUPPORTED_RAILS) {
      expect(METHOD_IDENTIFIER_PATTERN.test(rail)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isSupportedRail("fake")).toBe(false);
    expect(isSupportedRail("")).toBe(false);
    expect(isSupportedRail("USDC-BASE")).toBe(false);
  });
});

describe("isValidMethodIdentifier", () => {
  it("accepts canonical method identifier shapes", () => {
    const ok = ["tempo", "stripe", "usdc-base", "usdc-tempo", "method:sub_id"];
    for (const id of ok) {
      expect(isValidMethodIdentifier(id)).toBe(true);
    }
  });

  it("rejects shapes that violate the spec grammar", () => {
    const bad = ["", "1method", "-method", "METHOD", "method.with.dots", "method with space"];
    for (const id of bad) {
      expect(isValidMethodIdentifier(id)).toBe(false);
    }
  });
});
