import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { runDueSyncs } from "@/server/integration.service";
import { json, apiError } from "@/lib/api";

// Scheduler entry point for the data collection layer. Call this on a
// schedule (e.g. every 15 minutes from a CRON job or the platform scheduler):
//   - Google Trends: runs every due, enabled trend config (see
//     docs/DATA_COLLECTION.md) respecting each config's frequency.
//   - GSC: runs when the configured refresh interval elapsed and no retry
//     backoff window is active.
// The endpoint requires an authenticated session (same pattern as the
// existing /api/trends/run-due endpoint).
export async function POST(_req: NextRequest) {
  try {
    await requireUser();
    const result = await runDueSyncs();
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}