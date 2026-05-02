export type { AuthContext } from "./types/auth.js";
export type { SearchParams } from "./types/search.js";
export type { Connector, ConnectorCapabilities } from "./types/connector.js";
export { ConnectorError, AuthExpiredError, RateLimitError, NotFoundError } from "./errors.js";

/**
 * Re-exported from `@atlasprotocol/server-sdk` so connector authors can
 * validate their `toAtlas*` outputs without taking a direct dependency on the
 * server SDK.
 */
export { AtlasEventSchema } from "@atlasprotocol/server-sdk";
