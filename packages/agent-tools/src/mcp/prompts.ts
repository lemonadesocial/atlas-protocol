/**
 * MCP prompt registrar for ATLAS Protocol.
 *
 * Registers three "starter" prompts that drive the canonical agent flows:
 * find events, compare prices, buy tickets. Hosts free to override the
 * surface — these are convenience defaults, not part of the protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AtlasToolsConfig } from "../config.js";
import { resolveConfig } from "../config.js";

/** Register the three starter prompts on the supplied {@link McpServer}. */
export function registerAtlasMcpPrompts(server: McpServer, config: AtlasToolsConfig): void {
  const resolved = resolveConfig(config);

  server.registerPrompt(
    "find_events_near_me",
    {
      title: "Find events near me",
      description: "Search for events across all connected platforms via Atlas Protocol",
      argsSchema: {
        city: z.string().optional().describe("City or area to search in"),
        interest: z.string().optional().describe("Type of event or topic of interest"),
      },
    },
    ({ city, interest }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use Atlas Protocol to find events${interest ? ` about ${interest}` : ""}${city ? ` near ${city}` : " near me"}. Search across all connected platforms and show me what's coming up, including ticket prices and availability. Use the atlas_search tool to find events.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "compare_ticket_prices",
    {
      title: "Compare ticket prices",
      description: "Side-by-side comparison of ticket options across multiple events",
      argsSchema: {
        event_names: z
          .string()
          .optional()
          .describe("Comma-separated event names or IDs to compare"),
      },
    },
    ({ event_names }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to compare ticket prices${event_names ? ` for these events: ${event_names}` : ""}. First search for the events using atlas_search, then use atlas_compare_tickets to get a side-by-side comparison of ticket types, prices, and availability.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "buy_tickets_for_event",
    {
      title: "Buy tickets for an event",
      description: "Walk through purchasing tickets for a specific event via Atlas Protocol",
      argsSchema: {
        event_name: z.string().optional().describe("Name of the event to buy tickets for"),
      },
    },
    ({ event_name }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me buy tickets${event_name ? ` for "${event_name}"` : ""}. Search for the event using atlas_search, show me the available ticket types and prices, and then use atlas_purchase to complete the purchase. Walk me through each step.`,
          },
        },
      ],
    }),
  );

  resolved.logger.debug("Atlas MCP prompts registered");
}
