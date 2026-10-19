import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString, fromJsonString } from "@/lib/json";
import { sanitizeSyncError } from "@/server/sync-status.service";
import {
  clusterCandidates,
  detectCoverage,
  decideAction,
  detectIntent,
  normalizeTopicText,
  scoreOpportunityCandidate,
  titleCaseTopic,
  similarityOfTopics,
  type DiscoveryCandidate,
  type ExistingPage,
  type TopicCluster,
} from "@/server/opportunity-discovery";
import { z } from "zod";

export class DiscoveryServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryServiceError";
  }
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  region: z.string().max(50).optional().nullable(),
  language: z.string().max(20).optional(),
  timeRange: z.string().max(10).optional(),
  minScore: z.number().int().min(0).max(25).optional(),
  maxCandidates: z.number().int().min(1).max(500).optional(),
  includeKeywords: z.boolean().optional(),
  includeGsc: z.boolean().optional(),
  includeTrends: z.boolean().optional(),
  autoBucketId: z.string().optional().nullable(),
});

export type DiscoverySettingsInput = z.infer<typeof settingsSchema>;

// Deterministic clustering threshold used across runs.
export const CLUSTER_THRESHOLD = 0.55;
// Above this overlap an existing page "adequately covers" the topic.
export const COVERED_RATIO = 0.6;

// Overlap guard: one discovery run per website at a time (mirrors trends).
const runningSites = new Set<string>();

function timeRangeDays(range: string): number | null {
  const r = (range || "90d").trim().toLowerCase();
  if (r === "all") return null;
  const m = r.match(/^(\d+)(d|w|m|y)$/);
  if (!m) return 90;
  const n = Number(m[1]);
  switch (m[2]) {
    case "d": return n;
    case "w": return n * 7;
    case "m": return n * 30;
    case "y": return n * 365;
    default: return 90;
  }
}

export async function getDiscoverySettings(websiteId: string) {
  return prisma.discoverySettings.upsert({
    where: { websiteId },
    update: {},
    create: { websiteId },
  });
}

export async function updateDiscoverySettings(websiteId: string, raw: unknown, userId: string) {
  const data = settingsSchema.parse(raw);
  const existing = await getDiscoverySettings(websiteId);
  const payload: Record<string, unknown> = {};
  const keys = [
    "enabled", "region", "language", "timeRange", "minScore", "maxCandidates",
    "includeKeywords", "includeGsc", "includeTrends", "autoBucketId",
  ] as const;
  for (const k of keys) {
    const v = (data as Record<string, unknown>)[k];
    if (v !== undefined) payload[k] = v === null && k !== "enabled" ? null : v;
  }
  if (payload.autoBucketId) {
    const bucket = await prisma.keywordBucket.findFirst({
      where: { id: payload.autoBucketId as string, websiteId },
    });
    if (!bucket) throw new DiscoveryServiceError("autoBucketId does not belong to this website");
  }
  const updated = await prisma.discoverySettings.update({ where: { id: existing.id }, data: payload });
  await auditLog({
    userId,
    websiteId,
    action: "DISCOVERY_SETTINGS_UPDATED",
    entity: "DiscoverySettings",
    entityId: updated.id,
    detail: { enabled: updated.enabled, minScore: updated.minScore, timeRange: updated.timeRange },
  });
  return updated;
}

export function listDiscoveryRuns(websiteId: string) {
  return prisma.discoveryRun.findMany({
    where: { websiteId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { opportunities: true } } },
  });
}

export async function getDiscoveryRun(websiteId: string, runId: string) {
  return prisma.discoveryRun.findFirst({
    where: { id: runId, websiteId },
    include: { opportunities: { include: { score: true }, orderBy: { createdAt: "asc" } } },
  });
}

// --- Data gathering (site-scoped reads; RBAC enforced by the caller) -------

