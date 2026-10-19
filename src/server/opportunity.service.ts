import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString, fromJsonString } from "@/lib/json";
import { z } from "zod";

export class OpportunityServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityServiceError";
  }
}

const createSchema = z.object({
  title: z.string().min(1).max(500),
  keyword: z.string().max(500).optional().nullable(),
  bucketId: z.string().optional().nullable(),
  source: z.enum(["KEYWORD", "GSC", "TRENDS", "COMMUNITY", "MANUAL"]).optional().default("MANUAL"),
  searchIntent: z.string().max(50).optional().nullable(),
  commercialIntent: z.boolean().optional().default(false),
  seasonal: z.boolean().optional().default(false),
  existingPageOverlap: z.boolean().optional().default(false),
  notes: z.string().max(5000).optional().nullable(),
});

const scoreSchema = z.object({
  demandScore: z.number().int().min(0).max(5),
  demandJustification: z.string().min(1).max(4000),
  competitionScore: z.number().int().min(0).max(5),
  competitionJustification: z.string().min(1).max(4000),
  valueScore: z.number().int().min(0).max(5),
  valueJustification: z.string().min(1).max(4000),
  originalScore: z.number().int().min(0).max(5),
  originalJustification: z.string().min(1).max(4000),
  relevanceScore: z.number().int().min(0).max(5),
  relevanceJustification: z.string().min(1).max(4000),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidence: z.array(z.string()).optional().default([]),
  sources: z.array(z.string()).optional().default([]),
});

export type ScoreInput = z.infer<typeof scoreSchema>;

async function requireSite(websiteId: string) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new OpportunityServiceError("Website not found");
}

export async function createOpportunity(websiteId: string, input: unknown, userId: string) {
  await requireSite(websiteId);
  const data = createSchema.parse(input);
  const opp = await prisma.contentOpportunity.create({
    data: {
      websiteId,
      title: data.title.trim(),
      keyword: data.keyword ?? null,
      bucketId: data.bucketId ?? null,
      source: data.source ?? "MANUAL",
      searchIntent: data.searchIntent ?? null,
      commercialIntent: data.commercialIntent,
      seasonal: data.seasonal,
      existingPageOverlap: data.existingPageOverlap,
      notes: data.notes ?? null,
      status: "NEW",
    },
  });
  await auditLog({ userId, websiteId, action: "OPPORTUNITY_CREATED", entity: "ContentOpportunity", entityId: opp.id });
  return opp;
}

export async function createOpportunityFromKeyword(websiteId: string, keywordId: string, userId: string) {
  const rec = await prisma.keywordRecord.findFirst({ where: { id: keywordId, websiteId } });
  if (!rec) throw new OpportunityServiceError("Keyword not found");
  const existing = await prisma.contentOpportunity.findFirst({
    where: { websiteId, keyword: rec.keyword, source: "KEYWORD" },
  });
  if (existing) return existing;
  const opp = await prisma.contentOpportunity.create({
    data: {
      websiteId,
      title: rec.keyword,
      keyword: rec.keyword,
      bucketId: rec.bucketId,
      source: "KEYWORD",
      searchIntent: rec.searchIntent,
      status: "NEW",
    },
  });
  await auditLog({ userId, websiteId, action: "OPPORTUNITY_FROM_KEYWORD", entity: "ContentOpportunity", entityId: opp.id });
  return opp;
}

export async function getOpportunity(websiteId: string, opportunityId: string) {
  const opp = await prisma.contentOpportunity.findFirst({
    where: { id: opportunityId, websiteId },
    include: {
      score: true,
      drafts: { select: { id: true, title: true, status: true, slug: true }, orderBy: { createdAt: "asc" } },
      existingDraft: { select: { id: true, title: true, slug: true, status: true } },
    },
  });
  if (!opp) return null;
  // Resolve the live URL of the page this opportunity would update (or the
  // published draft in Article Studio), when a publication receipt exists.
  let existingUrl: string | null = null;
  const draftIds = [opp.existingDraftId, ...opp.drafts.map((d) => d.id)].filter(Boolean) as string[];
  if (draftIds.length > 0) {
    const receipt = await prisma.publicationReceipt.findFirst({
      where: { websiteId, draftId: { in: draftIds } },
      orderBy: { publishedAt: "desc" },
      select: { permalink: true },
    });
    existingUrl = receipt?.permalink ?? null;
  }
  return { ...opp, existingUrl };
}

