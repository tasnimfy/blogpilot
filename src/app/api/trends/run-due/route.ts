import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { runDueTrendChecks } from "@/server/trends.service";
import { json, apiError } from "@/lib/api";

export async function POST(_req: NextRequest) {
  try {
    await requireUser();
    const result = await runDueTrendChecks();
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}
