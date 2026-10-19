import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireOperator } from "@/lib/access";
import { createUser, listUsers, UserServiceError } from "@/server/user.service";
import { json, apiError, readJson } from "@/lib/api";

// User accounts are a global resource: only operators can manage them.
// Membership on a website is assigned separately (see /websites/[id]/users).

export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();
    await requireOperator(user.id);
    const users = await listUsers();
    return json({ users });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireOperator(user.id);
    const body = await readJson(req);
    const created = await createUser(user.id, body);
    return json({ user: created }, { status: 201 });
  } catch (e) {
    if (e instanceof UserServiceError) return json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}