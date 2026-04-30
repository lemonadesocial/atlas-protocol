import type { AtlasEvent, AtlasTicketType } from "@atlasprotocol/server-sdk";
import {
  AuthExpiredError,
  type AuthContext,
  type Connector,
  type ConnectorCapabilities,
  type SearchParams,
} from "@atlasprotocol/connector-framework";

import { EventbriteApiClient, type EventbriteApiClientOptions } from "./api.js";
import {
  eventbriteEventToAtlas,
  eventbriteTicketClassToAtlas,
  type MapEventOptions,
  type MapTicketTypeOptions,
} from "./mappers.js";

export interface EventbriteConnectorOptions {
  /** Base URL of the host's ATLAS endpoint, used to build atlas:purchase_endpoint. */
  baseUrl: string;
  /** Defaults applied to every emitted AtlasEvent. */
  eventDefaults?: Pick<MapEventOptions, "acceptedPaymentMethods">;
  /** Defaults applied to every emitted AtlasTicketType. */
  ticketDefaults?: MapTicketTypeOptions;
  /** Override the underlying REST API client (e.g. for testing). */
  api?: EventbriteApiClient;
  /** Inject a `fetch` implementation when constructing the default client. */
  fetchImpl?: typeof fetch;
  /** Override the API base URL when constructing the default client. */
  apiBaseUrl?: string;
}

const CAPABILITIES: ConnectorCapabilities = {
  search: true,
  getEvent: true,
  listTicketTypes: true,
  realtime: false,
};

/**
 * Reference Eventbrite connector. Implements the `Connector` contract
 * by composing the REST API client and pure mappers. The host owns
 * authentication state; this class holds only configuration.
 */
export class EventbriteConnector implements Connector {
  readonly id = "eventbrite";
  readonly name = "Eventbrite";
  readonly authMethod = "oauth2" as const;
  readonly capabilities = CAPABILITIES;

  private readonly api: EventbriteApiClient;
  private readonly baseUrl: string;
  private readonly eventDefaults: Pick<MapEventOptions, "acceptedPaymentMethods"> | undefined;
  private readonly ticketDefaults: MapTicketTypeOptions | undefined;

  constructor(opts: EventbriteConnectorOptions) {
    this.baseUrl = opts.baseUrl;
    this.eventDefaults = opts.eventDefaults;
    this.ticketDefaults = opts.ticketDefaults;
    if (opts.api) {
      this.api = opts.api;
    } else {
      const apiOpts: EventbriteApiClientOptions = {};
      if (opts.apiBaseUrl !== undefined) apiOpts.baseUrl = opts.apiBaseUrl;
      if (opts.fetchImpl !== undefined) apiOpts.fetchImpl = opts.fetchImpl;
      this.api = new EventbriteApiClient(apiOpts);
    }
  }

  async search(params: SearchParams, auth: AuthContext): Promise<AtlasEvent[]> {
    const accessToken = requireOAuth(auth);
    const query: Record<string, string | number | undefined> = {};
    if (params.query) query.name_filter = params.query;
    if (params.startDate) query["start_date.range_start"] = params.startDate.toISOString();
    if (params.endDate) query["start_date.range_end"] = params.endDate.toISOString();
    if (params.limit !== undefined) query.page_size = Math.max(1, Math.min(100, params.limit));
    if (params.cursor) query.continuation = params.cursor;
    if (params.location) {
      // Eventbrite location.within syntax: e.g. "10km@40.7128,-74.006".
      query["location.within"] = `${params.location.radiusKm}km`;
      query["location.latitude"] = params.location.lat;
      query["location.longitude"] = params.location.lng;
    }

    const page = await this.api.listMyEvents(accessToken, query);
    return page.events.map((e) => this.toAtlas(e));
  }

  async getEvent(externalId: string, auth: AuthContext): Promise<AtlasEvent | null> {
    const accessToken = requireOAuth(auth);
    const eb = await this.api.getEvent(accessToken, externalId);
    if (eb === null) return null;
    return this.toAtlas(eb);
  }

  async listTicketTypes(externalEventId: string, auth: AuthContext): Promise<AtlasTicketType[]> {
    const accessToken = requireOAuth(auth);
    const page = await this.api.listTicketClasses(accessToken, externalEventId);
    return page.ticket_classes.map((tc) =>
      eventbriteTicketClassToAtlas(tc, externalEventId, this.ticketDefaults ?? {}),
    );
  }

  private toAtlas(eb: import("./api.js").EventbriteEvent): AtlasEvent {
    const opts: MapEventOptions = { baseUrl: this.baseUrl };
    if (this.eventDefaults?.acceptedPaymentMethods) {
      opts.acceptedPaymentMethods = this.eventDefaults.acceptedPaymentMethods;
    }
    return eventbriteEventToAtlas(eb, opts);
  }
}

function requireOAuth(auth: AuthContext): string {
  if (auth.type !== "oauth2") {
    throw new AuthExpiredError(
      `Eventbrite connector requires oauth2 auth, received "${auth.type}"`,
    );
  }
  if (!auth.accessToken) {
    throw new AuthExpiredError("Eventbrite connector received an empty access token");
  }
  return auth.accessToken;
}

export {
  EventbriteApiClient,
  type EventbriteApiClientOptions,
  type EventbriteEvent,
  type EventbriteTicketClass,
  type EventbritePagedEvents,
  type EventbritePagedTicketClasses,
} from "./api.js";
export {
  eventbriteEventToAtlas,
  eventbriteTicketClassToAtlas,
  type MapEventOptions,
  type MapTicketTypeOptions,
} from "./mappers.js";
export {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  generateCodeChallenge,
  generateCodeVerifier,
  generatePkcePair,
  refreshAccessToken,
  type OAuthClientConfig,
  type OAuthTokenResponse,
  type PkcePair,
} from "./auth.js";
