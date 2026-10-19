import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { parseCsv, looksLikeHeader, isEmptyCell, parseInteger, parseNumber } from "@/lib/csv";
import { detectKeywordColumns, type ColumnMap } from "@/lib/column-mapping";
import { getKeywordProvider } from "@/providers/keyword-providers";
import type { KeywordDatum, KeywordSourceIssue } from "@/providers/types";
import { recordSyncResult } from "@/server/sync-status.service";
import { z } from "zod";

export class KeywordImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeywordImportError";
  }
}

const importOptionsSchema = z.object({
  bucketId: z.string().min(1),
  fileName: z.string().max(255).optional().nullable(),
  source: z.string().max(50).optional().default("CSV"),
  hasHeader: z.boolean().optional(),
  // explicit mapping: app field -> column index. Optional; auto-detect when absent.
  mapping: z.record(z.number()).optional(),
  duplicatePolicy: z.enum(["SKIP", "MERGE"]).optional().default("SKIP"),
});

export type ImportOptions = z.infer<typeof importOptionsSchema>;

export interface KeywordPreview {
  header: string[] | null;
  detectedMapping: Record<string, number>;
  unknownColumns: { header: string; index: number }[];
  totalRows: number;
  sample: string[][];
  errors: { row: number; message: string }[];
}

function normalizeKeyword(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function previewKeywordCsv(fileContent: string, opts: { hasHeader?: boolean; mapping?: Record<string, number> }): KeywordPreview {
  const { header, rows, rowNumbers } = parseCsv(fileContent);
  const effectiveHeader = opts.hasHeader !== false && header && looksLikeHeader(header) ? header : null;

  let mapping: Record<string, number> = {};
  let unknownColumns: { header: string; index: number }[] = [];
  if (opts.mapping) {
    mapping = opts.mapping;
    if (effectiveHeader) {
      const used = new Set(Object.values(mapping));
      unknownColumns = (effectiveHeader as string[]).map((h, i) => ({ header: h, index: i })).filter((c) => !used.has(c.index));
    }
  } else if (effectiveHeader) {
    const detected: ColumnMap = detectKeywordColumns(effectiveHeader);
    mapping = detected.fieldToIndex;
    unknownColumns = detected.unknown;
  }

  // Validate mapping targets exist.
  const errors: { row: number; message: string }[] = [];
  let dataRows = rows;
  if (!effectiveHeader && !opts.mapping) {
    // No usable header and no explicit mapping: cannot import.
    return { header: null, detectedMapping: {}, unknownColumns: [], totalRows: 0, sample: [], errors: [{ row: 0, message: "No header row detected and no column mapping provided" }] };
  }
  if (!effectiveHeader && opts.mapping) {
    // Treat row 0 as data too.
    dataRows = rows;
  }

  const keywordIdx = mapping.keyword;
  dataRows.forEach((row, i) => {
    const line = effectiveHeader ? rowNumbers[i] : (rowNumbers[i] ?? i + 1);
    if (keywordIdx === undefined) return;
    const kw = row[keywordIdx];
    if (isEmptyCell(kw)) {
      errors.push({ row: line, message: "Missing keyword in required column" });
    }
  });

  return {
    header: effectiveHeader,
    detectedMapping: mapping,
    unknownColumns,
    totalRows: dataRows.length,
    sample: dataRows.slice(0, 8),
    errors,
  };
}

// ---------------------------------------------------------------------------
// Persistence of validated keyword rows (shared by CSV import and any future
// keyword provider). Duplicate handling (SKIP vs MERGE) and the ImportBatch
// record live here; providers only parse/validate/normalize.
// ---------------------------------------------------------------------------

export async function storeKeywordRows(
  websiteId: string,
  bucketId: string,
  rows: KeywordDatum[],
  issues: KeywordSourceIssue[],
  opts: {
    source: string;
    fileName?: string | null;
    duplicatePolicy: "SKIP" | "MERGE";
    userId: string;
    totalRows: number;
  }
): Promise<{
  batch: {
    id: string;
    status: string;
    totalRows: number;
    importedRows: number;
    skippedRows: number;
    failedRows: number;
    duplicatesSkipped: number;
    error: string | null;
  };
  summary: {
    total: number;
    imported: number;
    duplicatesSkipped: number;
    failed: number;
    failedRows: { row: number; message: string }[];
  };
}> {
  // Load existing keywords in this bucket for duplicate detection (by id).
  const existing = await prisma.keywordRecord.findMany({
    where: { websiteId, bucketId },
    select: { keyword: true, id: true },
  });
  const existingIds = new Map<string, string>();
  for (const e of existing) existingIds.set(normalizeKeyword(e.keyword), e.id);

  let imported = 0;
  let duplicates = 0;
  const failedRows: { row: number; message: string }[] = (issues ?? []).slice();
  const failed = failedRows.length;

  const batch = await prisma.importBatch.create({
    data: {
      websiteId,
      bucketId,
      source: opts.source ?? "CSV",
      fileName: opts.fileName ?? null,
      totalRows: opts.totalRows,
      importedRows: 0,
      skippedRows: 0,
      failedRows: 0,
      duplicatesSkipped: 0,
      status: "RUNNING",
    },
  });

  try {
    const createMany: import("@prisma/client").Prisma.KeywordRecordCreateManyInput[] = [];
    const seenInImport = new Set<string>();

    for (const rec of rows) {
      const norm = normalizeKeyword(rec.keyword);
      if (existingIds.has(norm) || seenInImport.has(norm)) {
        if (opts.duplicatePolicy === "MERGE") {
          // Merge: update the existing record if this row adds metrics.
          const targetId = existingIds.get(norm);
          if (targetId) {
            await prisma.keywordRecord.updateMany({
              where: { id: targetId },
              data: {
                searchVolume: rec.searchVolume ?? undefined,
                competition: rec.competition ?? undefined,
                cpcCents: rec.cpc === null || rec.cpc === undefined ? undefined : Math.round(rec.cpc * 100),
                difficulty: rec.difficulty ?? undefined,
                searchIntent: rec.searchIntent ?? undefined,
                country: rec.country ?? undefined,
                language: rec.language ?? undefined,
                sourceUrl: rec.sourceUrl ?? undefined,
                notes: rec.notes ?? undefined,
                source: opts.source,
              },
            });
            imported++;
          } else {
            duplicates++;
          }
        } else {
          duplicates++;
        }
        continue;
      }
      seenInImport.add(norm);
      createMany.push({
        websiteId,
        bucketId,
        importBatchId: batch.id,
        source: opts.source ?? "CSV",
        keyword: rec.keyword,
        searchIntent: rec.searchIntent,
        country: rec.country,
        language: rec.language,
        searchVolume: rec.searchVolume,
        competition: rec.competition,
        cpcCents: rec.cpc === null || rec.cpc === undefined ? null : Math.round(rec.cpc * 100),
        difficulty: rec.difficulty,
        dateRange: rec.dateRange,
        sourceUrl: rec.sourceUrl,
        notes: rec.notes,
      });
      imported++;
    }

    if (createMany.length > 0) {
      await prisma.keywordRecord.createMany({ data: createMany });
    }

    const skipped = duplicates + failed;
    const batchDone = await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        importedRows: imported,
        skippedRows: skipped,
        failedRows: failed,
        duplicatesSkipped: duplicates,
        status: "COMPLETED",
      },
    });

    await auditLog({
      userId: opts.userId,
      websiteId,
      action: "KEYWORD_IMPORT",
      entity: "ImportBatch",
      entityId: batch.id,
      detail: { fileName: opts.fileName, imported, duplicates, failed },
    });
    await recordSyncResult(websiteId, "KEYWORDS", { ok: true, count: imported });

    return {
      batch: batchDone,
      summary: {
        total: opts.totalRows,
        imported,
        duplicatesSkipped: duplicates,
        failed,
        failedRows: failedRows.slice(0, 20),
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await prisma.importBatch
      .update({ where: { id: batch.id }, data: { status: "FAILED", error: message } })
      .catch(() => undefined);
    await recordSyncResult(websiteId, "KEYWORDS", { ok: false, error: message }).catch(() => undefined);
    throw e;
  }
}

