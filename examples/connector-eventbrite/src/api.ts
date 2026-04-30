import {
  AuthExpiredError,
  ConnectorError,
  RateLimitError,
} from '@atlasprotocol/connector-framework';

export const EVENTBRITE_API_BASE = 'https://www.eventbriteapi.com/v3';

/**
 * Subset of Eventbrite REST shapes we consume. Only fields actually
 * read by the mappers are typed — everything else is left loose so an
 * upstream schema bump doesn't break compilation.
 */
export interface EventbriteMultipartText {
  text?: string | null;
  html?: string | null;
}

export interface EventbriteDateTime {
  timezone?: string;
  utc?: string;
  local?: string;
}

export interface EventbriteVenue {
  id?: string;
  name?: string;
  address?: {
    address_1?: string | null;
    address_2?: string | null;
    city?: string | null;
    region?: string | null;
    postal_code?: string | null;
    country?: string | null;
    latitude?: string | null;
    longitude?: string | null;
    localized_address_display?: string | null;
  };
  latitude?: string | null;
  longitude?: string | null;
}

export interface EventbriteOrganizer {
  id?: string;
  name?: string;
  url?: string;
}

export type EventbriteStatus = 'live' | 'started' | 'ended' | 'completed' | 'canceled' | 'draft';

export interface EventbriteEvent {
  id: string;
  name?: EventbriteMultipartText;
  description?: EventbriteMultipartText;
  url?: string;
  start?: EventbriteDateTime;
  end?: EventbriteDateTime;
  created?: string;
  changed?: string;
  status?: EventbriteStatus;
  currency?: string;
  online_event?: boolean;
  organization_id?: string;
  logo?: { url?: string } | null;
  venue?: EventbriteVenue | null;
  organizer?: EventbriteOrganizer | null;
}

export interface EventbriteCost {
  display?: string;
  currency?: string;
  value?: number;
  major_value?: string;
}

export interface EventbriteTicketClass {
  id: string;
  name: string;
  description?: string | null;
  free?: boolean;
  donation?: boolean;
  cost?: EventbriteCost | null;
  fee?: EventbriteCost | null;
  tax?: EventbriteCost | null;
  quantity_total?: number;
  quantity_sold?: number;
  minimum_quantity?: number;
  maximum_quantity?: number;
  sales_start?: string | null;
  sales_end?: string | null;
  hidden?: boolean;
  on_sale_status?: 'AVAILABLE' | 'SOLD_OUT' | 'NOT_YET_ON_SALE' | 'SALES_ENDED' | 'UNAVAILABLE';
}

export interface EventbritePagedEvents {
  events: EventbriteEvent[];
  pagination?: {
    object_count?: number;
    page_number?: number;
    page_count?: number;
    page_size?: number;
    has_more_items?: boolean;
    continuation?: string;
  };
}

export interface EventbritePagedTicketClasses {
  ticket_classes: EventbriteTicketClass[];
  pagination?: EventbritePagedEvents['pagination'];
}

export interface EventbriteApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin wrapper around the Eventbrite REST API. Handles bearer-token
 * auth, error → connector-framework error mapping, and JSON parsing.
 * The underlying transport (`fetch`) is injectable for testability.
 */
export class EventbriteApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: EventbriteApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? EVENTBRITE_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * GET /users/me/events/ — Eventbrite deprecated the public events
   * search in 2019, so the example scopes search to the authenticated
   * user's own events. Real-world hosts should call
   * `/organizations/{org_id}/events/` instead and pass the org id
   * through `SearchParams.cursor` or via a host-side configuration.
   */
  async listMyEvents(
    accessToken: string,
    query: Record<string, string | number | undefined>,
  ): Promise<EventbritePagedEvents> {
    const url = this.buildUrl('/users/me/events/', query);
    return this.request<EventbritePagedEvents>(url, accessToken);
  }

  async getEvent(accessToken: string, eventId: string): Promise<EventbriteEvent | null> {
    const url = this.buildUrl(`/events/${encodeURIComponent(eventId)}/`, {
      expand: 'venue,organizer,logo',
    });
    return this.requestOrNull<EventbriteEvent>(url, accessToken);
  }

  async listTicketClasses(
    accessToken: string,
    eventId: string,
  ): Promise<EventbritePagedTicketClasses> {
    const url = this.buildUrl(`/events/${encodeURIComponent(eventId)}/ticket_classes/`, {});
    return this.request<EventbritePagedTicketClasses>(url, accessToken);
  }

  private buildUrl(path: string, query: Record<string, string | number | undefined>): string {
    const url = new URL(this.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async request<T>(url: string, accessToken: string): Promise<T> {
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    });
    await this.assertOk(res);
    return (await res.json()) as T;
  }

  private async requestOrNull<T>(url: string, accessToken: string): Promise<T | null> {
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    });
    if (res.status === 404) return null;
    await this.assertOk(res);
    return (await res.json()) as T;
  }

  private async assertOk(res: Response): Promise<void> {
    if (res.ok) return;
    if (res.status === 401 || res.status === 403) {
      throw new AuthExpiredError(
        `Eventbrite returned ${res.status} ${res.statusText || ''}`.trim(),
      );
    }
    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      throw new RateLimitError(
        'Eventbrite rate limit exceeded',
        retryAfter,
      );
    }
    const body = await safeRead(res);
    throw new ConnectorError(
      `Eventbrite request failed (${res.status} ${res.statusText || ''}): ${body}`.trim(),
    );
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  // HTTP-date form — best-effort.
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    const delta = Math.max(0, Math.ceil((date - Date.now()) / 1000));
    return delta;
  }
  return undefined;
}

async function safeRead(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<unreadable body>';
  }
}
