// ---------------------------------------------------------------------------
// Scheduled AI article-generation pipeline.
//
// The daily generation queue (ARTICLE_GENERATE background jobs, enqueued when
// an opportunity is approved) is drained per website according to its
// GenerationSchedule: a configurable local time, timezone, daily limit
// (conservative default: 1), retry budget, and enabled/disabled switch.
//
// Safety contract:
//  - Generated articles are saved ONLY as unpublished Article Studio drafts
//    (status DRAFT). Nothing in this pipeline ever publishes or contacts an
//    external platform; manual publication controls and existing drafts are
//    untouched.
//  - Only approved, eligible opportunities are processed: the job carries the
//    linked draft id, and the draft is only written once (job claim + body
//    existence are both used as duplicate guards).
//  - Research/citations are never fabricated. Collected evidence (opportunity
//    score evidence, clustered queries, completed research briefs) is passed
//    to the model as VERIFIED input with an explicit "do not invent"
//    instruction; metadata (metaTitle/metaDescription) is stored as the AI
//    suggestion it is. Related keywords come from the verified cluster.
//  - No secrets are logged. Usage records store only model, token metrics,
//    estimated cost, timestamps and references — never prompts or keys.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString, fromJsonString } from "@/lib/json";
import {
  callOpenRouterDetailed,
  OpenRouterError,
  type OpenRouterCall,
  type OpenRouterCallResult,
} from "@/server/openrouter";
import {
  buildOutlinePrompt,
  buildArticlePrompt,
  buildMetaPrompt,
  parseOutline,
  type PromptGuidelines,
} from "@/server/prompts";
import { getDecryptedOpenRouterKey } from "@/server/settings.service";
import { serializeBrief } from "@/server/research.service";
import { transitionOpportunityStatus, OpportunityWorkflowError } from "@/server/opportunity-workflow.service";
import { expandDynamicTags } from "@/lib/dynamic-tags";
import { markdownToHtml, sanitizeHtml } from "@/lib/markup";
import { requireSitePermission } from "@/lib/access";
import { notify } from "@/server/notification.service";
import { z } from "zod";

export class GenerationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationServiceError";
  }
}

export const GENERATION_JOB_TYPE = "ARTICLE_GENERATE";

// The pipeline runs unattended; workflow transitions and audits are recorded
// with a null actor (audit logging never breaks the primary operation).

// ---------------------------------------------------------------------------
// Schedule configuration
// ---------------------------------------------------------------------------

export const generationScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Schedule must be HH:MM in 24h format")
    .optional(),
  timezone: z.string().max(100).optional().nullable(),
  dailyLimit: z.number().int().min(0).max(100).optional(),
  maxPerRun: z.number().int().min(1).max(100).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutMinutes: z.number().int().min(1).max(1440).optional(),
  weekdayMask: z.array(z.number().int().min(0).max(6)).optional().nullable(),
});

export type GenerationScheduleRow = {
  id: string;
  websiteId: string;
  enabled: boolean;
  schedule: string;
  timezone: string | null;
  dailyLimit: number;
  maxPerRun: number;
  maxRetries: number;
  timeoutMinutes: number;
  weekdayMask: string | null;
};

export async function getGenerationSchedule(websiteId: string): Promise<GenerationScheduleRow | null> {
  return prisma.generationSchedule.findUnique({ where: { websiteId } });
}

export async function updateGenerationSchedule(websiteId: string, raw: unknown, userId: string) {
  const data = generationScheduleSchema.parse(raw);
  const existing = await prisma.generationSchedule.findUnique({ where: { websiteId } });
  const payload: Record<string, unknown> = {};
  for (const k of Object.keys(data) as (keyof typeof data)[]) {
    if (data[k] !== undefined) payload[k] = data[k];
  }
  if (payload.weekdayMask === null) payload.weekdayMask = null;
  else if (Array.isArray(payload.weekdayMask))
    payload.weekdayMask = (payload.weekdayMask as number[]).length
      ? toJsonString([...new Set(payload.weekdayMask as number[])].sort())
      : null;

  const updated = await prisma.generationSchedule.upsert({
    where: { websiteId },
    update: { ...payload, updatedAt: new Date() },
    create: { websiteId, ...payload },
  });
  await auditLog({
    userId,
    websiteId,
    action: "GENERATION_SCHEDULE_UPDATED",
    entity: "GenerationSchedule",
    entityId: updated.id,
    detail: payload,
  }).catch(() => undefined);
  return updated;
}

