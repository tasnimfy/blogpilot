import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { listGenerationJobs } from "@/server/generation.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "automation.manage");
    const result = await listGenerationJobs(params.id);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}