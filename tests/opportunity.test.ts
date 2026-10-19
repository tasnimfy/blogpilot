import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBucket } from "@/server/bucket.service";
import {
  createOpportunity,
  createOpportunityFromKeyword,
  getOpportunity,
  listOpportunities,
  scoreOpportunity,
  recommendedAction,
  serializeScore,
  OpportunityServiceError,
} from "@/server/opportunity.service";
import { createKeyword } from "@/server/keyword.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("content opportunities & scoring", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  const score = {
    demandScore: 4,
    demandJustification: "High search volume observed",
    competitionScore: 3,
    competitionJustification: "Moderate competition, new sites can rank",
    valueScore: 5,
    valueJustification: "Strong commercial intent",
    originalScore: 4,
    originalJustification: "Supports original research",
    relevanceScore: 5,
    relevanceJustification: "Directly matches the site niche",
    confidence: "HIGH",
    evidence: ["GSC impressions"],
    sources: ["https://example.com"],
  };

  it("creates an opportunity", async () => {
    const opp = await createOpportunity(siteId, { title: "Best rafting rivers", source: "MANUAL" }, admin.id);
    expect(opp.title).toBe("Best rafting rivers");
    expect(opp.status).toBe("NEW");
  });

  it("creates an opportunity from a keyword", async () => {
    const bucket = (await createBucket(siteId, { name: "B" }, admin.id)).id;
    const kw = await createKeyword(siteId, { keyword: "kayak tours", bucketId: bucket }, admin.id);
    const opp = await createOpportunityFromKeyword(siteId, kw.id, admin.id);
    expect(opp.keyword).toBe("kayak tours");
    expect(opp.source).toBe("KEYWORD");
  });

  it("computes the total and marks status SCORED", async () => {
    const opp = await createOpportunity(siteId, { title: "X" }, admin.id);
    const { total } = await scoreOpportunity(siteId, opp.id, score, admin.id);
    expect(total).toBe(21); // 4+3+5+4+5
    const loaded = await getOpportunity(siteId, opp.id);
    expect(loaded?.score?.total).toBe(21);
    expect(loaded?.status).toBe("SCORED");
    expect(loaded?.recommendedAction).toBe("PRIORITIZE");
  });

  it("validates scores are within 0-5 and justifications required", async () => {
    const opp = await createOpportunity(siteId, { title: "X" }, admin.id);
    await expect(scoreOpportunity(siteId, opp.id, { ...score, demandScore: 6 }, admin.id)).rejects.toThrow();
    await expect(scoreOpportunity(siteId, opp.id, { ...score, demandJustification: "" }, admin.id)).rejects.toThrow();
  });

  it("preserves the original score when overridden", async () => {
    const opp = await createOpportunity(siteId, { title: "X" }, admin.id);
    await scoreOpportunity(siteId, opp.id, score, admin.id);
    const override = { ...score, demandScore: 2, demandJustification: "Editor: actual volume is lower" };
    const res = await scoreOpportunity(siteId, opp.id, override, admin.id);
    expect(res.isOverride).toBe(true);
    expect(res.total).toBe(19);
    const loaded = await getOpportunity(siteId, opp.id);
    expect(loaded?.score?.isOverride).toBe(true);
    const original = JSON.parse(loaded?.score?.originalAiScore as string);
    expect(original.demandScore).toBe(4);
    expect(loaded?.score?.demandScore).toBe(2);
  });

  it("serializes evidence/sources arrays for the client", async () => {
    const opp = await createOpportunity(siteId, { title: "X" }, admin.id);
    await scoreOpportunity(siteId, opp.id, score, admin.id);
    const loaded = await getOpportunity(siteId, opp.id);
    const safe = serializeScore(loaded?.score as never);
    expect(safe?.evidence).toEqual(["GSC impressions"]);
    expect(safe?.sources).toEqual(["https://example.com"]);
  });

  it("lists and filters opportunities", async () => {
    await createOpportunity(siteId, { title: "Alpha topic", source: "MANUAL" }, admin.id);
    await createOpportunity(siteId, { title: "Beta topic", source: "KEYWORD" }, admin.id);
    const all = await listOpportunities(siteId, {});
    expect(all.total).toBe(2);
    const kw = await listOpportunities(siteId, { source: "KEYWORD" });
    expect(kw.total).toBe(1);
    const search = await listOpportunities(siteId, { search: "Alpha" });
    expect(search.total).toBe(1);
  });

  it("fails on a missing site", async () => {
    await expect(createOpportunity("missing", { title: "X" }, admin.id)).rejects.toThrow(OpportunityServiceError);
  });

  it("provides priority bands", () => {
    expect(recommendedAction(21)).toBe("PRIORITIZE");
    expect(recommendedAction(16)).toBe("CONSIDER");
    expect(recommendedAction(11)).toBe("LOW_PRIORITY");
    expect(recommendedAction(5)).toBe("DEPRIORITIZE");
  });
});
