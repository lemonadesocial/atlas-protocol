/**
 * LangChain bindings for the four ATLAS Protocol tools.
 *
 * Returns an array of {@link DynamicStructuredTool} instances ready to drop
 * into any LangChain agent. The four tools mirror the MCP surface:
 *
 *   - atlas_search           — federated event search
 *   - atlas_compare_tickets  — fan-out event detail fetch
 *   - atlas_purchase         — start a purchase, surface 402 challenge
 *   - atlas_get_receipt      — poll a hold's purchase receipt
 *
 * The tools are stateless w.r.t. the package; per-request user auth (e.g. a
 * session token) is supplied via the optional `getAuthHeader` callback in
 * {@link BuildAtlasLangChainToolsOptions}. The optional `state` generic lets
 * callers thread their own agent state through the tool closure (e.g. for
 * UI-card metadata) without coupling this package to any specific framework.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { AtlasToolsConfig } from "../config.js";
import { createAtlasHttpClient } from "../http-client.js";
import type {
  AtlasChallengeResponse,
  AtlasCheckoutResponse,
  AtlasFreeTicketResponse,
} from "../types/atlas.js";

/** Hook signature for surfacing tool results into caller-owned state. */
export type AtlasStateHook<TState> = (
  state: TState,
  event: {
    tool: "atlas_search" | "atlas_compare_tickets" | "atlas_purchase" | "atlas_get_receipt";
    data: unknown;
    cards?: { type: string; items: unknown[] };
  },
) => void;

/** Options for {@link buildAtlasLangChainTools}. */
export interface BuildAtlasLangChainToolsOptions<TState = unknown> {
  /** Connection / identity config for the ATLAS HTTP layer. */
  config: AtlasToolsConfig;
  /**
   * Returns the end-user `Authorization` header value to forward on
   * purchase / receipt calls. Required for those tools to function — without
   * it, the tools throw a clear authentication error at invocation time.
   */
  getAuthHeader?: () => string | undefined;
  /** Optional caller state passed through to the {@link AtlasStateHook}. */
  state?: TState;
  /** Optional hook to record tool results into caller state. */
  onResult?: AtlasStateHook<TState>;
}

/**
 * Build the four ATLAS LangChain tools.
 *
 * @typeParam TState - Optional caller-owned state type threaded through the
 *                     `onResult` hook. Defaults to `unknown`.
 */
