import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { runDueGeneration } from "@/server/generation.service";
import { json, apiError } from "@/lib/api";

// Scheduler entry point. Call on a CRON/schedule (e.g. every 15 minutes):
// drains the ARTICLE_GENERATE queue for every website whose local schedule
// time matches, respecting each website's daily limit and enabled switch.
export async function POST(_req: NextRequest) {
  try {
    await requireUser();
    const result = await runDueGeneration();
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}