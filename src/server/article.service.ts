import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString, fromJsonString } from "@/lib/json";
import { z } from "zod";
import { callOpenRouter, callOpenRouterDetailed, OpenRouterError, type OpenRouterCall, type OpenRouterCallResult } from "@/server/openrouter";
import { buildOutlinePrompt, buildArticlePrompt, type PromptGuidelines } from "@/server/prompts";
import { getDecryptedOpenRouterKey } from "@/server/settings.service";
import { serializeBrief } from "@/server/research.service";
import { markdownToHtml, sanitizeHtml, looksLikeHtml, toEditorHtml } from "@/lib/markup";

export class ArticleServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArticleServiceError";
  }
}

// AI client abstraction so tests can inject a fake without network access.
export interface AIClient {
  call(input: OpenRouterCall): Promise<string>;
}
// Extended client that also reports usage/cost metadata (used by the
// scheduled pipeline and the in-editor AI actions for the usage ledger).
export interface AIClientDetailed extends AIClient {
  callDetailed(input: OpenRouterCall): Promise<OpenRouterCallResult>;
}
const defaultAI: AIClient & AIClientDetailed = {
  call: callOpenRouter,
  callDetailed: callOpenRouterDetailed,
};

const createSchema = z.object({
  opportunityId: z.string().optional().nullable(),
  title: z.string().min(1).max(500),
  keyword: z.string().max(500).optional().nullable(),
  articleType: z.string().max(100).optional().nullable(),
  targetLength: z.number().int().min(0).optional().nullable(),
  language: z.string().max(20).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  slug: z.string().max(500).optional().nullable(),
  body: z.string().optional().nullable(),
  outline: z.string().optional().nullable(),
  outlineApproved: z.boolean().optional(),
  articleType: z.string().max(100).optional().nullable(),
  targetLength: z.number().int().min(0).optional().nullable(),
  language: z.string().max(20).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  status: z.string().max(50).optional(),
});

async function requireSite(websiteId: string) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new ArticleServiceError("Website not found");
  return site;
}

async function getDraftOwned(websiteId: string, draftId: string) {
  const draft = await prisma.articleDraft.findFirst({ where: { id: draftId, websiteId } });
  if (!draft) throw new ArticleServiceError("Draft not found");
  return draft;
}

export async function createDraft(websiteId: string, raw: unknown, userId: string) {
  const site = await requireSite(websiteId);
  const data = createSchema.parse(raw);
  if (data.opportunityId) {
    const opp = await prisma.contentOpportunity.findFirst({ where: { id: data.opportunityId, websiteId } });
    if (!opp) throw new ArticleServiceError("Opportunity not found");
  }
  const draft = await prisma.articleDraft.create({
    data: {
      websiteId,
      opportunityId: data.opportunityId ?? null,
      status: data.opportunityId ? "OUTLINE" : "WRITING",
      title: data.title.trim(),
      keyword: data.keyword ?? null,
      articleType: data.articleType ?? null,
      targetLength: data.targetLength ?? null,
      language: data.language ?? site.primaryLanguage ?? null,
      notes: data.notes ?? null,
    },
  });
  await auditLog({ userId, websiteId, action: "DRAFT_CREATED", entity: "ArticleDraft", entityId: draft.id });
  return draft;
}

export async function getDraft(websiteId: string, draftId: string) {
  const draft = await prisma.articleDraft.findFirst({
    where: { id: draftId, websiteId },
    include: { opportunity: { select: { id: true, title: true, keyword: true } }, revisions: { orderBy: { version: "desc" }, take: 5 } },
  });
  if (!draft) return null;
  // The editor works on HTML. Legacy markdown bodies (and their revision
  // snapshots) are converted on read without mutating the stored draft.
  return {
    ...draft,
    body: toEditorHtml(draft.body),
    revisions: draft.revisions.map((r) => ({ ...r, body: toEditorHtml(r.body) })),
  };
}