async function gatherCandidates(
  websiteId: string,
  settings: { region: string | null; language: string; timeRange: string; includeKeywords: boolean; includeGsc: boolean; includeTrends: boolean },
  dayCutoff: Date | null
): Promise<DiscoveryCandidate[]> {
  const byKey = new Map<string, DiscoveryCandidate>();
  const add = (c: DiscoveryCandidate) => {
    const key = normalizeTopicText(c.key);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, c);
      return;
    }
    // Merge signals from multiple sources into one candidate.
    existing.searchVolume = existing.searchVolume ?? c.searchVolume;
    existing.difficulty = existing.difficulty ?? c.difficulty;
    existing.cpcCents = existing.cpcCents ?? c.cpcCents;
    existing.gscImpressions = (existing.gscImpressions ?? 0) + (c.gscImpressions ?? 0);
    existing.gscClicks = (existing.gscClicks ?? 0) + (c.gscClicks ?? 0);
    existing.gscPosition = existing.gscPosition ?? c.gscPosition;
    existing.gscDate = existing.gscDate ?? c.gscDate;
    existing.trendsValue = existing.trendsValue ?? c.trendsValue;
    existing.trendsChangePct = existing.trendsChangePct ?? c.trendsChangePct;
    existing.trendsObservedOn = existing.trendsObservedOn ?? c.trendsObservedOn;
    if (["KEYWORD", "GSC", "TRENDS"].indexOf(c.source) < ["KEYWORD", "GSC", "TRENDS"].indexOf(existing.source)) {
      existing.source = c.source;
    }
  };

  if (settings.includeKeywords) {
    const rows = await prisma.keywordRecord.findMany({
      where: {
        websiteId,
        ...(settings.region ? { OR: [{ country: settings.region }, { country: null }] } : {}),
        ...(settings.language !== "en" ? { OR: [{ language: settings.language }, { language: null }] } : {}),
      },
      select: {
        keyword: true, searchVolume: true, difficulty: true, cpcCents: true,
        searchIntent: true, source: true, createdAt: true,
      },
    });
    for (const r of rows) {
      add({
        key: r.keyword,
        keyword: r.keyword,
        source: "KEYWORD",
        searchVolume: r.searchVolume,
        difficulty: r.difficulty,
        cpcCents: r.cpcCents,
        searchIntent: r.searchIntent ?? undefined,
      });
    }
  }

  if (settings.includeGsc) {
    const gscDays = dayCutoff;
    const rows = await prisma.searchConsoleRecord.findMany({
      where: {
        websiteId,
        ...(settings.region ? { OR: [{ country: settings.region }, { country: null }] } : {}),
        ...(gscDays ? { OR: [{ date: { gte: gscDays } }, { date: null }] } : {}),
      },
      select: { query: true, page: true, clicks: true, impressions: true, position: true, date: true, country: true },
    });
    // Aggregate per query.
    const agg = new Map<string, { clicks: number; impressions: number; positions: number[]; latest: string | null; pages: Set<string> }>();
    for (const r of rows) {
      if (!r.query) continue;
      const got = agg.get(r.query) ?? { clicks: 0, impressions: 0, positions: [], latest: null, pages: new Set<string>() };
      got.clicks += r.clicks ?? 0;
      got.impressions += r.impressions ?? 0;
      if (r.position !== null && r.position !== undefined) got.positions.push(r.position);
      const iso = r.date ? r.date.toISOString().slice(0, 10) : null;
      if (iso && (!got.latest || iso > got.latest)) got.latest = iso;
      agg.set(r.query, got);
    }
    for (const [query, a] of agg) {
      if (a.impressions + a.clicks <= 0) continue; // only queries with actual GSC activity
      add({
        key: query,
        keyword: query,
        source: "GSC",
        gscClicks: a.clicks,
        gscImpressions: a.impressions,
        gscPosition: a.positions.length ? a.positions.reduce((x, y) => x + y, 0) / a.positions.length : null,
        gscDate: a.latest,
      });
    }
  }

  if (settings.includeTrends) {
    const rows = await prisma.trendObservation.findMany({
      where: {
        websiteId,
        ...(settings.region ? { OR: [{ region: settings.region }, { region: null }] } : {}),
        ...(dayCutoff ? { observedOn: { gte: dayCutoff } } : {}),
      },
      select: { term: true, value: true, changePct: true, observedOn: true, notable: true, region: true },
    });
    const byTerm = new Map<string, { value: number | null; changePct: number | null; last: Date | null; notable: boolean }>();
    for (const r of rows) {
      if (!r.term) continue;
      const got = byTerm.get(r.term) ?? { value: null, changePct: null, last: null, notable: false };
      got.value = r.value ?? got.value;
      if (r.changePct !== null && r.changePct !== undefined) got.changePct = r.changePct;
      if (r.observedOn && (!got.last || r.observedOn.getTime() > got.last.getTime())) got.last = r.observedOn;
      got.notable = got.notable || r.notable;
      byTerm.set(r.term, got);
    }
    for (const [term, t] of byTerm) {
      if ((t.value ?? 0) <= 0) continue; // ignore fabricated/empty values
      add({
        key: term,
        keyword: term,
        source: "TRENDS",
        trendsValue: t.value,
        trendsChangePct: t.changePct,
        trendsObservedOn: t.last,
      });
    }
  }

  return [...byKey.values()];
}

