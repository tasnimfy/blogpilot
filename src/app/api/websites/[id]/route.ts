import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { getSite, updateSite, deleteSite } from "@/server/website.service";
import { serializeAiConfig, serializeWordpress } from "@/server/settings.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const site = await getSite(params.id);
    if (!site) return json({ error: "Website not found" }, { status: 404 });
    // Never expose stored secrets: AI config and WordPress connection are
    // serialized down to hasApiKey / hasAppPassword booleans.
    return json({
      site: {
        ...site,
        aiConfiguration: site.aiConfiguration ? serializeAiConfig(site.aiConfiguration as never) : null,
        wordpressConnection: site.wordpressConnection ? serializeWordpress(site.wordpressConnection as never) : null,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "settings.manage");
    const body = await readJson(req);
    const site = await updateSite(params.id, body as never, user.id);
    return json({ site });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.delete");
    await deleteSite(params.id, user.id);
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
