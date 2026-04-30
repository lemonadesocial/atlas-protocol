import type { AtlasEvent, AtlasTicketType } from '@atlas/server-sdk';

import type { AuthContext } from './auth.js';
import type { SearchParams } from './search.js';

/**
 * Capability descriptor advertised by a connector. Hosts use this to
 * decide whether to expose a given operation in their manifest and to
 * route requests intelligently when multiple connectors are installed.
 */
export interface ConnectorCapabilities {
  search: boolean;
  getEvent: boolean;
  listTicketTypes: boolean;
  realtime: boolean;
}

/**
 * The Connector contract. Every source-platform adapter (Eventbrite,
 * Lu.ma, Meetup, etc.) implements this shape and exports a single
 * instance. Connectors are deliberately stateless with respect to
 * credentials — auth is passed per call.
 */
export interface Connector {
  readonly id: string;
  readonly name: string;
  readonly authMethod: 'oauth2' | 'apikey';
  readonly capabilities: ConnectorCapabilities;
  search(params: SearchParams, auth: AuthContext): Promise<AtlasEvent[]>;
  getEvent(externalId: string, auth: AuthContext): Promise<AtlasEvent | null>;
  listTicketTypes(externalEventId: string, auth: AuthContext): Promise<AtlasTicketType[]>;
}

export type { AuthContext, SearchParams };
