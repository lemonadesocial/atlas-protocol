/**
 * MCP tool registrar for the four ATLAS Protocol tools.
 *
 * Mirrors the LangChain surface in `langchain/build-tools.ts`. Pass an
 * {@link McpServer} instance and the agent will speak ATLAS over MCP.
 *
 * Per-request user auth is read from the MCP request's `authorization`
 * header — the package never sees, stores, or signs payment material.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { AtlasToolsConfig } from '../config.js';
import { resolveConfig } from '../config.js';
import { createAtlasHttpClient } from '../http-client.js';
import type {
  AtlasChallengeResponse,
  AtlasCheckoutResponse,
  AtlasEventDetail,
  AtlasPurchaseResponse,
  AtlasReceiptResponse,
  AtlasSearchResult,
} from '../types/atlas.js';

/**
 * Register the four ATLAS tools on the supplied {@link McpServer}.
 */
export function registerAtlasMcpTools(
  server: McpServer,
  config: AtlasToolsConfig,
): void {
  const resolved = resolveConfig(config);
  const http = createAtlasHttpClient(config);

  server.registerTool(
    'atlas_search',
    {
      description:
        'Search for events across federated sources via Atlas Protocol. Returns events with ticket info from multiple platforms.',
      inputSchema: {
        query: z.string().optional().describe('Free-text search query'),
        city: z.string().optional().describe('City name to filter by'),
        lat: z.number().optional().describe('Latitude for geo search'),
        lng: z.number().optional().describe('Longitude for geo search'),
        radius_km: z
          .number()
          .optional()
          .describe('Radius in kilometers for geo search'),
        start_after: z
          .string()
          .optional()
          .describe('ISO date string, only events starting after this date'),
        start_before: z
          .string()
          .optional()
          .describe('ISO date string, only events starting before this date'),
        cursor: z.string().optional().describe('Pagination cursor from previous search'),
        limit: z.number().optional().describe('Max results to return (default 20)'),
      },
    },
    async (input) => {
      const searchQuery: Record<string, string | number | boolean | undefined> = {};
      if (input.query) searchQuery['q'] = input.query;
      if (input.city) searchQuery['city'] = input.city;
      if (input.lat !== undefined) searchQuery['lat'] = input.lat;
      if (input.lng !== undefined) searchQuery['lng'] = input.lng;
      if (input.radius_km !== undefined) searchQuery['radius_km'] = input.radius_km;
      if (input.start_after) searchQuery['start_after'] = input.start_after;
      if (input.start_before) searchQuery['start_before'] = input.start_before;
      if (input.cursor) searchQuery['cursor'] = input.cursor;
      if (input.limit !== undefined) searchQuery['limit'] = input.limit;

      const response = await http.registrySearch<AtlasSearchResult>(searchQuery);
      const data = response.data;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: data.items,
              cursor: data.cursor,
              total: data.total,
              sources: data.sources,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'atlas_compare_tickets',
    {
      description:
        'Compare ticket prices and availability across 2-5 events. Fetches event details in parallel for side-by-side comparison.',
      inputSchema: {
        event_ids: z
          .array(z.string().regex(/^[a-zA-Z0-9_-]+$/))
          .min(2)
          .max(5)
          .describe('Array of 2-5 Atlas event IDs to compare'),
      },
    },
    async (input) => {
      const results = await Promise.allSettled(
        input.event_ids.map(async (eventId) => {
          const response = await http.request<AtlasEventDetail>({
            method: 'GET',
            path: `/atlas/v1/events/${eventId}`,
            target: 'registry',
          });
          return response.data;
        }),
      );

      const events: Array<AtlasEventDetail | { id: string; error: string }> =
        results.map((result, index) => {
          if (result.status === 'fulfilled') return result.value;
          const id = input.event_ids[index] ?? 'unknown';
          const reason = result.reason as { message?: string } | undefined;
          return { id, error: reason?.message ?? 'Failed to fetch event' };
        });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ events }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'atlas_purchase',
    {
      description:
        'Purchase tickets for an Atlas event. Returns a redirect URL for free events or a checkout URL for paid events.',
      inputSchema: {
        event_id: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .describe('Atlas event ID'),
        ticket_type_id: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .describe('Ticket type ID to purchase'),
        quantity: z.number().min(1).max(10).describe('Number of tickets (1-10)'),
      },
    },
    async (input, raw) => {
      const rawAuth = (raw as { requestInfo?: { headers?: Record<string, unknown> } })
        ?.requestInfo?.headers?.['authorization'];
      const authorization = typeof rawAuth === 'string' ? rawAuth : undefined;
      if (!authorization) {
        throw new Error('Authentication required to purchase tickets');
      }

      const idempotencyKey = createHash('sha256')
        .update(
          `atlas:${input.event_id}:${input.ticket_type_id}:${input.quantity}:${authorization}`,
        )
        .digest('hex');

      const response = await http.request<AtlasPurchaseResponse>({
        method: 'POST',
        path: `/atlas/v1/events/${input.event_id}/purchase`,
        target: 'backend',
        headers: {
          Authorization: authorization,
          'Idempotency-Key': idempotencyKey,
        },
        body: {
          ticket_type_id: input.ticket_type_id,
          quantity: input.quantity,
        },
      });

      if (
        response.status === 200 &&
        (response.data as { type?: string }).type === 'free_ticket_redirect'
      ) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'completed',
                redirect_url: (response.data as { redirect_url: string }).redirect_url,
                message: 'Tickets acquired successfully (free event)',
              }),
            },
          ],
        };
      }

      if (response.status === 402) {
        const challenge = (response.data as AtlasChallengeResponse)['atlas:challenge'];
        const holdId = challenge.ticket_hold_id;
        const checkoutResponse = await http.request<AtlasCheckoutResponse>({
          method: 'POST',
          path: `/atlas/v1/holds/${holdId}/checkout`,
          target: 'backend',
          headers: {
            Authorization: authorization,
            'Idempotency-Key': idempotencyKey,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'pending_payment',
                hold_id: holdId,
                checkout_url: checkoutResponse.data.checkout_url,
                expires_at: checkoutResponse.data.expires_at,
                message:
                  'Payment required. Open the checkout URL to complete purchase.',
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data),
          },
        ],
      };
    },
  );

  server.registerTool(
    'atlas_get_receipt',
    {
      description:
        'Check the status of a ticket purchase by hold ID. Returns pending, completed, or expired status.',
      inputSchema: {
        hold_id: z.string().describe('The hold ID from a previous purchase'),
      },
    },
    async (input, raw) => {
      const rawAuth = (raw as { requestInfo?: { headers?: Record<string, unknown> } })
        ?.requestInfo?.headers?.['authorization'];
      const authorization = typeof rawAuth === 'string' ? rawAuth : undefined;
      if (!authorization) {
        throw new Error('Authentication required to check receipt');
      }

      const response = await http.request<AtlasReceiptResponse>({
        method: 'GET',
        path: `/atlas/v1/receipts/by-hold/${input.hold_id}`,
        target: 'backend',
        headers: { Authorization: authorization },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data),
          },
        ],
      };
    },
  );

  resolved.logger.debug('Atlas MCP tools registered');
}
