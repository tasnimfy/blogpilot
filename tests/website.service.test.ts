import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createSite,
  updateSite,
  deleteSite,
  setSiteStatus,
  getSite,
  listSites,
  WebsiteServiceError,
} from "@/server/website.service";
import { resetDb, createTestAdmin } from "./helpers";

describe("multi-site management", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("adds multiple websites with isolated data", async () => {
    const admin = await createTestAdmin();
    const a = await createSite(
      { name: "White Rafting", domain: "whiterafting.com", url: "https://whiterafting.com", niche: "rafting" },
      admin.id
    );
    const b = await createSite(
      { name: "Web Hosting Blog", domain: "webhosting.com", url: "https://webhosting.com", niche: "hosting" },
      admin.id
    );
    expect(a.id).not.toBe(b.id);
    const sites = await listSites();
    expect(sites).toHaveLength(2);

    // Each site got its own settings + guidelines + AI config rows (1:1).
    expect(await prisma.websiteSettings.count({ where: { websiteId: a.id } })).toBe(1);
    expect(await prisma.websiteSettings.count({ where: { websiteId: b.id } })).toBe(1);
  });

  it("rejects a duplicate domain", async () => {
    const admin = await createTestAdmin();
    await createSite({ name: "A", domain: "dup.com", url: "https://dup.com" }, admin.id);
    await expect(
      createSite({ name: "B", domain: "dup.com", url: "https://dup.com" }, admin.id)
    ).rejects.toThrow(WebsiteServiceError);
  });

  it("rejects an invalid domain", async () => {
    const admin = await createTestAdmin();
    await expect(
      createSite({ name: "A", domain: "not a domain", url: "https://x.com" }, admin.id)
    ).rejects.toThrow(WebsiteServiceError);
  });

  it("updates a site and changes status", async () => {
    const admin = await createTestAdmin();
    const site = await createSite({ name: "A", domain: "a.com", url: "https://a.com" }, admin.id);
    const updated = await updateSite(site.id, { name: "A Renamed", targetCountries: ["US", "CA"] }, admin.id);
    expect(updated.name).toBe("A Renamed");
    const disabled = await setSiteStatus(site.id, "DISABLED", admin.id);
    expect(disabled.status).toBe("DISABLED");
  });

  it("updating a missing site throws", async () => {
    const admin = await createTestAdmin();
    await expect(updateSite("missing", { name: "x" }, admin.id)).rejects.toThrow(WebsiteServiceError);
  });

  it("deletes a site and cascades its owned records", async () => {
    const admin = await createTestAdmin();
    const site = await createSite({ name: "A", domain: "a.com", url: "https://a.com" }, admin.id);
    await prisma.keywordBucket.create({ data: { websiteId: site.id, name: "Ideas" } });
    await deleteSite(site.id, admin.id);
    expect(await prisma.website.findUnique({ where: { id: site.id } })).toBeNull();
    expect(await prisma.keywordBucket.count()).toBe(0);
    expect(await prisma.websiteSettings.count()).toBe(0);
  });

  it("site queries are scoped by website", async () => {
    const admin = await createTestAdmin();
    const a = await createSite({ name: "A", domain: "a.com", url: "https://a.com" }, admin.id);
    await createSite({ name: "B", domain: "b.com", url: "https://b.com" }, admin.id);
    const got = await getSite(a.id);
    expect(got?.id).toBe(a.id);
    expect(got?.name).toBe("A");
    expect(await getSite("nonexistent")).toBeNull();
  });
});
