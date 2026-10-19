import { prisma } from "@/lib/prisma";
import { getGscProvider, listGscProviders } from "@/providers/gsc-providers";
import { getKeywordProvider, listKeywordProviders } from "@/providers/keyword-providers";
import { listTrendsProviders } from "@/providers/trends-providers";
import { runDueTrendChecksForWebsite } from "@/server/trends.service";
import { storeGscRecords } from "@/server/searchconsole.service";
import { storeKeywordRows } from "@/server/keyword-import.service";
import {
  ensureIntegrationStatus,
  isDue,
  listIntegrationStatus,
  markSyncRunning,
  recordSyncResult,
  updateIntegrationConfig,
  type SyncSource,
} from "@/server/sync-status.service";
import type { SitePermission } from "@/lib/permissions";

// ---------------------------------------------------------------------------
// Content research data collection layer
//
// Orchestrates the three data sources (KEYWORDS, GSC, TRENDS) behind their
// provider registries. Responsibilities:
//  - run one source for a website (runSourceSync) with overlap prevention
//  - run all due syncs (runDueSyncs) for scheduling/CRON
//  - expose integration status + provider catalog + config updates
// The layer never fabricates metrics: providers return explicit ok/error
// results and missing metrics stay null. Failures set a backoff window so
// retries are safe and rate-limit friendly.
// ---------------------------------------------------------------------------

// Overlap prevention across scheduled runs/processes (in-memory; each
// process has its own guard, matching the existing trends run guard).
const running = new Set<string>();

// Map a data source to the RBAC permission that governs managing it. This is
// the server-side gate; route handlers call requireSitePermission with this.
export function permissionForSource(source: SyncSource): SitePermission {
  switch (source) {
    case "TRENDS":
      return "trends.manage";
    default:
      // KEYWORDS and GSC data (queries/pages/metrics) are keyword-domain data.
      return "keywords.manage";
  }
}

export function sourceLabel(source: SyncSource): string {
  switch (source) {
    case "KEYWORDS":
      return "Keyword data";
    case "GSC":
      return "Google Search Console";
    default:
      return "Google Trends";
  }
}

// Provider catalog for the UI (id/name/capabilities only — never credentials).
export function providerCatalog() {
  return {
    GSC: listGscProviders().map((p) => ({ id: p.id, name: p.name, capabilities: p.capabilities })),
    KEYWORDS: listKeywordProviders().map((p) => ({ id: p.id, name: p.name, capabilities: p.capabilities })),
    TRENDS: listTrendsProviders().map((p) => ({ id: p.id, name: p.name, capabilities: p.capabilities })),
  };
}

export function integrationOverview(websiteId: string) {
  return listIntegrationStatus(websiteId);
}

export async function updateSourceConfig(
  websiteId: string,
  source: SyncSource,
  input: { enabled?: boolean; refreshIntervalMinutes?: number; providerId?: string | null },
  userId: string
) {
  // Validate the provider id against the matching registry before persisting.
  if (input.providerId !== undefined && input.providerId !== null && input.providerId !== "") {
    const catalog =
      source === "GSC"
        ? listGscProviders()
        : source === "KEYWORDS"
          ? listKeywordProviders()
          : listTrendsProviders();
    if (!catalog.some((p) => p.id === input.providerId)) {
      throw new Error(`Unknown provider for ${source}: ${input.providerId}`);
    }
  }
  const updated = await updateIntegrationConfig(websiteId, source, input);
  await prisma.auditLog.create({
    data: {
      userId,
      websiteId,
      action: "INTEGRATION_CONFIG_UPDATED",
      entity: "IntegrationStatus",
      entityId: updated.id,
      detail: JSON.stringify({
        source,
        enabled: input.enabled,
        refreshIntervalMinutes: input.refreshIntervalMinutes,
        providerId: input.providerId,
      }),
    },
  }).catch(() => undefined);
  return updated;
}

export interface SyncOutcome {
  source: SyncSource;
  ok: boolean;
  skipped: boolean;
  error?: string;
  detail?: unknown;
}

