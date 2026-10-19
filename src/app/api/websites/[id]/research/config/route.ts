import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { getResearchConfig, updateResearchConfig, SOURCE_PRESETS } from "@/server/research-config.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const config = await getResearchConfig(params.id);
    return json({ config, presets: SOURCE_PRESETS });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "research.manage");
    const body = await readJson(req);
    const config = await updateResearchConfig(params.id, body, user.id);
    return json({ config });
  } catch (e) {
    return apiError(e);
  }
}
