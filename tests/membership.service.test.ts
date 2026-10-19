import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  grantMembership,
  updateMembership,
  revokeMembership,
  listMembers,
  MembershipServiceError,
} from "@/server/membership.service";
import { resetDb, createTestAdmin, createTestSite, createTestUser } from "./helpers";

describe("website membership management", () => {
  let admin: { id: string };
  let site: { id: string };

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    site = await createTestSite();
  });

  it("grants membership by email of an existing account", async () => {
    const member = await createTestUser("writer@test.local");
    const m = await grantMembership(admin.id, site.id, {
      email: "writer@test.local",
      role: "WRITER",
    });
    expect(m.userId).toBe(member.id);
    expect(m.websiteId).toBe(site.id);
    expect(m.role).toBe("WRITER");
    expect(m.canPublish).toBe(false);
  });

  it("refuses to grant to an email with no account", async () => {
    await expect(
      grantMembership(admin.id, site.id, { email: "nobody@test.local", role: "VIEWER" })
    ).rejects.toThrow(MembershipServiceError);
  });

  it("refuses to grant to an inactive account", async () => {
    const member = await createTestUser("off@test.local");
    await prisma.user.update({ where: { id: member.id }, data: { isActive: false } });
    await expect(
      grantMembership(admin.id, site.id, { email: "off@test.local", role: "VIEWER" })
    ).rejects.toThrow(MembershipServiceError);
  });

  it("refuses duplicate memberships", async () => {
    await createTestUser("twice@test.local");
    await grantMembership(admin.id, site.id, { email: "twice@test.local", role: "EDITOR" });
    await expect(
      grantMembership(admin.id, site.id, { email: "twice@test.local", role: "ADMIN" })
    ).rejects.toThrow(MembershipServiceError);
  });

  it("only honors canPublish for the EDITOR role", async () => {
    await createTestUser("ed@test.local");
    const editor = await grantMembership(admin.id, site.id, {
      email: "ed@test.local",
      role: "EDITOR",
      canPublish: true,
    });
    expect(editor.canPublish).toBe(true);

    await createTestUser("wr@test.local");
    const writer = await grantMembership(admin.id, site.id, {
      email: "wr@test.local",
      role: "WRITER",
      canPublish: true,
    });
    expect(writer.canPublish).toBe(false);
  });

  it("lists members with their user info", async () => {
    await createTestUser("a@test.local");
    await grantMembership(admin.id, site.id, { email: "a@test.local", role: "VIEWER" });
    const members = await listMembers(site.id);
    expect(members).toHaveLength(1);
    expect(members[0].user.email).toBe("a@test.local");
  });

  it("updates a membership role", async () => {
    const member = await createTestUser("u@test.local");
    await grantMembership(admin.id, site.id, { email: "u@test.local", role: "VIEWER" });
    const updated = await updateMembership(admin.id, site.id, member.id, {
      role: "EDITOR",
      canPublish: true,
    });
    expect(updated.role).toBe("EDITOR");
    expect(updated.canPublish).toBe(true);
  });

  it("clears canPublish when an EDITOR is demoted", async () => {
    const member = await createTestUser("e@test.local");
    await grantMembership(admin.id, site.id, { email: "e@test.local", role: "EDITOR", canPublish: true });
    const updated = await updateMembership(admin.id, site.id, member.id, { role: "WRITER" });
    expect(updated.role).toBe("WRITER");
    expect(updated.canPublish).toBe(false);
  });

  it("cannot demote the last OWNER", async () => {
    const member = await createTestUser("owner@test.local");
    await grantMembership(admin.id, site.id, { email: "owner@test.local", role: "OWNER" });
    await expect(
      updateMembership(admin.id, site.id, member.id, { role: "ADMIN" })
    ).rejects.toThrow(MembershipServiceError);
  });

  it("ADMIN cannot grant the OWNER role (no self-escalation)", async () => {
    const siteAdmin = await createTestUser("siteadmin@test.local");
    await grantMembership(admin.id, site.id, { email: "siteadmin@test.local", role: "ADMIN" });
    await createTestUser("victim@test.local");
    await expect(
      grantMembership(siteAdmin.id, site.id, { email: "victim@test.local", role: "OWNER" })
    ).rejects.toThrow(MembershipServiceError);
  });

  it("ADMIN cannot promote to OWNER (no self-escalation)", async () => {
    const siteAdmin = await createTestUser("siteadmin2@test.local");
    await grantMembership(admin.id, site.id, { email: "siteadmin2@test.local", role: "ADMIN" });
    const member = await createTestUser("promote@test.local");
    await grantMembership(admin.id, site.id, { email: "promote@test.local", role: "EDITOR" });
    await expect(
      updateMembership(siteAdmin.id, site.id, member.id, { role: "OWNER" })
    ).rejects.toThrow(MembershipServiceError);
  });

  it("ADMIN cannot demote or revoke an existing OWNER", async () => {
    const siteAdmin = await createTestUser("siteadmin3@test.local");
    await grantMembership(admin.id, site.id, { email: "siteadmin3@test.local", role: "ADMIN" });
    const owner = await createTestUser("realowner@test.local");
    await grantMembership(admin.id, site.id, { email: "realowner@test.local", role: "OWNER" });
    await expect(
      updateMembership(siteAdmin.id, site.id, owner.id, { role: "ADMIN" })
    ).rejects.toThrow(MembershipServiceError);
    await expect(revokeMembership(siteAdmin.id, site.id, owner.id)).rejects.toThrow(MembershipServiceError);
  });

  it("an OWNER can grant the OWNER role", async () => {
    const owner = await createTestUser("o3@test.local");
    await grantMembership(admin.id, site.id, { email: "o3@test.local", role: "OWNER" });
    await createTestUser("newowner@test.local");
    const m = await grantMembership(owner.id, site.id, { email: "newowner@test.local", role: "OWNER" });
    expect(m.role).toBe("OWNER");
  });

  it("cannot revoke the last OWNER", async () => {
    const member = await createTestUser("owner2@test.local");
    await grantMembership(admin.id, site.id, { email: "owner2@test.local", role: "OWNER" });
    await expect(revokeMembership(admin.id, site.id, member.id)).rejects.toThrow(MembershipServiceError);
  });

  it("can demote an OWNER while another OWNER remains", async () => {
    const a = await createTestUser("o1@test.local");
    const b = await createTestUser("o2@test.local");
    await grantMembership(admin.id, site.id, { email: "o1@test.local", role: "OWNER" });
    await grantMembership(admin.id, site.id, { email: "o2@test.local", role: "OWNER" });
    await expect(updateMembership(admin.id, site.id, a.id, { role: "ADMIN" })).resolves.toBeTruthy();
  });

  it("revokes a membership", async () => {
    const member = await createTestUser("bye@test.local");
    await grantMembership(admin.id, site.id, { email: "bye@test.local", role: "WRITER" });
    const res = await revokeMembership(admin.id, site.id, member.id);
    expect(res.ok).toBe(true);
    expect(await listMembers(site.id)).toHaveLength(0);
  });

  it("audit-logs grant, update and revoke", async () => {
    const member = await createTestUser("audit@test.local");
    await grantMembership(admin.id, site.id, { email: "audit@test.local", role: "EDITOR", canPublish: true });
    await updateMembership(admin.id, site.id, member.id, { role: "ADMIN" });
    await revokeMembership(admin.id, site.id, member.id);
    const actions = await prisma.auditLog.findMany({
      where: { action: { in: ["MEMBERSHIP_GRANTED", "MEMBERSHIP_UPDATED", "MEMBERSHIP_REVOKED"] } },
    });
    expect(actions.map((a) => a.action).sort()).toEqual([
      "MEMBERSHIP_GRANTED",
      "MEMBERSHIP_REVOKED",
      "MEMBERSHIP_UPDATED",
    ]);
  });
});