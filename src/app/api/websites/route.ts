import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireOperator } from "@/lib/access";
import { listSites, createSite } from "@/server/website.service";
import { json, apiError, readJson } from "@/lib/api";

export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();
    // Site-scoped visibility: operators see every website, members only the
    // websites they hold a membership on.
    const sites = await listSites(user.id);
    return json({ sites, user });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    // Creating a website is a global (operator-level) action: the operator
    // creates the site and then assigns memberships to it.
    await requireOperator(user.id);
    const body = await readJson(req);
    const site = await createSite(body as never, user.id);
    return json({ site }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
