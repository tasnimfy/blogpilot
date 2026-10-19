import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString, fromJsonString } from "@/lib/json";
import { parseCsv, isEmptyCell, parseInteger, looksLikeHeader } from "@/lib/csv";
import { getTrendsProvider } from "@/providers/trends-providers";
import { recordSyncResult } from "@/server/sync-status.service";
import { z } from "zod";

export class TrendsServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrendsServiceError";
  }
}

const configSchema = z.object({
  enabled: z.boolean().optional(),
  searchTerms: z.array(z.string()).optional(),
  topicGroups: z.array(z.string()).optional(),
  countries: z.array(z.string()).optional(),
  frequency: z.enum(["DAILY", "WEEKLY"]).optional(),
  timeRange: z.string().optional(),
  category: z.number().int().optional().nullable(),
  searchType: z.string().optional(),
  changeThreshold: z.number().min(0).optional(),
  autoBucketId: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
  provider: z.string().optional().nullable(),
});

// Guard against overlapping executions of the same configuration.
const runningConfigs = new Set<string>();

async function requireSite(websiteId: string) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new TrendsServiceError("Website not found");
}

export function listTrendConfigs(websiteId: string) {
  return prisma.trendMonitoringConfiguration.findMany({
    where: { websiteId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createTrendConfig(websiteId: string, raw: unknown, userId: string) {
  await requireSite(websiteId);
  const d = configSchema.parse(raw);
  const cfg = await prisma.trendMonitoringConfiguration.create({
    data: {
      websiteId,
      enabled: d.enabled ?? true,
      searchTerms: toJsonString(d.searchTerms ?? []),
      topicGroups: toJsonString(d.topicGroups ?? []),
      countries: toJsonString(d.countries ?? []),
      frequency: d.frequency ?? "DAILY",
      timeRange: d.timeRange ?? "90d",
      category: d.category ?? null,
      searchType: d.searchType ?? "WEB",
      changeThreshold: d.changeThreshold ?? 30,
      autoBucketId: d.autoBucketId ?? null,
      timezone: d.timezone ?? null,
    },
  });
  await auditLog({ userId, websiteId, action: "TREND_CONFIG_CREATED", entity: "TrendMonitoringConfiguration", entityId: cfg.id });
  return cfg;
}

export async function updateTrendConfig(websiteId: string, configId: string, raw: unknown, userId: string) {
  await requireSite(websiteId);
  const existing = await prisma.trendMonitoringConfiguration.findFirst({ where: { id: configId, websiteId } });
  if (!existing) throw new TrendsServiceError("Trend config not found");
  const d = configSchema.parse(raw);
  const data: Record<string, unknown> = {};
  if (d.enabled !== undefined) data.enabled = d.enabled;
  if (d.searchTerms !== undefined) data.searchTerms = toJsonString(d.searchTerms);
  if (d.topicGroups !== undefined) data.topicGroups = toJsonString(d.topicGroups);
  if (d.countries !== undefined) data.countries = toJsonString(d.countries);
  if (d.frequency !== undefined) data.frequency = d.frequency;
  if (d.timeRange !== undefined) data.timeRange = d.timeRange;
  if (d.category !== undefined) data.category = d.category;
  if (d.searchType !== undefined) data.searchType = d.searchType;
  if (d.changeThreshold !== undefined) data.changeThreshold = d.changeThreshold;
  if (d.autoBucketId !== undefined) data.autoBucketId = d.autoBucketId;
  if (d.timezone !== undefined) data.timezone = d.timezone;
  const updated = await prisma.trendMonitoringConfiguration.update({ where: { id: configId }, data });
  await auditLog({ userId, websiteId, action: "TREND_CONFIG_UPDATED", entity: "TrendMonitoringConfiguration", entityId: configId });
  return updated;
}

export async function deleteTrendConfig(websiteId: string, configId: string, userId: string) {
  await requireSite(websiteId);
  const existing = await prisma.trendMonitoringConfiguration.findFirst({ where: { id: configId, websiteId } });
  if (!existing) throw new TrendsServiceError("Trend config not found");
  await prisma.trendMonitoringConfiguration.delete({ where: { id: configId } });
  await auditLog({ userId, websiteId, action: "TREND_CONFIG_DELETED", entity: "TrendMonitoringConfiguration", entityId: configId });
}

export async function listObservations(websiteId: string, configId?: string, term?: string) {
  return prisma.trendObservation.findMany({
    where: { websiteId, configId: configId ?? undefined, term: term ?? undefined },
    orderBy: { observedOn: "desc" },
    take: 200,
  });
}

// Run one Trends check. Returns an honest result; never fabricates data.
export async function runTrendsJob(configId: string, providerId?: string | null, websiteId?: string | null) {
  if (runningConfigs.has(configId)) {
    return { ok: false, skipped: true, error: "A check for this configuration is already running" };
  }
  const config = await prisma.trendMonitoringConfiguration.findUnique({
    where: { id: configId },
    include: { website: { select: { id: true, name: true } } },
  });
  if (!config) throw new TrendsServiceError("Trend config not found");
  // Cross-site guard: when the caller operates in a website context, the
  // config must belong to that website (prevents running another site's
  // config by guessing its id from a different website's route).
  if (websiteId && config.websiteId !== websiteId) {
    throw new TrendsServiceError("Trend config not found");
  }
  runningConfigs.add(configId);

  const job = await prisma.backgroundJob.create({
    data: { websiteId: config.websiteId, type: "TRENDS_CHECK", status: "RUNNING", payload: toJsonString({ configId }), startedAt: new Date() },
  });

  try {
    const provider = getTrendsProvider(providerId ?? null);
    const terms = fromJsonString<string[]>(config.searchTerms, []);
    const regions = fromJsonString<string[]>(config.countries, []);
    if (terms.length === 0) {
      throw new TrendsServiceError("No search terms configured");
    }
    const res = await provider.fetch({
      terms,
      regions,
      timeRange: config.timeRange ?? "90d",
      category: config.category ?? undefined,
      searchType: config.searchType,
    });

    if (!res.ok) {
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: res.error, completedAt: new Date() },
      });
      runningConfigs.delete(configId);
      await recordSyncResult(config.websiteId, "TRENDS", { ok: false, error: res.error }).catch(() => undefined);
      return { ok: false, skipped: false, error: res.error };
    }

    // Normalize + compare with previous observations.
    let notable = 0;
    const recorded: Record<string, number> = {};
    for (const point of res.points) {
      const prev = await prisma.trendObservation.findFirst({
        where: {
          websiteId: config.websiteId,
          term: point.term,
          region: point.region ?? null,
          timeRange: point.timeRange ?? null,
        },
        orderBy: { observedOn: "desc" },
      });
      const changePct = prev?.value ? ((point.value - prev.value) / prev.value) * 100 : null;
      const isNotable =
        changePct !== null && config.changeThreshold !== null && Math.abs(changePct) >= config.changeThreshold;

      await prisma.trendObservation.create({
        data: {
          websiteId: config.websiteId,
          configId: config.id,
          term: point.term,
          region: point.region ?? null,
          timeRange: point.timeRange ?? null,
          value: point.value,
          previousValue: prev?.value ?? null,
          changePct,
          provider: res.provider,
          source: "TRENDS",
          notable: isNotable,
        },
      });
      recorded[point.term] = point.value;
      if (isNotable) {
        notable++;
        await maybeAddDiscovery(config.websiteId, config.autoBucketId, point.term);
      }
    }

    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", result: toJsonString({ terms: recorded, notable }), completedAt: new Date() },
    });
    runningConfigs.delete(configId);
    await recordSyncResult(config.websiteId, "TRENDS", { ok: true, count: res.points.length }).catch(() => undefined);
    return { ok: true, skipped: false, notable, points: res.points.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
    runningConfigs.delete(configId);
    await recordSyncResult(config.websiteId, "TRENDS", { ok: false, error: message }).catch(() => undefined);
    return { ok: false, skipped: false, error: message };
  }
}