async function loadExistingPages(websiteId: string): Promise<ExistingPage[]> {
  const pages: ExistingPage[] = [];
  const drafts = await prisma.articleDraft.findMany({
    where: { websiteId, status: { in: ["PUBLISHED", "PUBLISHING", "READY"] } },
    select: { id: true, title: true, slug: true },
  });
  for (const d of drafts) {
    pages.push({ id: `draft:${d.id}`, type: "draft", title: `${d.title} ${d.slug ?? ""}` });
  }
  const receipts = await prisma.publicationReceipt.findMany({
    where: { websiteId, status: { in: ["PUBLISHED", "DRAFT", "PENDING"] } },
    select: { id: true, permalink: true },
  });
  for (const r of receipts) {
    const slug = r.permalink.split("/").filter(Boolean).pop() ?? "";
    pages.push({ id: `receipt:${r.id}`, type: "receipt", title: slug.replace(/[-_]/g, " ") });
  }
  return pages;
}

// --- Run -------------------------------------------------------------------

export interface DiscoveryRunResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  run?: unknown;
  summary?: { candidates: number; clusters: number; created: number; updated: number; belowThreshold: number; covered: number };
}

export async function runDiscovery(
  websiteId: string,
  opts: { triggeredBy?: "MANUAL" | "SCHEDULED"; userId?: string | null } = {}
): Promise<DiscoveryRunResult> {
  if (runningSites.has(websiteId)) {
    return { ok: false, skipped: true, reason: "A discovery run for this website is already in progress" };
  }
  runningSites.add(websiteId);
  const triggeredBy = opts.triggeredBy ?? "MANUAL";
  try {
    const site = await prisma.website.findUnique({ where: { id: websiteId } });
    if (!site) throw new DiscoveryServiceError("Website not found");
    const settings = await getDiscoverySettings(websiteId);
    if (!settings.enabled) {
      return { ok: false, skipped: true, reason: "Discovery is disabled in website discovery settings" };
    }

    const run = await prisma.discoveryRun.create({
      data: {
        websiteId,
        status: "RUNNING",
        triggeredBy,
        settings: toJsonString(settings),
        startedAt: new Date(),
      },
    });

    const dayCutoff = (() => {
      const days = timeRangeDays(settings.timeRange);
      return days === null ? null : new Date(Date.now() - days * 24 * 3600 * 1000);
    })();

    const candidates = await gatherCandidates(websiteId, settings, dayCutoff);
    const clusters = clusterCandidates(candidates, CLUSTER_THRESHOLD);
    if (settings.maxCandidates > 0) clusters.splice(settings.maxCandidates);

    // Existing opportunities in this website -> dedupe across runs.
    const existingOpps = await prisma.contentOpportunity.findMany({
      where: { websiteId },
      select: { keyword: true, title: true, keywords: true },
    });
    const existingKeys = new Set<string>();
    for (const o of existingOpps) {
      for (const k of [o.keyword, o.title, ...fromJsonString<string[]>(o.keywords, [])]) {
        if (k) existingKeys.add(normalizeTopicText(k));
      }
    }

    const pages = await loadExistingPages(websiteId);
    const pagesForCoverage = pages.map((p) => ({ id: p.id, type: p.type, title: p.title }));

    let created = 0;
    let updated = 0; // matched an existing opportunity (dedupe)
    let belowThreshold = 0;
    let covered = 0;

    // Topics accepted (or deduped) earlier in this same run, so a run never
    // emits two clusters for the same topic. clusterCandidates already merges
    // identical topics (Jaccard 1 >= threshold), so this is a defensive guard
    // against normalization drift between candidate keys and cluster topics.
    const processedTopics: string[] = [];

    for (const cluster of clusters) {
      const topicKey = normalizeTopicText(cluster.topic);
      // Deduplicate against opportunities from previous runs (and their
      // keywords/titles) so repeated runs do not create duplicates.
      if (existingKeys.has(topicKey)) {
        updated++;
        continue;
      }
      // Deduplicate identical topics inside this run (similarity >= 1).
      if (processedTopics.some((t) => similarityOfTopics(t, topicKey) >= 1)) {
        updated++;
        continue;
      }
      processedTopics.push(topicKey);

      // intent + coverage + action
      const intent = detectIntent(cluster.topic);
      const coverage = detectCoverage(cluster.topic, pagesForCoverage);
      const action = decideAction(coverage);
      const ctx = await buildScoreContext(websiteId, settings, cluster, intent, coverage, site);
      const score = scoreOpportunityCandidate(ctx);

      if (score.total < settings.minScore) {
        belowThreshold++;
        continue;
      }
      if (coverage.covered) {
        covered++;
        if (score.total < settings.minScore + 3) continue; // only notable demand justifies an update
      }

      const draftId = coverage.covered && coverage.page?.type === "draft" && coverage.page.id.startsWith("draft:")
        ? coverage.page.id.slice("draft:".length)
        : null;

      await prisma.contentOpportunity.create({
        data: {
          websiteId,
          title: titleCaseTopic(cluster.topic),
          keyword: cluster.members[0] ?? cluster.topic,
          bucketId: settings.autoBucketId ?? null,
          source: cluster.primarySource,
          searchIntent: intent.intent,
          contentType: intent.contentType,
          keywords: toJsonString([...new Set(cluster.members)]),
          action,
          discoveryRunId: run.id,
          existingDraftId: draftId,
          commercialIntent: intent.commercial,
          seasonal: intent.seasonal,
          existingPageOverlap: coverage.covered,
          recommendedAction: score.total >= 20 ? "PRIORITIZE" : score.total >= 15 ? "CONSIDER" : "LOW_PRIORITY",
          notes: [
            `Discovered from ${ctx.sourceCount} source(s): ${cluster.candidates.map((c) => c.source).join(", ")}.`,
            ...score.missingData.map((m) => `Missing: ${m}`),
          ].join(" "),
          status: "NEW", // saved for human review; never auto-approved/published
          score: {
            create: {
              demandScore: score.demandScore,
              demandJustification: score.demandJustification,
              competitionScore: score.competitionScore,
              competitionJustification: score.competitionJustification,
              valueScore: score.valueScore,
              valueJustification: score.valueJustification,
              originalScore: score.originalScore,
              originalJustification: score.originalJustification,
              relevanceScore: score.relevanceScore,
              relevanceJustification: score.relevanceJustification,
              total: score.total,
              confidence: score.confidence,
              evidence: toJsonString(score.evidence),
              sources: toJsonString(score.sources),
              missingData: toJsonString(score.missingData),
              dataFreshness: score.dataFreshness,
            },
          },
        },
      });
      created++;
    }

    const done = await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        candidatesTotal: candidates.length,
        opportunitiesCreated: created,
        opportunitiesUpdated: updated,
        skippedBelowThreshold: belowThreshold,
        skippedCovered: covered,
      },
    });

    await auditLog({
      userId: opts.userId ?? undefined,
      websiteId,
      action: "DISCOVERY_RUN_COMPLETED",
      entity: "DiscoveryRun",
      entityId: run.id,
      detail: { created, updated, belowThreshold, covered, candidates: candidates.length },
    }).catch(() => undefined);

    return {
      ok: true,
      run: done,
      summary: {
        candidates: candidates.length,
        clusters: clusters.length,
        created,
        updated,
        belowThreshold,
        covered,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const last = await prisma.discoveryRun.findFirst({ where: { websiteId, status: "RUNNING" }, orderBy: { createdAt: "desc" } });
    if (last) {
      await prisma.discoveryRun.update({
        where: { id: last.id },
        data: { status: "FAILED", completedAt: new Date(), errors: sanitizeSyncError(message) },
      }).catch(() => undefined);
    }
    return { ok: false, error: message };
  } finally {
    runningSites.delete(websiteId);
  }
}

