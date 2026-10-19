import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { z } from "zod";
import { SITE_ROLES, isSiteRole } from "@/lib/permissions";
import type { SiteRole } from "@/lib/permissions";

export class MembershipServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipServiceError";
  }
}

const grantSchema = z.object({
  email: z.string().email("Enter a valid email address").max(200),
  role: z.enum(SITE_ROLES),
  canPublish: z.boolean().optional().default(false),
});

const updateSchema = z.object({
  role: z.enum(SITE_ROLES).optional(),
  canPublish: z.boolean().optional(),
});

// --- Listing --------------------------------------------------------------

export async function listMembers(websiteId: string) {
  const rows = await prisma.websiteUserRole.findMany({
    where: { websiteId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, email: true, name: true, globalRole: true, isActive: true } },
    },
  });
  return rows.map((m) => ({
    userId: m.userId,
    websiteId: m.websiteId,
    role: m.role,
    canPublish: m.canPublish,
    createdAt: m.createdAt,
    user: m.user,
  }));
}

// --- Granting / updating / revoking ---------------------------------------

// Membership is assigned to an existing account (secure assignment; no
// invitation token is needed because the operator already controls accounts).
export async function grantMembership(actorUserId: string, websiteId: string, raw: unknown) {
  const data = grantSchema.parse(raw);
  const email = data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new MembershipServiceError(
      "No account exists with that email. An operator must create the account first."
    );
  }
  if (!user.isActive) throw new MembershipServiceError("That account is inactive");

  const existing = await prisma.websiteUserRole.findUnique({
    where: { userId_websiteId: { userId: user.id, websiteId } },
  });
  if (existing) throw new MembershipServiceError("That user is already a member of this website");

  // The OWNER role carries every permission (including site.delete). Only an
  // OPERATOR or an existing OWNER of the website may assign it; otherwise an
  // ADMIN could self-escalate to OWNER via access.manage.
  if (data.role === "OWNER" && !(await canManageOwner(actorUserId, websiteId))) {
    throw new MembershipServiceError("Only an OWNER or an OPERATOR can assign the OWNER role");
  }

  const membership = await prisma.websiteUserRole.create({
    data: { userId: user.id, websiteId, role: data.role, canPublish: data.canPublish && data.role === "EDITOR" },
  });
  await auditLog({
    userId: actorUserId,
    websiteId,
    action: "MEMBERSHIP_GRANTED",
    entity: "WebsiteUserRole",
    entityId: membership.id,
    detail: { user: email, role: data.role, canPublish: membership.canPublish },
  });
  return membership;
}

export async function updateMembership(
  actorUserId: string,
  websiteId: string,
  memberUserId: string,
  raw: unknown
) {
  const data = updateSchema.parse(raw);
  const membership = await prisma.websiteUserRole.findUnique({
    where: { userId_websiteId: { userId: memberUserId, websiteId } },
  });
  if (!membership) throw new MembershipServiceError("Membership not found");

  const nextRole: SiteRole = data.role ?? (isSiteRole(membership.role) ? membership.role : "VIEWER");
  if (data.role !== undefined) {
    await assertNotLastOwner(websiteId, memberUserId, data.role);
  }

  // Granting/promoting to OWNER or altering an existing OWNER membership
  // requires OWNER/OPERATOR authority (prevents ADMIN self-escalation).
  if ((membership.role === "OWNER" || nextRole === "OWNER") && !(await canManageOwner(actorUserId, websiteId))) {
    throw new MembershipServiceError("Only an OWNER or an OPERATOR can change the OWNER role");
  }

  const nextCanPublish =
    data.canPublish !== undefined ? data.canPublish && nextRole === "EDITOR" : membership.canPublish && nextRole === "EDITOR";

  const updated = await prisma.websiteUserRole.update({
    where: { id: membership.id },
    data: { role: nextRole, canPublish: nextCanPublish },
  });
  await auditLog({
    userId: actorUserId,
    websiteId,
    action: "MEMBERSHIP_UPDATED",
    entity: "WebsiteUserRole",
    entityId: membership.id,
    detail: { userId: memberUserId, role: nextRole, canPublish: nextCanPublish },
  });
  return updated;
}

export async function revokeMembership(actorUserId: string, websiteId: string, memberUserId: string) {
  const membership = await prisma.websiteUserRole.findUnique({
    where: { userId_websiteId: { userId: memberUserId, websiteId } },
  });
  if (!membership) throw new MembershipServiceError("Membership not found");
  // Removing an OWNER requires OWNER/OPERATOR authority as well.
  if (membership.role === "OWNER" && !(await canManageOwner(actorUserId, websiteId))) {
    throw new MembershipServiceError("Only an OWNER or an OPERATOR can remove the OWNER role");
  }
  await assertNotLastOwner(websiteId, memberUserId);

  await prisma.websiteUserRole.delete({ where: { id: membership.id } });
  await auditLog({
    userId: actorUserId,
    websiteId,
    action: "MEMBERSHIP_REVOKED",
    entity: "WebsiteUserRole",
    entityId: membership.id,
    detail: { userId: memberUserId },
  });
  return { ok: true };
}

// The OWNER role has every site permission (including site.delete). Managing
// OWNER memberships is restricted to OPERATORs and existing site OWNERs so a
// lower role (e.g. ADMIN with access.manage) cannot self-escalate to OWNER.
async function canManageOwner(actorUserId: string, websiteId: string): Promise<boolean> {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { globalRole: true },
  });
  if (actor?.globalRole === "OPERATOR") return true;
  const membership = await prisma.websiteUserRole.findUnique({
    where: { userId_websiteId: { userId: actorUserId, websiteId } },
    select: { role: true },
  });
  return membership?.role === "OWNER";
}

// A website must always keep at least one OWNER: the last Owner cannot be
// demoted, removed, or have their membership revoked.
async function assertNotLastOwner(websiteId: string, memberUserId: string, newRole?: SiteRole) {
  const target = await prisma.websiteUserRole.findUnique({
    where: { userId_websiteId: { userId: memberUserId, websiteId } },
  });
  if (!target) return;
  const isOwnerNow = target.role === "OWNER";
  const willBeOwner = newRole === "OWNER";
  if (!isOwnerNow || willBeOwner) return;
  const ownerCount = await prisma.websiteUserRole.count({ where: { websiteId, role: "OWNER" } });
  if (ownerCount <= 1) {
    throw new MembershipServiceError("Cannot remove or demote the last Owner of the website");
  }
}