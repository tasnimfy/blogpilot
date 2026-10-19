import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBucket } from "@/server/bucket.service";
import {
  createTrendConfig,
  updateTrendConfig,
  runTrendsJob,
  runDueTrendChecks,
  importTrendsCsv,
  listObservations,
  TrendsServiceError,
} from "@/server/trends.service";
import { register, getTrendsProvider } from "@/providers/trends-providers";
import type { TrendsProvider, TrendsRequest, TrendsResponse } from "@/providers/types";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

// A fake provider injected into the registry for the success path.
class FakeTrendsProvider implements TrendsProvider {
  readonly id = "fake";
  readonly name = "Fake";
  readonly capabilities = "test-only";
  private values: Record<string, number> = {};
  setValue(term: string, v: number) {
    this.values[term] = v;
  }
  async fetch(req: TrendsRequest): Promise<TrendsResponse> {
    return {
      ok: true,
      provider: "fake",
      points: req.terms.map((term) => ({
        term,
        region: req.regions?.[0],
        timeRange: req.timeRange,
        value: this.values[term] ?? 50,
      })),
    };
  }
}

describe("Google Trends monitoring", () => {
  let admin: { id: string };
  let siteId: string;
  let fake: FakeTrendsProvider;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
    fake = new FakeTrendsProvider();
    register(fake);
  });
  afterEach(() => {
    // keep the default provider registered for other suites
  });

  it("creates, lists, updates and deletes configs", async () => {
    const cfg = await createTrendConfig(
      siteId,
      { searchTerms: ["rafting"], countries: ["US"], frequency: "DAILY", changeThreshold: 30 },
      admin.id
    );
    expect(cfg.searchTerms).toContain("rafting");
    const updated = await updateTrendConfig(siteId, cfg.id, { enabled: false }, admin.id);
    expect(updated.enabled).toBe(false);
    expect((await prisma.trendMonitoringConfiguration.count({ where: { websiteId: siteId } }))).toBe(1);
  });

  it("reports honestly when no automated provider is available", async () => {
    const cfg = await createTrendConfig(siteId, { searchTerms: ["rafting"] }, admin.id);
    const result = await runTrendsJob(cfg.id); // no provider id -> default unavailable
    expect(result.ok).toBe(false);
    const job = await prisma.backgroundJob.findFirst({ where: { websiteId: siteId, type: "TRENDS_CHECK" } });
    expect(job?.status).toBe("FAILED");
    expect(job?.error).toContain("No reliable automated Google Trends provider");
    // No fabricated observations.
    expect(await prisma.trendObservation.count()).toBe(0);
  });

  it("records observations and flags notable changes with a provider", async () => {
    const cfg = await createTrendConfig(siteId, { searchTerms: ["rafting"], countries: ["US"], changeThreshold: 30 }, admin.id);
    fake.setValue("rafting", 100);
    await runTrendsJob(cfg.id, "fake");
    fake.setValue("rafting", 150); // +50%
    const second = await runTrendsJob(cfg.id, "fake");
    expect(second.ok).toBe(true);
    expect(second.notable).toBe(1);

    const obs = await prisma.trendObservation.findMany({ where: { websiteId: siteId, term: "rafting" }, orderBy: { observedOn: "asc" } });
    expect(obs).toHaveLength(2);
    expect(obs[0].value).toBe(100);
    expect(obs[1].previousValue).toBe(100);
    expect(obs[1].changePct).toBeCloseTo(50);
    expect(obs[1].notable).toBe(true);
  });

  it("adds notable discoveries to the configured bucket without duplicates", async () => {
    const bucket = (await createBucket(siteId, { name: "Trending" }, admin.id)).id;
    const cfg = await createTrendConfig(siteId, { searchTerms: ["rafting"], autoBucketId: bucket, changeThreshold: 10 }, admin.id);
    fake.setValue("rafting", 100);
    await runTrendsJob(cfg.id, "fake");
    fake.setValue("rafting", 200);
    await runTrendsJob(cfg.id, "fake");
    const recs = await prisma.keywordRecord.findMany({ where: { bucketId: bucket } });
    expect(recs).toHaveLength(1);
    expect(recs[0].keyword).toBe("rafting");
    expect(recs[0].source).toBe("TRENDS");
  });

  it("runDueTrendChecks runs due enabled configs", async () => {
    await createTrendConfig(siteId, { searchTerms: ["rafting"], enabled: true }, admin.id);
    const res = await runDueTrendChecks();
    expect(res.checked).toBe(1);
    // default provider is unavailable, so the check fails honestly
    expect((res.results[0] as { result: { ok: boolean } }).result.ok).toBe(false);
  });

  it("refuses to run another website's config via a mismatched website context", async () => {
    const otherSiteId = (await createTestSite("B", "b.com")).id;
    const cfg = await createTrendConfig(
      otherSiteId,
      { searchTerms: ["rafting"], countries: ["US"], frequency: "DAILY" },
      admin.id
    );
    // Running siteId's route against otherSite's config must be rejected.
    await expect(runTrendsJob(cfg.id, "fake", siteId)).rejects.toThrow(TrendsServiceError);
    // No observation or job may be created for the other site through this path.
    expect(await prisma.trendObservation.count()).toBe(0);
    expect(await prisma.backgroundJob.count({ where: { websiteId: siteId, type: "TRENDS_CHECK" } })).toBe(0);
  });

  it("imports Trends observations manually via CSV", async () => {
    const csv = "Term,Region,Time range,Value,Date\nrafting,US,90d,80,2026-10-01\nkayak,US,90d,60,2026-10-01\n";
    const { summary } = await importTrendsCsv(siteId, csv, {}, admin.id);
    expect(summary.imported).toBe(2);
    const obs = await listObservations(siteId);
    expect(obs).toHaveLength(2);
    expect(obs.find((o) => o.term === "rafting")?.value).toBe(80);
  });

  it("rejects Trends CSV without a value column", async () => {
    await expect(importTrendsCsv(siteId, "Term\nrafting\n", {}, admin.id)).rejects.toThrow(TrendsServiceError);
  });
});