// Run one data collection pass for one source of one website.
export async function runSourceSync(websiteId: string, source: SyncSource): Promise<SyncOutcome> {
  const key = `${source}:${websiteId}`;
  if (running.has(key)) {
    return { source, ok: false, skipped: true, error: "A sync for this source is already running" };
  }
  running.add(key);
  try {
    const cfg = await ensureIntegrationStatus(websiteId, source);
    if (!cfg.enabled) {
      return { source, ok: false, skipped: true, error: "Source is disabled in integration settings" };
    }
    if (source === "TRENDS") return syncTrends(websiteId, cfg.providerId);
    if (source === "GSC") return syncGsc(websiteId, cfg.providerId);
    // KEYWORDS: exported on demand via CSV import; only a registered
    // non-CSV keyword provider would enable automated ingest.
    const provider = getKeywordProvider(cfg.providerId);
    if (provider.id === "unavailable" || provider.id === "csv") {
      return {
        source,
        ok: true,
        skipped: true,
        error: "Keyword data is imported on demand via CSV; no automated keyword source is configured",
      };
    }
    const started = Date.now();
    await markSyncRunning(websiteId, "KEYWORDS");
    try {
      const res = await provider.fetchRows({ bucketId: undefined });
      if (!res.ok) {
        await recordSyncResult(websiteId, "KEYWORDS", {
          ok: false,
          error: res.error,
          durationMs: Date.now() - started,
        });
        return { source, ok: false, skipped: false, error: res.error };
      }
      const bucket = await prisma.keywordBucket.findFirst({
        where: { websiteId },
        orderBy: { createdAt: "asc" },
      });
      if (!bucket) {
        const error = "No keyword bucket exists to store automated keyword data";
        await recordSyncResult(websiteId, "KEYWORDS", { ok: false, error });
        return { source, ok: false, skipped: false, error };
      }
      const { summary } = await storeKeywordRows(
        websiteId,
        bucket.id,
        res.rows,
        res.issues,
        {
          source: provider.id.toUpperCase(),
          duplicatePolicy: "SKIP",
          userId: "",
          totalRows: res.totalRows,
        }
      );
      await recordSyncResult(websiteId, "KEYWORDS", {
        ok: true,
        count: summary.imported,
        durationMs: Date.now() - started,
      });
      return { source, ok: true, skipped: false, detail: summary };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      await recordSyncResult(websiteId, "KEYWORDS", {
        ok: false,
        error: message,
        durationMs: Date.now() - started,
      }).catch(() => undefined);
      return { source, ok: false, skipped: false, error: message };
    }
  } finally {
    running.delete(key);
  }
}

async function syncTrends(websiteId: string, providerId: string | null): Promise<SyncOutcome> {
  const started = Date.now();
  const { checked, results } = await runDueTrendChecksForWebsite(websiteId, providerId);
  if (checked === 0) {
    return { source: "TRENDS", ok: true, skipped: true, error: "No due (enabled) trend configurations" };
  }
  // Each runTrendsJob already recorded its own outcome; aggregate for the source.
  const outcome = (r: unknown): { ok?: boolean; error?: string; skipped?: boolean } =>
    (r as { result?: { ok?: boolean; error?: string; skipped?: boolean } }).result ?? {};
  const jobs = results.map(outcome);
  const failedCount = jobs.filter((j) => j.ok === false || j.error).length;
  if (failedCount > 0 && failedCount === checked) {
    const firstError = jobs.find((j) => j.error)?.error ?? "Trend check failed";
    await recordSyncResult(websiteId, "TRENDS", {
      ok: false,
      error: firstError,
      durationMs: Date.now() - started,
    }).catch(() => undefined);
    return { source: "TRENDS", ok: false, skipped: false, error: firstError, detail: { checked, failed: failedCount } };
  }
  await recordSyncResult(websiteId, "TRENDS", {
    ok: true,
    count: checked - failedCount,
    durationMs: Date.now() - started,
  }).catch(() => undefined);
  return {
    source: "TRENDS",
    ok: true,
    skipped: false,
    detail: { checked, failed: failedCount },
  };
}

async function syncGsc(websiteId: string, providerId: string | null): Promise<SyncOutcome> {
  const started = Date.now();
  const provider = getGscProvider(providerId);

  // The default provider honestly reports that no authorized GSC API source
  // is configured. Status reflects that as ERROR (with safe retry backoff),
  // and NO SearchConsoleRecord is fabricated.
  if (provider.id === "unavailable") {
    const res = await provider.fetch({});
    const error = res.ok ? "No Google Search Console provider configured" : res.error;
    await markSyncRunning(websiteId, "GSC").catch(() => undefined);
    await recordSyncResult(websiteId, "GSC", { ok: false, error, durationMs: Date.now() - started });
    return { source: "GSC", ok: false, skipped: false, error };
  }

  await markSyncRunning(websiteId, "GSC");
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 28 * 24 * 3600 * 1000); // last 28 days default window
    const res = await provider.fetch({
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    });
    if (!res.ok) {
      await recordSyncResult(websiteId, "GSC", { ok: false, error: res.error, durationMs: Date.now() - started });
      return { source: "GSC", ok: false, skipped: false, error: res.error };
    }
    const { imported, duplicates, failed } = await storeGscRecords(websiteId, res.records, {
      provider: res.provider,
      source: "API",
    });
    await recordSyncResult(websiteId, "GSC", { ok: true, count: imported, durationMs: Date.now() - started });
    return { source: "GSC", ok: true, skipped: false, detail: { imported, duplicates, failed } };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await recordSyncResult(websiteId, "GSC", { ok: false, error: message, durationMs: Date.now() - started });
    return { source: "GSC", ok: false, skipped: false, error: message };
  }
}

// Run everything that is due right now (scheduler entry point).
// - TRENDS: gated by each config's own frequency/overlap rules.
// - GSC/KEYWORDS: gated by IntegrationStatus interval + retry backoff.
export async function runDueSyncs(): Promise<{ ran: SyncOutcome[] }> {
  const rows = await prisma.integrationStatus.findMany({ where: { enabled: true } });
  const ran: SyncOutcome[] = [];
  for (const row of rows) {
    if (row.status === "RUNNING") continue;
    if (row.source !== "TRENDS" && !isDue(row)) continue;
    try {
      ran.push(await runSourceSync(row.websiteId, row.source as SyncSource));
    } catch (e) {
      ran.push({
        source: row.source as SyncSource,
        ok: false,
        skipped: false,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }
  return { ran };
}