export async function listDrafts(websiteId: string, raw: unknown) {
  const q = z
    .object({
      status: z.string().optional(),
      search: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
    })
    .parse(raw);
  const where: import("@prisma/client").Prisma.ArticleDraftWhereInput = { websiteId };
  if (q.status) where.status = q.status;
  if (q.search) where.title = { contains: q.search };
  const [total, items] = await Promise.all([
    prisma.articleDraft.count({ where }),
    prisma.articleDraft.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true, title: true, keyword: true, status: true, outlineApproved: true,
        updatedAt: true, createdAt: true, language: true,
        _count: { select: { revisions: true } },
      },
    }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) };
}

export async function updateDraft(websiteId: string, draftId: string, raw: unknown, userId: string) {
  const draft = await getDraftOwned(websiteId, draftId);
  const parsed = updateSchema.parse(raw);
  const data: typeof parsed = { ...parsed };

  // The editor persists HTML. Sanitize HTML bodies on write so dangerous
  // markup (scripts, event handlers, foreign tags) never reaches the
  // database. Legacy markdown/plain-text bodies pass through unchanged.
  if (typeof data.body === "string" && looksLikeHtml(data.body)) {
    data.body = sanitizeHtml(data.body);
  }

  // Capture a revision when the body changes.
  if (typeof data.body === "string" && data.body !== draft.body) {
    const last = await prisma.draftRevision.findFirst({
      where: { draftId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    await prisma.draftRevision.create({
      data: { draftId, version: (last?.version ?? 0) + 1, body: data.body },
    });
  }

  const payload: Record<string, unknown> = {};
  for (const k of Object.keys(data) as (keyof typeof data)[]) {
    if (data[k] !== undefined) payload[k] = data[k];
  }

  const updated = await prisma.articleDraft.update({ where: { id: draftId }, data: payload });
  await auditLog({ userId, websiteId, action: "DRAFT_UPDATED", entity: "ArticleDraft", entityId: draftId });
  return updated;
}

export async function deleteDraft(websiteId: string, draftId: string, userId: string) {
  const draft = await getDraftOwned(websiteId, draftId);
  await prisma.articleDraft.delete({ where: { id: draftId } });
  await auditLog({ userId, websiteId, action: "DRAFT_DELETED", entity: "ArticleDraft", entityId: draftId });
}

// --- Generation ------------------------------------------------------------

async function loadGenerationContext(websiteId: string, draftId: string) {
  const site = await requireSite(websiteId);
  const draft = await getDraftOwned(websiteId, draftId);
  const [guidelines, ai] = await Promise.all([
    prisma.editorialGuidelines.findUnique({ where: { websiteId } }),
    prisma.aIProviderConfiguration.findUnique({ where: { websiteId } }),
  ]);
  const apiKey = await getDecryptedOpenRouterKey(websiteId);
  if (!apiKey) throw new OpenRouterError("No OpenRouter API key configured for this site", 400);
  return { site, draft, guidelines, ai, apiKey };
}

async function latestResearchBrief(websiteId: string, draft: { opportunityId: string | null }) {
  if (!draft.opportunityId) return null;
  const job = await prisma.researchJob.findFirst({
    where: { websiteId, opportunityId: draft.opportunityId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  return job ? serializeBrief(job.brief) : null;
}

function pickModel(ai: { writingModel: string | null; researchModel: string | null; preferredModel: string | null; fallbackModel: string | null }, kind: "outline" | "article"): { primary: string; fallback: string | null } {
  const primary =
    (kind === "outline" ? ai.researchModel : ai.writingModel) ?? ai.preferredModel ?? "";
  return { primary, fallback: ai.fallbackModel };
}

async function generateWithRetry(
  ai: AIClient,
  apiKey: string,
  model: string,
  fallback: string | null,
  input: Omit<OpenRouterCall, "apiKey" | "model">,
  maxRetries: number
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await ai.call({ ...input, apiKey, model });
    } catch (e) {
      lastError = e;
    }
  }
  if (fallback) {
    try {
      return await ai.call({ ...input, apiKey, model: fallback });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new OpenRouterError("AI generation failed");
}

export async function generateOutline(websiteId: string, draftId: string, userId: string, ai: AIClient = defaultAI) {
  const { site, draft, guidelines, ai: aiCfg, apiKey } = await loadGenerationContext(websiteId, draftId);
  const brief = await latestResearchBrief(websiteId, draft);
  const g = (guidelines ?? {}) as PromptGuidelines;
  const prompts = buildOutlinePrompt(
    { id: site.id, name: site.name, domain: site.domain, niche: site.niche, targetAudience: site.targetAudience, primaryCountry: site.primaryCountry, primaryLanguage: site.primaryLanguage },
    g,
    {
      title: draft.title,
      keyword: draft.keyword,
      searchIntent: null,
      articleType: draft.articleType,
      targetLength: draft.targetLength,
      language: draft.language,
      outline: draft.outline,
      notes: draft.notes,
    },
    brief
  );
  const model = pickModel(aiCfg ?? { writingModel: null, researchModel: null, preferredModel: null, fallbackModel: null }, "outline");
  const content = await generateWithRetry(
    ai,
    apiKey,
    model.primary,
    model.fallback,
    {
      messages: [
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ],
      maxTokens: aiCfg?.maxOutputTokens ?? 2048,
      temperature: aiCfg?.temperature ?? 0.7,
    },
    aiCfg?.maxRetries ?? 2
  );

  const outline = parseOutline(content);
  await prisma.articleDraft.update({
    where: { id: draftId },
    data: { outline: toJsonString(outline), status: "OUTLINE" },
  });
  await auditLog({ userId, websiteId, action: "OUTLINE_GENERATED", entity: "ArticleDraft", entityId: draftId });
  return { outline, raw: content };
}

export async function generateArticle(websiteId: string, draftId: string, userId: string, ai: AIClient = defaultAI) {
  const { site, draft, guidelines, ai: aiCfg, apiKey } = await loadGenerationContext(websiteId, draftId);
  // Ensure an outline exists before writing.
  if (!draft.outline) {
    await generateOutline(websiteId, draftId, userId, ai);
  }
  const refreshed = await getDraftOwned(websiteId, draftId);
  const brief = await latestResearchBrief(websiteId, refreshed);
  const g = (guidelines ?? {}) as PromptGuidelines;
  const prompts = buildArticlePrompt(
    { id: site.id, name: site.name, domain: site.domain, niche: site.niche, targetAudience: site.targetAudience, primaryCountry: site.primaryCountry, primaryLanguage: site.primaryLanguage },
    g,
    {
      title: refreshed.title,
      keyword: refreshed.keyword,
      searchIntent: null,
      articleType: refreshed.articleType,
      targetLength: refreshed.targetLength,
      language: refreshed.language,
      outline: refreshed.outline,
      notes: refreshed.notes,
    },
    brief
  );
  const model = pickModel(aiCfg ?? { writingModel: null, researchModel: null, preferredModel: null, fallbackModel: null }, "article");
  const content = await generateWithRetry(
    ai,
    apiKey,
    model.primary,
    model.fallback,
    {
      messages: [
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ],
      maxTokens: aiCfg?.maxOutputTokens ?? 4096,
      temperature: aiCfg?.temperature ?? 0.7,
    },
    aiCfg?.maxRetries ?? 2
  );

  // The model returns markdown; the editor and WordPress both work with HTML,
  // so convert (and sanitize) at save time. The draft stays unpublished.
  await updateDraft(websiteId, draftId, { body: markdownToHtml(content), status: "DRAFT" }, userId);
  await auditLog({ userId, websiteId, action: "ARTICLE_GENERATED", entity: "ArticleDraft", entityId: draftId });
  return { body: markdownToHtml(content) };
}

function parseOutline(raw: string): { heading: string; level: number; points: string[] }[] {
  try {
    const data = JSON.parse(raw);
    if (data?.sections && Array.isArray(data.sections)) {
      return data.sections.map((s: { heading?: string; level?: number; points?: string[] }) => ({
        heading: s.heading ?? "",
        level: s.level ?? 2,
        points: Array.isArray(s.points) ? s.points.map((p: unknown) => String(p)) : [],
      }));
    }
  } catch {
    // If the model did not return JSON, fall back to a markdown outline parse.
  }
  // Fallback: derive sections from markdown headings.
  const sections: { heading: string; level: number; points: string[] }[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) sections.push({ heading: m[2].trim(), level: m[1].length, points: [] });
  }
  return sections;
}

// --- In-editor AI actions ----------------------------------------------------
// "Improve" polishes the selected text; "regenerate" rewrites it from
// scratch. Both operate on the selected range ONLY — the service never
// modifies the draft body; the client replaces exactly the selection with the
// returned text. The rest of the article is never silently replaced.

const improveTextSchema = z.object({
  mode: z.enum(["improve", "regenerate"]).default("improve"),
  selection: z.string().min(1).max(12000),
  instruction: z.string().max(500).optional(),
});

export interface ImproveTextResult {
  text: string;
  mode: "improve" | "regenerate";
  model: string;
}

export async function improveText(
  websiteId: string,
  draftId: string,
  raw: unknown,
  userId: string,
  ai: AIClient | AIClientDetailed = defaultAI
): Promise<ImproveTextResult> {
  const { draft, ai: aiCfg, apiKey } = await loadGenerationContext(websiteId, draftId);
  const data = improveTextSchema.parse(raw);
  const model = pickModel(aiCfg ?? { writingModel: null, researchModel: null, preferredModel: null, fallbackModel: null }, "article");

  const system =
    "You are an expert article editor inside a CMS. Rewrite ONLY the text the user provides." +
    "\n- Improve clarity, flow, and concision while preserving the original meaning, facts, and tone." +
    "\n- In 'regenerate' mode, rewrite the passage from scratch keeping its role in the article." +
    "\n- NEVER invent facts, statistics, citations, or research; if the passage states a claim, keep it or soften it — do not fabricate support." +
    "\n- Return ONLY the replacement text. No markdown, no HTML, no headings, no labels, no surrounding commentary.";
  const user =
    `${data.mode === "regenerate" ? "REGENERATE" : "IMPROVE"} the selected text.` +
    (data.instruction ? `\nAdditional instruction: ${data.instruction.trim()}` : "") +
    `\n\nSelected text:\n"""\n${data.selection}\n"""`;

  // Try the usage-tracking client first (production), fall back to plain.
  let result: { content: string; model: string; usage: OpenRouterCallResult["usage"]; costCents: number | null } | undefined;
  const detailed = "callDetailed" in ai ? (ai as AIClientDetailed).callDetailed : null;
  const plain = ai.call.bind(ai);
  const attempts = (aiCfg?.maxRetries ?? 2) + 1;
  const makeInput = (m: string): OpenRouterCall => ({
    apiKey,
    model: m,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 1024,
    temperature: 0.4,
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (detailed) {
        const r = await detailed(makeInput(model.primary));
        result = { content: r.content, model: r.model, usage: r.usage, costCents: r.costCents };
        break;
      }
      const content = await plain(makeInput(model.primary));
      result = { content, model: model.primary, usage: null, costCents: null };
      break;
    } catch (e) {
      lastError = e;
      // fall through to retry / fallback model
    }
  }
  if (!result) {
    if (model.fallback) {
      try {
        if (detailed) {
          const r = await detailed(makeInput(model.fallback));
          result = { content: r.content, model: r.model, usage: r.usage, costCents: r.costCents };
        } else {
          const content = await plain(makeInput(model.fallback));
          result = { content, model: model.fallback, usage: null, costCents: null };
        }
      } catch (e) {
        lastError = e;
      }
    }
  }
  if (!result) throw lastError instanceof Error ? lastError : new OpenRouterError("AI text rewrite failed");

  const text = result.content.replace(/\s+/g, " ").trim();
  if (!text) throw new OpenRouterError("AI returned an empty rewrite", 502);
  if (text.length > 12000) throw new OpenRouterError("AI returned an oversized rewrite", 502);

  // Usage ledger (model, tokens, estimated cost; no content or secrets).
  await prisma.usageRecord.create({
    data: {
      websiteId,
      task: "AI_TEXT_IMPROVE",
      model: result.model,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
      costCents: result.costCents ?? 0,
      draftId,
      opportunityId: draft.opportunityId,
    },
  });
  await auditLog({ userId, websiteId, action: "AI_TEXT_IMPROVED", entity: "ArticleDraft", entityId: draftId, detail: { mode: data.mode, model: result.model } });

  return { text, mode: data.mode, model: result.model };
}


