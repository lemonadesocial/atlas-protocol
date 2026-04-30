/**
 * Cross-platform search parameters accepted by `Connector.search()`.
 *
 * Every field is optional; connectors must degrade gracefully when their
 * underlying API does not support a given filter (e.g. no geographic
 * search). Pagination is opaque-cursor based: the connector returns events
 * and the host application owns cursor extraction via its own metadata.
 */
export interface SearchParams {
  query?: string;
  startDate?: Date;
  endDate?: Date;
  location?: { lat: number; lng: number; radiusKm: number };
  limit?: number;
  cursor?: string;
}
