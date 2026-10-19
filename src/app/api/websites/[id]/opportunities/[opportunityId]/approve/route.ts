import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { approveOpportunity } from "@/server/opportunity-workflow.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string; opportunityId: string };
}

// Approve an opportunity: validates the caller's permission on this website,
// records who approved it and when, creates/links the Article Studio item
// (idempotent) and makes it eligible for the daily generation queue.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    const result = await approveOpportunity(params.id, params.opportunityId, user.id);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}