import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { listObservations } from "@/server/trends.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const sp = new URL(req.url).searchParams;
    const observations = await listObservations(params.id, sp.get("configId") ?? undefined, sp.get("term") ?? undefined);
    return json({ observations });
  } catch (e) {
    return apiError(e);
  }
}
