import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBucket } from "@/server/bucket.service";
import { previewKeywordCsv, importKeywordCsv, KeywordImportError } from "@/server/keyword-import.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("keyword CSV import", () => {
  let admin: { id: string };
  let siteId: string;
  let bucketId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
    bucketId = (await createBucket(siteId, { name: "Imported" }, admin.id)).id;
  });

  const gkpCsv = [
    "Keyword,Avg. monthly searches,Competition,CPC",
    "whitewater rafting,12000,High,2.50",
    "rafting near me,5400,Low,1.20",
    '"salmon river rafting ""idaho""",900,Medium,1.75',
    "",
  ].join("\n");

  it("auto-detects headers and maps columns, storing metrics", async () => {
    const { summary } = await importKeywordCsv(siteId, gkpCsv, { bucketId, fileName: "gkp.csv" }, admin.id);
    expect(summary.total).toBe(3);
    expect(summary.imported).toBe(3);
    expect(summary.duplicatesSkipped).toBe(0);
    expect(summary.failed).toBe(0);

    const recs = await prisma.keywordRecord.findMany({ where: { bucketId } });
    expect(recs).toHaveLength(3);
    const rafting = recs.find((r) => r.keyword === "whitewater rafting")!;
    expect(rafting.searchVolume).toBe(12000);
    expect(rafting.competition).toBe("High");
    expect(rafting.cpcCents).toBe(250); // 2.50 USD -> cents
    expect(rafting.source).toBe("CSV");
    expect(rafting.importBatchId).toBeTruthy();

    const quoted = recs.find((r) => r.keyword.includes("idaho"))!;
    expect(quoted.keyword).toBe('salmon river rafting "idaho"');
  });

  it("reports invalid rows and preserves unknown metrics as null", async () => {
    const bad = ["Keyword,Search Volume\nvalid,100\n,50\nother,,200\n"].join("");
    const { summary } = await importKeywordCsv(siteId, bad, { bucketId }, admin.id);
    expect(summary.imported).toBe(2);
    expect(summary.failed).toBe(1);
    const recs = await prisma.keywordRecord.findMany({ where: { bucketId } });
    expect(recs).toHaveLength(2);
    const valid = recs.find((r) => r.keyword === "valid")!;
    expect(valid.searchVolume).toBe(100);
    expect(valid.competition).toBeNull();
    expect(valid.cpcCents).toBeNull();
    const other = recs.find((r) => r.keyword === "other")!;
    expect(other.searchVolume).toBeNull();
  });

  it("skips duplicates by default within and across imports", async () => {
    await importKeywordCsv(siteId, gkpCsv, { bucketId }, admin.id);
    const second = await importKeywordCsv(siteId, gkpCsv, { bucketId }, admin.id);
    expect(second.summary.duplicatesSkipped).toBe(3);
    expect(second.summary.imported).toBe(0);
    expect(await prisma.keywordRecord.count({ where: { bucketId } })).toBe(3);
  });

  it("merges duplicates and fills metric gaps", async () => {
    await importKeywordCsv(siteId, gkpCsv, { bucketId }, admin.id);
    const mergeCsv = "Keyword,Search Volume\nwhitewater rafting,20000\n";
    const { summary } = await importKeywordCsv(siteId, mergeCsv, { bucketId, duplicatePolicy: "MERGE" }, admin.id);
    expect(summary.duplicatesSkipped).toBe(0);
    const rec = await prisma.keywordRecord.findFirst({ where: { bucketId, keyword: "whitewater rafting" } });
    expect(rec?.searchVolume).toBe(20000);
    expect(await prisma.keywordRecord.count({ where: { bucketId } })).toBe(3);
  });

  it("respects an explicit column mapping", async () => {
    const csv = "Term,Vol\nkayak trips,300\n";
    const preview = previewKeywordCsv(csv, { hasHeader: true, mapping: { keyword: 0, searchVolume: 1 } });
    expect(preview.detectedMapping.keyword).toBe(0);
    const { summary } = await importKeywordCsv(siteId, csv, { bucketId, mapping: { keyword: 0, searchVolume: 1 } }, admin.id);
    expect(summary.imported).toBe(1);
    const rec = await prisma.keywordRecord.findFirst({ where: { bucketId } });
    expect(rec?.keyword).toBe("kayak trips");
    expect(rec?.searchVolume).toBe(300);
  });

  it("rejects imports when no keyword column is mapped", async () => {
    const csv = "foo,bar\n1,2\n";
    await expect(importKeywordCsv(siteId, csv, { bucketId }, admin.id)).rejects.toThrow(KeywordImportError);
  });

  it("rejects a bucket from another site", async () => {
    const other = (await createTestSite("Other", "other.com")).id;
    const otherBucket = (await createBucket(other, { name: "X" }, admin.id)).id;
    await expect(importKeywordCsv(siteId, gkpCsv, { bucketId: otherBucket }, admin.id)).rejects.toThrow(KeywordImportError);
  });

  it("preview reports per-row errors and total count", async () => {
    const preview = previewKeywordCsv("Keyword,Volume\nok,10\n,5\n", { hasHeader: true });
    expect(preview.totalRows).toBe(2);
    expect(preview.errors.length).toBe(1);
    expect(preview.errors[0].message).toContain("Missing keyword");
  });
});
