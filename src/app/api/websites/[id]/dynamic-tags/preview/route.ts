import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { expandDynamicTags, SUPPORTED_TAGS } from "@/lib/dynamic-tags";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

// Expand dynamic tags for a draft using the site's timezone/name/domain,
// without mutating the stored draft. Returns resolved text + warnings.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "drafts.edit");
    const body = (await readJson(req)) as { text?: string };
    if (typeof body?.text !== "string") return json({ error: "text is required" }, { status: 400 });
    const site = await prisma.website.findUnique({ where: { id: params.id } });
    if (!site) return json({ error: "Website not found" }, { status: 404 });
    const resolved = expandDynamicTags(body.text, {
      siteName: site.name,
      siteDomain: site.domain,
      timezone: site.timezone,
    });
    return json({ ...resolved, supportedTags: SUPPORTED_TAGS });
  } catch (e) {
    return apiError(e);
  }
}
