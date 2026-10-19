import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { retryGenerationJob } from "@/server/generation.service";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string; jobId: string };
}

// Manual retry: a FAILED generation job is re-queued (inspectable history is
// preserved on the job until the next claim). Requires automation.manage.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const result = await retryGenerationJob(params.id, params.jobId, user.id);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}