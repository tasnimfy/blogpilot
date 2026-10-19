import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBucket } from "@/server/bucket.service";
import {
  listKeywords,
  createKeyword,
  updateKeyword,
  deleteKeyword,
  bulkAction,
  mergeKeywords,
  KeywordServiceError,
} from "@/server/keyword.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("keyword records", () => {
  let admin: { id: string };
  let siteId: string;
  let bucketA: string;
  let bucketB: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
    bucketA = (await createBucket(siteId, { name: "A" }, admin.id)).id;
    bucketB = (await createBucket(siteId, { name: "B" }, admin.id)).id;
    await createKeyword(siteId, { keyword: "rafting", bucketId: bucketA, searchVolume: 100 }, admin.id);
    await createKeyword(siteId, { keyword: "kayaking", bucketId: bucketA, searchVolume: 50 }, admin.id);
    await createKeyword(siteId, { keyword: "canoeing", bucketId: bucketB, searchVolume: 20 }, admin.id);
  });

  it("filters by bucket, search, and paginates", async () => {
    const a = await listKeywords(siteId, { bucketId: bucketA });
    expect(a.total).toBe(2);
    const search = await listKeywords(siteId, { search: "kayak" });
    expect(search.total).toBe(1);
    expect(search.records[0].keyword).toBe("kayaking");
    const page = await listKeywords(siteId, { page: 1, pageSize: 2 });
    expect(page.total).toBe(3);
    expect(page.pageCount).toBe(2);
  });

  it("sorts by search volume", async () => {
    const res = await listKeywords(siteId, { sort: "searchVolume", order: "desc" });
    expect(res.records[0].keyword).toBe("rafting");
  });

  it("updates a keyword", async () => {
    const rec = (await listKeywords(siteId, { search: "rafting" })).records[0];
    const updated = await updateKeyword(siteId, rec.id, { searchIntent: "INFORMATIONAL", notes: "hi" }, admin.id);
    expect(updated.searchIntent).toBe("INFORMATIONAL");
  });

  it("deletes a keyword", async () => {
    const rec = (await listKeywords(siteId, { search: "rafting" })).records[0];
    await deleteKeyword(siteId, rec.id, admin.id);
    expect(await listKeywords(siteId, { search: "rafting" })).toHaveProperty("total", 0);
  });

  it("bulk moves keywords between buckets", async () => {
    const recs = await listKeywords(siteId, { bucketId: bucketA });
    const ids = recs.records.map((r) => r.id);
    const res = await bulkAction(siteId, { ids, action: "MOVE", targetBucketId: bucketB }, admin.id);
    expect(res.count).toBe(2);
    expect((await listKeywords(siteId, { bucketId: bucketA })).total).toBe(0);
    expect((await listKeywords(siteId, { bucketId: bucketB })).total).toBe(3);
  });

  it("bulk deletes and rejects cross-site targets", async () => {
    const other = (await createTestSite("Other", "other.com")).id;
    const otherBucket = (await createBucket(other, { name: "OB" }, admin.id)).id;
    const rec = (await listKeywords(siteId, { search: "rafting" })).records[0];
    await expect(bulkAction(siteId, { ids: [rec.id], action: "MOVE", targetBucketId: otherBucket }, admin.id)).rejects.toThrow(KeywordServiceError);
    await bulkAction(siteId, { ids: [rec.id], action: "DELETE" }, admin.id);
    expect(await listKeywords(siteId, { search: "rafting" })).toHaveProperty("total", 0);
  });

  it("merges duplicates into the kept record", async () => {
    const keep = await createKeyword(siteId, { keyword: "best rafting", bucketId: bucketA }, admin.id);
    const dup = await createKeyword(siteId, { keyword: "best rafting trips", bucketId: bucketA, searchVolume: 999 }, admin.id);
    const merged = await mergeKeywords(siteId, keep.id, [dup.id], admin.id);
    expect(merged?.searchVolume).toBe(999);
    expect(await prisma.keywordRecord.count({ where: { bucketId: bucketA } })).toBe(3); // 2 seeded + kept; dup merged away
  });
});
