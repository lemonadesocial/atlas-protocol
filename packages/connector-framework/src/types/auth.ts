/**
 * Authentication context passed to every Connector method call.
 *
 * Connectors are stateless with respect to credentials — the host application
 * resolves the active user/installation, picks the appropriate auth strategy,
 * and forwards credentials per request via this discriminated union.
 */
export type AuthContext =
  | { type: "oauth2"; accessToken: string; refreshToken?: string }
  | { type: "apikey"; apiKey: string };
