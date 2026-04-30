/**
 * Low-level HTTP client for the ATLAS Protocol.
 *
 * Speaks two endpoints:
 *   - The federated Registry (search, event detail).
 *   - The Backend (holds, purchases, checkouts, receipts).
 *
 * x402 contract: HTTP 402 responses are NOT errors here — the body is returned
 * to the caller intact so the upstream agent / wallet layer can decide how to
 * handle the payment challenge. Signing payments is out of scope.
 */

import { resolveConfig, type AtlasToolsConfig, type Logger } from "./config.js";

/** Options accepted by {@link createAtlasHttpClient} factory's request method. */
export interface AtlasRequestOptions {
  method?: "GET" | "POST";
  path: string;
  target: "registry" | "backend";
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

/** Successful (or 402-challenge) response envelope. */
export interface AtlasResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

/** The HTTP client surface produced by {@link createAtlasHttpClient}. */
export interface AtlasHttpClient {
  request<T>(options: AtlasRequestOptions): Promise<AtlasResponse<T>>;
  registrySearch<T>(
    query: Record<string, string | number | boolean | undefined>,
  ): Promise<AtlasResponse<T>>;
}

function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  return (
    "?" +
    entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
  );
}

/**
 * Create an ATLAS HTTP client bound to a specific {@link AtlasToolsConfig}.
 */
export function createAtlasHttpClient(config: AtlasToolsConfig): AtlasHttpClient {
  const resolved = resolveConfig(config);
  const logger: Logger = resolved.logger;

  async function request<T>(options: AtlasRequestOptions): Promise<AtlasResponse<T>> {
    const {
      method = "GET",
      path,
      target,
      headers: extraHeaders = {},
      body,
      query,
      timeoutMs,
    } = options;

    const baseUrl = target === "registry" ? resolved.registryUrl : resolved.backendUrl;
    if (!baseUrl) throw new Error(`Atlas ${target} URL not configured`);

    const qs = query ? buildQueryString(query) : "";
    const url = `${baseUrl}${path}${qs}`;
    const timeout = timeoutMs ?? (target === "registry" ? 10_000 : 5_000);

    const headers: Record<string, string> = {
      "Atlas-Agent-Id": resolved.agentId,
      "Atlas-Version": resolved.apiVersion,
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (resolved.apiKey && !headers["Authorization"] && !headers["authorization"]) {
      headers["Authorization"] = `Bearer ${resolved.apiKey}`;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeout),
    };
    if (body && method === "POST") fetchOptions.body = JSON.stringify(body);

    async function doFetch(): Promise<AtlasResponse<T>> {
      const response = await fetch(url, fetchOptions);
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // 402: ATLAS payment challenge — surface the body and any
      // `Atlas-Payment` header to the caller, do NOT throw, do NOT sign.
      if (response.status === 402) {
        const data = await response.json();
        return { status: 402, data: data as T, headers: responseHeaders };
      }
      if (response.ok) {
        const data = await response.json();
        return {
          status: response.status,
          data: data as T,
          headers: responseHeaders,
        };
      }
      const errorBody = await response.text();
      throw new Error(
        `Atlas ${target} ${method} ${path} returned ${response.status}: ${errorBody}`,
      );
    }

    try {
      return await doFetch();
    } catch (error) {
      // Retry once on transient errors (5XX, network timeouts) but never on
      // 4XX client errors.
      if (error instanceof Error && !/returned 4\d{2}:/.test(error.message)) {
        logger.warn("Atlas request failed, retrying once", {
          error: error.message,
          url,
        });
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return await doFetch();
      }
      throw error;
    }
  }

  async function registrySearch<T>(
    query: Record<string, string | number | boolean | undefined>,
  ): Promise<AtlasResponse<T>> {
    try {
      return await request<T>({
        method: "GET",
        path: "/atlas/v1/search",
        target: "registry",
        query,
        timeoutMs: 10_000,
      });
    } catch (error) {
      logger.warn("Atlas Registry search failed, returning empty results", {
        error: (error as Error).message,
      });
      return {
        status: 503,
        data: {
          items: [],
          cursor: null,
          total: 0,
          sources: [],
          degraded: true,
        } as T,
        headers: {},
      };
    }
  }

  return { request, registrySearch };
}
