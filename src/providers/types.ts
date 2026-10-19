// Provider adapter contracts. Providers are pluggable data sources for
// research search and Google Trends monitoring. Every provider returns an
// explicit ok/error result; none ever fabricate data.

export interface ResearchQuery {
  query: string;
  language?: string;
  country?: string;
  maxResults?: number;
  permittedDomains?: string[];
  excludedDomains?: string[];
}

export interface ResearchHit {
  url: string;
  title?: string;
  snippet?: string;
  sourceType?: string;
}

export type ResearchResponse =
  | { ok: true; hits: ResearchHit[] }
  | { ok: false; error: string };

export interface ResearchProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: string;
  search(q: ResearchQuery): Promise<ResearchResponse>;
}

export interface TrendsRequest {
  terms: string[];
  regions?: string[];
  timeRange?: string;
  category?: number;
  searchType?: string;
}

export interface TrendsPoint {
  term: string;
  region?: string;
  timeRange?: string;
  value: number; // relative index; never absolute volume
}

export type TrendsResponse =
  | { ok: true; points: TrendsPoint[]; provider: string }
  | { ok: false; error: string };

export interface TrendsProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: string;
  fetch(req: TrendsRequest): Promise<TrendsResponse>;
}

// ---------------------------------------------------------------------------
// Google Search Console provider (automated refresh path).
// CSV import remains the supported manual fallback (searchconsole.service).
// An API-based provider must use an authorized API, return honest null
// metrics for missing values, and never scrape. Credentials live server-side
// only (encrypted at rest like other secrets in this app).
// ---------------------------------------------------------------------------

export interface GscRequest {
  siteUrl?: string; // verified property URL, e.g. sc-domain:example.com
  // ISO dates (YYYY-MM-DD). Providers that only support a fixed range should
  // clamp to their supported window and report the range they actually used.
  startDate?: string;
  endDate?: string;
  rowLimit?: number;
}

export interface GscRecord {
  query: string;
  page?: string | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null; // 0..1 fraction
  position: number | null;
  date?: string | null; // YYYY-MM-DD (start of the reported range)
  country?: string | null;
  device?: string | null;
}

export type GscResponse =
  | { ok: true; records: GscRecord[]; provider: string }
  | { ok: false; error: string };

export interface GscProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: string;
  fetch(req: GscRequest): Promise<GscResponse>;
}

// ---------------------------------------------------------------------------
// Keyword data source provider (imports into keyword buckets).
// Implementations parse/validate/normalize one logical import; persistence
// and cross-import duplicate handling live in keyword-import.service.
// ---------------------------------------------------------------------------

export interface KeywordSourceRequest {
  bucketId?: string;
  // Inline content for providers that accept it (e.g. the CSV provider).
  content?: string;
  // Optional CSV parsing hints (hasHeader, explicit column mapping).
  hasHeader?: boolean;
  mapping?: Record<string, number>;
  // Provider-specific external reference (file name, planner id, ...).
  sourceRef?: string;
}

export interface KeywordDatum {
  keyword: string; // normalized (trimmed, single-spaced) but original case kept
  searchVolume?: number | null;
  cpc?: number | null; // dollars, converted to cents on persist
  difficulty?: number | null;
  searchIntent?: string | null;
  country?: string | null;
  language?: string | null;
  competition?: string | null;
  dateRange?: string | null;
  sourceUrl?: string | null;
  notes?: string | null;
}

export interface KeywordSourceIssue {
  row: number; // 1-based line number in the source
  message: string;
}

export type KeywordSourceResponse =
  | {
      ok: true;
      rows: KeywordDatum[];
      issues: KeywordSourceIssue[];
      totalRows: number;
      provider: string;
    }
  | { ok: false; error: string };

export interface KeywordSourceProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: string;
  fetchRows(req: KeywordSourceRequest): Promise<KeywordSourceResponse>;
}
