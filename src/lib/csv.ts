// Robust RFC 4180 CSV parser. Handles:
// - UTF-8 BOM, CRLF / LF / CR line endings
// - quoted fields with embedded commas, quotes (doubled), and newlines
// - trailing empty fields
// Returns rows as string arrays. No dependency.

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export interface ParseResult {
  rows: string[][];
  // 1-based line number of each row (for error reporting). Data rows only.
  rowNumbers: number[];
  hasHeader: boolean;
}

export function parseCsv(input: string): { header: string[] | null; rows: string[][]; rowNumbers: number[] } {
  const text = stripBom(input);
  if (text.length === 0) return { header: null, rows: [], rowNumbers: [] };

  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;
  let startLine = 1;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    rowNumbers.push(startLine);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    switch (c) {
      case '"':
        inQuotes = true;
        i += 1;
        break;
      case ",":
        pushField();
        i += 1;
        break;
      case "\n":
        pushRow();
        line += 1;
        startLine = line;
        i += 1;
        // Skip a following CR (CRLF) — but only if it's not already consumed.
        if (text[i] === "\r") i += 1;
        break;
      case "\r":
        pushRow();
        line += 1;
        startLine = line;
        i += 1;
        if (text[i] === "\n") i += 1;
        break;
      default:
        field += c;
        i += 1;
    }
  }

  // Last row without trailing newline
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // Drop fully-empty rows (e.g. blank lines).
  const cleanRows: string[][] = [];
  const cleanLines: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0].trim() === "") continue;
    cleanRows.push(rows[r]);
    cleanLines.push(rowNumbers[r]);
  }

  const header = cleanRows.length > 0 ? cleanRows[0] : null;
  return { header, rows: cleanRows.slice(1), rowNumbers: cleanLines.slice(1) };
}

export function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

// Guess whether a header-like first row is actually a header (vs. data).
export function looksLikeHeader(cells: string[]): boolean {
  if (!cells || cells.length === 0) return false;
  const joined = cells.filter(Boolean).join(" ");
  return /\b(keyword|query|search volume|clicks|impressions|position|country|page)\b/i.test(joined);
}

// Normalize a header label for matching (lowercase, strip non-alphanumerics).
export function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isEmptyCell(v: string | undefined | null): boolean {
  return v === undefined || v === null || v.trim() === "";
}

// Parse a numeric cell. Returns null when unparseable/empty (never zero-invents).
export function parseNumber(v: string | undefined | null): number | null {
  if (isEmptyCell(v)) return null;
  const cleaned = (v as string).replace(/[,$%\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Parse an integer (used for counts/volumes). Returns null when not an integer.
export function parseInteger(v: string | undefined | null): number | null {
  const n = parseNumber(v);
  if (n === null) return null;
  const r = Math.round(n);
  return Math.abs(n - r) < 0.0001 ? r : null;
}

export function parseFloatCell(v: string | undefined | null): number | null {
  return parseNumber(v);
}
