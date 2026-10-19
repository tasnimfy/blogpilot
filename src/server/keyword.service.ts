import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { z } from "zod";

export class KeywordServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeywordServiceError";
  }
}

const listSchema = z.object({
  bucketId: z.string().optional(),
  search: z.string().max(200).optional(),
  searchIntent: z.string().max(50).optional(),
  researchStatus: z.string().max(50).optional(),
  sort: z.string().max(50).optional(),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const SORTABLE = new Set(["keyword", "searchVolume", "difficulty", "opportunityScore", "createdAt", "competition", "cpc"]);

export async function listKeywords(websiteId: string, raw: unknown) {
  const q = listSchema.parse(raw);
  const where: import("@prisma/client").Prisma.KeywordRecordWhereInput = { websiteId };
  if (q.bucketId) where.bucketId = q.bucketId;
  if (q.search) where.keyword = { contains: q.search };
  if (q.searchIntent) where.searchIntent = q.searchIntent;
  if (q.researchStatus) where.researchStatus = q.researchStatus;

  const orderBy: import("@prisma/client").Prisma.KeywordRecordOrderByWithRelationInput[] = [];
  if (q.sort && SORTABLE.has(q.sort)) {
    orderBy.push({ [q.sort]: q.order } as never);
  } else {
    orderBy.push({ createdAt: "desc" });
  }

  const [total, records] = await Promise.all([
    prisma.keywordRecord.count({ where }),
    prisma.keywordRecord.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { bucket: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    records,
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.ceil(total / q.pageSize),
  };
}

export async function deleteKeyword(websiteId: string, keywordId: string, userId: string) {  const rec = await prisma.keywordRecord.findFirst({ where: { id: keywordId, websiteId } });
  if (!rec) throw new KeywordServiceError("Keyword not found");
  await prisma.keywordRecord.delete({ where: { id: keywordId } });
  await auditLog({ userId, websiteId, action: "KEYWORD_DELETED", entity: "KeywordRecord", entityId: keywordId });
}

export async function updateKeyword(websiteId: string, keywordId: string, input: unknown, userId: string) {
  const rec = await prisma.keywordRecord.findFirst({ where: { id: keywordId, websiteId } });
  if (!rec) throw new KeywordServiceError("Keyword not found");
  const schema = z.object({
    keyword: z.string().min(1).max(500).optional(),
    searchIntent: z.string().max(50).optional().nullable(),
    country: z.string().max(100).optional().nullable(),
    language: z.string().max(20).optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
    researchStatus: z.string().max(50).optional(),
    searchVolume: z.number().int().min(0).optional().nullable(),
    competition: z.string().max(50).optional().nullable(),
    difficulty: z.number().int().min(0).optional().nullable(),
  });
  const data = schema.parse(input);
  const payload: Record<string, unknown> = {};
  for (const k of Object.keys(data) as (keyof typeof data)[]) {
    if (data[k] !== undefined) payload[k] = data[k] ?? null;
  }
  const updated = await prisma.keywordRecord.update({ where: { id: keywordId }, data: payload });
  await auditLog({ userId, websiteId, action: "KEYWORD_UPDATED", entity: "KeywordRecord", entityId: keywordId });
  return updated;
}

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["DELETE", "SET_RESEARCH_STATUS", "MOVE"]),
  researchStatus: z.string().optional(),
  targetBucketId: z.string().optional(),
});

export async function bulkAction(websiteId: string, raw: unknown, userId: string) {
  const q = bulkSchema.parse(raw);
  const ids = q.ids;
  const own = await prisma.keywordRecord.findMany({ where: { id: { in: ids }, websiteId }, select: { id: true } });
  if (own.length === 0) throw new KeywordServiceError("No matching keywords found");
  const ownIds = own.map((o) => o.id);

  if (q.action === "DELETE") {
    await prisma.keywordRecord.deleteMany({ where: { id: { in: ownIds } } });
    await auditLog({ userId, websiteId, action: "KEYWORDS_BULK_DELETE", entity: "KeywordRecord", detail: { count: ownIds.length } });
    return { count: ownIds.length };
  }

  if (q.action === "SET_RESEARCH_STATUS") {
    if (!q.researchStatus) throw new KeywordServiceError("researchStatus required");
    await prisma.keywordRecord.updateMany({ where: { id: { in: ownIds } }, data: { researchStatus: q.researchStatus } });
    return { count: ownIds.length };
  }

  // MOVE
  if (!q.targetBucketId) throw new KeywordServiceError("targetBucketId required");
  const target = await prisma.keywordBucket.findFirst({ where: { id: q.targetBucketId, websiteId } });
  if (!target) throw new KeywordServiceError("Target bucket not found");
  await prisma.keywordRecord.updateMany({ where: { id: { in: ownIds } }, data: { bucketId: target.id } });
  await auditLog({ userId, websiteId, action: "KEYWORDS_MOVE", entity: "KeywordRecord", detail: { count: ownIds.length, to: target.id } });
  return { count: ownIds.length, targetBucketId: target.id };
}

export async function mergeKeywords(websiteId: string, keepId: string, mergeIds: string[], userId: string) {
  if (mergeIds.includes(keepId)) throw new KeywordServiceError("Cannot merge a keyword into itself");
  const keep = await prisma.keywordRecord.findFirst({ where: { id: keepId, websiteId } });
  if (!keep) throw new KeywordServiceError("Keep keyword not found");
  const merge = await prisma.keywordRecord.findMany({ where: { id: { in: mergeIds }, websiteId } });
  if (merge.length !== mergeIds.length) throw new KeywordServiceError("One or more merge keywords not found");

  // Merge: fill gaps in the kept record with data from the merged records.
  type Rec = {
    searchVolume: number | null;
    competition: string | null;
    difficulty: number | null;
    cpcCents: number | null;
    searchIntent: string | null;
    country: string | null;
    language: string | null;
    sourceUrl: string | null;
    notes: string | null;
  };
  const srcs: Rec[] = [keep, ...merge];
  const best = (pick: (r: Rec) => number | string | null | undefined) =>
    srcs.map(pick).find((v) => v !== null && v !== undefined && v !== "");

  const data: Record<string, unknown> = {
    searchVolume: best((r) => r.searchVolume) ?? null,
    competition: best((r) => r.competition) ?? null,
    difficulty: best((r) => r.difficulty) ?? null,
    cpcCents: best((r) => r.cpcCents) ?? null,
    searchIntent: best((r) => r.searchIntent) ?? null,
    country: best((r) => r.country) ?? null,
    language: best((r) => r.language) ?? null,
    sourceUrl: best((r) => r.sourceUrl) ?? null,
    notes: best((r) => r.notes) ?? null,
  };

  await prisma.$transaction([
    prisma.keywordRecord.update({ where: { id: keepId }, data }),
    prisma.keywordRecord.deleteMany({ where: { id: { in: mergeIds } } }),
  ]);
  await auditLog({ userId, websiteId, action: "KEYWORDS_MERGED", entity: "KeywordRecord", entityId: keepId, detail: { merged: mergeIds.length } });
  return prisma.keywordRecord.findUnique({ where: { id: keepId } });
}

export async function createKeyword(websiteId: string, input: unknown, userId: string) {
  const schema = z.object({
    keyword: z.string().min(1).max(500),
    bucketId: z.string().min(1),
    searchIntent: z.string().max(50).optional().nullable(),
    country: z.string().max(100).optional().nullable(),
    language: z.string().max(20).optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
    source: z.string().max(50).optional().default("MANUAL"),
    searchVolume: z.number().int().min(0).optional().nullable(),
    competition: z.string().max(50).optional().nullable(),
    difficulty: z.number().int().min(0).optional().nullable(),
    cpcCents: z.number().int().min(0).optional().nullable(),
    sourceUrl: z.string().max(2000).optional().nullable(),
  });
  const data = schema.parse(input);
  const bucket = await prisma.keywordBucket.findFirst({ where: { id: data.bucketId, websiteId } });
  if (!bucket) throw new KeywordServiceError("Bucket not found");
  const rec = await prisma.keywordRecord.create({
    data: {
      websiteId,
      bucketId: data.bucketId,
      keyword: data.keyword.trim(),
      searchIntent: data.searchIntent ?? null,
      country: data.country ?? null,
      language: data.language ?? null,
      notes: data.notes ?? null,
      source: data.source ?? "MANUAL",
      searchVolume: data.searchVolume ?? null,
      competition: data.competition ?? null,
      difficulty: data.difficulty ?? null,
      cpcCents: data.cpcCents ?? null,
      sourceUrl: data.sourceUrl ?? null,
    },
  });
  await auditLog({ userId, websiteId, action: "KEYWORD_CREATED", entity: "KeywordRecord", entityId: rec.id });
  return rec;
}