async function maybeAddDiscovery(websiteId: string, bucketId: string | null, term: string) {
  if (!bucketId) return;
  const bucket = await prisma.keywordBucket.findFirst({ where: { id: bucketId, websiteId } });
  if (!bucket) return;
  const existing = await prisma.keywordRecord.findMany({
    where: { websiteId, bucketId },
    select: { keyword: true },
  });
  const lower = term.toLowerCase();
  if (existing.some((e) => e.keyword.toLowerCase() === lower)) return;
  await prisma.keywordRecord.create({
    data: { websiteId, bucketId, keyword: term, source: "TRENDS", notes: "Added by daily Trends check (notable change)" },
  });
}

// Determine whether a config is due based on its frequency and last observation.
function isDue(config: { frequency: string }, lastObservedAt: Date | null): boolean {
  if (!lastObservedAt) return true;
  const elapsedMs = Date.now() - lastObservedAt.getTime();
  const thresholdMs = config.frequency === "WEEKLY" ? 6 * 24 * 3600 * 1000 : 23 * 3600 * 1000;
  return elapsedMs >= thresholdMs;
}

// Run due, enabled trend checks for a single website (used by the data
// collection orchestrator). Honours each config's own frequency/overlap rules.
export async function runDueTrendChecksForWebsite(
  websiteId: string,
  providerId?: string | null
): Promise<{ checked: number; results: unknown[] }> {
  const configs = await prisma.trendMonitoringConfiguration.findMany({ where: { websiteId, enabled: true } });
  const results: unknown[] = [];
  for (const config of configs) {
    const last = await prisma.trendObservation.findFirst({
      where: { configId: config.id },
      orderBy: { observedOn: "desc" },
      select: { observedOn: true },
    });
    if (!isDue(config, last?.observedOn ?? null)) continue;
    try {
      results.push({ configId: config.id, result: await runTrendsJob(config.id, providerId) });
    } catch (e) {
      results.push({ configId: config.id, error: e instanceof Error ? e.message : "Unknown" });
    }
  }
  return { checked: results.length, results };
}

