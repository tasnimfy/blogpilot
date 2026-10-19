import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBucket, listBuckets, updateBucket, deleteBucket, BucketServiceError } from "@/server/bucket.service";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

describe("keyword buckets", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
  });

  it("creates and lists buckets for a site", async () => {
    const a = await createBucket(siteId, { name: "Evergreen Content" }, admin.id);
    await createBucket(siteId, { name: "Seasonal Content" }, admin.id);
    const buckets = await listBuckets(siteId);
    expect(buckets.map((b) => b.name).sort()).toEqual(["Evergreen Content", "Seasonal Content"]);
    expect(a.websiteId).toBe(siteId);
  });

  it("rejects duplicate bucket names within a site", async () => {
    await createBucket(siteId, { name: "Ideas" }, admin.id);
    await expect(createBucket(siteId, { name: "Ideas" }, admin.id)).rejects.toThrow(BucketServiceError);
  });

  it("allows the same bucket name on a different site (isolation)", async () => {
    const other = (await createTestSite("Other", "other.com")).id;
    await createBucket(siteId, { name: "Ideas" }, admin.id);
    const b = await createBucket(other, { name: "Ideas" }, admin.id);
    expect(b.websiteId).toBe(other);
    expect(await listBuckets(other)).toHaveLength(1);
  });

  it("updates and deletes a bucket", async () => {
    const b = await createBucket(siteId, { name: "Old" }, admin.id);
    const updated = await updateBucket(siteId, b.id, { name: "New", color: "#123456" }, admin.id);
    expect(updated.name).toBe("New");
    await deleteBucket(siteId, b.id, admin.id);
    expect(await listBuckets(siteId)).toHaveLength(0);
  });

  it("deleting a bucket cascades its keywords", async () => {
    const b = await createBucket(siteId, { name: "Ideas" }, admin.id);
    await prisma.keywordRecord.create({
      data: { websiteId: siteId, bucketId: b.id, keyword: "rafting trips" },
    });
    await deleteBucket(siteId, b.id, admin.id);
    expect(await prisma.keywordRecord.count()).toBe(0);
  });

  it("fails on a missing site or bucket", async () => {
    await expect(createBucket("missing", { name: "x" }, admin.id)).rejects.toThrow(BucketServiceError);
    await expect(deleteBucket(siteId, "missing", admin.id)).rejects.toThrow(BucketServiceError);
  });
});