export async function listOpportunities(websiteId: string, raw: unknown) {
  const q = z
    .object({
      search: z.string().max(200).optional(),
      status: z.string().max(50).optional(),
      reviewStatus: z.string().max(50).optional(),
      searchIntent: z.string().max(50).optional(),
      contentType: z.string().max(50).optional(),
      source: z.string().max(50).optional(),
      minScore: z.coerce.number().int().min(0).max(25).optional(),
      sort: z.enum(["createdAt", "total", "updatedAt", "title", "reviewStatus", "searchIntent", "source"]).optional().default("createdAt"),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
    })
    .parse(raw);

  const where: import("@prisma/client").Prisma.ContentOpportunityWhereInput = { websiteId };
  if (q.search) where.OR = [{ title: { contains: q.search } }, { keyword: { contains: q.search } }];
  if (q.status) where.status = q.status;
  if (q.reviewStatus) where.reviewStatus = q.reviewStatus;
  if (q.searchIntent) where.searchIntent = q.searchIntent;
  if (q.contentType) where.contentType = q.contentType;
  if (q.source) where.source = q.source;
  if (q.minScore !== undefined) where.score = { is: { total: { gte: q.minScore } } };

  const orderBy: import("@prisma/client").Prisma.ContentOpportunityOrderByWithRelationInput[] = [];
  if (q.sort === "total") orderBy.push({ score: { total: q.order } } as never);
  else orderBy.push({ [q.sort]: q.order } as never);

  const [total, items] = await Promise.all([
    prisma.contentOpportunity.count({ where }),
    prisma.contentOpportunity.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { score: true },
    }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) };
}

// Score (or override) an opportunity using the five-part framework.
// The first score is stored as the original; later submissions are treated as
// editor overrides with the original AI proposal preserved.
export async function scoreOpportunity(websiteId: string, opportunityId: string, raw: unknown, userId: string) {
  await requireSite(websiteId);
  const opp = await prisma.contentOpportunity.findFirst({ where: { id: opportunityId, websiteId } });
  if (!opp) throw new OpportunityServiceError("Opportunity not found");

  const data = scoreSchema.parse(raw);
  const total = data.demandScore + data.competitionScore + data.valueScore + data.originalScore + data.relevanceScore;

  const existing = await prisma.opportunityScore.findUnique({ where: { opportunityId } });
  const isOverride = Boolean(existing);
  let originalAiScore = existing?.originalAiScore ?? null;
  if (isOverride && !originalAiScore && existing) {
    originalAiScore = toJsonString({
      demandScore: existing.demandScore,
      demandJustification: existing.demandJustification,
      competitionScore: existing.competitionScore,
      competitionJustification: existing.competitionJustification,
      valueScore: existing.valueScore,
      valueJustification: existing.valueJustification,
      originalScore: existing.originalScore,
      originalJustification: existing.originalJustification,
      relevanceScore: existing.relevanceScore,
      relevanceJustification: existing.relevanceJustification,
      total: existing.total,
      confidence: existing.confidence,
    });
  }

  const score = await prisma.opportunityScore.upsert({
    where: { opportunityId },
    update: {
      demandScore: data.demandScore,
      demandJustification: data.demandJustification,
      competitionScore: data.competitionScore,
      competitionJustification: data.competitionJustification,
      valueScore: data.valueScore,
      valueJustification: data.valueJustification,
      originalScore: data.originalScore,
      originalJustification: data.originalJustification,
      relevanceScore: data.relevanceScore,
      relevanceJustification: data.relevanceJustification,
      total,
      confidence: data.confidence,
      evidence: toJsonString(data.evidence),
      sources: toJsonString(data.sources),
      isOverride,
      originalAiScore,
    },
    create: {
      opportunityId,
      demandScore: data.demandScore,
      demandJustification: data.demandJustification,
      competitionScore: data.competitionScore,
      competitionJustification: data.competitionJustification,
      valueScore: data.valueScore,
      valueJustification: data.valueJustification,
      originalScore: data.originalScore,
      originalJustification: data.originalJustification,
      relevanceScore: data.relevanceScore,
      relevanceJustification: data.relevanceJustification,
      total,
      confidence: data.confidence,
      evidence: toJsonString(data.evidence),
      sources: toJsonString(data.sources),
      isOverride: false,
    },
  });

  await prisma.contentOpportunity.update({
    where: { id: opportunityId },
    data: { status: "SCORED", recommendedAction: recommendedAction(total) },
  });

  await auditLog({ userId, websiteId, action: "OPPORTUNITY_SCORED", entity: "ContentOpportunity", entityId: opportunityId, detail: { total, isOverride } });
  return { score: { ...score, total }, isOverride, total };
}

// Configurable priority bands. Editorial guidance, not a ranking guarantee.
export function recommendedAction(total: number): string {
  if (total >= 20) return "PRIORITIZE";
  if (total >= 15) return "CONSIDER";
  if (total >= 10) return "LOW_PRIORITY";
  return "DEPRIORITIZE";
}

export function serializeScore(score: { evidence: string | null; sources: string | null; [k: string]: unknown } | null) {
  if (!score) return null;
  return {
    ...score,
    evidence: fromJsonString<string[]>(score.evidence, []),
    sources: fromJsonString<string[]>(score.sources, []),
    originalAiScore: score.originalAiScore ? fromJsonString<unknown>(score.originalAiScore as string, null) : null,
  };
}
