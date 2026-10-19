import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { getDiscoveryRun } from "@/server/discovery.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string; runId: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const run = await getDiscoveryRun(params.id, params.runId);
    if (!run) return json({ error: "Discovery run not found" }, { status: 404 });
    return json({ run });
  } catch (e) {
    return apiError(e);
  }
}