/**
 * OAuth2 Authorization Code + PKCE helpers for Eventbrite.
 *
 * RFC 7636 (Proof Key for Code Exchange) is used to protect the
 * authorization code from interception. These helpers are pure
 * functions: callers own storage of `code_verifier`, `state`, and the
 * resulting tokens.
 *
 * Endpoint reference: https://www.eventbrite.com/platform/api#/introduction/authentication
 */

const AUTHORIZE_URL = 'https://www.eventbrite.com/oauth/authorize';
const TOKEN_URL = 'https://www.eventbrite.com/oauth/token';

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * RFC 7636 §4.1: code_verifier is a cryptographically random string
 * of 43–128 characters from the unreserved set. We emit 64 chars.
 */
export function generateCodeVerifier(
  random: (length: number) => Uint8Array = defaultRandom,
): string {
  const bytes = random(48);
  return base64UrlEncode(bytes);
}

/**
 * RFC 7636 §4.2: code_challenge = BASE64URL(SHA256(code_verifier)).
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export async function generatePkcePair(
  random?: (length: number) => Uint8Array,
): Promise<PkcePair> {
  const codeVerifier = generateCodeVerifier(random);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

/**
 * Build the authorization URL the user is redirected to.
 */
export function buildAuthorizeUrl(args: {
  client: OAuthClientConfig;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: args.client.clientId,
    redirect_uri: args.client.redirectUri,
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (args.scope) params.set('scope', args.scope);
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code (plus the matching code_verifier)
 * for an access token. Uses Node 22 native `fetch`; callers may inject
 * an alternative transport for tests.
 */
export async function exchangeCodeForToken(args: {
  client: OAuthClientConfig;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthTokenResponse> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: args.client.clientId,
    client_secret: args.client.clientSecret,
    redirect_uri: args.client.redirectUri,
    code: args.code,
    code_verifier: args.codeVerifier,
  });

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`Eventbrite token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as OAuthTokenResponse;
}

/**
 * Refresh an OAuth2 access token using a refresh token.
 */
export async function refreshAccessToken(args: {
  client: OAuthClientConfig;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthTokenResponse> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: args.client.clientId,
    client_secret: args.client.clientSecret,
    refresh_token: args.refreshToken,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`Eventbrite token refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as OAuthTokenResponse;
}

function defaultRandom(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  // btoa expects a binary string. Iterating as char codes is safe for raw bytes.
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}
