import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  requireSitePermission,
  requireOperator,
  listAccessibleSiteIds,
  AccessDeniedError,
} from "@/lib/access";
import { listSites } from "@/server/website.service";
import { resetDb, createTestAdmin, createTestSite, createTestUser } from "./helpers";

async function grant(userId: string, websiteId: string, role: string, canPublish = false) {
  return prisma.websiteUserRole.create({
    data: { userId, websiteId, role, canPublish },
  });
}

describe("site-scoped authorization (cross-site isolation)", () => {
  let admin: { id: string };

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin(); // OPERATOR
  });

  it("OPERATORs bypass memberships on any website", async () => {
    const site = await createTestSite();
    const membership = await requireSitePermission(admin.id, site.id, "site.delete");
    expect(membership.role).toBe("OWNER");
    expect(membership.canPublish).toBe(true);
  });

  it("a member with the right role is allowed", async () => {
    const site = await createTestSite();
    const member = await createTestUser();
    await grant(member.id, site.id, "ADMIN");
    const m = await requireSitePermission(member.id, site.id, "settings.manage");
    expect(m.role).toBe("ADMIN");
  });

  it("a user with no membership is denied", async () => {
    const site = await createTestSite();
    const member = await createTestUser();
    await expect(requireSitePermission(member.id, site.id, "site.view")).rejects.toThrow(AccessDeniedError);
  });

  it("membership on one website never grants access to another website", async () => {
    const siteA = await createTestSite("A", "a.com");
    const siteB = await createTestSite("B", "b.com");
    const member = await createTestUser();
    await grant(member.id, siteA.id, "OWNER"); // full control of A
    expect((await requireSitePermission(member.id, siteA.id, "site.delete")).role).toBe("OWNER");
    await expect(requireSitePermission(member.id, siteB.id, "site.view")).rejects.toThrow(AccessDeniedError);
  });

  it("role grants are per website, not per user", async () => {
    const siteA = await createTestSite("A", "a.com");
    const siteB = await createTestSite("B", "b.com");
    const member = await createTestUser();
    await grant(member.id, siteA.id, "WRITER");
    await grant(member.id, siteB.id, "ADMIN");
    expect((await requireSitePermission(member.id, siteA.id, "drafts.create")).role).toBe("WRITER");
    expect((await requireSitePermission(member.id, siteB.id, "settings.manage")).role).toBe("ADMIN");
    // WRITER on A cannot manage settings on A…
    await expect(requireSitePermission(member.id, siteA.id, "settings.manage")).rejects.toThrow(AccessDeniedError);
  });

  it("WRITER can never publish, even with canPublish set", async () => {
    const site = await createTestSite();
    const writer = await createTestUser();
    await grant(writer.id, site.id, "WRITER", true);
    await expect(requireSitePermission(writer.id, site.id, "drafts.publish")).rejects.toThrow(AccessDeniedError);
  });

  it("EDITOR publishes only when canPublish is explicitly granted", async () => {
    const site = await createTestSite();
    const allowed = await createTestUser("editor-ok@test.local");
    const blocked = await createTestUser("editor-no@test.local");
    await grant(allowed.id, site.id, "EDITOR", true);
    await grant(blocked.id, site.id, "EDITOR", false);
    expect((await requireSitePermission(allowed.id, site.id, "drafts.publish")).canPublish).toBe(true);
    await expect(requireSitePermission(blocked.id, site.id, "drafts.publish")).rejects.toThrow(AccessDeniedError);
  });

  it("ADMIN publishes without a canPublish flag", async () => {
    const site = await createTestSite();
    const member = await createTestUser();
    await grant(member.id, site.id, "ADMIN", false);
    await expect(requireSitePermission(member.id, site.id, "drafts.publish")).resolves.toBeTruthy();
  });

  it("rejects permissions the role does not hold", async () => {
    const site = await createTestSite();
    const member = await createTestUser();
    await grant(member.id, site.id, "VIEWER");
    await expect(requireSitePermission(member.id, site.id, "drafts.create")).rejects.toThrow(AccessDeniedError);
  });

  it("rejects inactive accounts", async () => {
    const site = await createTestSite();
    const member = await createTestUser();
    await grant(member.id, site.id, "ADMIN");
    await prisma.user.update({ where: { id: member.id }, data: { isActive: false } });
    await expect(requireSitePermission(member.id, site.id, "site.view")).rejects.toThrow(AccessDeniedError);
  });

  it("requireOperator admits only OPERATORs", async () => {
    await expect(requireOperator(admin.id)).resolves.toBeUndefined();
    const member = await createTestUser();
    await expect(requireOperator(member.id)).rejects.toThrow(AccessDeniedError);
  });
});

describe("accessible site listing", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("OPERATORs can list every website", async () => {
    const admin = await createTestAdmin();
    const a = await createTestSite("A", "a.com");
    const b = await createTestSite("B", "b.com");
    const ids = await listAccessibleSiteIds(admin.id);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  it("members only see websites they belong to", async () => {
    const a = await createTestSite("A", "a.com");
    await createTestSite("B", "b.com");
    const member = await createTestUser();
    await prisma.websiteUserRole.create({
      data: { userId: member.id, websiteId: a.id, role: "VIEWER" },
    });
    const ids = await listAccessibleSiteIds(member.id);
    expect(ids).toEqual([a.id]);
  });

  it("listSites filters by membership for non-operators", async () => {
    const a = await createTestSite("A", "a.com");
    await createTestSite("B", "b.com");
    const member = await createTestUser();
    await prisma.websiteUserRole.create({
      data: { userId: member.id, websiteId: a.id, role: "EDITOR", canPublish: true },
    });
    const sites = await listSites(member.id);
    expect(sites.map((s) => s.id)).toEqual([a.id]);
  });
});