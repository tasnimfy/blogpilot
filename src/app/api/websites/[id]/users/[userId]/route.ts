import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { updateMembership, revokeMembership, MembershipServiceError } from "@/server/membership.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; userId: string };
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "access.manage");
    const body = await readJson(req);
    const membership = await updateMembership(user.id, params.id, params.userId, body);
    return json({ membership });
  } catch (e) {
    if (e instanceof MembershipServiceError) return json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "access.manage");
    const result = await revokeMembership(user.id, params.id, params.userId);
    return json(result);
  } catch (e) {
    if (e instanceof MembershipServiceError) return json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}