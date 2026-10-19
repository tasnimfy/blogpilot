import { prisma } from "@/lib/prisma";
import { toJsonString, fromJsonString } from "@/lib/json";
import { analyzeBody, hostOf } from "@/lib/markdown";
import { looksLikeHtml, htmlToText } from "@/lib/markup";

export class SeoServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoServiceError";
  }
}

type CheckStatus = "pass" | "warn" | "fail" | "info" | "suggestion";

export interface SeoCheck {
  id: string;
  category: string;
  status: CheckStatus;
  label: string;
  detail: string;
  mandatory: boolean;
  live: boolean; // requires a live URL / external service
}

export interface SeoAnalysisResult {
  overall: number;
  categories: Record<string, { score: number; max: number }>;
  checks: SeoCheck[];
  critical: string[];
  warnings: string[];
  suggestions: string[];
  mandatoryFailed: boolean;
  liveChecksRequired: boolean;
}

export interface SeoOverrides {
  seoTitle?: string | null;
  metaDescription?: string | null;
  slug?: string | null;
  canonical?: string | null;
  siteUrl?: string | null;
}

// The score is an internal editorial-quality indicator, not a ranking
// prediction. Every deduction has an explanation (a failed check).
export async function analyzeDraft(websiteId: string, draftId: string, overrides?: SeoOverrides): Promise<SeoAnalysisResult> {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new SeoServiceError("Website not found");
  const draft = await prisma.articleDraft.findFirst({
    where: { id: draftId, websiteId },
    include: {
      seo: true,
      images: { include: { image: true } },
      opportunity: { select: { keyword: true, title: true } },
    },
  });
  if (!draft) throw new SeoServiceError("Draft not found");

  const body = draft.body ?? "";
  const md = analyzeBody(body);
  const bodyText = looksLikeHtml(body) ? htmlToText(body) : body;
  const keyword = (draft.keyword ?? draft.opportunity?.keyword ?? "").trim().toLowerCase();
  // Prefer overrides for metadata fields; otherwise fall back to draft title.
  const title = overrides?.seoTitle ?? draft.title ?? "";
  const metaDescription = overrides?.metaDescription ?? undefined;
  const slug = overrides?.slug ?? draft.slug ?? undefined;
  const canonical = overrides?.canonical ?? undefined;
  const siteDomain = site.domain.replace(/^www\./, "").toLowerCase();

  const checks: SeoCheck[] = [];
  const push = (id: string, category: string, status: CheckStatus, label: string, detail: string, mandatory = false, live = false) =>
    checks.push({ id, category, status, label, detail, mandatory, live });

  // ---- Metadata -----------------------------------------------------------
  if (!title.trim()) {
    push("meta_title_present", "metadata", "fail", "SEO title present", "No title is set on the draft.", true);
  } else if (title.length < 30) {
    push("meta_title_length", "metadata", "warn", "SEO title length", `Title is ${title.length} chars (recommend 30-60).`);
  } else if (title.length > 60) {
    push("meta_title_length", "metadata", "warn", "SEO title length", `Title is ${title.length} chars (over 60 may truncate).`);
  } else {
    push("meta_title_length", "metadata", "pass", "SEO title length", `Title is ${title.length} chars (within 30-60).`);
  }

  if (!metaDescription) {
    push("meta_desc_present", "metadata", "warn", "Meta description present", "No meta description provided; generate one (recommend 120-160 chars).");
  } else if (metaDescription.length < 120 || metaDescription.length > 160) {
    push("meta_desc_length", "metadata", "warn", "Meta description length", `Meta description is ${metaDescription.length} chars (recommend 120-160).`);
  } else {
    push("meta_desc_length", "metadata", "pass", "Meta description length", "Meta description is within the recommended range.");
  }

  if (slug) {
    if (/\s|[A-Z]/.test(slug) || slug.length > 120) {
      push("slug_quality", "metadata", "warn", "URL slug quality", "Slug should be lowercase, hyphenated, and concise.");
    } else {
      push("slug_quality", "metadata", "pass", "URL slug quality", "Slug is clean and lowercase.");
    }
  } else {
    push("slug_quality", "metadata", "info", "URL slug quality", "No slug set; one will be generated at publication.");
  }

  if (keyword && !title.toLowerCase().includes(keyword)) {
    push("keyword_in_title", "metadata", "suggestion", "Primary keyword in title", "Primary keyword is not in the title (optional but helpful).");
  } else if (keyword) {
    push("keyword_in_title", "metadata", "pass", "Primary keyword in title", "Primary keyword appears in the title.");
  }

  // ---- Content structure --------------------------------------------------
  if (md.h1.length === 0) {
    push("single_h1", "content", "fail", "Exactly one H1", "No H1 heading found in the article body.", true);
  } else if (md.h1.length > 1) {
    push("single_h1", "content", "warn", "Exactly one H1", `Found ${md.h1.length} H1 headings; use a single H1.`);
  } else {
    push("single_h1", "content", "pass", "Exactly one H1", "Exactly one H1 found.");
  }

  if (md.h2.length === 0) {
    push("h2_structure", "content", "warn", "Logical H2 structure", "No H2 sections found; add headings that answer reader questions.");
  } else {
    push("h2_structure", "content", "pass", "Logical H2 structure", `${md.h2.length} H2 section(s) found.`);
  }

  // H3 without a preceding H2
  let h3Orphan = 0;
  let sawH2 = false;
  for (const h of md.headings) {
    if (h.level === 2) sawH2 = true;
    else if (h.level >= 3 && !sawH2) h3Orphan++;
  }
  if (h3Orphan > 0) {
    push("heading_hierarchy", "content", "warn", "Heading hierarchy", `${h3Orphan} H3+ heading(s) appear before any H2.`);
  }

  // Introduction relevance
  const firstPara = (looksLikeHtml(body) ? (body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "") : (body.split(/\n\s*\n/)[0] ?? "")).toLowerCase();
  if (!firstPara.trim()) {
    push("intro_relevance", "content", "warn", "Introduction relevance", "The article has no introductory paragraph.");
  } else if (keyword && !firstPara.includes(keyword)) {
    push("intro_relevance", "content", "suggestion", "Introduction relevance", "The introduction does not mention the primary keyword.");
  } else {
    push("intro_relevance", "content", "pass", "Introduction relevance", "Introduction is present and relevant.");
  }

  if (md.words < 200) {
    push("content_depth", "content", "warn", "Content depth", `Article is very short (${md.words} words); consider covering subtopics.`);
  } else if (md.words < 300) {
    push("content_depth", "content", "suggestion", "Content depth", `Article is ${md.words} words; length is not a quality metric but thin content may miss subtopics.`);
  } else {
    push("content_depth", "content", "pass", "Content depth", `${md.words} words of content.`);
  }

  if (md.avgSentenceWords !== null && md.avgSentenceWords > 28) {
    push("readability", "content", "warn", "Readability", `Average sentence length is ${md.avgSentenceWords} words (recommend under 28 for broad readability).`);
  } else {
    push("readability", "content", "pass", "Readability", `Average sentence length ${md.avgSentenceWords ?? "n/a"} words.`);
  }

  // Generic / repetitive sections
  const seenHeadings = new Map<string, number>();
  for (const h of md.headings) {
    const key = h.text.toLowerCase();
    seenHeadings.set(key, (seenHeadings.get(key) ?? 0) + 1);
  }
  const dupHeadings = [...seenHeadings.entries()].filter(([, c]) => c > 1).map(([k]) => k);
  if (dupHeadings.length > 0) {
    push("repetitive_sections", "content", "suggestion", "Repetitive or generic sections", `Repeated heading: "${dupHeadings[0]}".`);
  }

  // ---- On-page ------------------------------------------------------------
  const kwCount = keyword ? (bodyText.toLowerCase().match(new RegExp(escapeRe(keyword), "g")) || []).length : 0;
  if (keyword && kwCount === 0) {
    push("keyword_usage", "onpage", "warn", "Natural primary keyword usage", "The primary keyword does not appear in the body.");
  } else if (keyword) {
    push("keyword_usage", "onpage", "pass", "Natural primary keyword usage", `Primary keyword appears ${kwCount} time(s).`);
  } else {
    push("keyword_usage", "onpage", "info", "Natural primary keyword usage", "No primary keyword set.");
  }

  const internalLinks = md.links.filter((l) => hostOf(l.href) === siteDomain || l.href.startsWith("/"));
  const externalLinks = md.links.filter((l) => hostOf(l.href) !== siteDomain && !l.href.startsWith("/"));
  if (internalLinks.length === 0) {
    push("internal_links", "onpage", "warn", "Internal links", "No internal links found in the article.");
  } else {
    push("internal_links", "onpage", "pass", "Internal links", `${internalLinks.length} internal link(s) found.`);
  }
  if (externalLinks.length === 0) {
    push("external_citations", "onpage", "suggestion", "External citations", "No external source citations found; consider linking authoritative sources.");
  } else {
    push("external_citations", "onpage", "pass", "External citations", `${externalLinks.length} external link(s) found.`);
  }

  const vagueLinks = md.links.filter((l) => /^(click here|here|read more|this)$/i.test(l.text));
  if (vagueLinks.length > 0) {
    push("descriptive_link_text", "onpage", "suggestion", "Descriptive link text", `${vagueLinks.length} link(s) use vague anchor text.`);
  }

  const images = draft.images.map((a) => ({ role: a.role, altText: a.altText ?? a.image.altText }));
  const hasFeatured = images.some((i) => i.role === "FEATURED");
  if (!hasFeatured) {
    push("featured_image", "onpage", "warn", "Featured image", "No featured image is selected.");
  }
  const missingAlt = images.filter((i) => !i.altText || !i.altText.trim());
  if (images.length > 0 && missingAlt.length > 0) {
    push("image_alt_text", "onpage", "warn", "Image alt text", `${missingAlt.length} image(s) are missing descriptive alt text.`);
  } else if (images.length === 0) {
    push("image_alt_text", "onpage", "info", "Image alt text", "No images in this draft.");
  }

  // Near-duplicate title within the site's drafts
  const normTitle = draft.title.toLowerCase().replace(/\s+/g, " ").trim();
  const dup = await prisma.articleDraft.count({
    where: { websiteId, id: { not: draftId }, title: { contains: draft.title } },
  });
  if (dup > 0) {
    push("duplicate_title", "onpage", "warn", "Duplicate or near-duplicate content", `${dup} other draft(s) have a similar title on this site.`);
  }

  // ---- Technical ----------------------------------------------------------
  if (canonical) {
    push("canonical", "technical", "pass", "Canonical URL", "A canonical URL is configured.");
  } else {
    push("canonical", "technical", "info", "Canonical URL", "No canonical configured (optional; applied at publication).");
  }

  if (md.hasStructuredData) {
    push("structured_data", "technical", "pass", "Structured data", "JSON-LD structured data detected in the body.");
  } else {
    push("structured_data", "technical", "suggestion", "Structured data", "No structured data detected (optional enhancement).");
  }

  push("broken_links", "technical", "info", "Broken links", "Broken-link and HTTP status checks require a live URL and are not performed automatically.", false, true);
  push("indexability", "technical", "info", "Indexability", "Indexability depends on the live WordPress site; not determinable locally.", false, true);

  // ---- Score --------------------------------------------------------------
  const categoryScores: Record<string, { score: number; max: number }> = {
    metadata: { score: 100, max: 100 },
    content: { score: 100, max: 100 },
    onpage: { score: 100, max: 100 },
    technical: { score: 100, max: 100 },
  };
  const deduct: Record<string, number> = { fail: 15, warn: 8, suggestion: 3, info: 0 };

  for (const c of checks) {
    if (c.status === "pass" || c.status === "info") continue;
    if (!categoryScores[c.category]) continue;
    categoryScores[c.category].score = Math.max(0, categoryScores[c.category].score - deduct[c.status]);
  }

  const weights: Record<string, number> = { metadata: 0.3, content: 0.3, onpage: 0.3, technical: 0.1 };
  let overall = 0;
  for (const [cat, { score }] of Object.entries(categoryScores)) {
    overall += score * weights[cat];
  }
  overall = Math.round(overall);

  const critical = checks.filter((c) => c.status === "fail").map((c) => `${c.label}: ${c.detail}`);
  const warnings = checks.filter((c) => c.status === "warn").map((c) => `${c.label}: ${c.detail}`);
  const suggestions = checks.filter((c) => c.status === "suggestion").map((c) => `${c.label}: ${c.detail}`);
  const mandatoryFailed = checks.some((c) => c.mandatory && c.status === "fail");

  // Persist the analysis on the draft.
  await prisma.sEOAnalysis.upsert({
    where: { draftId },
    update: {
      overallScore: overall,
      categories: toJsonString(categoryScores),
      critical: toJsonString(critical),
      warnings: toJsonString(warnings),
      suggestions: toJsonString(suggestions),
      mandatoryFailed,
      checks: toJsonString(checks),
    },
    create: {
      draftId,
      overallScore: overall,
      categories: toJsonString(categoryScores),
      critical: toJsonString(critical),
      warnings: toJsonString(warnings),
      suggestions: toJsonString(suggestions),
      mandatoryFailed,
      checks: toJsonString(checks),
    },
  });

  return {
    overall,
    categories: categoryScores,
    checks,
    critical,
    warnings,
    suggestions,
    mandatoryFailed,
    liveChecksRequired: checks.some((c) => c.live),
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function serializeSeo(row: {
  categories: string | null;
  critical: string | null;
  warnings: string | null;
  suggestions: string | null;
  checks: string | null;
  [k: string]: unknown;
} | null) {
  if (!row) return null;
  return {
    ...row,
    categories: fromJsonString<unknown>(row.categories, null),
    critical: fromJsonString<string[]>(row.critical, []),
    warnings: fromJsonString<string[]>(row.warnings, []),
    suggestions: fromJsonString<string[]>(row.suggestions, []),
    checks: fromJsonString<SeoCheck[]>(row.checks, []),
  };
}
