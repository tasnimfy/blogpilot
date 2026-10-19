import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { permissionForSource, runSourceSync } from "@/server/integration.service";
import { isSyncSource } from "@/server/sync-status.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string; source: string };
}

// Manually trigger a data collection run for one source of one website.
// The same RBAC permission that governs the source's data also gates its sync.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { source } = params;
    if (!isSyncSource(source)) {
      return json({ error: "source must be one of KEYWORDS, GSC, TRENDS" }, { status: 400 });
    }
    await requireSitePermission(user.id, params.id, permissionForSource(source));
    const result = await runSourceSync(params.id, source);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}