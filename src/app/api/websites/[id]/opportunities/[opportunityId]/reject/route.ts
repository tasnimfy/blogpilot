import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { rejectOpportunity } from "@/server/opportunity-workflow.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; opportunityId: string };
}

// Reject an opportunity with an optional reason (recorded with the decision).
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    const body = (await readJson(req).catch(() => ({}))) as { reason?: string | null };
    const opportunity = await rejectOpportunity(params.id, params.opportunityId, user.id, body.reason ?? null);
    return json({ opportunity });
  } catch (e) {
    return apiError(e);
  }
}