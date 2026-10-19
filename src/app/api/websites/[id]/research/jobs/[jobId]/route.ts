import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { getResearchJob, serializeBrief } from "@/server/research.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string; jobId: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const job = await getResearchJob(params.jobId);
    if (!job || job.websiteId !== params.id) return json({ error: "Research job not found" }, { status: 404 });
    return json({ job, brief: serializeBrief(job.brief) });
  } catch (e) {
    return apiError(e);
  }
}
