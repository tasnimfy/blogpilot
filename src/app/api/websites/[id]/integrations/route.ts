import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { integrationOverview, providerCatalog, updateSourceConfig, permissionForSource } from "@/server/integration.service";
import { isSyncSource } from "@/server/sync-status.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const [statuses, providers] = await Promise.all([
      integrationOverview(params.id),
      Promise.resolve(providerCatalog()),
    ]);
    return json({ statuses, providers });
  } catch (e) {
    return apiError(e);
  }
}

// Update configuration (enabled / refresh interval / provider) for one source.
// Guarded with the same permission the source's data is managed under.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const body = (await readJson(req)) as {
      source?: unknown;
      enabled?: unknown;
      refreshIntervalMinutes?: unknown;
      providerId?: unknown;
    };
    if (typeof body.source !== "string" || !isSyncSource(body.source)) {
      return json({ error: "source is required and must be one of KEYWORDS, GSC, TRENDS" }, { status: 400 });
    }
    await requireSitePermission(user.id, params.id, permissionForSource(body.source));
    const updated = await updateSourceConfig(
      params.id,
      body.source,
      {
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        refreshIntervalMinutes:
          typeof body.refreshIntervalMinutes === "number" ? body.refreshIntervalMinutes : undefined,
        providerId: typeof body.providerId === "string" || body.providerId === null ? body.providerId : undefined,
      },
      user.id
    );
    return json({ status: updated });
  } catch (e) {
    return apiError(e);
  }
}