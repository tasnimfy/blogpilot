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
    const jobs = await prisma.backgroundJob.findMany({
      where: { websiteId: params.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, status: true, error: true, createdAt: true, completedAt: true },
    });
    return json({ jobs });
  } catch (e) {
    return apiError(e);
  }
}
