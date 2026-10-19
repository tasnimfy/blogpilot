import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBucket } from "@/server/bucket.service";
import { importKeywordCsv } from "@/server/keyword-import.service";
import { importGscCsv } from "@/server/searchconsole.service";
import { createTrendConfig } from "@/server/trends.service";
import { permissionForSource, runDueSyncs, runSourceSync, updateSourceConfig } from "@/server/integration.service";
import {
  ensureIntegrationStatus,
  isDue,
  listIntegrationStatus,
  nextRetryDelayMs,
  recordSyncResult,
  sanitizeSyncError,
} from "@/server/sync-status.service";
import { register as registerGsc } from "@/providers/gsc-providers";
import { register as registerTrends } from "@/providers/trends-providers";
import type { GscProvider, GscRequest, GscResponse, TrendsProvider, TrendsRequest, TrendsResponse } from "@/providers/types";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

class FakeGscProvider implements GscProvider {
  readonly id = "fake-gsc2";
  readonly name = "Fake GSC";
  readonly capabilities = "test-only";
  async fetch(_req: GscRequest): Promise<GscResponse> {
    return {
      ok: true,
      provider: "fake-gsc2",
      records: [
        { query: "whitewater rafting", page: "https://example.com/rafting", clicks: 12, impressions: 300, ctr: 0.04, position: 9.2, date: "2026-09-01" },
        { query: "", page: null, clicks: 1, impressions: 10, ctr: 0.1, position: 20 },
      ],
    };
  }
}

class FakeTrendsProvider implements TrendsProvider {
  readonly id = "fake-trends";
  readonly name = "Fake Trends";
  readonly capabilities = "test-only";
  async fetch(req: TrendsRequest): Promise<TrendsResponse> {
    return {
      ok: true,
      provider: "fake-trends",
      points: req.terms.map((term) => ({ term, region: req.regions?.[0], timeRange: req.timeRange, value: 50 })),
    };
  }
}

