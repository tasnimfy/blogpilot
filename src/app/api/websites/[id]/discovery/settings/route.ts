import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { getDiscoverySettings, updateDiscoverySettings } from "@/server/discovery.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const settings = await getDiscoverySettings(params.id);
    return json({ settings });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    const body = await readJson(req);
    const settings = await updateDiscoverySettings(params.id, body, user.id);
    return json({ settings });
  } catch (e) {
    return apiError(e);
  }
}