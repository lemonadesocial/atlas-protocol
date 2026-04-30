# Changelog

All notable changes to this package will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-30

### Added

- `createAtlasAgent` factory wiring `@atlasprotocol/agent-tools` `buildAtlasLangChainTools` into a tool-calling LangChain `AgentExecutor` over OpenAI (`ChatOpenAI`) or Anthropic (`ChatAnthropic`) chat models.
- Default system prompt that walks the model through the canonical four-tool flow: `atlas_search` -> `atlas_compare_tickets` -> `atlas_purchase` (after explicit user confirmation) -> `atlas_get_receipt`.
- CLI entry (`src/index.ts`) that reads connection / identity / LLM config from the environment, accepts the user prompt as `argv[2]` or via stdin, prints intermediate tool calls, and surfaces x402 `pending_payment` challenges instead of attempting to sign them.
- `buildCliConfigFromEnv` helper enumerating every missing required env var on failure.
- `isPaymentChallenge` helper that recognizes the `atlas_purchase` tool's `pending_payment` JSON envelope.
- Vitest unit suite covering tool registration, provider switching, missing-auth purchase rejection, env validation, and payment-challenge detection.
- `.env.example` template documenting `ATLAS_REGISTRY_URL`, `ATLAS_BACKEND_URL`, `ATLAS_AGENT_ID`, `ATLAS_API_KEY`, `LLM_PROVIDER`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY`.
