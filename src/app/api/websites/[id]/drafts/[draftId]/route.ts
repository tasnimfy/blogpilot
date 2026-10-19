import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { getDraft, updateDraft, deleteDraft } from "@/server/article.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; draftId: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const draft = await getDraft(params.id, params.draftId);
    if (!draft) return json({ error: "Draft not found" }, { status: 404 });
    return json({ draft });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "drafts.edit");
    const body = await readJson(req);
    const draft = await updateDraft(params.id, params.draftId, body, user.id);
    return json({ draft });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "drafts.edit");
    await deleteDraft(params.id, params.draftId, user.id);
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
