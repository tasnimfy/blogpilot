import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { importGscCsv, deriveGscOpportunities } from "@/server/searchconsole.service";
import { prisma } from "@/lib/prisma";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "keywords.manage");
    const body = await readJson(req);
    const record = body as { fileContent?: string };
    if (typeof record?.fileContent !== "string") {
      return json({ error: "fileContent is required" }, { status: 400 });
    }
    const result = await importGscCsv(params.id, record.fileContent, body, user.id);
    const recent = await prisma.searchConsoleRecord.findMany({
      where: { websiteId: params.id },
      select: { query: true, page: true, clicks: true, impressions: true, ctr: true, position: true },
      take: 2000,
    });
    const opportunities = deriveGscOpportunities(recent);
    return json({ ...result, opportunities }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
