import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { saveImage, listImages } from "@/server/image.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const images = await listImages(params.id);
    return json({ images });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "images.manage");
    const body = await readJson(req);
    const image = await saveImage(params.id, body, user.id);
    return json({ image }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
