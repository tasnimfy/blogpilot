import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { previewKeywordCsv } from "@/server/keyword-import.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "keywords.manage");
    const body = (await readJson(req)) as { fileContent?: string; hasHeader?: boolean; mapping?: Record<string, number> };
    if (typeof body?.fileContent !== "string") {
      return json({ error: "fileContent is required" }, { status: 400 });
    }
    const preview = previewKeywordCsv(body.fileContent, { hasHeader: body.hasHeader, mapping: body.mapping });
    return json({ preview });
  } catch (e) {
    return apiError(e);
  }
}
