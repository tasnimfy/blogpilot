import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { listTrendConfigs, createTrendConfig } from "@/server/trends.service";
import { listTrendsProviders } from "@/providers/trends-providers";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const configs = await listTrendConfigs(params.id);
    return json({ configs, providers: listTrendsProviders().map((p) => ({ id: p.id, name: p.name, capabilities: p.capabilities })) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "trends.manage");
    const body = await readJson(req);
    const config = await createTrendConfig(params.id, body, user.id);
    return json({ config }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

