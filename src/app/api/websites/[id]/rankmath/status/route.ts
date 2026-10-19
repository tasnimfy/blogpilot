import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireSitePermission } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { detectRankMath, RANK_MATH_LIMITATIONS, buildRankMathMetaPayload } from "@/server/rankmath.service";
import { getDecryptedWordpressPassword } from "@/server/settings.service";
import { assertSafeOutboundUrl } from "@/lib/ssrf";
import { json, apiError } from "@/lib/api";

interface Ctx {
  params: { id: string };
}

// Report Rank Math compatibility status for a site. Detects only when a
// WordPress connection with credentials is configured; otherwise reports the
// limitation honestly. Never fabricates a Rank Math score.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireSitePermission(user.id, params.id, "seo.analyze");
    const conn = await prisma.wordPressConnection.findUnique({ where: { websiteId: params.id } });
    const capabilities = {
      supportedMeta: buildRankMathMetaPayload({ seoTitle: "Title", metaDescription: "Desc", focusKeyword: "kw", canonical: "https://example.com/c" }),
      limitations: RANK_MATH_LIMITATIONS,
    };

    if (!conn || !conn.appPasswordEncrypted) {
      return json({
        installed: "unknown",
        note: "No WordPress connection with credentials is configured for this site, so Rank Math presence cannot be probed.",
        capabilities,
      });
    }

    try {
      assertSafeOutboundUrl(conn.siteUrl, "WordPress site URL");
    } catch (e) {
      return json({
        installed: "unknown",
        note: e instanceof Error ? e.message : "WordPress URL blocked",
        capabilities,
      });
    }

    const appPassword = await getDecryptedWordpressPassword(params.id);
    const username = conn.username;
    const probe = {
      async get(path: string) {
        const url = new URL(path, conn.siteUrl.endsWith("/") ? conn.siteUrl : `${conn.siteUrl}/`).toString();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
          const res = await fetch(url, {
            headers: {
              Authorization: `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`,
              Accept: "application/json",
            },
            signal: controller.signal,
          });
          const text = await res.text();
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = null;
          }
          return { status: res.status, body };
        } finally {
          clearTimeout(timer);
        }
      },
    };

    const result = await detectRankMath(probe);
    return json({ ...result, capabilities });
  } catch (e) {
    return apiError(e);
  }
}
