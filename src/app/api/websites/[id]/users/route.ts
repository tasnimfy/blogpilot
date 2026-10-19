import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { grantMembership, listMembers, MembershipServiceError } from "@/server/membership.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

// Memberships are site-scoped: the actor must hold the access.manage
// permission on this exact website (OWNER/ADMIN, or an OPERATOR).

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "access.manage");
    const members = await listMembers(params.id);
    return json({ members });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "access.manage");
    const body = await readJson(req);
    const membership = await grantMembership(user.id, params.id, body);
    return json({ membership }, { status: 201 });
  } catch (e) {
    if (e instanceof MembershipServiceError) return json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}