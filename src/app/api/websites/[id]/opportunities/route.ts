import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { createOpportunity, listOpportunities } from "@/server/opportunity.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const sp = new URL(req.url).searchParams;
    const result = await listOpportunities(params.id, Object.fromEntries(sp.entries()));
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    const body = await readJson(req);
    const opportunity = await createOpportunity(params.id, body, user.id);
    return json({ opportunity }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