describe("integration status registry", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });
  afterEach(() => undefined);

  it("ensures one status row per source per website (cross-site isolation)", async () => {
    const other = (await createTestSite("Other", "other.com")).id;
    await listIntegrationStatus(siteId);
    await listIntegrationStatus(other);
    expect(await prisma.integrationStatus.count({ where: { websiteId: siteId } })).toBe(3);
    expect(await prisma.integrationStatus.count({ where: { websiteId: other } })).toBe(3);
    // Membership/status is scoped to one website only.
    expect((await prisma.integrationStatus.findMany({ where: { websiteId: siteId, source: "GSC" } }))[0].websiteId).toBe(siteId);
  });

  it("records a successful sync: OK status, timestamps, counter reset", async () => {
    await recordSyncResult(siteId, "GSC", { ok: true, count: 42, durationMs: 500 });
    const row = await ensureIntegrationStatus(siteId, "GSC");
    expect(row.status).toBe("OK");
    expect(row.lastSuccessAt).toBeTruthy();
    expect(row.lastError).toBeNull();
    expect(row.consecutiveFailures).toBe(0);
    expect(row.nextAttemptAt).toBeNull();
    expect(row.lastSyncCount).toBe(42);
    expect(row.lastDurationMs).toBe(500);
  });

  it("records a failed sync: ERROR, sanitized error, safe retry backoff", async () => {
    await recordSyncResult(siteId, "GSC", { ok: false, error: "boom api_key=supersecret" });
    const row = await ensureIntegrationStatus(siteId, "GSC");
    expect(row.status).toBe("ERROR");
    expect(row.consecutiveFailures).toBe(1);
    expect(row.lastError).not.toContain("supersecret");
    expect(row.lastError).toContain("[REDACTED]");
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    // second failure backs off further
    await recordSyncResult(siteId, "GSC", { ok: false, error: "again" });
    const row2 = await ensureIntegrationStatus(siteId, "GSC");
    expect(row2.consecutiveFailures).toBe(2);
    expect(row2.nextAttemptAt!.getTime()).toBeGreaterThan(row.nextAttemptAt!.getTime());
    // success resets
    await recordSyncResult(siteId, "GSC", { ok: true, count: 1 });
    const row3 = await ensureIntegrationStatus(siteId, "GSC");
    expect(row3.consecutiveFailures).toBe(0);
    expect(row3.nextAttemptAt).toBeNull();
  });

  it("sanitizeSyncError redacts credential-like fragments and encrypted payloads", () => {
    const msg = "GET /failed Authorization: Bearer abc123 secret=xyz enc:v1:00:11:22";
    const out = sanitizeSyncError(msg);
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("xyz");
    expect(out).not.toContain("enc:v1:");
    expect(out).toContain("[REDACTED]");
    expect(sanitizeSyncError("")).toBe("Unknown sync error");
    expect(sanitizeSyncError("plain message")).toBe("plain message");
  });

  it("backoff grows and is capped", () => {
    expect(nextRetryDelayMs(1, 1440)).toBe(5 * 60_000);
    expect(nextRetryDelayMs(2, 1440)).toBe(10 * 60_000);
    expect(nextRetryDelayMs(10, 30)).toBeLessThanOrEqual(24 * 3600_000);
  });

  it("isDue respects enabled, running, backoff and interval", () => {
    const base = {
      enabled: true,
      status: "IDLE",
      refreshIntervalMinutes: 60,
      lastSuccessAt: null,
      nextAttemptAt: null,
    };
    expect(isDue(base)).toBe(true);
    expect(isDue({ ...base, enabled: false })).toBe(false);
    expect(isDue({ ...base, status: "RUNNING" })).toBe(false);
    expect(isDue({ ...base, nextAttemptAt: new Date(Date.now() + 100_000) })).toBe(false);
    expect(isDue({ ...base, nextAttemptAt: new Date(Date.now() - 1000) })).toBe(true);
    expect(isDue({ ...base, lastSuccessAt: new Date(Date.now() - 1000) })).toBe(false);
    expect(isDue({ ...base, lastSuccessAt: new Date(Date.now() - 3601_000) })).toBe(true);
  });

  it("updateIntegrationConfig changes enabled/interval/provider (with validation)", async () => {
    const updated = await updateSourceConfig(siteId, "GSC", { enabled: false, refreshIntervalMinutes: 720 }, admin.id);
    expect(updated.enabled).toBe(false);
    expect(updated.refreshIntervalMinutes).toBe(720);
    await expect(updateSourceConfig(siteId, "GSC", { refreshIntervalMinutes: 1 }, admin.id)).rejects.toThrow(/between 5 and 43200/);
    await expect(updateSourceConfig(siteId, "GSC", { providerId: "nope" }, admin.id)).rejects.toThrow(/Unknown provider/);
  });

  it("manual keyword CSV import registers a successful KEYWORDS sync", async () => {
    const bucketId = (await createBucket(siteId, { name: "Imported" }, admin.id)).id;
    const csv = "Keyword,Search Volume\nrafting trips,100\n";
    await importKeywordCsv(siteId, csv, { bucketId }, admin.id);
    const row = await ensureIntegrationStatus(siteId, "KEYWORDS");
    expect(row.status).toBe("OK");
    expect(row.lastSuccessAt).toBeTruthy();
  });

  it("manual GSC CSV import registers a successful GSC sync", async () => {
    const csv = "Top queries,Clicks,Impressions,CTR,Position\nrafting,10,100,0.1,5.5\n";
    await importGscCsv(siteId, csv, {}, admin.id);
    const row = await ensureIntegrationStatus(siteId, "GSC");
    expect(row.status).toBe("OK");
  });
});