export function isValidIanaTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function scheduleTimezone(sched: { timezone: string | null }, siteTz: string): string {
  if (sched.timezone && isValidIanaTz(sched.timezone)) return sched.timezone;
  if (isValidIanaTz(siteTz)) return siteTz;
  return "UTC";
}

export function dayBoundsInTz(now: Date, tz: string): { start: Date; end: Date } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = fmt.format(now).split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, d)), end: new Date(Date.UTC(y, m - 1, d + 1)) };
}

export function weekdayMaskToNumbers(mask: string | null): number[] | null {
  if (!mask) return null;
  const parsed = fromJsonString<number[]>(mask, []);
  return Array.isArray(parsed) && parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) ? parsed : null;
}

export function isGenerationDue(
  sched: { enabled: boolean; schedule: string; timezone: string | null; weekdayMask: string | null },
  siteTz: string,
  now: Date
): boolean {
  if (!sched.enabled) return false;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sched.schedule)) return false;
  const tz = scheduleTimezone(sched, siteTz);
  const [hh, mm] = sched.schedule.split(":").map(Number);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (get("hour") !== String(hh).padStart(2, "0") || get("minute") !== String(mm).padStart(2, "0")) return false;
  const mask = weekdayMaskToNumbers(sched.weekdayMask);
  if (mask) {
    const weekdayShort = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
    const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);
    if (!mask.includes(dayIndex)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// AI client abstraction (tests inject a fake; production uses OpenRouter)
// ---------------------------------------------------------------------------

export interface GenerationAI {
  call(input: OpenRouterCall): Promise<OpenRouterCallResult>;
}
const defaultGenerationAI: GenerationAI = { call: callOpenRouterDetailed };

// USD-rate based estimate comes from the OpenRouter client; here we only merge
// token totals for budget checks when cost is unknown.
function tokensOf(r: OpenRouterCallResult): number {
  return r.usage?.totalTokens ?? 0;
}

interface TaskCall {
  task: string;
  result: OpenRouterCallResult;
}
interface UsageTrack {
  calls: TaskCall[];
  totalTokens: number;
  costCents: number;
}
function newUsageTrack(): UsageTrack {
  return { calls: [], totalTokens: 0, costCents: 0 };
}
function track(usage: UsageTrack, task: string, result: OpenRouterCallResult) {
  usage.calls.push({ task, result });
  usage.totalTokens += tokensOf(result);
  usage.costCents += result.costCents ?? 0;
}

async function generateTaskWithRetry(
  ai: GenerationAI,
  apiKey: string,
  modelPrimary: string,
  modelFallback: string | null,
  input: Omit<OpenRouterCall, "apiKey" | "model">,
  maxRetries: number
): Promise<OpenRouterCallResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await ai.call({ ...input, apiKey, model: modelPrimary });
    } catch (e) {
      lastError = e;
    }
  }
  if (modelFallback) {
    try {
      return await ai.call({ ...input, apiKey, model: modelFallback });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new OpenRouterError("AI generation failed");
}

function pickPipelineModel(aiCfg: {
  researchModel: string | null;
  writingModel: string | null;
  seoModel: string | null;
  preferredModel: string | null;
  fallbackModel: string | null;
} | null, kind: "outline" | "article" | "meta"): { primary: string; fallback: string | null } {
  const cfg = aiCfg ?? { researchModel: null, writingModel: null, seoModel: null, preferredModel: null, fallbackModel: null };
  const primary =
    kind === "outline"
      ? cfg.researchModel
      : kind === "article"
        ? cfg.writingModel
        : cfg.seoModel ?? cfg.writingModel ?? cfg.preferredModel ?? "";
  const core = primary ?? cfg.preferredModel ?? "";
  return { primary: core, fallback: cfg.fallbackModel };
}

// ---------------------------------------------------------------------------
// Job lifecycle: claim / retry / stale recovery / failure bookkeeping
// ---------------------------------------------------------------------------

// Atomic claim. Two workers calling this for the same job: exactly one gets
// count === 1 (the other sees a non-QUEUED row) — duplicate prevention.
export async function claimQueuedJob(jobId: string): Promise<boolean> {
  const res = await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: "QUEUED" },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      lockedAt: new Date(),
      attempts: { increment: 1 },
      error: null,
    },
  });
  return res.count === 1;
}

