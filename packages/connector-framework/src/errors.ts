/**
 * Base class for every error raised by a connector. Hosts catch
 * `ConnectorError` once and use `instanceof` to discriminate on the
 * concrete subclass.
 */
export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The host-supplied credentials are no longer valid. The host should
 * trigger its refresh flow (or prompt the user to re-authorize) and
 * retry the call with fresh credentials.
 */
export class AuthExpiredError extends ConnectorError {
  constructor(message = 'Authentication credentials are expired or invalid') {
    super(message);
    this.name = 'AuthExpiredError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The upstream platform returned a rate-limit response. When the
 * upstream supplies a `Retry-After` header, connectors set
 * `retryAfterSeconds` so the host can honor it.
 */
export class RateLimitError extends ConnectorError {
  readonly retryAfterSeconds?: number;

  constructor(message = 'Rate limit exceeded', retryAfterSeconds?: number) {
    super(message);
    this.name = 'RateLimitError';
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The requested resource does not exist on the upstream platform.
 * Connectors typically convert 404 responses on `getEvent` into a
 * `null` return value rather than throwing — this error is reserved
 * for cases where the operation cannot be completed because a
 * dependency was deleted (e.g. listing ticket types for an event that
 * no longer exists).
 */
export class NotFoundError extends ConnectorError {
  constructor(message = 'Requested resource was not found') {
    super(message);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
