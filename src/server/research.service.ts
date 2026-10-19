import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString, fromJsonString } from "@/lib/json";
import { getResearchProvider } from "@/providers/research-providers";
import { z } from "zod";

export class ResearchServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchServiceError";
  }
}

export const FINDING_CATEGORIES = [
  "VERIFIED_FACT",
  "FIRST_HAND",
  "OPINION",
  "THEME",
  "DISAGREEMENT",
  "EXPERT",
  "INFERENCE",
  "UNVERIFIED",
] as const;

const runSchema = z.object({
  opportunityId: z.string().optional().nullable(),
  topic: z.string().min(1).max(500),
  title: z.string().max(500).optional().nullable(),
});

const sourceSchema = z.object({
  url: z.string().url("Enter a valid URL"),
  title: z.string().max(500).optional().nullable(),
  sourceType: z.string().max(50).optional().nullable(),
  excerpt: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  findings: z
    .array(
      z.object({
        category: z.enum(FINDING_CATEGORIES),
        claim: z.string().min(1).max(2000),
        evidence: z.string().max(2000).optional().nullable(),
      })
    )
    .optional()
    .default([]),
});

const findingSchema = z.object({
  sourceId: z.string().optional().nullable(),
  category: z.enum(FINDING_CATEGORIES),
  claim: z.string().min(1).max(2000),
  evidence: z.string().max(2000).optional().nullable(),
});

function generateQuestions(topic: string): string[] {
  return [
    `What are the most common questions readers ask about "${topic}"?`,
    `What first-hand experiences do people share about "${topic}"?`,
    `Which claims about "${topic}" require verification against primary sources?`,
    `What are the main disagreements or conflicting viewpoints on "${topic}"?`,
    `What practical tips, costs, or logistics matter most to someone researching "${topic}"?`,
    `Which official or expert sources provide authoritative guidance on "${topic}"?`,
  ];
}