async function requeueJob(job: { id: string; attempts: number }, message: string, now: Date) {
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      status: "QUEUED",
      error: message.slice(0, 2000),
      startedAt: null,
      lockedAt: null,
      scheduledFor: new Date(now.getTime() + 15 * 60 * 1000 * Math.min(job.attempts, 8)),
    },
  });
}

async function failJob(job: { id: string }, message: string) {
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: { status: "FAILED", error: message.slice(0, 2000), completedAt: new Date() },
  });
}

async function succeedJob(job: { id: string }, result: Record<string, unknown>) {
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: { status: "SUCCEEDED", result: toJsonString(result), error: null, completedAt: new Date() },
  });
}

// Recover RUNNING jobs whose claim has no progress after timeoutMinutes. Jobs
// with retry budget left are re-queued; exhausted ones are failed (both leave
// the job inspectable and manually retryable).
export async function recoverStaleGenerationJobs(websiteId: string, sched: { timeoutMinutes: number; maxRetries: number }): Promise<number> {
  const threshold = new Date(Date.now() - sched.timeoutMinutes * 60_000);
  const stale = await prisma.backgroundJob.findMany({
    where: { websiteId, type: GENERATION_JOB_TYPE, status: "RUNNING", startedAt: { lt: threshold } },
    select: { id: true, attempts: true },
  });
  let recovered = 0;
  for (const job of stale) {
    const data =
      job.attempts <= sched.maxRetries
        ? {
            status: "QUEUED",
            error: "Stale job recovered (no progress within timeout); re-queued for retry",
            startedAt: null,
            lockedAt: null,
            scheduledFor: new Date(),
          }
        : { status: "FAILED", error: "Stale job recovered (no progress within timeout); retry budget exhausted", completedAt: new Date() };
    const res = await prisma.backgroundJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data });
    if (res.count === 1) recovered++;
  }
  return recovered;
}

export async function retryGenerationJob(websiteId: string, jobId: string, userId: string) {
  await requireSitePermission(userId, websiteId, "automation.manage");
  const res = await prisma.backgroundJob.updateMany({
    where: { id: jobId, websiteId, type: GENERATION_JOB_TYPE, status: "FAILED" },
    data: { status: "QUEUED", scheduledFor: new Date(), completedAt: null },
  });
  if (res.count === 0) throw new GenerationServiceError("Job not found or not retryable");
  await auditLog({ userId, websiteId, action: "GENERATION_JOB_RETRIED", entity: "BackgroundJob", entityId: jobId }).catch(() => undefined);
  return { ok: true, jobId };
}

// ---------------------------------------------------------------------------
// Daily budget (conservative default: 1 article per website per day)
// ---------------------------------------------------------------------------

async function dailyBudgetStatus(websiteId: string, sched: { dailyLimit: number }, now: Date, tz: string) {
  const { start, end } = dayBoundsInTz(now, tz);
  const [succeededToday, runningNow] = await Promise.all([
    prisma.backgroundJob.count({
      where: { websiteId, type: GENERATION_JOB_TYPE, status: "SUCCEEDED", completedAt: { gte: start, lt: end } },
    }),
    // Only jobs being executed right now consume today's budget; queued
    // backlog stays eligible up to the (conservative) daily limit.
    prisma.backgroundJob.count({
      where: { websiteId, type: GENERATION_JOB_TYPE, status: "RUNNING" },
    }),
  ]);
  const used = succeededToday + runningNow;
  return { used, remaining: Math.max(0, sched.dailyLimit - used) };
}

