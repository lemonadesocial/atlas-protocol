/**
 * Supported payment rails for the MPP envelope.
 *
 * Mirrors the rails surface of `@atlasprotocol/server-sdk` but is duplicated here so
 * `@atlasprotocol/mpp` has zero coupling to the server-sdk package.
 *
 * Naming follows the canonical MPP method identifier convention
 * (lowercase, alphanumeric, ':' / '_' / '-' allowed) — see
 * https://mpp.dev/protocol/challenges (accessed 2026-04-30).
 */
export const SUPPORTED_RAILS = [
  'usdc-base',
  'usdc-tempo',
  'usdc-arbitrum',
  'usdc-polygon',
  'usdc-optimism',
  'stripe-spt',
] as const;

export type Rail = (typeof SUPPORTED_RAILS)[number];

/**
 * Canonical MPP method identifier regex per
 * https://mpp.dev/protocol/challenges (accessed 2026-04-30):
 *
 *   method = lcalpha *(lcalpha / DIGIT / ":" / "_" / "-")
 *
 * All of `SUPPORTED_RAILS` conform.
 */
export const METHOD_IDENTIFIER_PATTERN = /^[a-z][a-z0-9:_-]*$/;

/**
 * Type guard for the supported rail enum.
 */
export function isSupportedRail(s: string): s is Rail {
  return (SUPPORTED_RAILS as readonly string[]).includes(s);
}

/**
 * Lightweight check that a rail string is at least syntactically valid as
 * an MPP method identifier — useful for parsing inbound envelopes that
 * may carry rails not yet enumerated in `SUPPORTED_RAILS`.
 */
export function isValidMethodIdentifier(s: string): boolean {
  return METHOD_IDENTIFIER_PATTERN.test(s);
}
