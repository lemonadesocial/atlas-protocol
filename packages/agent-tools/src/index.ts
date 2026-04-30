/**
 * @atlas/agent-tools — public API.
 *
 * Speak ATLAS Protocol from any agent runtime: LangChain, MCP, or your own
 * HTTP layer.
 */

export type {
  AtlasToolsConfig,
  Logger,
} from './config.js';
export { noopLogger, resolveConfig } from './config.js';

export type {
  AtlasHttpClient,
  AtlasRequestOptions,
  AtlasResponse,
} from './http-client.js';
export { createAtlasHttpClient } from './http-client.js';

export type {
  AtlasChallengeResponse,
  AtlasCheckoutResponse,
  AtlasEventDetail,
  AtlasFreeTicketResponse,
  AtlasPurchaseResponse,
  AtlasReceiptResponse,
  AtlasSearchResult,
} from './types/atlas.js';

export type {
  AtlasStateHook,
  BuildAtlasLangChainToolsOptions,
} from './langchain/build-tools.js';
export { buildAtlasLangChainTools } from './langchain/build-tools.js';

export { registerAtlasMcpTools } from './mcp/tools.js';
export type {
  AtlasPricingPayload,
  AtlasVerificationStatus,
  RegisterAtlasMcpResourcesOptions,
} from './mcp/resources.js';
export { registerAtlasMcpResources } from './mcp/resources.js';
export { registerAtlasMcpPrompts } from './mcp/prompts.js';
