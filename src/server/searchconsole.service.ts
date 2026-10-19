import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { parseCsv, isEmptyCell, parseInteger, parseFloatCell, looksLikeHeader } from "@/lib/csv";
import { detectGscColumns } from "@/lib/column-mapping";
import { recordSyncResult } from "@/server/sync-status.service";
import type { GscRecord } from "@/providers/types";
import { z } from "zod";

export class GscImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GscImportError";
  }
}

const gscOptionsSchema = z.object({
  fileName: z.string().max(255).optional().nullable(),
  hasHeader: z.boolean().optional(),
});

export interface GscOpportunity {
  query: string;
  page: string | null;
  type: "HIGH_IMPRESSIONS_LOW_CTR" | "NEAR_FIRST_PAGE" | "NEW_QUERY" | "CANNIBALIZATION";
  reason: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  position: number | null;
}

function parseGscDate(v: string | undefined | null): Date | null {
  if (isEmptyCell(v)) return null;
  const s = (v as string).trim();
  // Accept YYYY-MM-DD and YYYY-MM-DD - YYYY-MM-DD (GSC weekly ranges)
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

export interface GscPreview {
  header: string[] | null;
  detectedMapping: Record<string, number>;
  totalRows: number;
  sample: string[][];
  errors: { row: number; message: string }[];
}

export function previewGscCsv(fileContent: string): GscPreview {
  const { header, rows, rowNumbers } = parseCsv(fileContent);
  const effectiveHeader = header && looksLikeHeader(header) ? header : null;
  const errors: { row: number; message: string }[] = [];
  if (!effectiveHeader) {
    return { header: null, detectedMapping: {}, totalRows: 0, sample: [], errors: [{ row: 0, message: "No Search Console header row detected" }] };
  }
  const detected = detectGscColumns(effectiveHeader).fieldToIndex;
  const queryIdx = detected.query;
  rows.forEach((row, i) => {
    if (queryIdx === undefined) return;
    if (isEmptyCell(row[queryIdx])) errors.push({ row: rowNumbers[i], message: "Missing query" });
  });
  return { header: effectiveHeader, detectedMapping: detected, totalRows: rows.length, sample: rows.slice(0, 8), errors };
}

export async function importGscCsv(websiteId: string, fileContent: string, rawOpts: unknown, userId: string) {
  const parsed = gscOptionsSchema.safeParse(rawOpts);
  if (!parsed.success) throw new GscImportError(parsed.error.issues[0]?.message ?? "Invalid options");
  const opts = parsed.data;

  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new GscImportError("Website not found");

  const preview = previewGscCsv(fileContent);
  const { rows, rowNumbers } = parseCsv(fileContent);
  const mapping = preview.detectedMapping;

  const batch = await prisma.importBatch.create({
    data: {
      websiteId,
      source: "GSC",
      fileName: opts.fileName ?? null,
      totalRows: rows.length,
      importedRows: 0,
      skippedRows: 0,
      failedRows: 0,
      duplicatesSkipped: 0,
      status: "RUNNING",
    },
  });

  const createMany: import("@prisma/client").Prisma.SearchConsoleRecordCreateManyInput[] = [];
  const seen = new Set<string>();
  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  const failedRows: { row: number; message: string }[] = [];

  const get = (row: string[], f: string) => (mapping[f] === undefined ? undefined : row[mapping[f]]);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const line = rowNumbers[i];
    const query = get(row, "query")?.trim();
    if (!query) {
      failed++;
      failedRows.push({ row: line, message: "Missing query" });
      continue;
    }
    const page = get(row, "page") || null;
    const date = parseGscDate(get(row, "date"));
    const key = [query.toLowerCase(), page ?? "", date ? date.toISOString() : ""].join("|");
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    createMany.push({
      websiteId,
      importBatchId: batch.id,
      source: "CSV",
      query,
      page,
      clicks: parseInteger(get(row, "clicks")),
      impressions: parseInteger(get(row, "impressions")),
      ctr: parseFloatCell(get(row, "ctr")),
      position: parseFloatCell(get(row, "position")),
      date,
      country: get(row, "country") || null,
      device: get(row, "device") || null,
    });
    imported++;
  }

  if (createMany.length > 0) await prisma.searchConsoleRecord.createMany({ data: createMany });

  const batchDone = await prisma.importBatch.update({
    where: { id: batch.id },
    data: { importedRows: imported, skippedRows: duplicates + failed, failedRows: failed, duplicatesSkipped: duplicates, status: "COMPLETED" },
  });

  await auditLog({
    userId,
    websiteId,
    action: "GSC_IMPORT",
    entity: "ImportBatch",
    entityId: batch.id,
    detail: { fileName: opts.fileName, imported, duplicates, failed },
  });
  await recordSyncResult(websiteId, "GSC", { ok: true, count: imported });

  return { batch: batchDone, summary: { total: rows.length, imported, duplicatesSkipped: duplicates, failed, failedRows: failedRows.slice(0, 20) } };
}

