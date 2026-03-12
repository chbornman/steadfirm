import type { ServiceName } from '../constants';

/** Request body for POST /api/v1/search. */
export interface SearchRequest {
  query: string;
  services?: ServiceName[];
  limit?: number;
}

/** A single normalized search result from any service. */
export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  /** Route path to navigate to this item in the UI. */
  route: string;
}

/** Results from a single service (one SSE "results" event). */
export interface ServiceSearchResult {
  service: ServiceName;
  items: SearchResultItem[];
  total: number;
}

/** Error info for a service that failed during search. */
export interface ServiceSearchError {
  service: ServiceName;
  error: string;
}

/** Final SSE "done" event payload. */
export interface SearchComplete {
  totalResults: number;
  durationMs: number;
  servicesQueried: ServiceName[];
  servicesFailed: ServiceSearchError[];
}
