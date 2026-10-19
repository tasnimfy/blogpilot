import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { setSiteStatus } from "@/server/website.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "settings.manage");
    const body = (await readJson(req)) as { status?: string };
    if (!body?.status) return json({ error: "status is required" }, { status: 400 });
    const site = await setSiteStatus(params.id, body.status, user.id);
    return json({ site });
  } catch (e) {
    return apiError(e);
  }
}
