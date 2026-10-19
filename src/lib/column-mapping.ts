import { normalizeHeader } from "@/lib/csv";

// Auto-detect which header columns map to application fields.
// Returns a map of app field -> column index (0-based) for the detected ones.

const KEYWORD_ALIASES: Record<string, string[]> = {
  keyword: ["keyword", "keyword phrase", "keyword topic", "keyword/topic", "search term", "searchterm", "topic", "query", "key phrase"],
  country: ["country", "region", "geo"],
  language: ["language", "lang"],
  searchVolume: ["search volume", "avg monthly searches", "average monthly searches", "monthly searches", "volume", "searches", "avg monthly search volume"],
  competition: ["competition", "google competition", "ad competition", "ads competition", "comp", "competition level"],
  cpc: ["cpc", "avg cpc", "average cpc", "cost per click"],
  difficulty: ["difficulty", "keyword difficulty", "organic difficulty", "seo difficulty", "kd"],
  dateRange: ["date range", "time range", "date"],
  source: ["source", "origin"],
  sourceUrl: ["source url", "url", "reference url", "link"],
  notes: ["notes", "note", "comment", "comments"],
  intent: ["search intent", "intent", "buying intent"],
};

const GSC_ALIASES: Record<string, string[]> = {
  query: ["query", "top queries", "search query", "keyword"],
  page: ["page", "url", "landing page", "top pages"],
  clicks: ["clicks", "click"],
  impressions: ["impressions", "impr"],
  ctr: ["ctr", "click through rate", "clickthrough rate"],
  position: ["position", "avg position", "average position", "avg. position"],
  date: ["date", "day", "week"],
  country: ["country"],
  device: ["device"],
};

export interface ColumnMap {
  // app field -> column index
  fieldToIndex: Record<string, number>;
  unknown: { header: string; index: number }[];
  headerCells: string[];
}

function detect(header: string[], aliases: Record<string, string[]>): ColumnMap {
  const normalized = header.map((h) => normalizeHeader(h));
  const fieldToIndex: Record<string, number> = {};
  const usedIndices = new Set<number>();

  for (const [field, candidates] of Object.entries(aliases)) {
    for (let idx = 0; idx < normalized.length; idx++) {
      if (usedIndices.has(idx)) continue;
      if (candidates.includes(normalized[idx])) {
        fieldToIndex[field] = idx;
        usedIndices.add(idx);
        break;
      }
    }
  }

  const unknown: { header: string; index: number }[] = [];
  for (let idx = 0; idx < header.length; idx++) {
    if (!usedIndices.has(idx)) {
      unknown.push({ header: header[idx], index: idx });
    }
  }

  return { fieldToIndex, unknown, headerCells: header };
}

export function detectKeywordColumns(header: string[]): ColumnMap {
  return detect(header, KEYWORD_ALIASES);
}

export function detectGscColumns(header: string[]): ColumnMap {
  return detect(header, GSC_ALIASES);
}

export const KEYWORD_FIELDS = Object.keys(KEYWORD_ALIASES);
export const GSC_FIELDS = Object.keys(GSC_ALIASES);
