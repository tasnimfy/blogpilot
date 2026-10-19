import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { improveText } from "@/server/article.service";
import { json, apiError, readJson } from "@/lib/api";

interface Ctx {
  params: { id: string; draftId: string };
}

// In-editor AI action: improve or regenerate the SELECTED text only. The
// service returns replacement text; it never rewrites the whole draft body.
// Server-side permission is enforced here (drafts.generate) and again in the
// route caller context; the client replaces exactly the selection.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "drafts.generate");
    const body = await readJson(req);
    const result = await improveText(params.id, params.draftId, body, user.id);
    return json({ text: result.text, mode: result.mode });
  } catch (e) {
    return apiError(e);
  }
}