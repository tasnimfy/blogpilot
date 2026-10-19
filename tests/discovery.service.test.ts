import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBucket } from "@/server/bucket.service";
import { createKeyword } from "@/server/keyword.service";
import {
  getDiscoverySettings,
  updateDiscoverySettings,
  runDiscovery,
  listDiscoveryRuns,
  getDiscoveryRun,
  DiscoveryServiceError,
} from "@/server/discovery.service";
import { fromJsonString } from "@/lib/json";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("content opportunity discovery engine (service)", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  async function enableDiscovery(minScore = 6) {
    await updateDiscoverySettings(siteId, { enabled: true, minScore }, admin.id);
  }

  async function seedKeywordCluster() {
    const bucket = (await createBucket(siteId, { name: "KW" }, admin.id)).id;
    await createKeyword(
      siteId,
      { keyword: "best white water rafting trips", bucketId: bucket, searchVolume: 5000, difficulty: 15, cpcCents: 200 },
      admin.id
    );
    await createKeyword(
      siteId,
      { keyword: "white water rafting trip", bucketId: bucket, searchVolume: 4000, difficulty: 20 },
      admin.id
    );
    return bucket;
  }

  it("upserts discovery settings with safe defaults", async () => {
    const s = await getDiscoverySettings(siteId);
    expect(s.enabled).toBe(false);
    expect(s.minScore).toBe(12);
    expect(s.maxCandidates).toBe(50);
    expect(s.includeKeywords).toBe(true);
    expect(s.includeGsc).toBe(true);
    expect(s.includeTrends).toBe(true);
    // Upsert is idempotent: same row returned on a second read.
    const again = await getDiscoverySettings(siteId);
    expect(again.id).toBe(s.id);
  });

  it("persists partial settings updates and audits them", async () => {
    const updated = await updateDiscoverySettings(siteId, { enabled: true, minScore: 7, timeRange: "30d" }, admin.id);
    expect(updated.enabled).toBe(true);
    expect(updated.minScore).toBe(7);
    expect(updated.timeRange).toBe("30d");
    expect(updated.region).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { websiteId: siteId, action: "DISCOVERY_SETTINGS_UPDATED" } });
    expect(audit).not.toBeNull();
  });

  it("validates autoBucketId belongs to the website", async () => {
    await expect(updateDiscoverySettings(siteId, { autoBucketId: "missing-bucket" }, admin.id)).rejects.toThrow(
      DiscoveryServiceError
    );
    const bucket = (await createBucket(siteId, { name: "Auto" }, admin.id)).id;
    const ok = await updateDiscoverySettings(siteId, { autoBucketId: bucket }, admin.id);
    expect(ok.autoBucketId).toBe(bucket);
  });

  it("skips the run when discovery is disabled", async () => {
    const res = await runDiscovery(siteId, { userId: admin.id });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    expect(res.reason).toContain("disabled");
    expect(await prisma.discoveryRun.count()).toBe(0);
  });

  it("creates scored opportunities from keyword data for human review", async () => {
    await seedKeywordCluster();
    await enableDiscovery(6);

    const res = await runDiscovery(siteId, { userId: admin.id });
    expect(res.ok).toBe(true);
    expect(res.summary?.candidates).toBe(2);
    expect(res.summary?.clusters).toBe(1);
    expect(res.summary?.created).toBe(1);

    const opps = await prisma.contentOpportunity.findMany({ where: { websiteId: siteId }, include: { score: true } });
    expect(opps).toHaveLength(1);
    const opp = opps[0];
    // Saved for human review — never auto-approved or auto-published.
    expect(opp.status).toBe("NEW");
    expect(await prisma.articleDraft.count({ where: { websiteId: siteId } })).toBe(0);
    expect(await prisma.publicationAttempt.count()).toBe(0);

    expect(opp.action).toBe("NEW_ARTICLE");
    expect(opp.contentType).toBe("COMMERCIAL_LIST");
    expect(opp.discoveryRunId).toBeTruthy();
    expect(fromJsonString<string[]>(opp.keywords, [])).toEqual(
      expect.arrayContaining(["best white water rafting trips", "white water rafting trip"])
    );

    const score = opp.score;
    expect(score?.total).toBeGreaterThanOrEqual(6);
    expect(score?.total).toBeLessThanOrEqual(25);
    expect(score?.demandScore).toBe(4); // volume 5000 -> log10 -> 4
    expect(score?.competitionScore).toBe(4); // difficulty 15
    expect(score?.valueScore).toBe(5); // commercial intent + CPC
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(score?.confidence);
    expect(score?.evidence).toContain("Search volume");
    // Missing evidence is named, and the niche profile is absent on this site.
    expect(fromJsonString<string[]>(score?.missingData ?? null, [])).toContain(
      "No site niche/description profile to measure topic relevance"
    );

    const run = await prisma.discoveryRun.findFirst({ where: { websiteId: siteId } });
    expect(run?.status).toBe("COMPLETED");
    expect(run?.triggeredBy).toBe("MANUAL");
    expect(run?.opportunitiesCreated).toBe(1);
    expect(run?.candidatesTotal).toBe(2);
    expect(run?.completedAt).not.toBeNull();
  });

  it("does not duplicate opportunities across repeated runs", async () => {
    await seedKeywordCluster();
    await enableDiscovery(6);
    const r1 = await runDiscovery(siteId, { userId: admin.id });
    const r2 = await runDiscovery(siteId, { userId: admin.id });

    expect(r1.ok).toBe(true);
    expect(r1.summary?.created).toBe(1);
    expect(r2.ok).toBe(true);
    expect(r2.summary?.created).toBe(0);
    expect(r2.summary?.updated).toBeGreaterThanOrEqual(1);
    expect(await prisma.contentOpportunity.count({ where: { websiteId: siteId } })).toBe(1);
  });

  it("skips topics below the configured minimum score threshold", async () => {
    const bucket = (await createBucket(siteId, { name: "KW" }, admin.id)).id;
    await createKeyword(siteId, { keyword: "obscure niche topic", bucketId: bucket, searchVolume: 5, difficulty: 90 }, admin.id);
    await enableDiscovery(25); // impossible-to-reach threshold

    const res = await runDiscovery(siteId, { userId: admin.id });
    expect(res.summary?.created).toBe(0);
    expect(res.summary?.belowThreshold).toBe(1);
    const run = await prisma.discoveryRun.findFirst({ where: { websiteId: siteId } });
    expect(run?.status).toBe("COMPLETED");
    expect(run?.skippedBelowThreshold).toBe(1);
    expect(await prisma.contentOpportunity.count({ where: { websiteId: siteId } })).toBe(0);
  });

  it("recommends updating an existing page when the topic is already covered", async () => {
    const draft = await prisma.articleDraft.create({
      data: { websiteId: siteId, title: "White Water Rafting Trips", status: "PUBLISHED", slug: "white-water-rafting-trips" },
    });
    const bucket = (await createBucket(siteId, { name: "KW" }, admin.id)).id;
    await createKeyword(
      siteId,
      { keyword: "white water rafting trips", bucketId: bucket, searchVolume: 5000, difficulty: 12, cpcCents: 200 },
      admin.id
    );
    await enableDiscovery(12);

    const res = await runDiscovery(siteId, { userId: admin.id });
    expect(res.ok).toBe(true);
    expect(res.summary?.created).toBe(1);

    const opp = await prisma.contentOpportunity.findFirst({ where: { websiteId: siteId } });
    expect(opp?.action).toBe("UPDATE_EXISTING");
    expect(opp?.existingDraftId).toBe(draft.id);
    expect(opp?.existingPageOverlap).toBe(true);
    expect(opp?.title).toBe("White Water Rafting Trips");
  });

  it("merges GSC and Trends signals into candidates and records their evidence", async () => {
    const bucket = (await createBucket(siteId, { name: "KW" }, admin.id)).id;
    await createKeyword(siteId, { keyword: "kayak tours", bucketId: bucket, searchVolume: 800, difficulty: 30 }, admin.id);
    await prisma.searchConsoleRecord.create({
      data: { websiteId: siteId, query: "kayak tours", clicks: 50, impressions: 1000, position: 12.5, date: new Date() },
    });
    await prisma.trendObservation.create({
      data: { websiteId: siteId, term: "white water rafting", value: 80, observedOn: new Date() },
    });
    await enableDiscovery(8);

    const res = await runDiscovery(siteId, { userId: admin.id });
    expect(res.ok).toBe(true);
    // keyword+GSC merged into one candidate; trends forms a second one
    expect(res.summary?.candidates).toBe(2);
    expect(res.summary?.created).toBe(2);

    const opps = await prisma.contentOpportunity.findMany({ where: { websiteId: siteId }, include: { score: true } });
    const kayak = opps.find((o) => o.keyword === "kayak tours");
    const trend = opps.find((o) => o.keyword === "white water rafting");
    expect(kayak).toBeTruthy();
    expect(trend).toBeTruthy();

    // Merged candidate keeps evidence from both the keyword library and GSC.
    expect(fromJsonString<string[]>(kayak!.score!.sources, [])).toEqual(expect.arrayContaining(["KEYWORD", "GSC"]));
    expect(kayak!.score!.evidence).toContain("GSC impressions 1000");
    expect(kayak!.score!.demandScore).toBe(4); // GSC impressions win over volume 800
    expect(kayak!.score!.competitionScore).toBe(3); // difficulty 30

    // Trend-only candidate records trend interest honestly.
    expect(fromJsonString<string[]>(trend!.score!.sources, [])).toEqual(expect.arrayContaining(["TRENDS"]));
    expect(trend!.score!.demandScore).toBe(4); // 1 + floor(80/25)
    expect(trend!.score!.dataFreshness).toContain("Trends observed");
  });

  it("fails honestly for a missing website without leaving a stuck run", async () => {
    const res = await runDiscovery("missing-site", { userId: admin.id });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Website not found");
    expect(await prisma.discoveryRun.count()).toBe(0);
  });

  it("lists runs and serves run detail with its opportunities", async () => {
    await seedKeywordCluster();
    await enableDiscovery(6);
    await runDiscovery(siteId, { userId: admin.id });

    const runs = await listDiscoveryRuns(siteId);
    expect(runs).toHaveLength(1);
    expect(runs[0]._count.opportunities).toBe(1);

    const detail = await getDiscoveryRun(siteId, runs[0].id);
    expect(detail?.status).toBe("COMPLETED");
    expect(detail?.opportunities).toHaveLength(1);
    expect(detail?.opportunities[0].score).not.toBeNull();

    // Site-scoped: another website's run is never visible.
    const other = await createTestSite("Other Site", "other.example");
    const hidden = await getDiscoveryRun(other.id, runs[0].id);
    expect(hidden).toBeNull();
  });
});