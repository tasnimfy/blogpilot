import { assertSafeOutboundUrl } from "@/lib/ssrf";

export class WordPressError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "WordPressError";
    this.status = status;
  }
}

export interface WpConnectionInfo {
  siteUrl: string;
  username: string;
  appPassword: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown; // JSON body
  binary?: { data: Buffer | Uint8Array; contentType: string }; // media upload
  timeoutMs?: number;
}

// Minimal REST client for a WordPress site. Uses Application Passwords over
// HTTPS (SSRF-guarded). All calls stay on the server.
export class WordPressClient {
  private siteUrl: string;
  private username: string;
  private appPassword: string;
  // Active REST base. Starts as the pretty-permalink form
  // ({site}/wp-json/wp/v2) and may be switched to the core query form
  // ({site}/?rest_route=/wp/v2) by test() on sites with plain permalinks.
  restBase: string;

  constructor(info: WpConnectionInfo) {
    assertSafeOutboundUrl(info.siteUrl, "WordPress site URL");
    this.siteUrl = info.siteUrl.replace(/\/+$/, "");
    this.username = info.username;
    this.appPassword = info.appPassword;
    this.restBase = `${this.siteUrl}/wp-json/wp/v2`;
  }

  // Joins a path onto the active REST base. When the query form is in use the
  // base already contains "?", so a path's own query string must be joined
  // with "&" (e.g. /categories?per_page=100 -> ?rest_route=/wp/v2/categories&per_page=100).
  private buildUrl(path: string): string {
    if (path.startsWith("http")) return path;
    if (this.restBase.includes("?")) return `${this.restBase}${path.replace("?", "&")}`;
    return `${this.restBase}${path}`;
  }

  private async raw(path: string, opts: RequestOptions = {}): Promise<Response> {
    assertSafeOutboundUrl(this.siteUrl, "WordPress site URL");
    const url = this.buildUrl(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.username}:${this.appPassword}`).toString("base64")}`,
      Accept: "application/json",
    };
    let body: BodyInit | undefined;
    if (opts.binary) {
      headers["Content-Type"] = opts.binary.contentType;
      body = opts.binary.data as BodyInit;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    try {
      const res = await fetch(url, { method: opts.method ?? "GET", headers, body, signal: controller.signal });
      return res;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new WordPressError("WordPress request timed out", 504);
      throw new WordPressError(`WordPress request failed: ${e instanceof Error ? e.message : "unknown error"}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse(res: Response): Promise<unknown> {
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message =
        (data as { message?: string })?.message ?? `WordPress returned HTTP ${res.status}`;
      throw new WordPressError(message, res.status);
    }
    return data;
  }

  async request(path: string, opts: RequestOptions = {}): Promise<unknown> {
    const res = await this.raw(path, opts);
    return this.parse(res);
  }

  // Connection test: reach the WP REST API root, which requires and reflects
  // authentication. Two real-world cases are handled explicitly:
  //  - "Plain" permalink sites do not serve /wp-json/*; WordPress still serves
  //    the same API via the core ?rest_route= query form, so fall back to it
  //    (and keep using it for the follow-up capability probes below).
  //  - A blank site title (name: "") is a valid, working connection; the site
  //    host is used as the display label instead of failing the test.
  async test(): Promise<{ name: string; url: string; description?: string }> {
    const prettyBase = `${this.siteUrl}/wp-json/wp/v2`;
    const queryBase = `${this.siteUrl}/?rest_route=/wp/v2`;
    let lastError: WordPressError | null = null;

    for (const base of [prettyBase, queryBase]) {
      this.restBase = base;
      let data: { name?: string; url?: string; description?: string } | null;
      try {
        data = (await this.request("")) as { name?: string; url?: string; description?: string } | null;
      } catch (e) {
        lastError = e instanceof WordPressError ? e : null;
        continue; // try the next REST base form
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        lastError = new WordPressError(
          `${base} did not return the WordPress REST API index. The Site URL may not point at this ` +
            `WordPress site's homepage, or a security/caching plugin, firewall, or "coming soon" page is intercepting the request.`,
          502
        );
        continue;
      }
      // A genuine WP REST root always carries the site url. Random JSON from a
      // proxy/WAF (e.g. {"error":"..."}) does not, so require it before calling
      // this a successful connection.
      if (typeof data.url !== "string" || !data.url) {
        lastError = new WordPressError(
          `${base} responded with JSON that is not the WordPress REST API index (no site url). ` +
            `Check that the Site URL is this WordPress site's homepage and that no proxy or security plugin is rewriting REST API responses.`,
          502
        );
        continue;
      }
      // A blank site title (name: "") is a valid, working connection: the site
      // host is used as the display label instead of failing the test.
      const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
      return {
        name: name ?? this.siteUrl,
        url: data.url,
        description: typeof data.description === "string" ? data.description : undefined,
      };
    }

    throw (
      lastError ??
      new WordPressError(
        `Could not read the WordPress REST API from ${prettyBase} or via ?rest_route=. ` +
          `Check that the Site URL is your WordPress site's homepage (e.g. https://example.com).`,
        502
      )
    );
  }

  async getPostTypes(): Promise<string[]> {
    const data = (await this.request("/types")) as Record<string, { rest_base?: string; name?: string }>;
    return Object.keys(data ?? {});
  }

  async getTerms(taxonomy: "categories" | "tags"): Promise<{ id: number; name: string; slug: string }[]> {
    const data = (await this.request(`/${taxonomy}?per_page=100`)) as { id: number; name: string; slug: string }[];
    return Array.isArray(data) ? data : [];
  }

  async getPostsBySlug(slug: string): Promise<{ id: number; slug: string; link: string; status: string }[]> {
    const data = (await this.request(`/posts?slug=${encodeURIComponent(slug)}&status=any`)) as {
      id: number; slug: string; link: string; status: string;
    }[];
    return Array.isArray(data) ? data : [];
  }

  async createPost(payload: Record<string, unknown>): Promise<{ id: number; link: string; slug: string; status: string }> {
    const data = (await this.request("/posts", { method: "POST", body: payload })) as {
      id: number; link: string; slug: string; status: string;
    };
    return data;
  }

  async updatePost(id: number, payload: Record<string, unknown>): Promise<{ id: number; link: string; slug: string; status: string }> {
    const data = (await this.request(`/posts/${id}`, { method: "POST", body: payload })) as {
      id: number; link: string; slug: string; status: string;
    };
    return data;
  }

  async uploadMedia(file: Uint8Array, fileName: string, contentType: string): Promise<{ id: number; source_url: string }> {
    // Media uploads require Content-Disposition with the filename.
    const url = this.buildUrl("/media");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.username}:${this.appPassword}`).toString("base64")}`,
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
        body: file as BodyInit,
        signal: controller.signal,
      });
      const data = (await this.parse(res)) as { id: number; source_url: string };
      if (!data.id) throw new WordPressError("Media upload returned no id", 502);
      return { id: data.id, source_url: data.source_url };
    } catch (e) {
      if (e instanceof WordPressError) throw e;
      if (e instanceof Error && e.name === "AbortError") throw new WordPressError("Media upload timed out", 504);
      throw new WordPressError("Media upload failed", 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
