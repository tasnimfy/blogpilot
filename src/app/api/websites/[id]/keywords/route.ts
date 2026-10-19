import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { listKeywords, createKeyword } from "@/server/keyword.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const sp = new URL(req.url).searchParams;
    const query = Object.fromEntries(sp.entries());
    const result = await listKeywords(params.id, query);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "keywords.manage");
    const body = await readJson(req);
    const record = await createKeyword(params.id, body, user.id);
    return json({ record }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