async function buildScoreContext(
  websiteId: string,
  settings: { minScore: number },
  cluster: TopicCluster,
  intent: ReturnType<typeof detectIntent>,
  coverage: ReturnType<typeof detectCoverage>,
  site: { niche: string | null; description: string | null; primaryCountry: string | null }
) {
  // Deterministic aggregation: order members by demand, take the first
  // present value for per-member fields; sums for GSC counts.
  void websiteId;
  void settings;
  const members = [...cluster.candidates].sort(
    (a, b) => (b.searchVolume ?? b.gscImpressions ?? b.trendsValue ?? 0) - (a.searchVolume ?? a.gscImpressions ?? a.trendsValue ?? 0)
  );
  const first = (pick: (c: DiscoveryCandidate) => number | null | undefined): number | null => {
    for (const m of members) {
      const v = pick(m);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  const impressions = members.reduce((s, m) => s + (m.gscImpressions ?? 0), 0);
  const clicks = members.reduce((s, m) => s + (m.gscClicks ?? 0), 0);
  let latestGscDate: string | null = null;
  let latestTrendObserved: Date | null = null;
  for (const m of members) {
    if (m.gscDate && (!latestGscDate || m.gscDate > latestGscDate)) latestGscDate = m.gscDate;
    if (m.trendsObservedOn && (!latestTrendObserved || m.trendsObservedOn.getTime() > latestTrendObserved.getTime())) latestTrendObserved = m.trendsObservedOn;
  }

  return {
    keyword: cluster.topic,
    searchVolume: first((c) => c.searchVolume),
    difficulty: first((c) => c.difficulty),
    cpcCents: first((c) => c.cpcCents),
    gscImpressions: impressions > 0 ? impressions : null,
    gscClicks: clicks > 0 ? clicks : null,
    gscPosition: first((c) => c.gscPosition),
    gscDate: latestGscDate,
    trendsValue: first((c) => c.trendsValue),
    trendsChangePct: first((c) => c.trendsChangePct),
    trendsObservedOn: latestTrendObserved,
    sourceCount: new Set(cluster.candidates.map((c) => c.source)).size,
    intent,
    coverage,
    siteNiche: site.niche,
    siteDescription: site.description,
    siteCountry: site.primaryCountry,
  };
}