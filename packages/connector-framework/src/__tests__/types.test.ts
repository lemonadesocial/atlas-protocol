import { describe, expect, it } from "vitest";

import {
  AuthExpiredError,
  ConnectorError,
  NotFoundError,
  RateLimitError,
  type AuthContext,
  type Connector,
  type ConnectorCapabilities,
  type SearchParams,
} from "../index.js";

describe("Connector interface", () => {
  it("is satisfiable by a minimal stub implementation", () => {
    const stub: Connector = {
      id: "stub",
      name: "Stub Connector",
      authMethod: "apikey",
      capabilities: {
        search: true,
        getEvent: true,
        listTicketTypes: true,
        realtime: false,
      },
      async search() {
        return [];
      },
      async getEvent() {
        return null;
      },
      async listTicketTypes() {
        return [];
      },
    };

    expect(stub.id).toBe("stub");
    expect(stub.name).toBe("Stub Connector");
    expect(stub.authMethod).toBe("apikey");
    expect(stub.capabilities.search).toBe(true);
    expect(stub.capabilities.realtime).toBe(false);
  });

  it("accepts both oauth2 and apikey AuthContext shapes", () => {
    const oauth: AuthContext = { type: "oauth2", accessToken: "a", refreshToken: "r" };
    const oauthNoRefresh: AuthContext = { type: "oauth2", accessToken: "a" };
    const apikey: AuthContext = { type: "apikey", apiKey: "k" };

    expect(oauth.type).toBe("oauth2");
    expect(oauthNoRefresh.type).toBe("oauth2");
    expect(apikey.type).toBe("apikey");
  });

  it("accepts SearchParams with all-optional fields", () => {
    const empty: SearchParams = {};
    const full: SearchParams = {
      query: "jazz",
      startDate: new Date("2026-06-01T00:00:00Z"),
      endDate: new Date("2026-06-30T23:59:59Z"),
      location: { lat: 40.7128, lng: -74.006, radiusKm: 25 },
      limit: 50,
      cursor: "opaque-cursor",
    };

    expect(empty).toEqual({});
    expect(full.location?.radiusKm).toBe(25);
    expect(full.limit).toBe(50);
  });

  it("exposes the four-capability shape", () => {
    const caps: ConnectorCapabilities = {
      search: false,
      getEvent: true,
      listTicketTypes: true,
      realtime: false,
    };
    expect(Object.keys(caps).sort()).toEqual(["getEvent", "listTicketTypes", "realtime", "search"]);
  });
});

describe("Connector error hierarchy", () => {
  it("ConnectorError is an Error with the right name", () => {
    const err = new ConnectorError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.name).toBe("ConnectorError");
    expect(err.message).toBe("boom");
  });

  it("AuthExpiredError extends ConnectorError", () => {
    const err = new AuthExpiredError();
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err).toBeInstanceOf(AuthExpiredError);
    expect(err.name).toBe("AuthExpiredError");
  });

  it("RateLimitError carries retryAfterSeconds when provided", () => {
    const err = new RateLimitError("too fast", 42);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.name).toBe("RateLimitError");
    expect(err.retryAfterSeconds).toBe(42);
  });

  it("RateLimitError omits retryAfterSeconds when not provided", () => {
    const err = new RateLimitError();
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it("NotFoundError extends ConnectorError", () => {
    const err = new NotFoundError("gone");
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.name).toBe("NotFoundError");
    expect(err.message).toBe("gone");
  });

  it("preserves prototype chain so instanceof works after throw/catch", () => {
    function thrower(): never {
      throw new RateLimitError("limit", 5);
    }
    try {
      thrower();
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect(e).toBeInstanceOf(ConnectorError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});
