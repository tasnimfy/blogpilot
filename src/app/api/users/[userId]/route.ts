import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireOperator } from "@/lib/access";
import { updateUser, UserServiceError } from "@/server/user.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { userId: string };
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireOperator(user.id);
    const body = await readJson(req);
    const updated = await updateUser(user.id, params.userId, body);
    return json({ user: updated });
  } catch (e) {
    if (e instanceof UserServiceError) return json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}