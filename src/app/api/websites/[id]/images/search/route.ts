import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { searchImages, providerCapabilities } from "@/server/image.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "images.manage");
    const sp = new URL(req.url).searchParams;
    const provider = sp.get("provider");
    const q = sp.get("q") ?? "";
    const result = await searchImages(params.id, provider, q);
    return json({ ...result, providers: providerCapabilities() });
  } catch (e) {
    return apiError(e);
  }
}