async function monthlySpendCents(websiteId: string, now: Date): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const agg = await prisma.usageRecord.aggregate({
    where: { websiteId, createdAt: { gte: start } },
    _sum: { costCents: true },
  });
  return agg._sum.costCents ?? 0;
}

async function recordUsage(websiteId: string, usage: UsageTrack, draftId: string | null, opportunityId: string | null, jobId: string) {
  for (const call of usage.calls) {
    await prisma.usageRecord.create({
      data: {
        websiteId,
        task: call.task,
        model: call.result.model.slice(0, 200),
        promptTokens: call.result.usage?.promptTokens ?? 0,
        completionTokens: call.result.usage?.completionTokens ?? 0,
        totalTokens: call.result.usage?.totalTokens ?? 0,
        costCents: call.result.costCents ?? 0,
        draftId,
        opportunityId,
        jobId,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Workflow + notifications (best-effort; never break generation)
// ---------------------------------------------------------------------------

async function safeTransition(websiteId: string, opp: { id: string; reviewStatus: string } | null, to: string) {
  if (!opp) return;
  try {
    await transitionOpportunityStatus(websiteId, opp.id, to, null);
  } catch (e) {
    if (!(e instanceof OpportunityWorkflowError)) throw e;
    // invalid/duplicate transition (e.g. already in target state) is fine
  }
}

async function generationAudience(websiteId: string): Promise<string[]> {
  const members = await prisma.websiteUserRole.findMany({
    where: { websiteId, role: { in: ["OWNER", "ADMIN", "EDITOR", "SEO_MANAGER"] } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

async function notifyDraftReady(site: { id: string; name: string }, draft: { id: string; title: string }, oppTitle: string) {
  const userIds = await generationAudience(site.id);
  if (userIds.length === 0) return;
  await notify({
    websiteId: site.id,
    userIds,
    type: "GENERATION_DRAFT_READY",
    title: `Draft ready: ${draft.title}`,
    body: `The approved opportunity "${oppTitle}" was generated and saved as an unpublished draft in Article Studio for ${site.name}.`,
  }).catch(() => undefined);
}

async function notifyFailure(site: { id: string }, draft: { title: string }, error: string) {
  const userIds = await generationAudience(site.id);
  if (userIds.length === 0) return;
  await notify({
    websiteId: site.id,
    userIds,
    type: "GENERATION_FAILED",
    title: `Generation failed: ${draft.title}`,
    body: `The scheduled generation for "${draft.title}" failed. Reason: ${error.slice(0, 500)}. The job is inspectable and retryable in Automation.`,
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Per-job execution
// ---------------------------------------------------------------------------

function sitePrompt(site: {
  name: string;
  domain: string;
  niche: string | null;
  targetAudience: string | null;
  primaryCountry: string | null;
  primaryLanguage: string;
}) {
  return {
    id: site.name,
    name: site.name,
    domain: site.domain,
    niche: site.niche,
    targetAudience: site.targetAudience,
    primaryCountry: site.primaryCountry,
    primaryLanguage: site.primaryLanguage,
  };
}

function draftMeta(draft: { title: string; keyword: string | null; articleType: string | null; targetLength: number | null; language: string | null; outline: string | null; notes: string | null }, opp: { searchIntent: string | null } | null) {
  return {
    title: draft.title,
    keyword: draft.keyword,
    searchIntent: opp?.searchIntent ?? null,
    articleType: draft.articleType,
    targetLength: draft.targetLength,
    language: draft.language,
    outline: draft.outline,
    notes: draft.notes,
  };
}

// The collected evidence is appended to the outline prompt as VERIFIED input
// with an explicit no-invention instruction (distinguishes evidence from
// AI-generated suggestions).
function withCollectedEvidence(p: { system: string; user: string }, notes: string | null): { system: string; user: string } {
  if (!notes) return p;
  return {
    system: p.system,
    user:
      `${p.user}\n\n` +
      `Collected evidence (from the opportunity review; treat as VERIFIED input — you may paraphrase and cite it, ` +
      `but you must never invent additional facts, statistics, quotes, or first-hand experiences):\n${notes}`,
  };
}

function parseMetaJson(raw: string): { metaTitle: string | null; metaDescription: string | null; warnings: string[] } {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return { metaTitle: null, metaDescription: null, warnings: ["Meta response was not valid JSON; metadata left empty"] };
  try {
    const parsed = JSON.parse(match[0]) as { metaTitle?: unknown; metaDescription?: unknown };
    return {
      metaTitle: typeof parsed.metaTitle === "string" && parsed.metaTitle.trim() ? parsed.metaTitle.trim() : null,
      metaDescription:
        typeof parsed.metaDescription === "string" && parsed.metaDescription.trim() ? parsed.metaDescription.trim() : null,
      warnings: [],
    };
  } catch {
    return { metaTitle: null, metaDescription: null, warnings: ["Meta response was not valid JSON; metadata left empty"] };
  }
}

async function latestResearchBrief(websiteId: string, draft: { opportunityId: string | null }) {
  if (!draft.opportunityId) return null;
  const job = await prisma.researchJob.findFirst({
    where: { websiteId, opportunityId: draft.opportunityId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  return job ? serializeBrief(job.brief) : null;
}

type JobOutcome = {
  jobId: string;
  claimed: boolean;
  ok?: boolean;
  skipped?: boolean;
  retried?: boolean;
  error?: string;
  reason?: string;
  draftId?: string;
  warnings?: string[];
};

async function executeGenerationJob(
  jobId: string,
  websiteId: string,
  site: {
    id: string;
    name: string;
    domain: string;
    niche: string | null;
    targetAudience: string | null;
    primaryCountry: string | null;
    primaryLanguage: string;
    timezone: string;
  },
  sched: Pick<GenerationScheduleRow, "maxRetries" | "timeoutMinutes" | "timezone">,
  now: Date,
  ai: GenerationAI
): Promise<JobOutcome> {
  const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return { jobId, claimed: false, skipped: true };

  const payload = fromJsonString<{ draftId?: string }>(job.payload ?? "{}", {});
  if (!payload.draftId) {
    await failJob(job, "Job payload is missing the linked draft id");
    return { jobId, claimed: true, ok: false, error: "Job payload is missing the linked draft id" };
  }

  const draft = await prisma.articleDraft.findFirst({ where: { id: payload.draftId, websiteId } });
  if (!draft) {
    await failJob(job, "Linked draft no longer exists");
    return { jobId, claimed: true, ok: false, error: "Linked draft no longer exists" };
  }
  const opp = draft.opportunityId ? await prisma.contentOpportunity.findUnique({ where: { id: draft.opportunityId } }) : null;

  // Eligibility guard: only approved opportunities may be generated. A
  // rejection after the job was enqueued aborts the job (terminal, retryable
  // only after a human re-approves).
  if (opp && opp.reviewStatus === "REJECTED") {
    await failJob(job, "Opportunity was rejected; generation aborted");
    return { jobId, claimed: true, ok: false, error: "Opportunity was rejected; generation aborted" };
  }

  // Idempotent completion: a body already present means this draft was already
  // generated (another claim, a retry after partial save, or manual work).
  if (draft.body && draft.body.trim().length > 10) {
    await succeedJob(job, { draftId: draft.id, title: draft.title, skipped: true, reason: "Draft already generated" });
    await safeTransition(websiteId, opp, "DRAFT_READY");
    return { jobId, claimed: true, ok: true, skipped: true, reason: "already_generated", draftId: draft.id };
  }

  const [aiCfg, settings, guidelines, researchBrief] = await Promise.all([
    prisma.aIProviderConfiguration.findUnique({ where: { websiteId } }),
    prisma.websiteSettings.findUnique({ where: { websiteId } }),
    prisma.editorialGuidelines.findUnique({ where: { websiteId } }),
    latestResearchBrief(websiteId, draft),
  ]);

  // Configurable usage limit: monthly budget (historial spend) is a hard
  // pre-flight gate. The job fails cleanly and remains manually retryable.
  if (aiCfg?.monthlyBudgetCents && aiCfg.monthlyBudgetCents > 0) {
    const spent = await monthlySpendCents(websiteId, now);
    if (spent >= aiCfg.monthlyBudgetCents) {
      const message = `Monthly AI budget exhausted ($${(spent / 100).toFixed(2)} of $${(aiCfg.monthlyBudgetCents / 100).toFixed(2)} used)`;
      await failJob(job, message);
      return { jobId, claimed: true, ok: false, error: message };
    }
  }

  const apiKey = await getDecryptedOpenRouterKey(websiteId);
  if (!apiKey) {
    await failJob(job, "No OpenRouter API key configured for this website");
    return { jobId, claimed: true, ok: false, error: "No OpenRouter API key configured for this website" };
  }

  const tz = scheduleTimezone(sched, site.timezone);
  const useDynamicTags = settings?.dynamicTags !== false;
  const g = (guidelines ?? {}) as PromptGuidelines;
  const usage = newUsageTrack();

  await safeTransition(websiteId, opp, "QUEUED_FOR_ARTICLE_STUDIO");
  await safeTransition(websiteId, opp, "GENERATING");

  try {
    // 1) Outline from the collected evidence (existing AI integration).
    const outlineModels = pickPipelineModel(aiCfg, "outline");
    const outlineRes = await generateTaskWithRetry(
      ai, apiKey, outlineModels.primary, outlineModels.fallback,
      {
        messages: [
          { role: "system", content: withCollectedEvidence(buildOutlinePrompt(sitePrompt(site), g, draftMeta(draft, opp), researchBrief), draft.notes).system },
          { role: "user", content: withCollectedEvidence(buildOutlinePrompt(sitePrompt(site), g, draftMeta(draft, opp), researchBrief), draft.notes).user },
        ],
        maxTokens: aiCfg?.maxOutputTokens ?? 2048,
        temperature: aiCfg?.temperature ?? 0.7,
      },
      aiCfg?.maxRetries ?? 2
    );
    track(usage, "OUTLINE_GENERATE", outlineRes);
    const outline = parseOutline(outlineRes.content);
    if (outline.length === 0) throw new OpenRouterError("Outline generation returned no usable sections");

    // 2) Article (title = opportunity title; intro, headings, conclusion are
    //    part of the generated body).
    const articleModels = pickPipelineModel(aiCfg, "article");
    const articleMeta = { ...draftMeta(draft, opp), outline: toJsonString(outline) };
    const articleRes = await generateTaskWithRetry(
      ai, apiKey, articleModels.primary, articleModels.fallback,
      {
        messages: [
          { role: "system", content: buildArticlePrompt(sitePrompt(site), g, articleMeta, researchBrief).system },
          { role: "user", content: buildArticlePrompt(sitePrompt(site), g, articleMeta, researchBrief).user },
        ],
        maxTokens: aiCfg?.maxOutputTokens ?? 4096,
        temperature: aiCfg?.temperature ?? 0.7,
      },
      aiCfg?.maxRetries ?? 2
    );
    track(usage, "ARTICLE_GENERATE", articleRes);

    // 3) Metadata: meta title/description from the model; related keywords
    //    from the verified opportunity cluster (never invented).
    const related = fromJsonString<string[]>(opp?.keywords ?? null, []);
    const metaModels = pickPipelineModel(aiCfg, "meta");
    const metaRes = await generateTaskWithRetry(
      ai, apiKey, metaModels.primary, metaModels.fallback,
      {
        messages: [
          { role: "system", content: buildMetaPrompt(sitePrompt(site), g, draftMeta(draft, opp), related).system },
          { role: "user", content: buildMetaPrompt(sitePrompt(site), g, draftMeta(draft, opp), related).user },
        ],
        maxTokens: Math.min(aiCfg?.maxOutputTokens ?? 4096, 1024),
        temperature: Math.min(aiCfg?.temperature ?? 0.7, 0.4),
      },
      aiCfg?.maxRetries ?? 2
    );
    track(usage, "META_GENERATE", metaRes);
    const meta = parseMetaJson(metaRes.content);

    // 4) Dynamic date tags expanded at save time (never hardcoded by the
    //    pipeline; the model is asked to emit tags for dated topics).
    const tagCtx = { siteName: site.name, siteDomain: site.domain, timezone: tz };
    const expand = (s: string) => (useDynamicTags ? expandDynamicTags(s, tagCtx).text : s);
    // The editor and WordPress both work with HTML: convert the model's
    // markdown to sanitized HTML at save time (records are kept as markdown
    // only in the AI prompt; never stored unsanitized).
    const body = sanitizeHtml(markdownToHtml(expand(articleRes.content)));
    const metaTitle = meta.metaTitle ? expand(meta.metaTitle) : draft.title;
    const metaDescription = meta.metaDescription ? expand(meta.metaDescription) : "";

    // 5) Save as an UNPUBLISHED Article Studio draft (status DRAFT). The
    //    pipeline never transitions to READY/PUBLISHED and never contacts
    //    WordPress or any external platform.
    await prisma.articleDraft.update({
      where: { id: draft.id },
      data: {
        body,
        outline: toJsonString(outline),
        metaTitle: metaTitle.slice(0, 500),
        metaDescription: metaDescription.slice(0, 1600),
        relatedKeywords: toJsonString(related),
        keyword: draft.keyword ?? opp?.keyword ?? null,
        status: "DRAFT",
        outlineApproved: true,
      },
    });

    // 6) Usage ledger (model + tokens + estimated cost; no content/secrets).
    await recordUsage(websiteId, usage, draft.id, opp?.id ?? null, job.id);

    const warnings = [...meta.warnings];
    if (aiCfg?.maxCostPerArticleCents && aiCfg.maxCostPerArticleCents > 0 && usage.costCents > aiCfg.maxCostPerArticleCents) {
      warnings.push(
        `Generated article cost ($${(usage.costCents / 100).toFixed(2)}) exceeds the configured max per-article cost ($${(aiCfg.maxCostPerArticleCents / 100).toFixed(2)})`
      );
    }

    await succeedJob(job, {
      draftId: draft.id,
      title: draft.title,
      metaTitle,
      tokens: usage.totalTokens,
      costCents: usage.costCents,
      warnings,
      generatedAt: new Date().toISOString(),
    });
    await safeTransition(websiteId, opp, "DRAFT_READY");
    await notifyDraftReady({ id: site.id, name: site.name }, draft, opp?.title ?? draft.title);
    await auditLog({
      userId: null,
      websiteId,
      action: "ARTICLE_GENERATED_SCHEDULED",
      entity: "ArticleDraft",
      entityId: draft.id,
      detail: { jobId: job.id, title: draft.title, tokens: usage.totalTokens, costCents: usage.costCents },
    }).catch(() => undefined);

    return { jobId, claimed: true, ok: true, draftId: draft.id, warnings };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown generation error";
    if (usage.calls.length > 0) await recordUsage(websiteId, usage, draft.id, opp?.id ?? null, job.id).catch(() => undefined);
    if (job.attempts <= sched.maxRetries) {
      await requeueJob(job, message, now);
      return { jobId, claimed: true, ok: false, retried: true, error: message };
    }
    await failJob(job, message);
    await safeTransition(websiteId, opp, "FAILED");
    await notifyFailure({ id: site.id }, draft, message);
    return { jobId, claimed: true, ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export interface RunGenerationOptions {
  actorId?: string; // when set, website permission is re-checked
  now?: Date;
  ai?: GenerationAI; // injectable for tests
  sched?: GenerationScheduleRow; // injectable for tests (overrides DB)
}

const runningWebsites = new Set<string>();

export async function runGenerationForWebsite(websiteId: string, opts: RunGenerationOptions = {}): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
  websiteId: string;
  remaining?: number;
  outcomes?: JobOutcome[];
}> {
  if (opts.actorId) await requireSitePermission(opts.actorId, websiteId, "automation.manage");
  if (runningWebsites.has(websiteId)) {
    return { ok: false, skipped: true, error: "Generation already running for this website", websiteId };
  }
  runningWebsites.add(websiteId);
  try {
    const now = opts.now ?? new Date();
    const site = await prisma.website.findUnique({ where: { id: websiteId } });
    if (!site) throw new GenerationServiceError("Website not found");
    const sched = opts.sched ?? (await getGenerationSchedule(websiteId));
    if (!sched) return { ok: false, skipped: true, error: "No generation schedule configured for this website", websiteId };
    if (!sched.enabled) return { ok: false, skipped: true, error: "Scheduled generation is disabled for this website", websiteId };

    const tz = scheduleTimezone(sched, site.timezone);
    await recoverStaleGenerationJobs(websiteId, sched);

    const budget = await dailyBudgetStatus(websiteId, sched, now, tz);
    if (budget.remaining <= 0) {
      return { ok: false, skipped: false, error: "Daily generation limit reached", websiteId, remaining: 0, outcomes: [] };
    }

    const jobs = await prisma.backgroundJob.findMany({
      where: { websiteId, type: GENERATION_JOB_TYPE, status: "QUEUED" },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      take: Math.min(budget.remaining, sched.maxPerRun),
      select: { id: true },
    });

    const ai = opts.ai ?? defaultGenerationAI;
    const outcomes: JobOutcome[] = [];
    for (const job of jobs) {
      if (!(await claimQueuedJob(job.id))) {
        outcomes.push({ jobId: job.id, claimed: false, skipped: true, reason: "claimed by another worker" });
        continue;
      }
      const outcome = await executeGenerationJob(job.id, websiteId, site, sched, now, ai);
      outcomes.push(outcome);
    }
    const succeeded = outcomes.filter((o) => o.ok === true && o.skipped !== true).length;
    return { ok: true, skipped: false, websiteId, remaining: Math.max(0, budget.remaining - succeeded), outcomes };
  } finally {
    runningWebsites.delete(websiteId);
  }
}

export interface GenerationRunSummary {
  due: number;
  ran: number;
  results: {
    websiteId: string;
    ok: boolean;
    skipped?: boolean;
    error?: string;
    outcomes?: JobOutcome[];
  }[];
}

// Global scheduler sweep: every enabled website whose local schedule time
// matches the given instant is drained (up to its daily limit). Overlap-guarded
// per website, and job claims are atomic, so multiple workers are safe.
export async function runDueGeneration(now = new Date(), ai?: GenerationAI): Promise<GenerationRunSummary> {
  const schedules = await prisma.generationSchedule.findMany({
    where: { enabled: true },
    include: { website: { select: { id: true, timezone: true } } },
  });
  const results: GenerationRunSummary["results"] = [];
  for (const sched of schedules) {
    if (!isGenerationDue(sched, sched.website.timezone, now)) continue;
    const res = await runGenerationForWebsite(sched.website.id, { now, ai });
    results.push({ websiteId: sched.website.id, ok: res.ok, skipped: res.skipped, error: res.error, outcomes: res.outcomes });
  }
  return { due: results.length, ran: results.filter((r) => r.ok).length, results };
}

// Inspectable jobs + usage summary for the Automation UI.
export async function listGenerationJobs(websiteId: string, limit = 50) {
  const jobs = await prisma.backgroundJob.findMany({
    where: { websiteId, type: GENERATION_JOB_TYPE },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      error: true,
      result: true,
      attempts: true,
      scheduledFor: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });
  const rows = await prisma.usageRecord.findMany({
    where: { websiteId, task: { in: ["OUTLINE_GENERATE", "ARTICLE_GENERATE", "META_GENERATE"] } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { task: true, model: true, promptTokens: true, completionTokens: true, totalTokens: true, costCents: true, createdAt: true },
  });
  const totals = rows.reduce(
    (acc, r) => ({ tokens: acc.tokens + r.totalTokens, costCents: acc.costCents + r.costCents, calls: acc.calls + 1 }),
    { tokens: 0, costCents: 0, calls: 0 }
  );
  return {
    jobs,
    usage: { recent: rows.slice(0, 50), totals },
  };
}