import { describe, expect, it } from 'vitest';

import { registerAtlasMcpTools } from '../mcp/tools.js';
import { registerAtlasMcpResources } from '../mcp/resources.js';
import { registerAtlasMcpPrompts } from '../mcp/prompts.js';
import type { AtlasToolsConfig } from '../config.js';

const config: AtlasToolsConfig = {
  registryUrl: 'https://registry.test',
  backendUrl: 'https://backend.test',
  agentId: 'agent:test',
};

interface RegisteredTool {
  name: string;
  meta: unknown;
  handler: (input: unknown, raw?: unknown) => Promise<unknown>;
}

interface RegisteredResource {
  name: string;
  uri: string;
  meta: unknown;
  handler: (uri: unknown, extra: unknown) => Promise<unknown>;
}

interface RegisteredPrompt {
  name: string;
  meta: unknown;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

class FakeMcpServer {
  public tools: RegisteredTool[] = [];
  public resources: RegisteredResource[] = [];
  public prompts: RegisteredPrompt[] = [];

  registerTool(
    name: string,
    meta: unknown,
    handler: (input: unknown, raw?: unknown) => Promise<unknown>,
  ): void {
    this.tools.push({ name, meta, handler });
  }

  registerResource(
    name: string,
    uri: string,
    meta: unknown,
    handler: (uri: unknown, extra: unknown) => Promise<unknown>,
  ): void {
    this.resources.push({ name, uri, meta, handler });
  }

  registerPrompt(
    name: string,
    meta: unknown,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.prompts.push({ name, meta, handler });
  }
}

describe('registerAtlasMcpTools', () => {
  it('registers all four ATLAS protocol tools', () => {
    const server = new FakeMcpServer();
    registerAtlasMcpTools(server as unknown as Parameters<typeof registerAtlasMcpTools>[0], config);
    expect(server.tools.map((t) => t.name)).toEqual([
      'atlas_search',
      'atlas_compare_tickets',
      'atlas_purchase',
      'atlas_get_receipt',
    ]);
  });

  it('atlas_purchase rejects requests with no Authorization header', async () => {
    const server = new FakeMcpServer();
    registerAtlasMcpTools(server as unknown as Parameters<typeof registerAtlasMcpTools>[0], config);
    const purchase = server.tools.find((t) => t.name === 'atlas_purchase');
    expect(purchase).toBeDefined();

    await expect(
      purchase!.handler(
        { event_id: 'evt_1', ticket_type_id: 'tt_1', quantity: 1 },
        { requestInfo: { headers: {} } },
      ),
    ).rejects.toThrow(/Authentication required/);
  });
});

describe('registerAtlasMcpResources', () => {
  it('always registers atlas-pricing', async () => {
    const server = new FakeMcpServer();
    registerAtlasMcpResources(
      server as unknown as Parameters<typeof registerAtlasMcpResources>[0],
      { config },
    );
    expect(server.resources.map((r) => r.name)).toContain('atlas-pricing');

    const pricing = server.resources.find((r) => r.name === 'atlas-pricing')!;
    const out = (await pricing.handler('atlas://pricing', {})) as {
      contents: Array<{ text: string }>;
    };
    const parsed = JSON.parse(out.contents[0]!.text);
    expect(parsed.protocol_fee_percent).toBe(2.5);
  });

  it('omits atlas-verification when no loader is provided', () => {
    const server = new FakeMcpServer();
    registerAtlasMcpResources(
      server as unknown as Parameters<typeof registerAtlasMcpResources>[0],
      { config },
    );
    expect(server.resources.map((r) => r.name)).not.toContain('atlas-verification');
  });

  it('registers atlas-verification when a loader is provided', async () => {
    const server = new FakeMcpServer();
    registerAtlasMcpResources(
      server as unknown as Parameters<typeof registerAtlasMcpResources>[0],
      {
        config,
        loadVerificationStatus: async () => ({ is_verified: true, level: 'gold' }),
      },
    );
    const verification = server.resources.find((r) => r.name === 'atlas-verification');
    expect(verification).toBeDefined();

    const out = (await verification!.handler('atlas://verification', {
      requestInfo: { headers: { authorization: 'Bearer x' } },
    })) as { contents: Array<{ text: string }> };
    const parsed = JSON.parse(out.contents[0]!.text);
    expect(parsed.is_verified).toBe(true);
    expect(parsed.level).toBe('gold');
  });
});

describe('registerAtlasMcpPrompts', () => {
  it('registers the three starter prompts', () => {
    const server = new FakeMcpServer();
    registerAtlasMcpPrompts(server as unknown as Parameters<typeof registerAtlasMcpPrompts>[0], config);
    expect(server.prompts.map((p) => p.name)).toEqual([
      'find_events_near_me',
      'compare_ticket_prices',
      'buy_tickets_for_event',
    ]);
  });
});
