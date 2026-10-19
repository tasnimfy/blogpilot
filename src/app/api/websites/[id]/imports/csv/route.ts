import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { importKeywordCsv } from "@/server/keyword-import.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "keywords.manage");
    const body = await readJson(req);
    const record = body as { fileContent?: string; bucketId?: string };
    if (typeof record?.fileContent !== "string" || !record.bucketId) {
      return json({ error: "fileContent and bucketId are required" }, { status: 400 });
    }
    const result = await importKeywordCsv(params.id, record.fileContent, body, user.id);
    return json(result, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
