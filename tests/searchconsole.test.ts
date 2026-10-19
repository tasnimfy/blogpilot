import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { importGscCsv, deriveGscOpportunities } from "@/server/searchconsole.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("Search Console CSV import", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  const gsc = [
    "Query,Page,Clicks,Impressions,CTR,Position",
    "cheap rafting,https://x.com/rafting,2,500,0.004,15.5", // low CTR -> HIGH_IMPRESSIONS_LOW_CTR
    "high ranker,https://x.com/high,5,30,0.166,12", // position 12 -> NEAR_FIRST_PAGE
    "new topic,https://x.com/new,0,80,0.05,30", // zero clicks -> NEW_QUERY
    "rafting trips,https://x.com/rafting,10,100,0.1,3.2", // no flag
    "rafting trips,https://x.com/other,1,50,0.02,20", // same query, 2 pages -> CANNIBALIZATION
  ].join("\n");

  it("stores GSC records with parsed metrics", async () => {
    const { summary } = await importGscCsv(siteId, gsc, { fileName: "gsc.csv" }, admin.id);
    expect(summary.imported).toBe(5);
    const recs = await prisma.searchConsoleRecord.findMany({ where: { websiteId: siteId } });
    expect(recs).toHaveLength(5);
    const r = recs.find((x) => x.query === "rafting trips" && x.page === "https://x.com/rafting")!;
    expect(r.clicks).toBe(10);
    expect(r.impressions).toBe(100);
    expect(r.ctr).toBeCloseTo(0.1);
    expect(r.position).toBeCloseTo(3.2);
  });

  it("derives opportunity candidates from the data", async () => {
    await importGscCsv(siteId, gsc, {}, admin.id);
    const recent = await prisma.searchConsoleRecord.findMany({ where: { websiteId: siteId } });
    const opps = deriveGscOpportunities(recent);
    const types = opps.map((o) => o.type);
    expect(types).toContain("HIGH_IMPRESSIONS_LOW_CTR");
    expect(types).toContain("NEAR_FIRST_PAGE");
    expect(types).toContain("NEW_QUERY");
    expect(types).toContain("CANNIBALIZATION");
    // not every record is flagged
    expect(opps.some((o) => o.query === "rafting trips" && o.type === "NEW_QUERY")).toBe(false);
  });

  it("reports missing-query rows as failures", async () => {
    const bad = "Query,Page\n,https://x.com\nvalid,https://x.com\n";
    const { summary } = await importGscCsv(siteId, bad, {}, admin.id);
    expect(summary.failed).toBe(1);
    expect(summary.imported).toBe(1);
  });
});
