import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import {
  transitionOpportunityStatus,
  workflowSummary,
  availableTransitions,
} from "@/server/opportunity-workflow.service";
import { prisma } from "@/lib/prisma";
import { json, apiError, readJson } from "@/lib/api";
import { z } from "zod";

interface Ctx {
  params: { id: string; opportunityId: string };
}

const transitionSchema = z.object({
  to: z.string().min(1).max(50),
  reason: z.string().max(2000).optional().nullable(),
});

// Explicit workflow transitions only (e.g. REVIEWED, QUEUED_FOR_ARTICLE_STUDIO,
// GENERATING, DRAFT_READY, FAILED). Arbitrary status changes are rejected.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    const body = transitionSchema.parse(await readJson(req));
    const opportunity = await transitionOpportunityStatus(params.id, params.opportunityId, body.to, user.id, {
      reason: body.reason ?? null,
    });
    return json({ opportunity, workflow: workflowSummary(opportunity) });
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const opp = await prisma.contentOpportunity.findFirst({
      where: { id: params.opportunityId, websiteId: params.id },
      select: { reviewStatus: true },
    });
    if (!opp) return json({ error: "Opportunity not found" }, { status: 404 });
    return json({ state: opp.reviewStatus, allowed: availableTransitions(opp.reviewStatus) });
  } catch (e) {
    return apiError(e);
  }
}