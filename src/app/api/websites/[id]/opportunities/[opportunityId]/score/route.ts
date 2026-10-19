import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { scoreOpportunity, serializeScore } from "@/server/opportunity.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; opportunityId: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    const body = await readJson(req);
    const result = await scoreOpportunity(params.id, params.opportunityId, body, user.id);
    return json({ score: serializeScore(result.score as never), isOverride: result.isOverride, total: result.total });
  } catch (e) {
    return apiError(e);
  }
}