// Run all due, enabled trend checks. Prevents overlapping executions.
export async function runDueTrendChecks(): Promise<{ checked: number; results: unknown[] }> {
  const configs = await prisma.trendMonitoringConfiguration.findMany({ where: { enabled: true } });
  const results: unknown[] = [];
  for (const config of configs) {
    const last = await prisma.trendObservation.findFirst({
      where: { configId: config.id },
      orderBy: { observedOn: "desc" },
      select: { observedOn: true },
    });
    if (!isDue(config, last?.observedOn ?? null)) continue;
    try {
      results.push({ configId: config.id, result: await runTrendsJob(config.id) });
    } catch (e) {
      results.push({ configId: config.id, error: e instanceof Error ? e.message : "Unknown" });
    }
  }
  return { checked: results.length, results };
}

// --- Manual CSV fallback for Trends observations -------------------------

const trendImportSchema = z.object({
  configId: z.string().optional().nullable(),
  fileName: z.string().max(255).optional().nullable(),
});

export async function importTrendsCsv(websiteId: string, fileContent: string, rawOpts: unknown, userId: string) {
  await requireSite(websiteId);
  const opts = trendImportSchema.parse(rawOpts);
  const { header, rows } = parseCsv(fileContent);
  const effectiveHeader = header ?? null;
  if (!effectiveHeader) throw new TrendsServiceError("No header row detected (need term, region, time range, value, date)");

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const col: Record<string, number> = {};
  for (let i = 0; i < effectiveHeader.length; i++) {
    const h = norm(effectiveHeader[i]);
    if (/^term|keyword/.test(h)) col.term ??= i;
    if (/region|country|geo/.test(h)) col.region ??= i;
    if (/time ?range|range/.test(h)) col.timeRange ??= i;
    if (/^value|index/.test(h)) col.value ??= i;
    if (/date|day|week/.test(h)) col.date ??= i;
  }
  if (col.term === undefined || col.value === undefined) {
    throw new TrendsServiceError("CSV must contain a term column and a value column");
  }

  let imported = 0;
  let failed = 0;
  const created: import("@prisma/client").Prisma.TrendObservationCreateManyInput[] = [];
  for (const row of rows) {
    const term = row[col.term]?.trim();
    if (!term || isEmptyCell(row[col.value])) {
      failed++;
      continue;
    }
    const value = parseInteger(row[col.value]);
    if (value === null) {
      failed++;
      continue;
    }
    const dateStr = col.date !== undefined ? row[col.date]?.trim() : undefined;
    const date = dateStr ? parseDate(dateStr) : new Date();
    created.push({
      websiteId,
      configId: opts.configId ?? null,
      term,
      region: col.region !== undefined ? row[col.region]?.trim() || null : null,
      timeRange: col.timeRange !== undefined ? row[col.timeRange]?.trim() || null : null,
      value,
      observedOn: date,
      provider: "CSV",
      source: "CSV",
    });
    imported++;
  }
  if (created.length > 0) await prisma.trendObservation.createMany({ data: created });
  await auditLog({ userId, websiteId, action: "TRENDS_CSV_IMPORT", entity: "TrendObservation", detail: { imported, failed } });
  return { summary: { total: rows.length, imported, failed } };
}

function parseDate(s: string): Date {
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}
