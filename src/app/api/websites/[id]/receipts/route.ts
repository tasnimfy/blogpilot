import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "site.view");
    const receipts = await prisma.publicationReceipt.findMany({
      where: { websiteId: params.id },
      orderBy: { publishedAt: "desc" },
      take: 50,
    });
    return json({ receipts });
  } catch (e) {
    return apiError(e);
  }
}
