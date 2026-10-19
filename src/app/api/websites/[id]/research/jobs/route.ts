import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { runResearch, listResearchJobs } from "@/server/research.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const sp = new URL(req.url).searchParams;
    const opportunityId = sp.get("opportunityId") ?? undefined;
    const jobs = await listResearchJobs(params.id, opportunityId);
    return json({ jobs });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "research.manage");
    const body = await readJson(req);
    const job = await runResearch(params.id, body, user.id);
    return json({ job }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