// Persist records returned by a GSC provider (automated refresh path).
// Uses upsert semantics keyed by (query, page, date): rows already present
// for a website are refreshed with the latest metrics rather than duplicated,
// so repeated refreshes over an overlapping window do not grow unboundedly.
// Records an ImportBatch for provenance and marks the collection timestamp
// via createdAt. source distinguishes the transport ("API" vs "CSV");
// provider names the actual data source so provenance stays traceable.
export async function storeGscRecords(
  websiteId: string,
  records: GscRecord[],
  opts: { provider: string; source?: string; fileName?: string | null; userId?: string }
): Promise<{ imported: number; duplicates: number; failed: number }> {
  // Existing (query, page, date) tuples for this website, for refresh-merge.
  const existing = await prisma.searchConsoleRecord.findMany({
    where: { websiteId },
    select: { id: true, query: true, page: true, date: true },
  });
  const existingKeys = new Map<string, string>();
  for (const e of existing) {
    existingKeys.set(gscTupleKey(e.query, e.page ?? null, e.date), e.id);
  }

  const batch = await prisma.importBatch.create({
    data: {
      websiteId,
      source: "GSC",
      fileName:
        opts.fileName ?? `Automated refresh (${opts.provider})`,
      totalRows: records.length,
      importedRows: 0,
      skippedRows: 0,
      failedRows: 0,
      duplicatesSkipped: 0,
      status: "RUNNING",
    },
  });

  const createMany: import("@prisma/client").Prisma.SearchConsoleRecordCreateManyInput[] = [];
  const updateMany: { id: string; data: import("@prisma/client").Prisma.SearchConsoleRecordUpdateManyMutationInput }[] = [];
  const seen = new Set<string>();
  let imported = 0;
  let duplicates = 0;
  let failed = 0;

  for (const rec of records) {
    const query = rec.query?.trim();
    if (!query) {
      failed++;
      continue;
    }
    const page = rec.page || null;
    const date = rec.date ? parseGscDate(rec.date) : null;
    const key = gscTupleKey(query, page, date);
    const existingId = existingKeys.get(key);
    if (existingId) {
      // Refresh the previously collected values for this tuple.
      duplicates++;
      updateMany.push({
        id: existingId,
        data: {
          clicks: rec.clicks,
          impressions: rec.impressions,
          ctr: rec.ctr,
          position: rec.position,
          country: rec.country ?? null,
          device: rec.device ?? null,
        },
      });
      continue;
    }
    if (seen.has(key)) {
      duplicates++; // repeated row within the same provider response
      continue;
    }
    seen.add(key);
    createMany.push({
      websiteId,
      importBatchId: batch.id,
      source: opts.source ?? "API",
      query,
      page,
      clicks: rec.clicks,
      impressions: rec.impressions,
      ctr: rec.ctr,
      position: rec.position,
      date,
      country: rec.country ?? null,
      device: rec.device ?? null,
    });
    imported++;
  }

  if (createMany.length > 0) await prisma.searchConsoleRecord.createMany({ data: createMany });
  for (const u of updateMany) {
    await prisma.searchConsoleRecord.updateMany({ where: { id: u.id }, data: u.data });
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      importedRows: imported,
      skippedRows: duplicates + failed,
      failedRows: failed,
      duplicatesSkipped: duplicates,
      status: "COMPLETED",
    },
  });

  await auditLog({
    userId: opts.userId ?? null,
    websiteId,
    action: "GSC_REFRESH",
    entity: "ImportBatch",
    entityId: batch.id,
    detail: { provider: opts.provider, imported, duplicates, failed },
  });

  return { imported, duplicates, failed };
}

function gscTupleKey(query: string, page: string | null, date: Date | null): string {
  return [query.toLowerCase(), page ?? "", date ? date.toISOString() : ""].join("|");
}

// Derive opportunity candidates from stored GSC records. These are
// recommendations based on the data, not guaranteed ranking improvements.
export function deriveGscOpportunities(
  records: { query: string; page: string | null; clicks: number | null; impressions: number | null; ctr: number | null; position: number | null }[]
): GscOpportunity[] {
  const out: GscOpportunity[] = [];
  for (const r of records) {
    const reason = reasonFor(r);
    if (reason) out.push({ ...r, type: reason.type, reason: reason.reason });
  }

  // Cannibalization: same query mapping to multiple distinct pages.
  const byQuery = new Map<string, Set<string>>();
  for (const r of records) {
    if (!r.page) continue;
    if (!byQuery.has(r.query.toLowerCase())) byQuery.set(r.query.toLowerCase(), new Set());
    byQuery.get(r.query.toLowerCase())!.add(r.page);
  }
  for (const [q, pages] of byQuery) {
    if (pages.size > 1) {
      out.push({
        query: q,
        page: [...pages][0],
        type: "CANNIBALIZATION",
        reason: `Query "${q}" appears on ${pages.size} different pages`,
        impressions: null,
        clicks: null,
        ctr: null,
        position: null,
      });
    }
  }
  return out;
}

function reasonFor(r: { impressions: number | null; ctr: number | null; position: number | null; clicks: number | null; query: string }): GscOpportunity | null {
  if (r.impressions !== null && r.impressions >= 50 && r.ctr !== null && r.ctr < 0.02) {
    return {
      ...r,
      page: null,
      type: "HIGH_IMPRESSIONS_LOW_CTR",
      reason: `High impressions (${r.impressions}) with low CTR (${(r.ctr * 100).toFixed(1)}%) — consider improving the title/meta or intent match`,
    };
  }
  if (r.position !== null && r.position >= 8 && r.position <= 20) {
    return {
      ...r,
      page: null,
      type: "NEAR_FIRST_PAGE",
      reason: `Ranking near the first page (position ${r.position.toFixed(1)})`,
    };
  }
  if (r.impressions !== null && r.impressions > 0 && (r.clicks === null || r.clicks === 0)) {
    return {
      ...r,
      page: null,
      type: "NEW_QUERY",
      reason: `Query earns impressions (${r.impressions}) but zero clicks`,
    };
  }
  return null;
}
