import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { importTrendsCsv } from "@/server/trends.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "trends.manage");
    const body = await readJson(req);
    const record = body as { fileContent?: string };
    if (typeof record?.fileContent !== "string") return json({ error: "fileContent is required" }, { status: 400 });
    const result = await importTrendsCsv(params.id, record.fileContent, body, user.id);
    return json(result, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
