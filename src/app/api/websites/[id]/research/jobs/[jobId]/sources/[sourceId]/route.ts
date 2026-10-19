import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { deleteResearchSource } from "@/server/research.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string; jobId: string; sourceId: string };
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "research.manage");
    await deleteResearchSource(params.id, params.sourceId, user.id);
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