export function buildAtlasLangChainTools<TState = unknown>(
  options: BuildAtlasLangChainToolsOptions<TState>,
): DynamicStructuredTool[] {
  const { config, getAuthHeader, state, onResult } = options;
  const http = createAtlasHttpClient(config);

  function emit(
    tool: "atlas_search" | "atlas_compare_tickets" | "atlas_purchase" | "atlas_get_receipt",
    data: unknown,
    cards?: { type: string; items: unknown[] },
  ): void {
    if (!onResult || state === undefined) return;
    if (cards !== undefined) {
      onResult(state, { tool, data, cards });
    } else {
      onResult(state, { tool, data });
    }
  }

  const tools: DynamicStructuredTool[] = [];

  tools.push(
    new DynamicStructuredTool({
      name: "atlas_search",
      description:
        "Search for events across federated sources via Atlas Protocol. Returns events with ticket info from multiple platforms.",
      schema: z.object({
        query: z.string().optional().describe("Free-text search query"),
        city: z.string().optional().describe("City name to filter by"),
        lat: z.number().optional().describe("Latitude for geo search"),
        lng: z.number().optional().describe("Longitude for geo search"),
        radius_km: z.number().optional().describe("Radius in km for geo search"),
        start_after: z.string().optional().describe("ISO date, events starting after"),
        start_before: z.string().optional().describe("ISO date, events starting before"),
        cursor: z.string().optional().describe("Pagination cursor"),
        limit: z.number().optional().describe("Max results (default 20)"),
      }),
      func: async (input) => {
        const searchQuery: Record<string, string | number | boolean | undefined> = {};
        if (input.query) searchQuery["q"] = input.query;
        if (input.city) searchQuery["city"] = input.city;
        if (input.lat !== undefined) searchQuery["lat"] = input.lat;
        if (input.lng !== undefined) searchQuery["lng"] = input.lng;
        if (input.radius_km !== undefined) searchQuery["radius_km"] = input.radius_km;
        if (input.start_after) searchQuery["start_after"] = input.start_after;
        if (input.start_before) searchQuery["start_before"] = input.start_before;
        if (input.cursor) searchQuery["cursor"] = input.cursor;
        if (input.limit !== undefined) searchQuery["limit"] = input.limit;

        const response = await http.registrySearch(searchQuery);
        const data = response.data as { items?: unknown[] };

        emit("atlas_search", response.data, {
          type: "atlas_event",
          items: data?.items ?? [],
        });

        return JSON.stringify(response.data);
      },
      returnDirect: false,
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: "atlas_compare_tickets",
      description: "Compare ticket prices and availability across 2-5 events fetched in parallel.",
      schema: z.object({
        event_ids: z
          .array(z.string().regex(/^[a-zA-Z0-9_-]+$/))
          .min(2)
          .max(5)
          .describe("Array of 2-5 Atlas event IDs to compare"),
      }),
      func: async (input) => {
        const results = await Promise.allSettled(
          input.event_ids.map(async (eventId: string) => {
            const response = await http.request({
              method: "GET",
              path: `/atlas/v1/events/${eventId}`,
              target: "registry",
            });
            return response.data;
          }),
        );

        const events = results.map((result, index) => {
          if (result.status === "fulfilled") return result.value;
          const id = input.event_ids[index] ?? "unknown";
          const reason = result.reason as { message?: string } | undefined;
          return { id, error: reason?.message ?? "Failed to fetch" };
        });

        emit("atlas_compare_tickets", events, {
          type: "atlas_comparison",
          items: events,
        });

        return JSON.stringify({ events });
      },
      returnDirect: false,
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: "atlas_purchase",
      description:
        "Purchase tickets for an Atlas event. Returns checkout URL for paid events or confirms free ticket acquisition.",
      schema: z.object({
        event_id: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .describe("Atlas event ID"),
        ticket_type_id: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .describe("Ticket type ID"),
        quantity: z.number().min(1).max(10).describe("Number of tickets (1-10)"),
      }),
      func: async (input) => {
        const authHeader = getAuthHeader?.();
        if (!authHeader || typeof authHeader !== "string") {
          throw new Error("Authentication required to purchase tickets");
        }

        const idempotencyKey = createHash("sha256")
          .update(`atlas:${input.event_id}:${input.ticket_type_id}:${input.quantity}:${authHeader}`)
          .digest("hex");

        const response = await http.request<AtlasChallengeResponse | AtlasFreeTicketResponse>({
          method: "POST",
          path: `/atlas/v1/events/${input.event_id}/purchase`,
          target: "backend",
          headers: {
            Authorization: authHeader,
            "Idempotency-Key": idempotencyKey,
          },
          body: {
            ticket_type_id: input.ticket_type_id,
            quantity: input.quantity,
          },
        });

        if (
          response.status === 200 &&
          (response.data as AtlasFreeTicketResponse).type === "free_ticket_redirect"
        ) {
          emit("atlas_purchase", response.data);
          return JSON.stringify({
            status: "completed",
            redirect_url: (response.data as AtlasFreeTicketResponse).redirect_url,
            message: "Tickets acquired successfully (free event)",
          });
        }

        if (response.status === 402) {
          const challenge = (response.data as AtlasChallengeResponse)["atlas:challenge"];
          const holdId = challenge.ticket_hold_id;
          const checkout = await http.request<AtlasCheckoutResponse>({
            method: "POST",
            path: `/atlas/v1/holds/${holdId}/checkout`,
            target: "backend",
            headers: {
              Authorization: authHeader,
              "Idempotency-Key": idempotencyKey,
            },
          });

          const result = {
            status: "pending_payment",
            hold_id: holdId,
            checkout_url: checkout.data.checkout_url,
            expires_at: checkout.data.expires_at,
          };

          emit("atlas_purchase", result);
          return JSON.stringify(result);
        }

        emit("atlas_purchase", response.data);
        return JSON.stringify(response.data);
      },
      returnDirect: false,
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: "atlas_get_receipt",
      description:
        "Check the status of a ticket purchase by hold ID. Returns pending, completed, or expired.",
      schema: z.object({
        hold_id: z.string().describe("Hold ID from a previous purchase"),
      }),
      func: async (input) => {
        const authHeader = getAuthHeader?.();
        if (!authHeader || typeof authHeader !== "string") {
          throw new Error("Authentication required to check receipt");
        }

        const response = await http.request({
          method: "GET",
          path: `/atlas/v1/receipts/by-hold/${input.hold_id}`,
          target: "backend",
          headers: { Authorization: authHeader },
        });

        emit("atlas_get_receipt", response.data, {
          type: "atlas_receipt",
          items: [response.data],
        });

        return JSON.stringify(response.data);
      },
      returnDirect: false,
    }),
  );

  return tools;
}
