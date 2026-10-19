import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { runTrendsJob } from "@/server/trends.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string; configId: string };
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "trends.manage");
    const result = await runTrendsJob(params.configId, undefined, params.id);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}
