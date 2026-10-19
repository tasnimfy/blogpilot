import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { mergeKeywords } from "@/server/keyword.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "keywords.manage");
    const body = (await readJson(req)) as { keepId?: string; mergeIds?: string[] };
    if (!body?.keepId || !Array.isArray(body.mergeIds)) {
      return json({ error: "keepId and mergeIds are required" }, { status: 400 });
    }
    const record = await mergeKeywords(params.id, body.keepId, body.mergeIds, user.id);
    return json({ record });
  } catch (e) {
    return apiError(e);
  }
}
