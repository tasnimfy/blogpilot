import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { updateBucket, deleteBucket } from "@/server/bucket.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; bucketId: string };
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "keywords.manage");
    const body = await readJson(req);
    const bucket = await updateBucket(params.id, params.bucketId, body, user.id);
    return json({ bucket });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "keywords.manage");
    await deleteBucket(params.id, params.bucketId, user.id);
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
