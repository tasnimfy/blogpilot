import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { addResearchFinding } from "@/server/research.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; jobId: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "research.manage");
    const body = await readJson(req);
    const finding = await addResearchFinding(params.id, params.jobId, body, user.id);
    return json({ finding }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
