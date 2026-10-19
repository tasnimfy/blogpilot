import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { getSite } from "@/server/website.service";
import { updateGuidelines } from "@/server/settings.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const site = await getSite(params.id);
    if (!site) return json({ error: "Website not found" }, { status: 404 });
    return json({ guidelines: site.guidelines });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "settings.manage");
    const body = await readJson(req);
    const guidelines = await updateGuidelines(params.id, body as never, user.id);
    return json({ guidelines });
  } catch (e) {
    return apiError(e);
  }
}
