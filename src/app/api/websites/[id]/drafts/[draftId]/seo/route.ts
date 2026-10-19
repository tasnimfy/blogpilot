import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { analyzeDraft, serializeSeo } from "@/server/seo.service";
import { prisma } from "@/lib/prisma";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; draftId: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const seo = await prisma.sEOAnalysis.findUnique({ where: { draftId: params.draftId } });
    if (!seo) return json({ analysis: null });
    return json({ analysis: serializeSeo(seo as never) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "seo.analyze");
    const body = await readJson(req);
    const analysis = await analyzeDraft(params.id, params.draftId, body as never);
    return json({ analysis });
  } catch (e) {
    return apiError(e);
  }
}
