import { NextRequest } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { listAccessibleSiteIds } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { json, apiError } from "@/lib/api";

export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();
    // Per-website grants for the session: used by the UI to show role-aware
    // actions. Membership on one website never grants access to another.
    const accessibleIds = await listAccessibleSiteIds(user.id);
    const memberships = await prisma.websiteUserRole.findMany({
      where: { userId: user.id },
      select: { websiteId: true, role: true, canPublish: true },
    });
    const grants = memberships.map((m) => ({
      websiteId: m.websiteId,
      role: m.role,
      canPublish: m.canPublish,
    }));
    return json({ user, accessibleSiteIds: accessibleIds, grants });
  } catch (e) {
    if (e instanceof AuthError) return json({ user: null }, { status: 200 });
    return apiError(e);
  }
}
