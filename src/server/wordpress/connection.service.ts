import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString, fromJsonString } from "@/lib/json";
import { WordPressClient, WordPressError } from "@/server/wordpress/client";
import { getDecryptedWordpressPassword } from "@/server/settings.service";

export class ConnectionServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionServiceError";
  }
}

export interface ConnectionTestResult {
  ok: boolean;
  name?: string;
  postTypes: string[];
  categories: { id: number; name: string; slug: string }[];
  tags: { id: number; name: string; slug: string }[];
  mediaCapable: boolean;
  metaKeys: string[];
  hasRankMathMeta: boolean;
  lastError?: string;
}

async function loadConnection(websiteId: string) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new ConnectionServiceError("Website not found");
  const conn = await prisma.wordPressConnection.findUnique({ where: { websiteId } });
  if (!conn || !conn.appPasswordEncrypted) {
    throw new ConnectionServiceError("No WordPress connection with credentials is configured for this site");
  }
  const appPassword = await getDecryptedWordpressPassword(websiteId);
  if (!appPassword) throw new ConnectionServiceError("Stored WordPress password could not be decrypted");
  return { conn, appPassword };
}

function clientFor(conn: { siteUrl: string; username: string }, appPassword: string): WordPressClient {
  return new WordPressClient({ siteUrl: conn.siteUrl, username: conn.username, appPassword });
}

// Test the WordPress connection server-side and refresh stored capability info.
export async function testConnection(websiteId: string, userId: string): Promise<ConnectionTestResult> {
  const { conn, appPassword } = await loadConnection(websiteId);
  const client = clientFor(conn, appPassword);
  const result: ConnectionTestResult = { ok: false, postTypes: [], categories: [], tags: [], mediaCapable: false, metaKeys: [], hasRankMathMeta: false };
  try {
    const info = await client.test();
    result.name = info.name;
    result.postTypes = await client.getPostTypes();
    result.categories = await client.getTerms("categories");
    result.tags = await client.getTerms("tags");

    // Probe media capability (some hosts restrict the media endpoint).
    try {
      await client.request("/media?per_page=1");
      result.mediaCapable = true;
    } catch {
      result.mediaCapable = false;
    }

    // Best-effort: inspect meta keys exposed on recent posts (Rank Math etc.).
    try {
      const posts = (await client.request("/posts?per_page=1")) as { meta?: Record<string, unknown> }[];
      const meta = posts[0]?.meta ?? {};
      result.metaKeys = Object.keys(meta);
      result.hasRankMathMeta = result.metaKeys.some((k) => k.startsWith("rank_math_"));
    } catch {
      result.metaKeys = [];
      result.hasRankMathMeta = false;
    }

    result.ok = true;

    await prisma.wordPressConnection.update({
      where: { id: conn.id },
      data: {
        status: "OK",
        lastTestedAt: new Date(),
        lastError: null,
        supportedPostTypes: toJsonString(result.postTypes),
        availableCategories: toJsonString(result.categories),
        availableTags: toJsonString(result.tags),
        mediaCapable: result.mediaCapable,
        restMetaFields: toJsonString({ metaKeys: result.metaKeys, hasRankMathMeta: result.hasRankMathMeta }),
      },
    });
    await auditLog({ userId, websiteId, action: "WORDPRESS_CONNECTION_TESTED", entity: "WordPressConnection", entityId: conn.id, detail: { ok: true } });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown connection error";
    await prisma.wordPressConnection.update({
      where: { id: conn.id },
      data: { status: "FAILED", lastError: message },
    });
    await auditLog({ userId, websiteId, action: "WORDPRESS_CONNECTION_TESTED", entity: "WordPressConnection", entityId: conn.id, detail: { ok: false } });
    throw new WordPressError(message, e instanceof WordPressError ? e.status : 502);
  }
}

export function getConnectionOptions(websiteId: string) {
  return prisma.wordPressConnection.findUnique({ where: { websiteId } });
}

export function serializeConnection(row: { supportedPostTypes: string | null; availableCategories: string | null; availableTags: string | null; restMetaFields: string | null; [k: string]: unknown } | null) {
  if (!row) return null;
  return {
    ...row,
    supportedPostTypes: fromJsonString<string[]>(row.supportedPostTypes, []),
    availableCategories: fromJsonString<unknown[]>(row.availableCategories, []),
    availableTags: fromJsonString<unknown[]>(row.availableTags, []),
    restMetaFields: fromJsonString<unknown>(row.restMetaFields, null),
  };
}
