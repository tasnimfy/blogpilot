import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { updateTrendConfig, deleteTrendConfig } from "@/server/trends.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; configId: string };
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "trends.manage");
    const body = await readJson(req);
    const config = await updateTrendConfig(params.id, params.configId, body, user.id);
    return json({ config });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "trends.manage");
    await deleteTrendConfig(params.id, params.configId, user.id);
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
