import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { deleteImage } from "@/server/image.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string; imageId: string };
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "images.manage");
    await deleteImage(params.id, params.imageId, user.id);
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
