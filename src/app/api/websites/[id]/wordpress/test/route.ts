import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { testConnection } from "@/server/wordpress/connection.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "settings.manage");
    const result = await testConnection(params.id, user.id);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}
