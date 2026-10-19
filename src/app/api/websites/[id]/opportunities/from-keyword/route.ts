import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { createOpportunityFromKeyword } from "@/server/opportunity.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    const body = (await readJson(req)) as { keywordId?: string };
    if (!body?.keywordId) return json({ error: "keywordId is required" }, { status: 400 });
    const opportunity = await createOpportunityFromKeyword(params.id, body.keywordId, user.id);
    return json({ opportunity }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
