import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { changePassword, getAccountInfo } from "@/server/account.service";
import { json, apiError, readJson } from "@/lib/api";

export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();
    const info = await getAccountInfo(user.id);
    return json({ account: info });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await readJson(req);
    const result = await changePassword(user.id, body);
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}
