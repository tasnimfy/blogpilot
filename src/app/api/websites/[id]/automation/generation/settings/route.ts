import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { getGenerationSchedule, updateGenerationSchedule } from "@/server/generation.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "automation.manage");
    const schedule = await getGenerationSchedule(params.id);
    return json({ schedule: schedule ?? null });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "automation.manage");
    const body = await req.json().catch(() => ({}));
    const schedule = await updateGenerationSchedule(params.id, body, user.id);
    const { enabled, schedule: runAt, timezone, dailyLimit, maxPerRun, maxRetries, timeoutMinutes, weekdayMask } = schedule;
    return json({
      schedule: { id: schedule.id, enabled, schedule: runAt, timezone, dailyLimit, maxPerRun, maxRetries, timeoutMinutes, weekdayMask },
    });
  } catch (e) {
    return apiError(e);
  }
}