// Optional Rank Math compatibility (staged). Rank Math's full analysis engine
// is NOT exposed through a public REST endpoint, so this module only:
//   Stage 1: detect whether Rank Math appears to be installed (with limits).
//   Stage 2: map our SEO fields to Rank Math's registered meta keys so they can
//            be synchronized through the WordPress REST API in the publishing
//            phase, when the target site exposes writable meta.
// Nothing here fabricates a Rank Math score or claims full integration.

export const RANK_MATH_META_KEYS = {
  seoTitle: "rank_math_title",
  metaDescription: "rank_math_description",
  focusKeyword: "rank_math_focus_keyword",
  canonical: "rank_math_canonical_url",
} as const;

export interface RankMathMetaInput {
  seoTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  canonical?: string | null;
}

// Map our internal SEO fields to the WordPress meta keys Rank Math registers.
export function buildRankMathMetaPayload(input: RankMathMetaInput): Record<string, string> {
  const payload: Record<string, string> = {};
  if (input.seoTitle) payload[RANK_MATH_META_KEYS.seoTitle] = input.seoTitle;
  if (input.metaDescription) payload[RANK_MATH_META_KEYS.metaDescription] = input.metaDescription;
  if (input.focusKeyword) payload[RANK_MATH_META_KEYS.focusKeyword] = input.focusKeyword;
  if (input.canonical) payload[RANK_MATH_META_KEYS.canonical] = input.canonical;
  return payload;
}

export interface RankMathProbeResult {
  // "unknown" when the site cannot be probed safely or the API is unreachable.
  installed: boolean | "unknown";
  method: string;
  note: string;
}

export interface RankMathProbe {
  // Returns HTTP status + parsed body for a GET against the given path.
  get(path: string): Promise<{ status: number; body: unknown }>;
}

// Probe a WordPress REST API to detect whether Rank Math appears installed.
// Detection is best-effort and limited: Rank Math may register meta differently
// across versions, and meta may only be visible on authenticated requests.
export async function detectRankMath(probe: RankMathProbe): Promise<RankMathProbeResult> {
  try {
    // Inspect the meta of a recent post; Rank Math registers meta keys like
    // rank_math_title on the post meta.
    const res = await probe.get("/wp-json/wp/v2/posts?per_page=1");
    if (res.status !== 200) {
      return {
        installed: "unknown",
        method: "post-meta",
        note: `WordPress REST API returned HTTP ${res.status}; Rank Math presence could not be determined.`,
      };
    }
    const posts = Array.isArray(res.body) ? (res.body as { meta?: Record<string, unknown> }[]) : [];
    const hasRankMathMeta = posts.some((p) => p.meta && Object.keys(p.meta).some((k) => k.startsWith("rank_math_")));
    if (hasRankMathMeta) {
      return {
        installed: true,
        method: "post-meta",
        note: "Recent post meta includes rank_math_* keys; Rank Math appears to be installed and exposing meta.",
      };
    }
    return {
      installed: "unknown",
      method: "post-meta",
      note: "No rank_math_* meta keys observed on recent posts. Presence is inconclusive (unknown): Rank Math may be installed without meta visible, not installed, or meta is hidden from the API.",
    };
  } catch (e) {
    return {
      installed: "unknown",
      method: "post-meta",
      note: `Could not probe WordPress: ${e instanceof Error ? e.message : "unknown error"}.`,
    };
  }
}

// Explanation of staged capabilities and their limits (for the UI/docs).
export const RANK_MATH_LIMITATIONS = [
  "Rank Math's full SEO analysis/scoring engine is not available through a public REST endpoint; BlogPilot's internal analyzer is always used.",
  "Detection is best-effort: it inspects post meta and can be inconclusive when meta is hidden or auth-gated.",
  "SEO metadata (title, description, focus keyword, canonical) is synchronized only when the target WordPress site exposes writable rank_math_* meta fields, in the publishing phase.",
  "No Rank Math score is fabricated or displayed as if real; any Rank Math-provided analysis (if available) is shown separately from the internal score.",
];
