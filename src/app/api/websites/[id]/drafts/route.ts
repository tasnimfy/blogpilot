import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { createDraft, listDrafts } from "@/server/article.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const sp = new URL(req.url).searchParams;
    const result = await listDrafts(params.id, Object.fromEntries(sp.entries()));
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "drafts.create");
    const body = await readJson(req);
    const draft = await createDraft(params.id, body, user.id);
    return json({ draft }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
