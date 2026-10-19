// Image discovery providers: Openverse and Wikimedia Commons. Both use public
// APIs. Results include license/attribution metadata so the operator can
// decide commercial suitability. Providers return an explicit ok/error result
// and never fabricate image URLs or licenses.

export interface ImageResult {
  provider: "openverse" | "wikimedia";
  providerId: string;
  url: string; // direct/original image URL
  thumbnailUrl?: string;
  title?: string;
  creator?: string;
  attribution?: string; // full attribution text when required
  license?: string; // short license identifier
  licenseUrl?: string;
  attributionRequired: boolean;
  commercialUse: boolean;
  width?: number;
  height?: number;
  mimeType?: string;
  sourcePage?: string;
}

export interface ImageSearchQuery {
  query: string;
  limit?: number;
}

export type ImageSearchResponse =
  | { ok: true; items: ImageResult[] }
  | { ok: false; error: string };

export interface ImageProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: string;
  search(q: ImageSearchQuery): Promise<ImageSearchResponse>;
}

const COMMERCIAL_LICENSES = new Set([
  "cc0",
  "pdm",
  "cc-by",
  "cc-by-sa",
]);

// Normalize a license string ("CC BY-SA 4.0", "cc0", "Public domain", …) to a
// canonical key used for commercial-use and attribution decisions.
function canonicalLicense(license: string): string {
  const l = license.toLowerCase();
  if (/cc0/.test(l)) return "cc0";
  if (/public domain|pdm/.test(l)) return "pdm";
  if (/cc[- ]by[- ]nc/.test(l)) return "cc-by-nc";
  if (/cc[- ]by[- ]sa/.test(l)) return "cc-by-sa";
  if (/cc[- ]by/.test(l)) return "cc-by";
  return l.trim();
}

function isCommercial(license: string): boolean {
  return COMMERCIAL_LICENSES.has(canonicalLicense(license));
}

function attributionRequiredFor(license: string): boolean {
  return !/^(cc0|pdm)$/.test(canonicalLicense(license));
}

function fetchJson(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  return fetch(url, {
    headers: { Accept: "application/json", ...(opts.headers ?? {}) },
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Openverse (https://api.openverse.org). Public search; an optional OAuth
// access token (OPENVERSE_TOKEN) improves reliability if the API requires it.
// ---------------------------------------------------------------------------

export class OpenverseProvider implements ImageProvider {
  readonly id = "openverse";
  readonly name = "Openverse";
  readonly capabilities =
    "Public API. Optional token via OPENVERSE_TOKEN. Returns license metadata; verify the asset license before commercial use.";

  async search(q: ImageSearchQuery): Promise<ImageSearchResponse> {
    const token = process.env.OPENVERSE_TOKEN;
    const params = new URLSearchParams({
      q: q.query,
      page_size: String(q.limit ?? 20),
    });
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const data = (await fetchJson(`https://api.openverse.org/v1/images/?${params}`, { headers })) as {
        results?: {
          id?: string;
          title?: string;
          url?: string;
          thumbnail?: string;
          creator?: string;
          license?: string;
          license_url?: string;
          attribution?: string;
          height?: number;
          width?: number;
          mime_type?: string;
          foreign_landing_url?: string;
        }[];
      };
      const results = data.results ?? [];
      return {
        ok: true,
        items: results.map((r) => normalizeOpenverse(r)),
      };
    } catch (e) {
      const statusHint = e instanceof Error && /401|403/.test(e.message) ? " (API may require an access token via OPENVERSE_TOKEN)" : "";
      return { ok: false, error: `Openverse search failed${statusHint}: ${e instanceof Error ? e.message : "unknown error"}` };
    }
  }
}

function normalizeOpenverse(r: {
  id?: string; title?: string; url?: string; thumbnail?: string; creator?: string;
  license?: string; license_url?: string; attribution?: string; height?: number; width?: number;
  mime_type?: string; foreign_landing_url?: string;
}): ImageResult {
  const license = r.license ?? "";
  return {
    provider: "openverse",
    providerId: r.id ?? r.url ?? "",
    url: r.url ?? "",
    thumbnailUrl: r.thumbnail,
    title: r.title,
    creator: r.creator,
    attribution: r.attribution,
    license: r.license ?? undefined,
    licenseUrl: r.license_url ?? undefined,
    attributionRequired: attributionRequiredFor(license),
    commercialUse: isCommercial(license),
    width: r.width,
    height: r.height,
    mimeType: r.mime_type,
    sourcePage: r.foreign_landing_url,
  };
}

// ---------------------------------------------------------------------------
// Wikimedia Commons API
// ---------------------------------------------------------------------------

interface WikiPage {
  title?: string;
  imageinfo?: {
    url?: string;
    thumburl?: string;
    width?: number;
    height?: number;
    mime?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

export class WikimediaProvider implements ImageProvider {
  readonly id = "wikimedia";
  readonly name = "Wikimedia Commons";
  readonly capabilities = "Public MediaWiki API. Returns license/artist metadata via extmetadata.";

  async search(q: ImageSearchQuery): Promise<ImageSearchResponse> {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: q.query,
      gsrnamespace: "6",
      gsrlimit: String(q.limit ?? 20),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "400",
      origin: "*",
    });
    try {
      const data = (await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`)) as {
        query?: { pages?: Record<string, WikiPage> };
      };
      const pages = data.query?.pages ?? {};
      const items = Object.values(pages).map((p) => normalizeWikimedia(p));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, error: `Wikimedia search failed: ${e instanceof Error ? e.message : "unknown error"}` };
    }
  }
}

function ext(p: WikiPage, key: string): string | undefined {
  return p.imageinfo?.[0]?.extmetadata?.[key]?.value;
}

function normalizeWikimedia(p: WikiPage): ImageResult {
  const info = p.imageinfo?.[0];
  const license = (ext(p, "LicenseShortName") ?? "").trim();
  const licenseUrl = ext(p, "LicenseUrl")?.trim();
  const artist = stripTags(ext(p, "Artist") ?? "").trim();
  const attributionRequired = attributionRequiredFor(license);
  return {
    provider: "wikimedia",
    providerId: p.title ?? info?.url ?? "",
    url: info?.url ?? "",
    thumbnailUrl: info?.thumburl,
    title: p.title,
    creator: artist || undefined,
    attribution: `${p.title ?? "Image"} by ${artist || "unknown"}${license ? ` — ${license}` : ""}`.trim(),
    license: license || undefined,
    licenseUrl,
    attributionRequired,
    commercialUse: isCommercial(license),
    width: info?.width,
    height: info?.height,
    mimeType: info?.mime,
    sourcePage: info?.descriptionurl,
  };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function listImageProviders(): ImageProvider[] {
  return [new OpenverseProvider(), new WikimediaProvider()];
}

export function getImageProvider(id: string | null | undefined): ImageProvider {
  const p = listImageProviders().find((x) => x.id === id);
  return p ?? new OpenverseProvider();
}
