import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { updateKeyword, deleteKeyword } from "@/server/keyword.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; keywordId: string };
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "keywords.manage");
    const body = await readJson(req);
    const record = await updateKeyword(params.id, params.keywordId, body, user.id);
    return json({ record });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "keywords.manage");
    await deleteKeyword(params.id, params.keywordId, user.id);
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
