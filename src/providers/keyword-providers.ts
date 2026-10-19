import type {
  KeywordSourceProvider,
  KeywordSourceRequest,
  KeywordSourceResponse,
  KeywordDatum,
} from "@/providers/types";
import { parseCsv, isEmptyCell, looksLikeHeader, parseInteger, parseNumber } from "@/lib/csv";
import { detectKeywordColumns } from "@/lib/column-mapping";

// Keyword data source registry.
//
// Implementations turn an external keyword source (CSV file, future API
// keyword tools, competitor exports, ...) into normalized KeywordDatum rows.
// Persistence, cross-import duplicate handling and audit live in
// keyword-import.service (storeKeywordRows), so providers stay replaceable.

class UnavailableKeywordProvider implements KeywordSourceProvider {
  readonly id = "unavailable";
  readonly name = "No automated keyword source";
  readonly capabilities =
    "No automated keyword/API provider is configured. Keyword data is imported " +
    "on demand, normally from CSV files into keyword buckets (Imports -> Keywords).";

  async fetchRows(): Promise<KeywordSourceResponse> {
    return {
      ok: false,
      error: "No reliable automated keyword data provider is configured. Import keyword data manually via CSV.",
    };
  }
}

// Normalize a query/term the same way the keyword importer does: trim,
// collapse inner whitespace, keep original case for display (duplicate
// detection additionally lowercases).
export function normalizeKeywordTerm(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

// Pull one keyword record out of a CSV row using the detected mapping.
// Never fabricates metrics: unparseable/empty cells become null.
function extractRow(row: string[], mapping: Record<string, number>): KeywordDatum {
  const get = (field: string): string | undefined => {
    const idx = mapping[field];
    return idx === undefined ? undefined : row[idx];
  };
  return {
    keyword: get("keyword")?.trim() ?? "",
    searchVolume: parseInteger(get("searchVolume")),
    cpc: parseNumber(get("cpc")),
    difficulty: parseInteger(get("difficulty")),
    searchIntent: get("intent") || null,
    country: get("country") || null,
    language: get("language") || null,
    competition: get("competition") || null,
    dateRange: get("dateRange") || null,
    sourceUrl: get("sourceUrl") || null,
    notes: get("notes") || null,
  };
}

// CSV provider: parses, validates and normalizes keyword rows from inline
// CSV content. This is a pure function of the input; it performs no IO and
// holds no state, which keeps it trivially replaceable by an API provider.
class CsvKeywordProvider implements KeywordSourceProvider {
  readonly id = "csv";
  readonly name = "CSV file import";
  readonly capabilities =
    "Parses CSV files (header detection or explicit column mapping), validates " +
    "rows, normalizes queries and reports invalid rows. Metrics are only kept " +
    "when they parse; missing/unparseable cells stay null (never zero-invented).";

  async fetchRows(req: KeywordSourceRequest): Promise<KeywordSourceResponse> {
    const { header, rows, rowNumbers } = parseCsv(req.content ?? "");
    const effectiveHeader =
      req.hasHeader !== false && header && looksLikeHeader(header) ? header : null;

    let mapping: Record<string, number> = {};
    if (req.mapping) {
      mapping = req.mapping;
    } else if (effectiveHeader) {
      mapping = detectKeywordColumns(effectiveHeader).fieldToIndex;
    }

    if (mapping.keyword === undefined) {
      return {
        ok: false,
        error:
          !effectiveHeader && !req.mapping
            ? "No header row detected and no column mapping provided"
            : "No keyword column mapped",
      };
    }

    const issues: { row: number; message: string }[] = [];
    const out: KeywordDatum[] = [];
    for (let i = 0; i < rows.length; i++) {
      const rec = extractRow(rows[i], mapping);
      if (!rec.keyword || rec.keyword === "") {
        issues.push({ row: rowNumbers[i], message: "Missing keyword" });
        continue;
      }
      out.push({ ...rec, keyword: normalizeKeywordTerm(rec.keyword) });
    }
    return { ok: true, rows: out, issues, totalRows: rows.length, provider: this.id };
  }
}

const registry = new Map<string, KeywordSourceProvider>();
register(new UnavailableKeywordProvider());
register(new CsvKeywordProvider());

export function register(provider: KeywordSourceProvider): void {
  registry.set(provider.id, provider);
}

export function getKeywordProvider(id?: string | null): KeywordSourceProvider {
  return registry.get(id ?? "") ?? registry.get("unavailable")!;
}

export function listKeywordProviders(): KeywordSourceProvider[] {
  return [...registry.values()];
}