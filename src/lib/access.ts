import { prisma } from "@/lib/prisma";
import {
  hasSitePermission,
  permitsPublish,
  isSiteRole,
  type SitePermission,
  type SiteRole,
} from "@/lib/permissions";

// Server-side authorization. Deny by default: every protected operation must
// pass requireSitePermission (or requireOperator for global endpoints). A
// membership on one website never grants access to another website.

export class AccessDeniedError extends Error {
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export interface SiteMembership {
  userId: string;
  websiteId: string;
  role: SiteRole;
  canPublish: boolean;
}

async function getUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, globalRole: true, isActive: true },
  });
}

export function isOperator(user: { globalRole: string }): boolean {
  return user.globalRole === "OPERATOR";
}

// Returns the effective membership when the user may perform `permission` on
// the website; throws AccessDeniedError otherwise. OPERATORs bypass site
// memberships (they manage every website).
export async function requireSitePermission(
  userId: string,
  websiteId: string,
  permission: SitePermission
): Promise<SiteMembership> {
  const user = await getUser(userId);
  if (!user || !user.isActive) throw new AccessDeniedError("Account is not active");

  if (isOperator(user)) {
    return { userId, websiteId, role: "OWNER", canPublish: true };
  }

  const row = await prisma.websiteUserRole.findUnique({
    where: { userId_websiteId: { userId, websiteId } },
    select: { userId: true, websiteId: true, role: true, canPublish: true },
  });
  if (!row) throw new AccessDeniedError("You do not have access to this website");
  if (!isSiteRole(row.role)) throw new AccessDeniedError("Invalid role on membership");

  const role: SiteRole = row.role;
  if (permission === "drafts.publish") {
    if (!permitsPublish(role, row.canPublish)) throw new AccessDeniedError();
  } else if (!hasSitePermission(role, permission)) {
    throw new AccessDeniedError();
  }
  return { userId, websiteId, role, canPublish: row.canPublish };
}

// Global endpoints (user management, global job runs) are OPERATOR-only.
export async function requireOperator(userId: string): Promise<void> {
  const user = await getUser(userId);
  if (!user || !user.isActive || !isOperator(user)) {
    throw new AccessDeniedError("Operator access required");
  }
}

// Website ids the user may view: all sites for OPERATORs, otherwise only the
// sites they hold a membership on. Used to filter site listings.
export async function listAccessibleSiteIds(userId: string): Promise<string[]> {
  const user = await getUser(userId);
  if (!user || !user.isActive) return [];
  if (isOperator(user)) {
    const sites = await prisma.website.findMany({ select: { id: true } });
    return sites.map((s) => s.id);
  }
  const memberships = await prisma.websiteUserRole.findMany({
    where: { userId },
    select: { websiteId: true },
  });
  return memberships.map((m) => m.websiteId);
}

export function serializeMembership(row: {
  userId: string;
  websiteId: string;
  role: string;
  canPublish: boolean;
}): SiteMembership {
  return {
    userId: row.userId,
    websiteId: row.websiteId,
    role: isSiteRole(row.role) ? row.role : "VIEWER",
    canPublish: row.canPublish,
  };
}