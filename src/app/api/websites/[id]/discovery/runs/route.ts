import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { listDiscoveryRuns, runDiscovery } from "@/server/discovery.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const runs = await listDiscoveryRuns(params.id);
    return json({ runs });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "opportunities.manage");
    // Body is optional: an empty body triggers a default MANUAL run.
    const body = (await readJson(req).catch(() => ({}))) as {
      triggeredBy?: "MANUAL" | "SCHEDULED";
    };
    const result = await runDiscovery(params.id, {
      triggeredBy: body.triggeredBy ?? "MANUAL",
      userId: user.id,
    });
    if (!result.ok && !result.skipped) {
      return json({ error: result.error ?? "Discovery run failed" }, { status: 400 });
    }
    return json({
      run: result.run ?? null,
      summary: result.summary ?? null,
      skipped: result.skipped ?? false,
      reason: result.reason ?? null,
    });
  } catch (e) {
    return apiError(e);
  }
}