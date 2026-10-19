import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { testConnection } from "@/server/wordpress/connection.service";
import { updateWordpress } from "@/server/settings.service";
import { WordPressError } from "@/server/wordpress/client";
import { resetDb, createTestAdmin, createTestSite } from "./helpers";

const realFetch = globalThis.fetch;

function stubWpApi(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init))) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("WordPress connection testing", () => {
  let admin: { id: string };
  let siteId: string;

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
    siteId = (await createTestSite()).id;
    await updateWordpress(siteId, { siteUrl: "https://example.com", username: "u", appPassword: "pass" }, admin.id);
  });

  it("tests a healthy connection and stores capabilities", async () => {
    stubWpApi((url) => {
      if (url.endsWith("/wp-json/wp/v2")) return new Response(JSON.stringify({ name: "Example Blog", url: "https://example.com" }));
      if (url.includes("/types")) return new Response(JSON.stringify({ post: { name: "Posts" }, page: { name: "Pages" } }));
      if (url.includes("/categories")) return new Response(JSON.stringify([{ id: 1, name: "Travel", slug: "travel" }]));
      if (url.includes("/tags")) return new Response(JSON.stringify([{ id: 2, name: "rafting", slug: "rafting" }]));
      if (url.includes("/media")) return new Response(JSON.stringify([]));
      if (url.includes("/posts")) return new Response(JSON.stringify([{ meta: { rank_math_title: "x" } }]));
      return new Response(JSON.stringify({}), { status: 404 });
    });
    const r = await testConnection(siteId, admin.id);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("Example Blog");
    expect(r.postTypes).toContain("post");
    expect(r.categories[0].name).toBe("Travel");
    expect(r.mediaCapable).toBe(true);
    expect(r.hasRankMathMeta).toBe(true);

    const conn = await prisma.wordPressConnection.findUnique({ where: { websiteId: siteId } });
    expect(conn?.status).toBe("OK");
    expect(conn?.lastTestedAt).not.toBeNull();
    expect(conn?.supportedPostTypes).toContain("post");
  });

  it("marks the connection FAILED on an auth error and reports it", async () => {
    stubWpApi(() => new Response(JSON.stringify({ code: "rest_forbidden", message: "Sorry, you are not allowed to do that." }), { status: 401 }));
    await expect(testConnection(siteId, admin.id)).rejects.toThrow(WordPressError);
    const conn = await prisma.wordPressConnection.findUnique({ where: { websiteId: siteId } });
    expect(conn?.status).toBe("FAILED");
    expect(conn?.lastError).toContain("not allowed");
  });

  it("throws clearly when no connection is configured", async () => {
    const other = (await createTestSite("Other", "other.com")).id; // no WP connection
    await expect(testConnection(other, admin.id)).rejects.toThrow(/No WordPress connection/);
  });
});