export async function importKeywordCsv(websiteId: string, fileContent: string, rawOpts: unknown, userId: string) {
  const parsed = importOptionsSchema.safeParse(rawOpts);
  if (!parsed.success) throw new KeywordImportError(parsed.error.issues[0]?.message ?? "Invalid import options");
  const opts = parsed.data;

  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new KeywordImportError("Website not found");
  const bucket = await prisma.keywordBucket.findFirst({ where: { id: opts.bucketId, websiteId } });
  if (!bucket) throw new KeywordImportError("Bucket not found");

  // Parsing/validation/normalization is delegated to the registered keyword
  // provider ("csv" by default) so the ingest path is provider-replaceable.
  const provider = getKeywordProvider("csv");
  const res = await provider.fetchRows({
    content: fileContent,
    hasHeader: opts.hasHeader,
    mapping: opts.mapping,
    bucketId: opts.bucketId,
    sourceRef: opts.fileName ?? undefined,
  });
  if (!res.ok) throw new KeywordImportError(res.error);

  return storeKeywordRows(websiteId, opts.bucketId, res.rows, res.issues, {
    source: opts.source ?? "CSV",
    fileName: opts.fileName ?? null,
    duplicatePolicy: opts.duplicatePolicy ?? "SKIP",
    userId,
    totalRows: res.totalRows,
  });
}