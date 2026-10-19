import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { generateArticle } from "@/server/article.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string; draftId: string };
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "drafts.generate");
    const result = await generateArticle(params.id, params.draftId, user.id);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}
