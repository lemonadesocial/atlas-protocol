/**
 * Configuration types for the ATLAS agent-tools package.
 *
 * The package never reads `process.env` itself — callers pass an explicit
 * {@link AtlasToolsConfig} object. This keeps the package portable across
 * runtimes (Node, Deno, browser/edge) and easy to test.
 */

/**
 * Minimal logger interface accepted by the package.
 *
 * Compatible with the public API of pino, bunyan, winston, and console — pass
 * any object that exposes the four methods below. Defaults to a no-op logger
 * when omitted.
 */
export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

/** No-op logger used when no logger is supplied. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Runtime configuration for the ATLAS agent-tools package.
 */
export interface AtlasToolsConfig {
  /** Base URL of an ATLAS Registry (federated event search). */
  registryUrl: string;
  /** Base URL of the ATLAS Backend (purchases, holds, receipts). */
  backendUrl: string;
  /** Stable identifier for this agent (sent as `Atlas-Agent-Id`). */
  agentId: string;
  /**
   * Optional pre-shared API key. If present, sent as a Bearer token on all
   * outbound requests. End-user auth (e.g. session tokens) is passed via
   * per-tool `authHeader` arguments instead.
   */
  apiKey?: string;
  /** Optional logger. Defaults to a no-op. */
  logger?: Logger;
  /** Override the ATLAS API version header. Defaults to `"1.0"`. */
  apiVersion?: string;
}

/** Resolves a config to its concrete defaults. */
export function resolveConfig(config: AtlasToolsConfig): Required<
  Pick<AtlasToolsConfig, "registryUrl" | "backendUrl" | "agentId" | "apiVersion">
> & {
  logger: Logger;
  apiKey: string | undefined;
} {
  return {
    registryUrl: config.registryUrl,
    backendUrl: config.backendUrl,
    agentId: config.agentId,
    apiVersion: config.apiVersion ?? "1.0",
    logger: config.logger ?? noopLogger,
    apiKey: config.apiKey,
  };
}
