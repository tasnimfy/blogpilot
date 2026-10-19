import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { getOpportunity } from "@/server/opportunity.service";
import { prisma } from "@/lib/prisma";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; opportunityId: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const opportunity = await getOpportunity(params.id, params.opportunityId);
    if (!opportunity) return json({ error: "Opportunity not found" }, { status: 404 });
    return json({ opportunity });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    const body = await readJson(req);
    const opp = await prisma.contentOpportunity.findFirst({ where: { id: params.opportunityId, websiteId: params.id } });
    if (!opp) return json({ error: "Opportunity not found" }, { status: 404 });
    // NOTE: status/reviewStatus are intentionally NOT editable here — the
    // workflow state only changes through the explicit transition endpoints
    // (approve, reject, workflow) so invalid state jumps are impossible.
    const allowed = ["title", "commercialIntent", "seasonal", "existingPageOverlap", "notes", "recommendedAction", "searchIntent", "contentType", "keywords", "action"];
    const payload: Record<string, unknown> = {};
    for (const k of allowed) if ((body as Record<string, unknown>)[k] !== undefined) payload[k] = (body as Record<string, unknown>)[k];
    const updated = await prisma.contentOpportunity.update({ where: { id: opp.id }, data: payload });
    return json({ opportunity: updated });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    const opp = await prisma.contentOpportunity.findFirst({ where: { id: params.opportunityId, websiteId: params.id } });
    if (!opp) return json({ error: "Opportunity not found" }, { status: 404 });
    await prisma.contentOpportunity.delete({ where: { id: opp.id } });
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
