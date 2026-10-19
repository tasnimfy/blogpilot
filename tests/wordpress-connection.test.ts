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

  it("treats a blank site title as a connected site (falls back to the site URL)", async () => {
    stubWpApi((url) => {
      // WP with an empty Settings -> General -> Site Title: name is "".
      if (url.endsWith("/wp-json/wp/v2")) return new Response(JSON.stringify({ name: "", url: "https://example.com" }));
      if (url.includes("/types")) return new Response(JSON.stringify({ post: { name: "Posts" } }));
      if (url.includes("/categories")) return new Response(JSON.stringify([]));
      if (url.includes("/tags")) return new Response(JSON.stringify([]));
      if (url.includes("/media")) return new Response(JSON.stringify([]));
      if (url.includes("/posts")) return new Response(JSON.stringify([]));
      return new Response(JSON.stringify({}), { status: 404 });
    });
    const r = await testConnection(siteId, admin.id);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("https://example.com"); // label fallback, not an error
  });

  it("falls back to ?rest_route= when /wp-json/ is unavailable (plain permalinks)", async () => {
    const requested: string[] = [];
    stubWpApi((url) => {
      requested.push(url);
      if (url.includes("rest_route=")) {
        if (url.includes("rest_route=/wp/v2/types")) return new Response(JSON.stringify({ post: { name: "Posts" } }));
        if (url.includes("rest_route=/wp/v2/categories")) return new Response(JSON.stringify([{ id: 1, name: "Travel", slug: "travel" }]));
        if (url.includes("rest_route=/wp/v2/tags")) return new Response(JSON.stringify([]));
        if (url.includes("rest_route=/wp/v2/media")) return new Response(JSON.stringify([]));
        if (url.includes("rest_route=/wp/v2/posts")) return new Response(JSON.stringify([]));
        if (url.includes("rest_route=/wp/v2")) return new Response(JSON.stringify({ name: "Plain Site", url: "https://example.com" }));
      }
      // Pretty permalinks disabled: /wp-json/* answers404 (as plain-permalink
      // WordPress does). The query form above must be used instead.
      return new Response(JSON.stringify({}), { status: 404 });
    });
    const r = await testConnection(siteId, admin.id);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("Plain Site");
    // Follow-up capability probes must also use the working query form.
    expect(requested.some((u) => u.includes("rest_route=/wp/v2/types"))).toBe(true);
    expect(requested.some((u) => u.includes("rest_route=/wp/v2/categories&per_page=100"))).toBe(true);
  });

  it("reports a clear error when the endpoint is not the WP REST index (e.g. WAF JSON)", async () => {
    // A firewall/proxy answering JSON without the REST index shape (no site
    // url) must not be reported as "Connected but no site name returned".
    stubWpApi(() => new Response(JSON.stringify({ error: "Forbidden by WAF" }), { status: 200 }));
    await expect(testConnection(siteId, admin.id)).rejects.toThrow(/REST API index|rest_route/i);
    const conn = await prisma.wordPressConnection.findUnique({ where: { websiteId: siteId } });
    expect(conn?.status).toBe("FAILED");
  });

  it("reports a clear error when the endpoint returns HTML instead of JSON", async () => {
    // e.g. wrong Site URL, "coming soon"/maintenance page, or a caching plugin
    // intercepting the REST API and answering an HTML page with HTTP 200.
    stubWpApi(() => new Response("<!DOCTYPE html><html><body>Coming soon</body></html>", { status: 200 }));
    await expect(testConnection(siteId, admin.id)).rejects.toThrow(/REST API index|REST API from/i);
  });
});