export async function runResearch(websiteId: string, raw: unknown, userId: string) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new ResearchServiceError("Website not found");
  const data = runSchema.parse(raw);
  if (data.opportunityId) {
    const opp = await prisma.contentOpportunity.findFirst({ where: { id: data.opportunityId, websiteId } });
    if (!opp) throw new ResearchServiceError("Opportunity not found");
  }

  const questions = generateQuestions(data.topic);

  const job = await prisma.researchJob.create({
    data: {
      websiteId,
      opportunityId: data.opportunityId ?? null,
      questions: toJsonString(questions),
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  // Attempt the configured research provider. The default manual provider
  // reports unavailability honestly; the job records that limitation.
  const provider = getResearchProvider();
  const providerError: string[] = [];
  const res = await provider.search({ query: data.topic });
  if (!res.ok) providerError.push(res.error);

  await prisma.researchJob.update({
    where: { id: job.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      error: providerError.length > 0 ? providerError.join(" ") : null,
    },
  });

  await auditLog({ userId, websiteId, action: "RESEARCH_RUN", entity: "ResearchJob", entityId: job.id });
  return getResearchJob(job.id);
}

export async function addResearchSource(websiteId: string, jobId: string, raw: unknown, userId: string) {
  const job = await prisma.researchJob.findFirst({ where: { id: jobId, websiteId } });
  if (!job) throw new ResearchServiceError("Research job not found");
  const data = sourceSchema.parse(raw);

  const source = await prisma.researchSource.create({
    data: {
      websiteId,
      researchJobId: job.id,
      url: data.url.trim(),
      title: data.title ?? null,
      sourceType: data.sourceType ?? null,
      excerpt: data.excerpt ?? null,
      notes: data.notes ?? null,
      findings: {
        create: data.findings.map((f) => ({
          websiteId,
          researchJobId: job.id,
          category: f.category,
          claim: f.claim,
          evidence: f.evidence ?? null,
        })),
      },
    },
    include: { findings: true },
  });

  // Recompute the brief after adding a source.
  await buildResearchBrief(job.id);
  await auditLog({ userId, websiteId, action: "RESEARCH_SOURCE_ADDED", entity: "ResearchSource", entityId: source.id });
  return source;
}

export async function addResearchFinding(websiteId: string, jobId: string, raw: unknown, userId: string) {
  const job = await prisma.researchJob.findFirst({ where: { id: jobId, websiteId } });
  if (!job) throw new ResearchServiceError("Research job not found");
  const data = findingSchema.parse(raw);
  if (data.sourceId) {
    const src = await prisma.researchSource.findFirst({ where: { id: data.sourceId, websiteId } });
    if (!src) throw new ResearchServiceError("Source not found");
  }
  const finding = await prisma.researchFinding.create({
    data: {
      websiteId,
      researchJobId: job.id,
      sourceId: data.sourceId ?? null,
      category: data.category,
      claim: data.claim,
      evidence: data.evidence ?? null,
    },
  });
  await buildResearchBrief(job.id);
  await auditLog({ userId, websiteId, action: "RESEARCH_FINDING_ADDED", entity: "ResearchFinding", entityId: finding.id });
  return finding;
}

export async function deleteResearchSource(websiteId: string, sourceId: string, userId: string) {
  const src = await prisma.researchSource.findFirst({ where: { id: sourceId, websiteId } });
  if (!src) throw new ResearchServiceError("Source not found");
  await prisma.researchSource.delete({ where: { id: sourceId } });
  if (src.researchJobId) await buildResearchBrief(src.researchJobId);
  await auditLog({ userId, websiteId, action: "RESEARCH_SOURCE_DELETED", entity: "ResearchSource", entityId: sourceId });
}

export async function getResearchJob(jobId: string) {
  return prisma.researchJob.findUnique({
    where: { id: jobId },
    include: { sources: { include: { findings: true } }, opportunity: { select: { id: true, title: true } } },
  });
}

export async function listResearchJobs(websiteId: string, opportunityId?: string) {
  return prisma.researchJob.findMany({
    where: { websiteId, opportunityId: opportunityId ?? undefined },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export interface ResearchBrief {
  topic: string;
  providerLimitation: string | null;
  questionCount: number;
  independentSourceCount: number;
  findings: { category: string; claim: string; evidence: string | null; source: string | null }[];
  themes: string[];
  disagreements: string[];
  missingEvidence: string[];
  generatedAt: string;
}

// Build a structured, evidence-based research brief from the job's sources and
// findings. Never fabricates; only aggregates what was actually recorded.
export async function buildResearchBrief(jobId: string): Promise<ResearchBrief> {
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId },
    include: { sources: { include: { findings: true } }, opportunity: { select: { id: true, title: true } } },
  });
  if (!job) throw new ResearchServiceError("Research job not found");

  // Aggregate findings attached to sources AND standalone job-level findings.
  const jobFindings = await prisma.researchFinding.findMany({
    where: { researchJobId: job.id },
    include: { source: { select: { url: true } } },
  });
  const allFindings = jobFindings.map((f) => ({
    category: f.category,
    claim: f.claim,
    evidence: f.evidence,
    source: f.source?.url ?? null,
  }));

  const topic =
    job.opportunity?.title ??
    (fromJsonString<string[]>(job.questions, [])[0]?.replace(/^What are the most common questions readers ask about "/, "").replace(/"\?$/, "") ??
      "research");

  const brief: ResearchBrief = {
    topic,
    providerLimitation: job.error,
    questionCount: fromJsonString<string[]>(job.questions, []).length,
    independentSourceCount: job.sources.length,
    findings: allFindings.map((f) => ({
      category: f.category,
      claim: f.claim,
      evidence: f.evidence,
      source: f.source,
    })),
    themes: [...new Set(allFindings.filter((f) => f.category === "THEME").map((f) => f.claim))],
    disagreements: allFindings.filter((f) => f.category === "DISAGREEMENT").map((f) => f.claim),
    missingEvidence: allFindings.filter((f) => f.category === "UNVERIFIED").map((f) => f.claim),
    generatedAt: new Date().toISOString(),
  };

  await prisma.researchJob.update({ where: { id: job.id }, data: { brief: toJsonString(brief) } });
  return brief;
}

export function serializeBrief(brief: string | null): ResearchBrief | null {
  if (!brief) return null;
  return fromJsonString<ResearchBrief | null>(brief, null);
}
