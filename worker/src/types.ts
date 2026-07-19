// The protocol. Every platform — API, semi-API, or scrape — implements `Source`.
// The pipeline only ever speaks `RawEvent` and `NormalizedEvent`; it never knows
// or cares where an event came from. Adding a platform = adding one Source.

export type Category =
  | 'music'
  | 'nightlife'
  | 'food'
  | 'art'
  | 'tech'
  | 'sports'
  | 'community'
  | 'family'
  | 'other';

/** A verbatim event from a source, before normalization. Stored in raw_events. */
export interface RawEvent {
  /** Stable id within the source (event id, or a hash of the URL for scrapes). */
  sourceId: string;
  /** Canonical link back to the source listing. */
  url?: string;
  /** The raw payload exactly as fetched (JSON object, scraped fields, etc.). */
  payload: unknown;
}

/** The shape every source must produce. No dedupe/db bookkeeping yet. */
export interface NormalizedEvent {
  title: string;
  description?: string;
  category: Category;
  /** ISO 8601. Always store an absolute instant; `tz` records the wall-clock zone. */
  startAt: string;
  endAt?: string;
  tz: string;
  venue?: string;
  address?: string;
  /** Some sources give coords directly; otherwise the geocoder fills these. */
  lat?: number;
  lng?: number;
  price?: { min: number; max?: number; free: boolean; currency: string };
  url?: string;
  image?: string;
}

export interface FetchContext {
  /** Bay Area bounding box / city list a source can use to scope its query. */
  region: { name: string; bbox: [number, number, number, number] };
  /** Soft cap so a single run can't fetch unbounded pages. */
  maxItems?: number;
  /** Source-specific secrets (API keys), injected from env. */
  secrets: Record<string, string | undefined>;
}

/** A connector for one platform. */
export interface Source {
  key: string;                 // 'luma' | 'eventbrite' | 'ticketmaster' | 'scrape:funcheap'
  name: string;
  kind: 'api' | 'semi-api' | 'scrape';
  /** Lower = more trusted when fields conflict during a merge. */
  trustRank: number;
  /** Pull raw events for the region. May page internally. */
  fetch(ctx: FetchContext): Promise<RawEvent[]>;
  /** Map one raw event into the normalized shape. Return null to drop it. */
  normalize(raw: RawEvent): NormalizedEvent | null;
}