describe("data collection orchestration", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  it("maps each source to the RBAC permission governing it", () => {
    expect(permissionForSource("GSC")).toBe("keywords.manage");
    expect(permissionForSource("KEYWORDS")).toBe("keywords.manage");
    expect(permissionForSource("TRENDS")).toBe("trends.manage");
  });

  it("GSC sync with the default provider fails honestly and stores nothing", async () => {
    const res = await runSourceSync(siteId, "GSC");
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(false);
    expect(res.error).toContain("No reliable automated Google Search Console provider");
    expect(await prisma.searchConsoleRecord.count({ where: { websiteId: siteId } })).toBe(0);
    const row = await ensureIntegrationStatus(siteId, "GSC");
    expect(row.status).toBe("ERROR");
    expect(row.consecutiveFailures).toBe(1);
  });

  it("GSC sync with a registered provider stores records with provenance", async () => {
    registerGsc(new FakeGscProvider());
    await updateSourceConfig(siteId, "GSC", { providerId: "fake-gsc2" }, admin.id);
    const res = await runSourceSync(siteId, "GSC");
    expect(res.ok).toBe(true);
    const records = await prisma.searchConsoleRecord.findMany({ where: { websiteId: siteId } });
    expect(records).toHaveLength(1); // the "missing query" row is rejected, never fabricated
    expect(records[0].query).toBe("whitewater rafting");
    expect(records[0].clicks).toBe(12);
    expect(records[0].ctr).toBeCloseTo(0.04);
    expect(records[0].source).toBe("API");
    expect(records[0].date).toBeTruthy();
    const batch = await prisma.importBatch.findFirst({ where: { websiteId: siteId, source: "GSC" } });
    expect(batch?.fileName).toContain("fake-gsc2");
    const row = await ensureIntegrationStatus(siteId, "GSC");
    expect(row.status).toBe("OK");
    expect(row.lastSyncCount).toBe(1);

    // duplicate re-run skips the same (query,page,date) tuple
    const res2 = await runSourceSync(siteId, "GSC");
    expect(res2.ok).toBe(true);
    expect((res2.detail as { duplicates: number }).duplicates).toBe(1);
    expect(await prisma.searchConsoleRecord.count({ where: { websiteId: siteId } })).toBe(1);
  });

  it("Trends sync runs due configs and records OK", async () => {
    registerTrends(new FakeTrendsProvider());
    await updateSourceConfig(siteId, "TRENDS", { providerId: "fake-trends" }, admin.id);
    await createTrendConfig(siteId, { searchTerms: ["rafting"], enabled: true }, admin.id);
    const res = await runSourceSync(siteId, "TRENDS");
    expect(res.ok).toBe(true);
    expect((res.detail as { checked: number }).checked).toBe(1);
    expect(await prisma.trendObservation.count({ where: { websiteId: siteId } })).toBe(1);
    const row = await ensureIntegrationStatus(siteId, "TRENDS");
    expect(row.status).toBe("OK");
  });

  it("Trends sync when there is nothing due is skipped honestly", async () => {
    const res = await runSourceSync(siteId, "TRENDS");
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
  });

  it("Keyword sync is skipped (on-demand CSV import) without touching status", async () => {
    const res = await runSourceSync(siteId, "KEYWORDS");
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
    const row = await ensureIntegrationStatus(siteId, "KEYWORDS");
    expect(row.status).toBe("IDLE");
    expect(row.lastError).toBeNull();
  });

  it("runDueSyncs runs due GSC sources and respects disabled/backoff", async () => {
    // Due (never run) -> will attempt and honestly fail -> ERROR
    await ensureIntegrationStatus(siteId, "GSC");
    // Second site: disabled -> must not run
    const other = (await createTestSite("Other", "other.com")).id;
    await prisma.integrationStatus.create({
      data: { websiteId: other, source: "GSC", enabled: false },
    });
    const { ran } = await runDueSyncs();
    const gscRuns = ran.filter((r) => r.source === "GSC");
    expect(gscRuns).toHaveLength(1);
    expect(gscRuns[0].ok).toBe(false);
    expect(await ensureIntegrationStatus(other, "GSC")).toMatchObject({ status: "IDLE", consecutiveFailures: 0 });

    // Backoff window (nextAttemptAt in the future) prevents a tight retry loop
    await recordSyncResult(siteId, "GSC", { ok: false, error: "first failure" });
    const row = await ensureIntegrationStatus(siteId, "GSC");
    const { ran: ran2 } = await runDueSyncs();
    expect(ran2.filter((r) => r.source === "GSC")).toHaveLength(0);

    // After the backoff window passes it retries safely
    await prisma.integrationStatus.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    const { ran: ran3 } = await runDueSyncs();
    expect(ran3.filter((r) => r.source === "GSC")).toHaveLength(1);
  });
});