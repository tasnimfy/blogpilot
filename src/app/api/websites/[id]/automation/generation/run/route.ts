import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { runGenerationForWebsite } from "@/server/generation.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

// Manual "run now": drains this website's generation queue in one pass.
// Permission is rechecked at the service layer (actorId) as well as here.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "automation.manage");
    const result = await runGenerationForWebsite(params.id, { actorId: user.id });
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}