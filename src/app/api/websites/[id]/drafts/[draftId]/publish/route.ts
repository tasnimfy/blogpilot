import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { publishDraft } from "@/server/wordpress/publish.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; draftId: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "drafts.publish");
    const body = await readJson(req);
    const result = await publishDraft(params.id, params.draftId, body as never);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}
