import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

// Lightweight liveness + database probe.
// Returns 200 when the app can read the database, 503 with the underlying
// error otherwise. Point your load balancer / Coolify health check here.
export async function GET(_req: NextRequest) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true, db: "ok" });
  } catch (e) {
    return json(
      { ok: false, db: "error", error: e instanceof Error ? e.message : String(e) },
      { status: 503 }
    );
  }
}
